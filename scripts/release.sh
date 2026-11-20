#!/usr/bin/env bash
# Publish the videos as a GitHub release of this repository, from CI after a
# merge (docs/authoring.md, Publication), with gh and jq, authenticated by a
# token that may write the contents of the repository and therefore sees
# draft releases. A release holds every
# video, <id>.mp4, its subtitles, <id>.vtt, and videos.json, which lists them
# with the entry of the lock
# that each was made from; the latest one is at
# releases/latest/download/<id>.mp4. A video whose entry of the lock equals the
# one of the previous release is copied from it; the others are rendered, and
# their capture must give the fingerprints of the lock. videos.json also
# records the hash of the website of the release and of what its image is
# built from (site/), so that a change of either alone makes a release too.
# A release is first a draft, and is published last, once its image and the
# attestations of the image exist, so that the image of a published release,
# which its tag names, is final (docs/deployment.md, Publication and
# Immutability).
#
# Usage:
#   scripts/release.sh changed <ref>        Print the ids of the tutorials whose
#                                           entry of the lock differs from the
#                                           one at the Git ref <ref>
#   scripts/release.sh publish [--dry-run]  Render what changed since the latest
#                                           published release, generate the
#                                           website into out/site/, then create
#                                           a draft release with every video,
#                                           in place of the drafts that earlier
#                                           runs left, unless the latest release
#                                           already holds them and that
#                                           website; out/release/videos.json
#                                           then names the release, and
#                                           out/release/draft exists when it is
#                                           a new draft; --dry-run prepares
#                                           them without creating the draft
#   scripts/release.sh check <tag>          Fail unless <tag> names a draft
#                                           release of the commit of the
#                                           checkout, and no published one,
#                                           which is final
#   scripts/release.sh finish <tag> <image> <sbom> <sbom-bundle> <provenance-bundle>
#                                           Attach to the draft release <tag>,
#                                           as its assets, the SBOM of the
#                                           image <image>, a reference by
#                                           digest, and the Sigstore bundles of
#                                           the image's SBOM and build
#                                           provenance attestations; state the
#                                           image in its notes; then publish
#                                           it, as the latest release and the
#                                           last action, and warn when the
#                                           release is not immutable
set -euo pipefail

# shellcheck source=scripts/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

readonly LOCK_FILE="${REPO_ROOT}/tutorials.lock.json"
readonly RELEASE_DIR="${REPO_ROOT}/out/release"
readonly PREVIOUS_DIR="${REPO_ROOT}/out/release-previous"
# The line that starts the section of the release notes that finish writes,
# so that a rerun replaces it.
readonly NOTES_MARKER="<!-- scripts/release.sh: the image of the website -->"

# The working directory of finish, removed on exit.
WORK_DIR=""

remove_work_dir() {
    if [[ -n "${WORK_DIR}" ]]; then
        rm -rf -- "${WORK_DIR}"
    fi
}

# Prints, for each GitHub Release of the tag $1, "published", or "draft" and
# the commit that the draft targets.
release_states() {
    gh api --paginate "repos/${REPOSITORY}/releases?per_page=100" \
        --jq ".[] | select(.tag_name == \"$1\") | if .draft then \"draft \(.target_commitish)\" else \"published\" end"
}

# Prints the identifier and the tag of each draft release.
draft_releases() {
    gh api --paginate "repos/${REPOSITORY}/releases?per_page=100" \
        --jq '.[] | select(.draft) | "\(.id) \(.tag_name)"'
}

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

# Prints the hash of the website in out/site/ and of what its image is built
# from: of every file but the videos and their posters, which the entries of
# the lock answer for, and which an encoder may write differently.
site_hash() {
    local files
    files="$(
        cd "${IMAGE_DIR}"
        find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum
        cd "${SITE_DIR}"
        find . -type f ! -name '*.mp4' ! -name '*.jpg' -print0 | LC_ALL=C sort -z | xargs -0 sha256sum
    )"
    printf 'sha256:%s\n' "$(printf '%s\n' "${files}" | sha256sum | cut -d ' ' -f 1)"
}

write_manifest() {
    local aura="$1" tag="$2" site="$3"
    jq --arg aura "${aura}" --arg tag "${tag}" --arg site "${site}" \
        --arg repository "${REPOSITORY}" \
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
          site: $site,
          videos: [.tutorials | to_entries[] | {
            id: .key,
            file: "\(.key).mp4",
            subtitles: "\(.key).vtt",
            title: .value.title,
            subtitle: .value.subtitle,
            aura: .value.aura,
            duration: .value.duration,
            chapters: .value.chapters,
            steps: .value.steps,
            covers: .value.covers,
            entry: $hashes[.key]
          }]
        }' "${LOCK_FILE}" >"${RELEASE_DIR}/videos.json"
}

