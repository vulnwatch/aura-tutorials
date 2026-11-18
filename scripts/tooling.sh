#!/usr/bin/env bash
# Run the repository's Node.js commands in disposable containers of the tooling
# image (Containerfile), through Docker Engine, as Aura's scripts/tooling.sh
# does. npm, npx, and node never run on the host.
#
# A container runs with the user and group IDs of the invoking user, without
# capabilities, and receives from the host the repository, read-only, and
# three writable directories: out/, where every run writes, the dependencies,
# and the cache of HyperFrames. The dependencies live in a directory of this
# clone under $XDG_CACHE_HOME/aura-tutorials/, or ~/.cache/aura-tutorials/,
# mounted on node_modules/, which stays empty on the host; every command but
# `npm` first installs them with `npm ci` when the directory is new or when
# the image, package.json, or package-lock.json changed. HyperFrames runs
# without telemetry, update checks, skills, or installations of its own, with
# the Chromium of the image, and renders without a network.
#
# Usage:
#   scripts/tooling.sh install               Install the dependencies (npm ci)
#   scripts/tooling.sh npm <args>            Run npm, with write access to
#                                            package.json and package-lock.json
#   scripts/tooling.sh versions              Print the versions of Node.js,
#                                            FFmpeg, Chromium, and HyperFrames;
#                                            fails below Node.js 22
#   scripts/tooling.sh tutorials <args>      Run src/tutorials.mjs, offline,
#                                            with write access to
#                                            tutorials.lock.json
#   scripts/tooling.sh capture <id>          Capture the tutorial <id> from the
#                                            development server of aura/, into
#                                            out/<id>/capture/
#   scripts/tooling.sh compose <id>          Generate its HyperFrames
#                                            composition, in
#                                            out/<id>/composition/
#   scripts/tooling.sh render <id> [args]    Render the composition to
#                                            out/<id>/<id>.mp4, with its title
#                                            and chapters
#   scripts/tooling.sh preview <id>          Serve the composition in
#                                            HyperFrames Studio on
#                                            http://localhost:3002
#   scripts/tooling.sh hyperframes <id> <command> [args]
#                                            Run another HyperFrames command,
#                                            such as lint, check, or snapshot,
#                                            on the composition, offline
#   scripts/tooling.sh site build <out> <videos>...
#                                            Generate the website of the
#                                            tutorials into <out>, offline,
#                                            with the videos of <videos>
#                                            (src/site.mjs)
#   scripts/tooling.sh site serve <dir>      Serve the website in <dir> on
#                                            http://localhost:8080
#   scripts/tooling.sh ffmpeg <args>         Run FFmpeg in out/, offline
#   scripts/tooling.sh clean                 Remove the dependencies and the
#                                            cache of HyperFrames
#
# <id> is the id of a tutorial, the name of its script in tutorials/ without
# .json. scripts/tutorials.sh runs these commands in the order that a video
# needs.
set -euo pipefail

# shellcheck source=scripts/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

# The image that the Containerfile builds, tagged with the hash of the
# Containerfile, so that a change of it builds a new one.
IMAGE="localhost/aura-tutorials-tooling:$(sha256sum "${REPO_ROOT}/Containerfile" | cut -c1-12)"
readonly IMAGE

