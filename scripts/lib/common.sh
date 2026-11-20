#!/usr/bin/env bash
# The code that the scripts under scripts/ share, which they source after
# setting their strict mode: their diagnostics and usage, the identity of this
# clone, and the development server of the submodule aura/.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
readonly REPO_ROOT

# Writes the message $* to stderr, prefixed with the name of the running
# script.
warn() {
    echo "${0##*/}: $*" >&2
}

# Writes the message $* like warn, then exits with status 1.
die() {
    warn "$@"
    exit 1
}

# Writes the header comment of the running script, its purpose and usage,
# without the comment markers, to stderr.
usage() {
    awk 'NR == 1 { next } !/^#/ { exit } { sub(/^# ?/, ""); print }' "$0" >&2
}

# The identifier of this clone, from the path of its root: its dependencies
# and its caches are named after it.
CLONE_ID="$(printf '%s' "${REPO_ROOT}" | sha256sum | cut -c1-12)"
# shellcheck disable=SC2034  # used by the scripts that source this file
readonly CLONE_ID

# The development server of the submodule, on http://localhost:5173. Aura's
# scripts/dev-env.sh names its backend after the path of the clone
# (scripts/lib/common.sh, clone_id), and its scripts/tooling.sh dev names the
# container of the server after the network of the backend.
# shellcheck disable=SC2034  # used by the scripts that source this file
readonly DEV_PORT=5173
AURA_ID="$(printf '%s' "$(cd "${REPO_ROOT}/aura" && pwd -P)" | sha256sum | cut -c1-12)"
readonly AURA_ID
readonly DEV_SERVER="sentinel-aura-${AURA_ID}_default-dev-server"

# Succeeds when the container of the development server runs.
dev_server_running() {
    [[ "$(docker container inspect --format '{{.State.Running}}' "${DEV_SERVER}" 2>/dev/null)" == true ]]
}

# Prints the version of Aura that the submodule holds: its release tag, or
# its abbreviated commit when no tag names it.
aura_version() {
    git -C "${REPO_ROOT}/aura" describe --tags --exact-match 2>/dev/null ||
        git -C "${REPO_ROOT}/aura" rev-parse --short HEAD
}

# The repository on GitHub, and the image of the website that its releases
# publish (docs/deployment.md), which a registry wants in lower case.
REPOSITORY="${GITHUB_REPOSITORY:-vulnwatch/aura-tutorials}"
# shellcheck disable=SC2034  # used by the scripts that source this file
readonly REPOSITORY
RELEASE_IMAGE="ghcr.io/${REPOSITORY,,}"
readonly RELEASE_IMAGE

# Succeeds when $1 is the tag of a release, such as aura-v0.10.0-r2: the
# version of Aura that the videos show, and the number of the release for it.
is_release_tag() {
    [[ "$1" =~ ^aura-[0-9A-Za-z.+-]+-r[1-9][0-9]*$ ]]
}

# Succeeds when $1 is the digest of an image.
is_digest() {
    [[ "$1" =~ ^sha256:[0-9a-f]{64}$ ]]
}

# Succeeds when $1 is a reference by digest of the image of a release, such as
# ghcr.io/vulnwatch/aura-tutorials@sha256:<64 hexadecimal digits>.
is_release_reference() {
    [[ "${1%@*}" == "${RELEASE_IMAGE}" ]] && is_digest "${1#*@}"
}

# Fails unless Docker's Buildx plugin is installed.
require_buildx() {
    docker buildx version >/dev/null 2>&1 || die "Docker's Buildx plugin is required"
}

# Prints the digest that the image tag $1, such as
# ghcr.io/vulnwatch/aura-tutorials:aura-v0.10.0-r2, names in its registry.
resolve_digest() {
    local digest
    require_buildx
    digest="$(docker buildx imagetools inspect "$1" --format '{{.Manifest.Digest}}')" ||
        die "cannot resolve $1 in the registry"
    is_digest "${digest}" || die "unexpected digest '${digest}' for $1"
    printf '%s\n' "${digest}"
}

# The website that src/site.mjs generates, and what its image is built from,
# besides the site.
# shellcheck disable=SC2034  # used by the scripts that source this file
readonly SITE_DIR="${REPO_ROOT}/out/site"
# shellcheck disable=SC2034  # used by the scripts that source this file
readonly IMAGE_DIR="${REPO_ROOT}/site"
