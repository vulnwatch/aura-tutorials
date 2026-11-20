#!/usr/bin/env bash
# Keep the tracking issue of the image scan in step with its result
# (docs/deployment.md, Vulnerability Scan), as Aura's script of this name
# does: open the issue, or update the open one, when the scan of the image of
# the latest release found fixable HIGH or CRITICAL vulnerabilities, and close
# it when the scan found none.
#
# Usage:
#   scripts/image-scan-issue.sh <report> <tag> <image>
#
# <report> is Trivy's JSON report of the scan, limited to fixable HIGH and
# CRITICAL vulnerabilities, of the image of the release <tag>, such as
# aura-v0.10.0-r2, whose reference by digest is <image>. gh authenticates
# with GH_TOKEN. GITHUB_REPOSITORY names the repository, and RUN_URL the
# workflow run, which keeps the complete report.
set -euo pipefail

# shellcheck source=scripts/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

# The issue is found by its title, among the open ones.
readonly ISSUE_TITLE="Image scan: fixable HIGH or CRITICAL vulnerabilities"
# The findings that the issue lists; the run's complete report has them all.
readonly MAX_ROWS=100

# Prints the number of the open tracking issue, or nothing.
open_issue() {
    gh issue list --repo "${GITHUB_REPOSITORY}" --state open \
        --search "in:title \"${ISSUE_TITLE}\"" --limit 100 --json number,title |
        jq -r --arg title "${ISSUE_TITLE}" \
            '[.[] | select(.title == $title)][0].number // empty'
}

# Prints the scanned image, of the release $1, whose reference by digest is
# $2, as the issue and its closing comment name it.
scanned_image() {
    printf "the image of the latest release, [%s](https://github.com/%s/releases/tag/%s), \`%s\`" \
        "$1" "${GITHUB_REPOSITORY}" "$1" "$2"
}

# Prints the body of the tracking issue for the report $1 with $2 findings,
# of the image of the release $3, whose reference by digest is $4.
issue_body() {
    local report="$1" count="$2" tag="$3" image="$4"
    cat <<BODY
The image scan found ${count} fixable HIGH or CRITICAL vulnerabilities in $(scanned_image "${tag}" "${image}"). The [workflow run](${RUN_URL}) keeps the complete report.

A fix usually arrives as the pull request of Renovate that updates the base image, nginx, of \`site/Containerfile\`. Its merge makes a release, whose image has the new base, and the scan that runs after that release closes this issue if no fixable vulnerability remains. See \`docs/deployment.md\` (Vulnerability Scan) and \`docs/authoring.md\` (Update the Tools).

| Vulnerability | Severity | Package | Installed | Fixed in |
|---|---|---|---|---|
BODY
    jq -r --argjson max "${MAX_ROWS}" '
        [.Results[]?.Vulnerabilities[]?] | .[:$max][]
        | "| \(.VulnerabilityID) | \(.Severity) | \(.PkgName) | \(.InstalledVersion) | \(.FixedVersion) |"
    ' "${report}"
    if ((count > MAX_ROWS)); then
        printf '\nThe table lists the first %d findings.\n' "${MAX_ROWS}"
    fi
}

main() {
    if [[ $# -ne 3 ]]; then
        usage
        exit 2
    fi
    local report="$1" tag="$2" image="$3" count issue body_file
    [[ -n "${GITHUB_REPOSITORY:-}" && -n "${RUN_URL:-}" ]] ||
        die "GITHUB_REPOSITORY and RUN_URL must be set"
    is_release_tag "${tag}" || die "'${tag}' is not the tag of a release, such as aura-v0.10.0-r2"
    is_release_reference "${image}" ||
        die "'${image}' is not a reference by digest of ${RELEASE_IMAGE}"
    count="$(jq '[.Results[]?.Vulnerabilities[]?] | length' "${report}")" ||
        die "cannot read the report ${report}"
    issue="$(open_issue)"

    if ((count == 0)); then
        if [[ -n "${issue}" ]]; then
            gh issue close "${issue}" --repo "${GITHUB_REPOSITORY}" \
                --comment "The image scan found no fixable HIGH or CRITICAL vulnerabilities in $(scanned_image "${tag}" "${image}"): [workflow run](${RUN_URL})."
            echo "Closed issue #${issue}: no fixable HIGH or CRITICAL vulnerabilities"
        else
            echo "No fixable HIGH or CRITICAL vulnerabilities, and no open issue"
        fi
        return 0
    fi

    body_file="$(mktemp)"
    issue_body "${report}" "${count}" "${tag}" "${image}" >"${body_file}"
    if [[ -n "${issue}" ]]; then
        gh issue edit "${issue}" --repo "${GITHUB_REPOSITORY}" --body-file "${body_file}"
        echo "Updated issue #${issue}: ${count} fixable HIGH or CRITICAL vulnerabilities"
    else
        gh issue create --repo "${GITHUB_REPOSITORY}" --title "${ISSUE_TITLE}" \
            --body-file "${body_file}"
        echo "Opened an issue: ${count} fixable HIGH or CRITICAL vulnerabilities"
    fi
    rm -f -- "${body_file}"
}

main "$@"
