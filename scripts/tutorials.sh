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
#   scripts/tutorials.sh render [--strict] [--reuse-capture] [--stale | --all | <id>...]
#                                              Capture, compose, and render the
#                                              tutorials (the stale ones by
#                                              default) to out/<id>/<id>.mp4,
#                                              and record them in the lock; the
#                                              composition reports the findings
#                                              of its checks, and --strict
#                                              fails on them once every video
#                                              is rendered, as CI runs it.
#                                              --reuse-capture renders a
#                                              tutorial from the capture that
#                                              out/<id>/capture holds, when it
#                                              is of the current script and
#                                              version of Aura, instead of
#                                              capturing it again: only after a
#                                              check with the same code, as in
#                                              CI, since a capture does not
#                                              record the code that made it
#   scripts/tutorials.sh frames <id> [<s>...]  Extract the frames of each step
#                                              of a rendered video, and a
#                                              contact sheet of each chapter,
#                                              into out/<id>/frames/, which
#                                              frames.md lists; with times in
#                                              seconds, only those frames
#   scripts/tutorials.sh check [--verify-only] [--since <ref> | <id>...]
#                                              Capture the tutorials (all by
#                                              default) again and compare their
#                                              screens with the lock: record
#                                              the unchanged videos as current
#                                              for this version of Aura, and
#                                              write out/report/check.md with
#                                              the changed screens beside the
#                                              earlier ones; fails when a video
#                                              needs a render. --since captures
#                                              only the tutorials that the
#                                              changes since the Git ref <ref>
#                                              can affect, as affected prints
#                                              them. --verify-only records
#                                              nothing, and also fails when the
#                                              lock is not current for any
#                                              tutorial, captured or not, as CI
#                                              runs it
#   scripts/tutorials.sh affected <ref>        Print the ids of the tutorials
#                                              that the changes since the Git
#                                              ref <ref> can affect: all of
#                                              them when a file changed that
#                                              every capture depends on
#                                              (SHARED_PATHS below); otherwise
#                                              those whose resolved script, or
#                                              whose entry of the lock, differs
#                                              from the lock at <ref>; needs jq
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

# What the capture of every tutorial depends on: Aura, the tooling, the code
# that captures, composes, and checks, the scripts that run them, and the
# workflow that runs the check. A change of a flow counts through the resolved
# scripts of the tutorials that include it; the catalog changes no screen, and
# validate checks the tasks that a script covers against it.
readonly -a SHARED_PATHS=(
    aura
    .gitmodules
    Containerfile
    package.json
    package-lock.json
    src/capture.mjs
    src/compose.mjs
    src/tutorials.mjs
    src/lib
    scripts
    .github/workflows/checks.yml
)

tutorials() {
    "${TOOLING}" tutorials "$@"
}

all_ids() {
    find "${REPO_ROOT}/tutorials" -maxdepth 1 -name '*.json' -printf '%f\n' | sed 's/\.json$//' | sort
}

# Prints the ids of the tutorials that the changes since the Git ref $1 can
# affect, and says why on stderr.
affected_ids() {
    local ref="$1" shared hashes base
    command -v jq >/dev/null 2>&1 || die "jq is required"
    git -C "${REPO_ROOT}" rev-parse --verify --quiet "${ref}^{commit}" >/dev/null ||
        die "not a commit of this repository: ${ref}"
    shared="$(git -C "${REPO_ROOT}" diff --name-only "${ref}" -- "${SHARED_PATHS[@]}")" ||
        die "cannot compare with ${ref}"
    if [[ -n "${shared}" ]]; then
        warn "every tutorial is affected: the changes since ${ref} touch ${shared//$'\n'/, }"
        all_ids
        return 0
    fi
    hashes="$(tutorials hashes)" || die "cannot resolve the scripts"
    base="$(git -C "${REPO_ROOT}" show "${ref}:tutorials.lock.json" 2>/dev/null)" || base='{"tutorials": {}}'
    # A changed script, a flow that it includes, or an entry of the lock that
    # claims other screens: each needs a capture to hold.
    # The locks are read as files: one argument holds at most 128 KiB.
    jq -rR --slurpfile base <(printf '%s' "${base}") --slurpfile lock "${REPO_ROOT}/tutorials.lock.json" '
        split("\t") as [$id, $hash]
        | select($id != null)
        | select($base[0].tutorials[$id].script != $hash or $base[0].tutorials[$id] != $lock[0].tutorials[$id])
        | $id' <<<"${hashes}"
}

cmd_affected() {
    [[ $# -eq 1 ]] || die "affected: takes a Git ref"
    affected_ids "$1"
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
    local strict=false reuse=false
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --strict) strict=true ;;
            --reuse-capture) reuse=true ;;
            *) break ;;
        esac
        shift
    done
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
        if [[ "${reuse}" == true ]] && tutorials captured "${id}" 2>/dev/null; then
            echo "tutorials.sh: rendering ${id} from the capture of out/${id}/capture" >&2
        else
            echo "tutorials.sh: rendering ${id}" >&2
            capture "${id}"
        fi
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
    local verify_only=false since=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --verify-only) verify_only=true ;;
            --since)
                [[ $# -ge 2 ]] || die "check: --since takes a Git ref"
                since="$2"
                shift
                ;;
            *) break ;;
        esac
        shift
    done
    local -a ids=("$@") skipped=()
    tutorials validate
    if [[ -n "${since}" ]]; then
        ((${#ids[@]} == 0)) || die "check: --since takes no tutorials"
        local affected id
        affected="$(affected_ids "${since}")"
        [[ -z "${affected}" ]] || mapfile -t ids <<<"${affected}"
        while read -r id; do
            [[ $'\n'"${affected}"$'\n' == *$'\n'"${id}"$'\n'* ]] || skipped+=("${id}")
        done < <(all_ids)
        echo "tutorials.sh: since ${since}: capturing ${ids[*]:-no tutorial}; not capturing ${skipped[*]:-none}" >&2
    elif ((${#ids[@]} == 0)); then
        mapfile -t ids < <(all_ids)
    fi
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
    if ((${#skipped[@]} > 0)); then
        mkdir -p "${REPO_ROOT}/out/report"
        {
            echo "## Not captured: no change since \`${since}\` can affect them"
            echo
            printf -- "- \`%s\`\n" "${skipped[@]}"
            echo
        } | tee -a "${REPO_ROOT}/out/report/check.md"
    fi
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
        affected) cmd_affected "$@" ;;
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
