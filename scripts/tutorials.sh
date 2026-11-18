#!/usr/bin/env bash
# Make and keep the videos of the tutorials: capture each script from the UI
# of the submodule aura/, compose it, render it, and record it in
# tutorials.lock.json; and check which videos a new version of Aura changes
# (docs/authoring.md). The Node.js commands run through scripts/tooling.sh,
# and the UI through scripts/backend.sh.
#
# The tutorials that change data capture each on a fresh backend, after the
# others, which share one backend with the example dataset as loaded.
#
# Usage:
#   scripts/tutorials.sh list                  The tutorials
#   scripts/tutorials.sh validate              Check the scripts, flows, and
#                                              catalog
#   scripts/tutorials.sh status                Which videos are up to date
#                                              against tutorials.lock.json
#   scripts/tutorials.sh coverage              Which tasks of the catalog the
#                                              tutorials cover
#   scripts/tutorials.sh render [--strict] [--stale | --all | <id>...]
#                                              Capture, compose, and render the
#                                              tutorials (the stale ones by
#                                              default) to out/<id>/<id>.mp4,
#                                              and record them in the lock; the
#                                              composition reports the findings
#                                              of its checks, and --strict
#                                              fails on them once every video
#                                              is rendered, as CI runs it
#   scripts/tutorials.sh frames <id> [<s>...]  Extract the frames of each step
#                                              of a rendered video, and a
#                                              contact sheet of each chapter,
#                                              into out/<id>/frames/, which
#                                              frames.md lists; with times in
#                                              seconds, only those frames
#   scripts/tutorials.sh check [--verify-only] [<id>...]
#                                              Capture the tutorials (all by
#                                              default) again and compare their
#                                              screens with the lock: record
#                                              the unchanged videos as current
#                                              for this version of Aura, and
#                                              write out/report/check.md with
#                                              the changed screens beside the
#                                              earlier ones; fails when a video
#                                              needs a render. --verify-only
#                                              records nothing, and also fails
#                                              when the lock is not current, as
#                                              CI runs it
#   scripts/tutorials.sh preview <id>          Serve the composition of a
#                                              rendered tutorial in HyperFrames
#                                              Studio on http://localhost:3002
#   scripts/tutorials.sh site [--release] [--serve]
#                                              Generate the website of the
#                                              tutorials into out/site/, with
#                                              the videos of out/<id>/, then
#                                              with --release those of the
#                                              latest release, which it
#                                              downloads with gh into
#                                              out/site-videos/; --serve then
#                                              serves it on
#                                              http://localhost:3003
set -euo pipefail

# shellcheck source=scripts/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

readonly TOOLING="${REPO_ROOT}/scripts/tooling.sh"
readonly BACKEND="${REPO_ROOT}/scripts/backend.sh"
# Whether the running backend holds the dataset as loaded (scripts/backend.sh).
readonly BACKEND_STATE="${REPO_ROOT}/out/.backend-state"

tutorials() {
    "${TOOLING}" tutorials "$@"
}

all_ids() {
    find "${REPO_ROOT}/tutorials" -maxdepth 1 -name '*.json' -printf '%f\n' | sed 's/\.json$//' | sort
}

# A backend with the dataset as loaded, new if needed.
clean_backend() {
    if [[ "$(cat "${BACKEND_STATE}" 2>/dev/null || true)" == clean ]] && "${BACKEND}" status 2>/dev/null; then
        return 0
    fi
    "${BACKEND}" fresh
}

# Prints the ids $@ in the order of their capture: those that only read
# first, then those that change data.
capture_order() {
    local id
    local -a reading=() changing=()
    for id in "$@"; do
        if tutorials changes-data "${id}" 2>/dev/null; then
            changing+=("${id}")
        else
            reading+=("${id}")
        fi
    done
    printf '%s\n' "${reading[@]}" "${changing[@]}" | sed '/^$/d'
}

# Captures the tutorial $1 on a backend that holds the dataset as loaded.
capture() {
    local id="$1"
    if tutorials changes-data "${id}" 2>/dev/null; then
        "${BACKEND}" fresh
        echo dirty >"${BACKEND_STATE}"
    else
        clean_backend
    fi
    "${TOOLING}" capture "${id}"
}

