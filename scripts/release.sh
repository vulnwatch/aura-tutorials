#!/usr/bin/env bash
# Publish the videos as a GitHub release of this repository, from CI after a
# merge (docs/authoring.md, Publication), with gh and jq. A release holds every
# video, <id>.mp4, and videos.json, which lists them with the entry of the lock
# that each was made from; the latest one is at
# releases/latest/download/<id>.mp4. A video whose entry of the lock equals the
# one of the previous release is copied from it; the others are rendered, and
# their capture must give the fingerprints of the lock.
#
# Usage:
#   scripts/release.sh changed <ref>        Print the ids of the tutorials whose
#                                           entry of the lock differs from the
#                                           one at the Git ref <ref>
#   scripts/release.sh publish [--dry-run]  Render what changed since the latest
#                                           release, then create a release with
#                                           every video; --dry-run prepares
#                                           out/release/ without publishing
set -euo pipefail

# shellcheck source=scripts/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

readonly LOCK_FILE="${REPO_ROOT}/tutorials.lock.json"
readonly RELEASE_DIR="${REPO_ROOT}/out/release"
readonly PREVIOUS_DIR="${REPO_ROOT}/out/release-previous"

# Prints the ids of the lock $1, one per line.
lock_ids() {
    jq -r '.tutorials | keys[]' "$1"
}

# Prints the hash of the entry of the tutorial $2 in the lock $1, or nothing
# without one.
entry_hash() {
    local entry
    entry="$(jq -cS --arg id "$2" '.tutorials[$id] // empty' "$1")"
    [[ -n "${entry}" ]] || return 0
    printf 'sha256:%s\n' "$(printf '%s' "${entry}" | sha256sum | cut -d ' ' -f 1)"
}

cmd_changed() {
    [[ $# -eq 1 ]] || die "changed: takes a Git ref"
    local base id
    base="$(mktemp)"
    git -C "${REPO_ROOT}" show "$1:tutorials.lock.json" >"${base}" 2>/dev/null || echo '{"tutorials": {}}' >"${base}"
    while read -r id; do
        if [[ "$(entry_hash "${base}" "${id}")" != "$(entry_hash "${LOCK_FILE}" "${id}")" ]]; then
            echo "${id}"
        fi
    done < <(lock_ids "${LOCK_FILE}")
    rm -f "${base}"
}

# Prints the hash that the previous release's videos.json records for the
# tutorial $1, or nothing.
previous_hash() {
    [[ -f "${PREVIOUS_DIR}/videos.json" ]] || return 0
    jq -r --arg id "$1" '.videos[] | select(.id == $id) | .entry' "${PREVIOUS_DIR}/videos.json"
}

write_manifest() {
    local aura="$1" tag="$2"
    jq --arg aura "${aura}" --arg tag "${tag}" \
        --arg repository "${GITHUB_REPOSITORY:-vulnwatch/aura-tutorials}" \
        --arg commit "$(git -C "${REPO_ROOT}" rev-parse HEAD)" \
        --argjson hashes "$(
            while read -r id; do
                jq -n --arg id "${id}" --arg hash "$(entry_hash "${LOCK_FILE}" "${id}")" '{($id): $hash}'
            done < <(lock_ids "${LOCK_FILE}") | jq -s 'add // {}'
        )" \
        '{
          aura: $aura,
          release: $tag,
          repository: $repository,
          commit: $commit,
          videos: [.tutorials | to_entries[] | {
            id: .key,
            file: "\(.key).mp4",
            title: .value.title,
            aura: .value.aura,
            duration: .value.duration,
            chapters: .value.chapters,
            covers: .value.covers,
            entry: $hashes[.key]
          }]
        }' "${LOCK_FILE}" >"${RELEASE_DIR}/videos.json"
}

write_notes() {
    local aura="$1" tag="$2" repository="${GITHUB_REPOSITORY:-vulnwatch/aura-tutorials}"
    {
        echo "The video tutorials of Sentinel Aura ${aura}, 1920x1080 at 30 fps, without audio."
        echo
        echo "| Video | Duration | Chapters |"
        echo "|---|---|---|"
        jq -r --arg base "https://github.com/${repository}/releases/download/${tag}" \
            '.videos[] | "| [\(.title)](\($base)/\(.file)) | \(.duration | floor / 60 | floor):\(.duration | floor % 60 | tostring | if length < 2 then "0" + . else . end) | \(.chapters | length) |"' \
            "${RELEASE_DIR}/videos.json"
        echo
        echo "The latest video of a tutorial is always at https://github.com/${repository}/releases/latest/download/<id>.mp4."
    } >"${RELEASE_DIR}/notes.md"
}