write_notes() {
    local aura="$1" tag="$2" repository="${REPOSITORY}"
    {
        echo "The video tutorials of Sentinel Aura ${aura}, 1920x1080 at 30 fps, narrated in English, each with its subtitles, <id>.vtt."
        echo
        echo "| Video | Duration | Chapters |"
        echo "|---|---|---|"
        jq -r --arg base "https://github.com/${repository}/releases/download/${tag}" \
            '.videos[] | "| [\(.title)](\($base)/\(.file)) | \(.duration | floor / 60 | floor):\(.duration | floor % 60 | tostring | if length < 2 then "0" + . else . end) | \(.chapters | length) |"' \
            "${RELEASE_DIR}/videos.json"
        echo
        echo "The latest video of a tutorial is always at https://github.com/${repository}/releases/latest/download/<id>.mp4, and its subtitles at <id>.vtt beside it."
    } >"${RELEASE_DIR}/notes.md"
}

cmd_publish() {
    local dry_run=false
    if [[ "${1:-}" == --dry-run ]]; then
        dry_run=true
        shift
    fi
    [[ $# -eq 0 ]] || die "publish: takes no arguments besides --dry-run"
    local aura stale previous id site states drafts draft
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
    if ((${#render[@]} > 0)); then
        "${REPO_ROOT}/scripts/tutorials.sh" render "${render[@]}"
        # The render records its capture in the lock: the same fingerprints,
        # or the lock does not describe what CI captured.
        git -C "${REPO_ROOT}" diff --exit-code -- tutorials.lock.json ||
            die "the capture of CI differs from tutorials.lock.json; check the tutorials again and commit the lock"
        for id in "${render[@]}"; do
            cp "${REPO_ROOT}/out/${id}/${id}.mp4" "${REPO_ROOT}/out/${id}/${id}.vtt" "${RELEASE_DIR}/"
        done
    fi
    for id in "${copy[@]}"; do
        gh release download "${previous}" --pattern "${id}.mp4" --pattern "${id}.vtt" --dir "${RELEASE_DIR}"
    done

    # The website of these videos, which Pages and the image receive.
    "${REPO_ROOT}/scripts/tooling.sh" site build out/site out/release
    site="$(site_hash)"
    if ((${#render[@]} == 0)) && [[ -n "${previous}" ]] &&
        [[ "$(jq -r '[.videos[].id] | sort | join(" ")' "${PREVIOUS_DIR}/videos.json")" == "$(lock_ids "${LOCK_FILE}" | sort | paste -sd ' ')" ]] &&
        [[ "$(jq -r '.site // empty' "${PREVIOUS_DIR}/videos.json")" == "${site}" ]]; then
        cp "${PREVIOUS_DIR}/videos.json" "${RELEASE_DIR}/videos.json"
        echo "release.sh: ${previous} holds every video as the lock records it, and this website; nothing to publish" >&2
        return 0
    fi

    local count tag
    # The published releases: a draft that an earlier run left has the number
    # of this one, which replaces it.
    count="$(gh release list --limit 1000 --exclude-drafts --json tagName --jq "[.[] | select(.tagName | startswith(\"aura-${aura}-r\"))] | length" 2>/dev/null || echo 0)"
    tag="aura-${aura}-r$((count + 1))"
    write_manifest "${aura}" "${tag}" "${site}"
    write_notes "${aura}" "${tag}"
    echo "release.sh: ${tag}: rendered ${render[*]:-nothing}; copied ${copy[*]:-nothing}" >&2
    if [[ "${dry_run}" == true ]]; then
        echo "release.sh: dry run; out/release/ holds the release, and out/site/ its website" >&2
        return 0
    fi
    states="$(release_states "${tag}")" || die "cannot list the releases of ${REPOSITORY}"
    [[ "${states}" != *published* ]] || die "release ${tag} is already published"
    # The drafts that earlier runs left, of this tag or of another version of
    # Aura: a run publishes only the draft of its own commit (check).
    drafts="$(draft_releases)" || die "cannot list the releases of ${REPOSITORY}"
    while read -r id draft; do
        is_release_tag "${draft}" || continue
        gh api --method DELETE "repos/${REPOSITORY}/releases/${id}" >/dev/null
        echo "release.sh: removed the draft release ${draft} that an earlier run left" >&2
    done <<<"${drafts}"
    # A draft, which the workflow publishes once the image of its website and
    # the attestations of the image exist (finish).
    gh release create "${tag}" "${RELEASE_DIR}"/*.mp4 "${RELEASE_DIR}"/*.vtt "${RELEASE_DIR}/videos.json" \
        --title "Sentinel Aura ${aura} tutorials, release $((count + 1))" \
        --notes-file "${RELEASE_DIR}/notes.md" --target "$(git -C "${REPO_ROOT}" rev-parse HEAD)" --draft
    touch "${RELEASE_DIR}/draft"
}

cmd_check() {
    [[ $# -eq 1 ]] || die "check: takes the tag of the release"
    local tag="$1" states commit
    is_release_tag "${tag}" || die "check: '${tag}' is not the tag of a release, such as aura-v0.10.0-r2"
    commit="$(git -C "${REPO_ROOT}" rev-parse HEAD)" || die "cannot read the commit of the checkout"
    states="$(release_states "${tag}")" || die "cannot list the releases of ${REPOSITORY}"
    [[ "${states}" != *published* ]] ||
        die "release ${tag} is already published, so its image and assets are final; ship a change as a new release"
    # A draft of another commit is the one of a later run, which replaced
    # the draft of this one: a rerun of the earlier run publishes nothing.
    [[ $'\n'"${states}"$'\n' == *$'\n'"draft ${commit}"$'\n'* ]] ||
        die "the tag ${tag} names no draft release of the commit ${commit:0:7} of the checkout, which 'scripts/release.sh publish' creates"
    echo "release.sh: ${tag} is a draft release of commit ${commit:0:7}" >&2
}

# Fails unless the file $1 is a Sigstore bundle.
require_bundle() {
    jq -e '.mediaType | startswith("application/vnd.dev.sigstore.bundle")' "$1" >/dev/null 2>&1 ||
        die "$1 is not a Sigstore bundle"
}

# Prints the notes of the release of the tag $1, with the section that states
# the image $2 after the notes that publish wrote.
release_notes() {
    local tag="$1" image="$2" body
    body="$(gh release view "${tag}" --repo "${REPOSITORY}" --json body --jq .body)" ||
        die "cannot read the notes of release ${tag}"
    body="${body%%"${NOTES_MARKER}"*}"
    while [[ "${body}" == *$'\n' ]]; do
        body="${body%$'\n'}"
    done
    cat <<EOF
${body}

${NOTES_MARKER}
### Image

\`${image}\`, tagged \`${RELEASE_IMAGE}:${tag}\`, serves the website of this release. Verify it before deploying it by its digest, as [Verify a Release](https://github.com/${REPOSITORY}/blob/${tag}/docs/deployment.md#verify-a-release) describes.
EOF
}

cmd_finish() {
    [[ $# -eq 5 ]] ||
        die "finish: takes the tag, the image, its SBOM, and the bundles of its SBOM and provenance attestations"
    local tag="$1" image="$2" sbom="$3" sbom_bundle="$4" provenance_bundle="$5" prefix immutable
    cmd_check "${tag}"
    is_release_reference "${image}" ||
        die "finish: '${image}' is not a reference by digest of ${RELEASE_IMAGE}"
    jq -e --arg version "${tag}" '.metadata.component.version == $version' \
        "${sbom}" >/dev/null 2>&1 || die "${sbom} is not the SBOM of the release ${tag}"
    require_bundle "${sbom_bundle}"
    require_bundle "${provenance_bundle}"

    WORK_DIR="$(mktemp -d)"
    trap remove_work_dir EXIT
    mkdir "${WORK_DIR}/assets"
    prefix="${WORK_DIR}/assets/aura-tutorials-${tag#aura-}"
    cp -- "${sbom}" "${prefix}.sbom.cdx.json"
    cp -- "${sbom_bundle}" "${prefix}.sbom.sigstore.json"
    cp -- "${provenance_bundle}" "${prefix}.provenance.sigstore.json"
    release_notes "${tag}" "${image}" >"${WORK_DIR}/notes.md"

    # --clobber keeps a rerun for a draft release idempotent.
    gh release upload "${tag}" "${WORK_DIR}/assets/"* --repo "${REPOSITORY}" --clobber
    gh release edit "${tag}" --repo "${REPOSITORY}" --notes-file "${WORK_DIR}/notes.md" --draft=false --latest
    echo "release.sh: published release ${tag} of ${image}" >&2

    # The release is published already, so a missing repository setting does
    # not turn the publication into a failure.
    immutable="$(gh release view "${tag}" --repo "${REPOSITORY}" --json isImmutable --jq .isImmutable)" ||
        immutable="unknown"
    if [[ "${immutable}" != true ]]; then
        echo "::warning::Release ${tag} is not immutable (isImmutable=${immutable}); enable release immutability in the repository settings (docs/deployment.md, Publication and Immutability)" >&2
    fi
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
        check | finish)
            command -v gh >/dev/null 2>&1 || die "the GitHub CLI, gh, is required"
            "cmd_${command}" "$@"
            ;;
        -h | --help | help) usage ;;
        *)
            usage
            die "unknown command: ${command}"
            ;;
    esac
}

main "$@"