# The dependencies and the cache of HyperFrames of this clone, named after its
# path, and the file that records the installation.
CACHE_HOME="${XDG_CACHE_HOME:-}"
[[ "${CACHE_HOME}" == /* ]] || CACHE_HOME="${HOME:?HOME is not set}/.cache"
readonly DEPS_DIR="${CACHE_HOME}/aura-tutorials/node-modules-${CLONE_ID}"
readonly STAMP_FILE="${DEPS_DIR}.stamp"
readonly HF_CACHE_DIR="${CACHE_HOME}/aura-tutorials/hyperframes-${CLONE_ID}"
readonly DEPENDENCY_FILES=(package.json package-lock.json)
readonly LOCK_FILE="tutorials.lock.json"

# The port of HyperFrames Studio, and that of the preview of the website.
readonly PREVIEW_PORT=3002
readonly SITE_PORT=8080

# The settings of HyperFrames: no telemetry, update checks, skills, or
# installations on first use; its cache in the mounted directory; the
# headless shell of Playwright's Chromium, so that it downloads no browser;
# and the safe profile of one worker, since its detection of the memory reads
# the host's, not the container's.
readonly HF_ENV=(
    --env=HYPERFRAMES_NO_TELEMETRY=1
    --env=DO_NOT_TRACK=1
    --env=HYPERFRAMES_NO_UPDATE_CHECK=1
    --env=HYPERFRAMES_NO_AUTO_INSTALL=1
    --env=HYPERFRAMES_SKIP_SKILLS=1
    --env=HYPERFRAMES_NO_OPTIONAL_INSTALL=1
    --env=HYPERFRAMES_CACHE_DIR=/cache
    --env=HYPERFRAMES_RENDER_LOCK=off
)

check_docker() {
    [[ ${EUID} -ne 0 ]] || die "run as a regular user: the containers run with your user ID"
    command -v docker >/dev/null 2>&1 || die "Docker Engine is required"
    docker version --format '{{.Server.Version}}' >/dev/null 2>&1 ||
        die "cannot reach the Docker daemon"
}

ensure_image() {
    if ! docker image inspect "${IMAGE}" >/dev/null 2>&1; then
        echo "tooling.sh: building ${IMAGE}" >&2
        # Without a build context: the Containerfile copies nothing.
        docker build --quiet --tag "${IMAGE}" - <"${REPO_ROOT}/Containerfile" >/dev/null
    fi
}

install_stamp() {
    {
        printf '%s\n' "${IMAGE}"
        (cd "${REPO_ROOT}" && sha256sum "${DEPENDENCY_FILES[@]}")
    } | sha256sum | cut -d ' ' -f 1
}

# Runs a command in a disposable container. Arguments: further docker
# options, then "--", then the command and its arguments.
run_container() {
    local -a options=() tty=()
    while [[ $# -gt 0 && "$1" != "--" ]]; do
        options+=("$1")
        shift
    done
    [[ $# -gt 0 ]] || die "run_container: missing '--'"
    shift
    if [[ -t 0 && -t 1 ]]; then
        tty=(--interactive --tty)
    fi
    ensure_image
    mkdir -p "${DEPS_DIR}" "${HF_CACHE_DIR}" "${REPO_ROOT}/node_modules" "${REPO_ROOT}/out"
    docker run --rm "${tty[@]}" \
        --user="$(id -u):$(id -g)" \
        --cap-drop=ALL \
        --security-opt=no-new-privileges \
        --shm-size=2g \
        --env=HOME=/tmp \
        --env=NPM_CONFIG_UPDATE_NOTIFIER=false \
        --env=PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
        --env=AURA_VERSION="$(aura_version)" \
        "${HF_ENV[@]}" \
        --volume="${REPO_ROOT}:/work:ro,z" \
        --volume="${DEPS_DIR}:/work/node_modules:rw,z" \
        --volume="${REPO_ROOT}/out:/work/out:rw,z" \
        --volume="${HF_CACHE_DIR}:/cache:rw,z" \
        --workdir=/work \
        "${options[@]}" \
        "${IMAGE}" "$@"
}

install_dependencies() {
    local stamp
    stamp="$(install_stamp)"
    echo "tooling.sh: installing the dependencies in ${DEPS_DIR}" >&2
    rm -f "${STAMP_FILE}"
    # On stderr, so that the output of the command that needed the
    # installation stays its own.
    run_container -- npm ci >&2
    printf '%s\n' "${stamp}" >"${STAMP_FILE}"
}

ensure_installed() {
    [[ -f "${REPO_ROOT}/package-lock.json" ]] || die "missing package-lock.json"
    if [[ "$(cat "${STAMP_FILE}" 2>/dev/null || true)" != "$(install_stamp)" ]]; then
        install_dependencies
    fi
}

# A shell command that sets HyperFrames' browser to the headless shell of the
# image, whose path holds the revision of Chromium, and then runs the
# arguments of `bash -c`.
# shellcheck disable=SC2016  # expanded in the container
readonly WITH_BROWSER='export HYPERFRAMES_BROWSER_PATH="$(ls -d /ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux*/chrome-headless-shell | head -n 1)"; exec "$@"'

# Fails unless $1 is the id of a tutorial.
check_id() {
    [[ "$1" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ && -f "${REPO_ROOT}/tutorials/$1.json" ]] ||
        die "no tutorial '$1'; give the name of a script of tutorials/ without .json"
}

composition_dir() {
    printf 'out/%s/composition\n' "$1"
}

require_composition() {
    [[ -f "${REPO_ROOT}/$(composition_dir "$1")/index.html" ]] ||
        die "no composition of $1; run 'scripts/tooling.sh compose $1'"
}

cmd_install() {
    [[ $# -eq 0 ]] || die "install: takes no arguments"
    install_dependencies
}

cmd_npm() {
    [[ $# -ge 1 ]] || die "npm: missing the npm command"
    # A first lockfile, empty, which npm replaces; the mount needs the file.
    if [[ ! -f "${REPO_ROOT}/package-lock.json" ]]; then
        printf '{"lockfileVersion": 3, "requires": true, "packages": {}}\n' \
            >"${REPO_ROOT}/package-lock.json"
    fi
    rm -f "${STAMP_FILE}"
    run_container \
        --volume="${REPO_ROOT}/package.json:/work/package.json:rw,z" \
        --volume="${REPO_ROOT}/package-lock.json:/work/package-lock.json:rw,z" \
        -- npm "$@"
}

cmd_versions() {
    [[ $# -eq 0 ]] || die "versions: takes no arguments"
    ensure_installed
    # shellcheck disable=SC2016  # expanded in the container
    run_container --network=none -- bash -c "${WITH_BROWSER}" bash bash -c '
        set -euo pipefail
        echo "Node.js $(node --version)"
        echo "npm $(npm --version)"
        ffmpeg -hide_banner -version | head -n 1
        echo "Chromium (Playwright): $("$(ls -d /ms-playwright/chromium-*/chrome-linux*/chrome | head -n 1)" --version)"
        echo "Chromium (HyperFrames): $("${HYPERFRAMES_BROWSER_PATH}" --version)"
        echo "Playwright $(node -p "require(\"playwright/package.json\").version")"
        echo "HyperFrames $(npx --no-install hyperframes --version)"
        major="$(node -p "process.versions.node.split(\".\")[0]")"
        ((major >= 22)) || { echo "Node.js 22 or later is required" >&2; exit 1; }'
}

cmd_tutorials() {
    [[ $# -ge 1 ]] || die "tutorials: missing the command of src/tutorials.mjs"
    ensure_installed
    # The mount needs the file.
    [[ -f "${REPO_ROOT}/${LOCK_FILE}" ]] || printf '{\n  "tutorials": {}\n}\n' >"${REPO_ROOT}/${LOCK_FILE}"
    run_container --network=none \
        --volume="${REPO_ROOT}/${LOCK_FILE}:/work/${LOCK_FILE}:rw,z" -- \
        node src/tutorials.mjs "$@"
}

# The capture shares the network namespace of the development server, where
# the UI is on http://localhost:5173, the origin from which Chromium accepts
# the Secure session cookie.
cmd_capture() {
    [[ $# -eq 1 ]] || die "capture: takes the id of a tutorial"
    check_id "$1"
    dev_server_running ||
        die "no running development server ${DEV_SERVER}; start it with 'scripts/backend.sh start'"
    ensure_installed
    run_container --network="container:${DEV_SERVER}" -- node src/capture.mjs "$1" "out/$1"
}

cmd_compose() {
    [[ $# -eq 1 ]] || die "compose: takes the id of a tutorial"
    check_id "$1"
    ensure_installed
    run_container --network=none -- node src/compose.mjs "$1" "out/$1"
}

# HyperFrames renders out/<id>/render.mp4; FFmpeg then writes the title and
# the chapters of compose.mjs into out/<id>/<id>.mp4, without encoding again.
cmd_render() {
    [[ $# -ge 1 ]] || die "render: takes the id of a tutorial"
    local id="$1"
    shift
    check_id "${id}"
    require_composition "${id}"
    ensure_installed
    run_container --network=none --env=PRODUCER_LOW_MEMORY_MODE=false -- \
        bash -c "${WITH_BROWSER}" bash \
        npx --no-install hyperframes render "$(composition_dir "${id}")" \
        --output "out/${id}/render.mp4" --fps 30 "$@"
    run_container --network=none -- ffmpeg -hide_banner -loglevel error -y \
        -i "out/${id}/render.mp4" -i "out/${id}/chapters.ffmeta" \
        -map 0 -map_metadata 1 -map_chapters 1 -codec copy -movflags +faststart \
        "out/${id}/${id}.mp4"
    rm -f "${REPO_ROOT}/out/${id}/render.mp4"
}

# Studio listens on every interface of its container, which is reachable from
# the host only through the port published on its loopback interface.
cmd_preview() {
    [[ $# -eq 1 ]] || die "preview: takes the id of a tutorial"
    check_id "$1"
    require_composition "$1"
    ensure_installed
    run_container --name="aura-tutorials-preview-${CLONE_ID}" \
        --publish="127.0.0.1:${PREVIEW_PORT}:${PREVIEW_PORT}" \
        --env=HYPERFRAMES_PREVIEW_HOST=0.0.0.0 -- \
        bash -c "${WITH_BROWSER}" bash \
        npx --no-install hyperframes preview "$(composition_dir "$1")" \
        --port "${PREVIEW_PORT}" --no-open --foreground
}

cmd_hyperframes() {
    [[ $# -ge 2 ]] || die "hyperframes: takes the id of a tutorial and a HyperFrames command"
    local id="$1" command="$2"
    shift 2
    check_id "${id}"
    require_composition "${id}"
    ensure_installed
    run_container --network=none -- bash -c "${WITH_BROWSER}" bash \
        npx --no-install hyperframes "${command}" "$(composition_dir "${id}")" "$@"
}

# The server of the website listens on every interface of its container,
# reachable from the host only through the port published on its loopback
# interface.
cmd_site() {
    [[ $# -ge 2 ]] || die "site: takes build <out> <videos>..., or serve <dir>"
    ensure_installed
    case "$1" in
        build) run_container --network=none -- node src/site.mjs "$@" ;;
        serve)
            [[ $# -eq 2 ]] || die "site serve: takes the directory of the website"
            run_container --name="aura-tutorials-site-${CLONE_ID}" \
                --publish="127.0.0.1:${SITE_PORT}:${SITE_PORT}" -- \
                node src/site.mjs serve "$2" "${SITE_PORT}"
            ;;
        *) die "site: unknown command: $1" ;;
    esac
}

cmd_ffmpeg() {
    [[ $# -ge 1 ]] || die "ffmpeg: missing the arguments of FFmpeg"
    run_container --network=none --workdir=/work/out -- ffmpeg -hide_banner "$@"
}

cmd_clean() {
    [[ $# -eq 0 ]] || die "clean: takes no arguments"
    rm -rf -- "${DEPS_DIR}" "${STAMP_FILE}" "${HF_CACHE_DIR}"
    echo "tooling.sh: removed ${DEPS_DIR} and ${HF_CACHE_DIR}" >&2
}

main() {
    if [[ $# -eq 0 ]]; then
        usage
        exit 2
    fi
    local command="$1"
    shift
    case "${command}" in
        install | npm | versions | tutorials | capture | compose | render | preview | hyperframes | site | ffmpeg)
            check_docker
            "cmd_${command}" "$@"
            ;;
        clean) cmd_clean "$@" ;;
        -h | --help | help) usage ;;
        *)
            usage
            die "unknown command: ${command}"
            ;;
    esac
}

main "$@"
