#!/usr/bin/env bash
# Run the UI under capture: the backend of the submodule aura/, Sentinel loaded
# with its example dataset, and its development server on
# http://localhost:5173, through Aura's scripts/dev-env.sh, in the background.
# Its output goes to out/dev-env.log.
#
# A tutorial that changes data needs the dataset as loaded, so it captures on
# a fresh backend (scripts/tutorials.sh does so); every other tutorial shares
# the running one.
#
# Usage:
#   scripts/backend.sh start    Start the backend and the development server,
#                               unless they run, and wait until the UI answers
#   scripts/backend.sh fresh    Remove the backend with its data, then start a
#                               new one
#   scripts/backend.sh stop     Stop the development server and remove the
#                               backend with its data
#   scripts/backend.sh status   Succeed when the UI answers
set -euo pipefail

# shellcheck source=scripts/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

readonly DEV_ENV="${REPO_ROOT}/aura/scripts/dev-env.sh"
readonly LOG_FILE="${REPO_ROOT}/out/dev-env.log"
# Whether the backend holds the dataset as loaded: "clean" once this script
# creates it, "dirty" once scripts/tutorials.sh captures a tutorial that
# changes data on it.
readonly STATE_FILE="${REPO_ROOT}/out/.backend-state"
readonly UI_URL="http://localhost:${DEV_PORT}/login"
# The first start downloads the images of the backend and installs Aura's
# dependencies.
readonly START_TIMEOUT=900

ui_answers() {
    curl --silent --fail --output /dev/null --max-time 5 "${UI_URL}"
}

# Succeeds when something listens on the port of the development server.
port_taken() {
    (: </dev/tcp/127.0.0.1/"${DEV_PORT}") 2>/dev/null
}

cmd_status() {
    if dev_server_running && ui_answers; then
        echo "backend.sh: the UI of Aura $(aura_version) answers on http://localhost:${DEV_PORT}" >&2
        return 0
    fi
    echo "backend.sh: the UI does not run" >&2
    return 1
}

cmd_start() {
    if dev_server_running && ui_answers; then
        return 0
    fi
    # Another clone of Aura, or another service, may hold the port.
    if ! dev_server_running && port_taken; then
        die "port ${DEV_PORT} is taken by another process; free it, or stop the other development server"
    fi
    mkdir -p "${REPO_ROOT}/out"
    echo "backend.sh: starting the backend and the development server of Aura $(aura_version); see ${LOG_FILE#"${REPO_ROOT}/"}" >&2
    setsid nohup "${DEV_ENV}" start >"${LOG_FILE}" 2>&1 </dev/null &
    local pid=$! waited=0
    until dev_server_running && ui_answers; do
        if ! kill -0 "${pid}" 2>/dev/null; then
            tail -n 30 "${LOG_FILE}" >&2
            die "the backend or the development server did not start"
        fi
        if ((waited >= START_TIMEOUT)); then
            tail -n 30 "${LOG_FILE}" >&2
            die "the UI did not answer within ${START_TIMEOUT} s"
        fi
        sleep 2
        waited=$((waited + 2))
    done
    # dev-env.sh reuses a running backend whose configuration is current, so a
    # backend of unknown state stays so.
    if ! grep -q 'reusing the running backend' "${LOG_FILE}"; then
        echo clean >"${STATE_FILE}"
    fi
    echo "backend.sh: the UI answers on http://localhost:${DEV_PORT}" >&2
}

cmd_stop() {
    mkdir -p "${REPO_ROOT}/out"
    rm -f "${STATE_FILE}"
    "${DEV_ENV}" stop >>"${LOG_FILE}" 2>&1 || die "cannot stop the backend; see ${LOG_FILE}"
}

main() {
    [[ $# -eq 1 ]] || {
        usage
        exit 2
    }
    case "$1" in
        start) cmd_start ;;
        fresh)
            cmd_stop
            cmd_start
            ;;
        stop) cmd_stop ;;
        status) cmd_status ;;
        -h | --help | help) usage ;;
        *)
            usage
            die "unknown command: $1"
            ;;
    esac
}

main "$@"