cmd_publish() {
    local dry_run=false
    if [[ "${1:-}" == --dry-run ]]; then
        dry_run=true
        shift
    fi
    [[ $# -eq 0 ]] || die "publish: takes no arguments besides --dry-run"
    local aura stale previous id
    aura="$(aura_version)"
    stale="$("${REPO_ROOT}/scripts/tutorials.sh" status | awk '$2 != "up-to-date"')"
    [[ -z "${stale}" ]] || die "tutorials.lock.json is not current; render and commit first: ${stale//$'\n'/; }"

    rm -rf "${RELEASE_DIR}" "${PREVIOUS_DIR}"
    mkdir -p "${RELEASE_DIR}" "${PREVIOUS_DIR}"
    previous="$(gh release view --json tagName --jq .tagName 2>/dev/null || true)"
    if [[ -n "${previous}" ]]; then
        gh release download "${previous}" --pattern videos.json --dir "${PREVIOUS_DIR}"
    fi

    local -a render=() copy=()
    while read -r id; do
        if [[ -n "${previous}" && "$(previous_hash "${id}")" == "$(entry_hash "${LOCK_FILE}" "${id}")" ]]; then
            copy+=("${id}")
        else
            render+=("${id}")
        fi
    done < <(lock_ids "${LOCK_FILE}")
    if ((${#render[@]} == 0)) && [[ -n "${previous}" ]] &&
        [[ "$(jq -r '[.videos[].id] | sort | join(" ")' "${PREVIOUS_DIR}/videos.json")" == "$(lock_ids "${LOCK_FILE}" | sort | paste -sd ' ')" ]]; then
        echo "release.sh: ${previous} holds every video as the lock records it; nothing to publish" >&2
        return 0
    fi

    if ((${#render[@]} > 0)); then
        "${REPO_ROOT}/scripts/tutorials.sh" render "${render[@]}"
        # The render records its capture in the lock: the same fingerprints,
        # or the lock does not describe what CI captured.
        git -C "${REPO_ROOT}" diff --exit-code -- tutorials.lock.json ||
            die "the capture of CI differs from tutorials.lock.json; check the tutorials again and commit the lock"
        for id in "${render[@]}"; do
            cp "${REPO_ROOT}/out/${id}/${id}.mp4" "${RELEASE_DIR}/"
        done
    fi
    for id in "${copy[@]}"; do
        gh release download "${previous}" --pattern "${id}.mp4" --dir "${RELEASE_DIR}"
    done

    local count tag
    count="$(gh release list --limit 1000 --json tagName --jq "[.[] | select(.tagName | startswith(\"aura-${aura}-r\"))] | length" 2>/dev/null || echo 0)"
    tag="aura-${aura}-r$((count + 1))"
    write_manifest "${aura}" "${tag}"
    write_notes "${aura}" "${tag}"
    echo "release.sh: ${tag}: rendered ${render[*]:-nothing}; copied ${copy[*]:-nothing}" >&2
    if [[ "${dry_run}" == true ]]; then
        echo "release.sh: dry run; out/release/ holds the release" >&2
        return 0
    fi
    gh release create "${tag}" "${RELEASE_DIR}"/*.mp4 "${RELEASE_DIR}/videos.json" \
        --title "Sentinel Aura ${aura} tutorials, release $((count + 1))" \
        --notes-file "${RELEASE_DIR}/notes.md" --target "$(git -C "${REPO_ROOT}" rev-parse HEAD)" --latest
}

main() {
    if [[ $# -eq 0 ]]; then
        usage
        exit 2
    fi
    local command="$1"
    shift
    command -v jq >/dev/null 2>&1 || die "jq is required"
    case "${command}" in
        changed) cmd_changed "$@" ;;
        publish)
            command -v gh >/dev/null 2>&1 || die "the GitHub CLI, gh, is required"
            cmd_publish "$@"
            ;;
        -h | --help | help) usage ;;
        *)
            usage
            die "unknown command: ${command}"
            ;;
    esac
}

main "$@"