cmd_render() {
    local strict=false
    if [[ "${1:-}" == --strict ]]; then
        strict=true
        shift
    fi
    local -a ids=()
    case "${1:---stale}" in
        --stale) mapfile -t ids < <(tutorials status --ids) ;;
        --all) mapfile -t ids < <(all_ids) ;;
        *) ids=("$@") ;;
    esac
    if ((${#ids[@]} == 0)); then
        echo "tutorials.sh: every video is up to date" >&2
        return 0
    fi
    tutorials validate
    local id
    while read -r id; do
        echo "tutorials.sh: rendering ${id}" >&2
        capture "${id}"
        "${TOOLING}" compose "${id}"
        "${TOOLING}" render "${id}"
        tutorials lock "${id}"
    done < <(capture_order "${ids[@]}")
    echo "tutorials.sh: rendered ${ids[*]} into out/<id>/<id>.mp4" >&2
    if [[ "${strict}" == true ]]; then
        tutorials findings "${ids[@]}" ||
            die "the checks of the composition found problems; see docs/authoring.md (Review)"
    fi
}

cmd_check() {
    local verify_only=false
    if [[ "${1:-}" == --verify-only ]]; then
        verify_only=true
        shift
    fi
    local -a ids=("$@")
    ((${#ids[@]} > 0)) || mapfile -t ids < <(all_ids)
    tutorials validate
    rm -rf "${REPO_ROOT}/out/report"
    local id status
    while read -r id; do
        echo "tutorials.sh: checking ${id}" >&2
        # The earlier capture, if any, shows beside the changed screens.
        rm -rf "${REPO_ROOT}/out/${id}/capture.previous" "${REPO_ROOT}/out/${id}/compare.json"
        if [[ -d "${REPO_ROOT}/out/${id}/capture" ]]; then
            mv "${REPO_ROOT}/out/${id}/capture" "${REPO_ROOT}/out/${id}/capture.previous"
        fi
        if ! capture "${id}"; then
            warn "the capture of ${id} failed"
            continue
        fi
        status="$(tutorials compare "${id}")"
        if [[ "${status}" == unchanged && "${verify_only}" == false ]]; then
            tutorials verify "${id}" || warn "${id} has unchanged screens but another script or generator than its video"
        fi
    done < <(capture_order "${ids[@]}")
    local failed=false
    tutorials report "${ids[@]}" || failed=true
    if [[ "${verify_only}" == true ]]; then
        local stale
        stale="$(tutorials status --ids)"
        if [[ -n "${stale}" ]]; then
            warn "tutorials.lock.json is not current for: ${stale//$'\n'/ }"
            failed=true
        fi
    fi
    [[ "${failed}" == false ]] || die "some videos need a render or a change of their script; see out/report/check.md"
}

cmd_site() {
    local release=false serve=false
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --release) release=true ;;
            --serve) serve=true ;;
            *) die "site: unknown argument: $1" ;;
        esac
        shift
    done
    local -a videos=(out)
    if [[ "${release}" == true ]]; then
        command -v gh >/dev/null 2>&1 || die "the GitHub CLI, gh, is required"
        rm -rf "${REPO_ROOT}/out/site-videos"
        gh release download --pattern '*.mp4' --dir "${REPO_ROOT}/out/site-videos"
        videos+=(out/site-videos)
    fi
    "${TOOLING}" site build out/site "${videos[@]}"
    echo "tutorials.sh: the website is in out/site/, $(du -sh "${REPO_ROOT}/out/site" | cut -f 1)" >&2
    if [[ "${serve}" == true ]]; then
        "${TOOLING}" site serve out/site
    fi
}

main() {
    if [[ $# -eq 0 ]]; then
        usage
        exit 2
    fi
    local command="$1"
    shift
    case "${command}" in
        list | validate | status | coverage | frames) tutorials "${command}" "$@" ;;
        render) cmd_render "$@" ;;
        check) cmd_check "$@" ;;
        preview) "${TOOLING}" preview "$@" ;;
        site) cmd_site "$@" ;;
        -h | --help | help) usage ;;
        *)
            usage
            die "unknown command: ${command}"
            ;;
    esac
}

main "$@"
