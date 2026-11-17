#!/usr/bin/env bash
# Turn a tutorial script into its video, through scripts/tooling.sh: capture
# its steps from the development server of the submodule aura/, generate the
# HyperFrames composition, and render it to out/<id>/<id>.mp4.
#
# The development server must run: start it, with its backend, with
# `aura/scripts/dev-env.sh start`.
#
# Usage:
#   scripts/video.sh <script> [render args]
#
# Example:
#   scripts/video.sh tutorials/sign-in-and-open-ticket.json
set -euo pipefail

TOOLING="$(dirname "${BASH_SOURCE[0]}")/tooling.sh"
readonly TOOLING

if [[ $# -lt 1 ]]; then
    awk 'NR == 1 { next } !/^#/ { exit } { sub(/^# ?/, ""); print }' "$0" >&2
    exit 2
fi
script="$1"
shift

"${TOOLING}" capture "${script}"
"${TOOLING}" compose "${script}"
"${TOOLING}" render "${script}" "$@"
