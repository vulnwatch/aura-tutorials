#!/usr/bin/env bash
# Build, test, inventory, scan, publish, and pull the image of the website of
# the tutorials: nginx and the site that src/site.mjs generates
# (docs/deployment.md), as Aura's scripts/image.sh does for the image of the
# UI. The script runs on the host with Docker Engine and its Buildx plugin,
# locally and in CI, and sbom and scan also with jq; Trivy runs from its
# official image, which the script pins.
#
# Usage:
#   scripts/image.sh build [<tag>]  Build the image
#                                   localhost/aura-tutorials-site:local from
#                                   the website in out/site/ and from site/,
#                                   with the labels of the release <tag>, such
#                                   as aura-v0.10.0-r2, or without it of a
#                                   development build, whose version is "dev",
#                                   and without the provenance attestation of
#                                   Buildx
#   scripts/image.sh test           Check the built image: that it is one
#                                   image manifest, its labels, its user, its
#                                   content, which is the website in out/site/
#                                   with no URL that leaves it but the links of
#                                   a page, and its server; then run it as the
#                                   cluster runs it, and check its processes
#                                   and its answers: every file of the site
#                                   with its type and the headers of the
#                                   server, the videos by range, and no
#                                   absolute redirect
#   scripts/image.sh sbom <file>    Write the CycloneDX SBOM of the built image
#                                   to <file>, then check it: the operating
#                                   system packages of the image, and the font
#                                   of package-lock.json, which the site
#                                   holds; offline
#   scripts/image.sh scan <dir>     Scan the operating system packages of the
#                                   built image for known vulnerabilities, and
#                                   write to <dir> Trivy's reports:
#                                   trivy-fixable.json, the fixable HIGH and
#                                   CRITICAL ones, and trivy-full.txt, all of
#                                   them
#   scripts/image.sh save <file>    Write the built image to a tar archive
#   scripts/image.sh load <file>    Load the built image from the archive that
#                                   save wrote
#   scripts/image.sh push <tag>     Push the built image, labeled as the
#                                   release <tag>, as
#                                   ghcr.io/vulnwatch/aura-tutorials:<tag>,
#                                   with the credentials of docker login, and
#                                   print its reference by the digest that the
#                                   registry names
#   scripts/image.sh pull <tag>     Pull the image of the release <tag> by the
#                                   digest that its tag names in the registry,
#                                   as the built image; check that it is
#                                   labeled as that release, and print its
#                                   reference by that digest
set -euo pipefail

# shellcheck source=scripts/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

readonly LOCAL_IMAGE="localhost/aura-tutorials-site:local"
# The port on which nginx listens in the container, and the directory that it
# serves: keep in sync with site/nginx.conf and site/Containerfile.
readonly CONTAINER_PORT=8080
readonly WEB_ROOT="/srv/site"
# The package of the font that the site holds (src/site.mjs).
readonly FONT_PACKAGE="@fontsource-variable/inter"

# Trivy's official image, which inventories and scans the image, pinned by
# version and digest and updated by Renovate, as in Aura.
readonly TRIVY_IMAGE="docker.io/aquasec/trivy:0.76.2@sha256:8f6bb947dbc528902e11f2f5be52f7b519f6a39d5d148f41166f2040499768fb"

readonly VERSION_LABEL="org.opencontainers.image.version"
readonly DEV_VERSION="dev"

# The headers that nginx adds to every answer: keep in sync with
# site/nginx.conf.
readonly -a SERVER_HEADERS=(
    "Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; media-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    "X-Content-Type-Options: nosniff"
    "Referrer-Policy: no-referrer"
    "Cross-Origin-Opener-Policy: same-origin"
    "Cross-Origin-Resource-Policy: same-origin"
    "Cache-Control: no-cache"
)

# The state of a command, a test container and a working directory, removed
# on exit.
CONTAINER=""
WORK_DIR=""

remove_state() {
    if [[ -n "${CONTAINER}" ]]; then
        docker rm --force "${CONTAINER}" >/dev/null 2>&1 || true
    fi
    if [[ -n "${WORK_DIR}" ]]; then
        rm -rf -- "${WORK_DIR}"
    fi
}

require_image() {
    docker image inspect "${LOCAL_IMAGE}" >/dev/null 2>&1 ||
        die "missing image ${LOCAL_IMAGE}; run 'scripts/image.sh build' first"
}

require_site() {
    [[ -f "${SITE_DIR}/index.html" ]] ||
        die "out/site/ holds no website; generate it first, such as with 'scripts/tutorials.sh site --release'"
}

# Prints the version that the label of the built image states.
image_version() {
    docker image inspect --format "{{index .Config.Labels \"${VERSION_LABEL}\"}}" "${LOCAL_IMAGE}"
}

# Prints the labels of an image of version $1, one key=value per line, sorted
# by key: its OCI annotations, which replace those of the base image. The
# revision and the time of creation are those of the checkout's commit, so
# that a rebuild of a commit labels it alike. The base image names its own
# maintainers, and this image states none.
expected_labels() {
    local version="$1" revision created
    revision="$(git -C "${REPO_ROOT}" rev-parse HEAD)" ||
        die "cannot read the commit of the checkout"
    created="$(TZ=UTC0 git -C "${REPO_ROOT}" log -1 \
        --date='format-local:%Y-%m-%dT%H:%M:%SZ' --format=%cd)" ||
        die "cannot read the time of the checkout's commit"
    printf '%s\n' \
        "maintainer=" \
        "org.opencontainers.image.created=${created}" \
        "org.opencontainers.image.description=Website of the video tutorials of Sentinel Aura" \
        "org.opencontainers.image.licenses=Apache-2.0" \
        "org.opencontainers.image.revision=${revision}" \
        "org.opencontainers.image.source=https://github.com/${REPOSITORY}" \
        "org.opencontainers.image.title=aura-tutorials" \
        "org.opencontainers.image.url=https://github.com/${REPOSITORY}" \
        "${VERSION_LABEL}=${version}" |
        LC_ALL=C sort
}

# Runs a shell command in a container of the image, as its user, without a
# network or a capability.
image_shell() {
    docker run --rm --network=none --entrypoint=sh \
        --cap-drop=ALL --security-opt=no-new-privileges \
        "${LOCAL_IMAGE}" -c "$1"
}

# The image is one image manifest, which its tag names when it is published,
# not an index that holds another manifest beside it, such as the provenance
# attestation that Buildx adds by default. Docker's classic image store
# records no descriptor of an image, and keeps no attestation.
check_manifest() {
    local media_type
    media_type="$(docker image inspect --format '{{with .Descriptor}}{{.MediaType}}{{end}}' "${LOCAL_IMAGE}")"
    case "${media_type}" in
        "" | application/vnd.oci.image.manifest.v1+json | application/vnd.docker.distribution.manifest.v2+json) ;;
        *) die "the image's media type is ${media_type}, not that of one image manifest: its build added another manifest, such as an attestation" ;;
    esac
}

# Every label of the image is one that build sets, with its value, so that no
# label of the base image describes this image.
check_labels() {
    local version expected actual
    version="$(image_version)"
    [[ "${version}" == "${DEV_VERSION}" ]] || is_release_tag "${version}" ||
        die "the image's version label, '${version}', is neither '${DEV_VERSION}' nor the tag of a release"
    expected="$(expected_labels "${version}")"
    actual="$(docker image inspect --format \
        '{{range $key, $value := .Config.Labels}}{{$key}}={{$value}}{{"\n"}}{{end}}' "${LOCAL_IMAGE}")"
    if [[ "${actual}" != "${expected}" ]]; then
        diff <(printf '%s\n' "${expected}") <(printf '%s\n' "${actual}") >&2 || true
        die "the labels of the image differ from those that 'scripts/image.sh build' sets (< expected, > found)"
    fi
}

# The website loads nothing from outside of it: a resource or a link with an
# absolute path breaks under the path of Pages, and a resource of another
# origin depends on it at runtime, and the policy of the server refuses it; a
# link of a page, <a>, may lead outside. Nor has a page a style or a script
# of its own, which the policy refuses too.
check_site() {
    if grep -rnE --include='*.html' --include='*.css' --include='*.js' \
        -e '(src|href)="/' -e 'src="[a-z]+:' -e '<link[^>]* href="[a-z]+:' -e "url\\([\"']?(/|[a-z]+:)" "${SITE_DIR}"; then
        die "the website has a URL that is not relative"
    fi
    if grep -rnE --include='*.html' -e '<style' -e ' style="' -e '<script[^>]*>[^<]' -e ' on[a-z]+="' "${SITE_DIR}"; then
        die "a page of the website has a style or a script of its own, which the Content-Security-Policy of the server refuses"
    fi
}

# The image declares a numeric user that is not root, and serves the website
# in out/site/, and nothing else, with the configuration of site/nginx.conf.
check_image_content() {
    local user image_files site_files config
    user="$(docker image inspect --format '{{.Config.User}}' "${LOCAL_IMAGE}")"
    if [[ ! "${user}" =~ ^[0-9]+(:[0-9]+)?$ ]] || ((10#${user%%:*} == 0)); then
        die "the image user, '${user}', is not a numeric user other than root"
    fi
    image_files="$(image_shell "cd ${WEB_ROOT} && find . -type f -exec sha256sum {} + | sort -k 2")"
    site_files="$(cd "${SITE_DIR}" && find . -type f -exec sha256sum {} + | LC_ALL=C sort -k 2)"
    [[ "${image_files}" == "${site_files}" ]] ||
        die "the image serves other files than the website in out/site/"
    config="$(image_shell 'cat /etc/nginx/nginx.conf')"
    [[ "${config}" == "$(<"${IMAGE_DIR}/nginx.conf")" ]] ||
        die "nginx has another configuration than site/nginx.conf"
}

# Prints the headers of the answer of the container to a GET request for the
# path $1 of the site, made inside it, since it has no network, with the
# request headers that follow.
site_headers() {
    local path="$1"
    shift
    printf '%s\r\n' "GET /${path} HTTP/1.1" "Host: localhost" "Connection: close" "$@" "" |
        docker exec --interactive "${CONTAINER}" nc 127.0.0.1 "${CONTAINER_PORT}" |
        LC_ALL=C awk '{ sub(/\r$/, "") } $0 == "" { body = 1 } !body'
}

# Starts the container as the cluster runs it (docs/deployment.md, Runtime):
# a read-only root filesystem with a writable /tmp, another user than the
# image's, no capability, and, since the server makes no connection, no
# network: the checks reach nginx inside it, on the loopback interface.
start_container() {
    CONTAINER="aura-tutorials-image-test-$$"
    docker run --detach --name "${CONTAINER}" --read-only --tmpfs /tmp --user 65534:65534 \
        --network=none --cap-drop=ALL --security-opt=no-new-privileges "${LOCAL_IMAGE}" >/dev/null
    local _
    for _ in $(seq 1 50); do
        if site_headers "" 2>/dev/null | grep -q "^HTTP/1.1 200 "; then
            return 0
        fi
        sleep 0.2
    done
    docker logs "${CONTAINER}" >&2 || true
    die "nginx does not answer in the container"
}

check_processes() {
    local uids uid
    uids="$(docker top "${CONTAINER}" -o pid,uid | awk 'NR > 1 { print $2 }')"
    [[ -n "${uids}" ]] || die "the container runs no process"
    while IFS= read -r uid; do
        if [[ ! "${uid}" =~ ^[0-9]+$ ]] || ((10#${uid} == 0)); then
            die "a process of the container runs as root"
        fi
    done <<<"${uids}"
}

# Every file of the site answers with its type and the headers of the server;
# a video answers a range, which seeking needs; a directory without its slash
# redirects without naming a host or a port, which only the ingress knows;
# and a missing file is a 404.
check_answers() {
    local file path type headers status header count=0
    while IFS= read -r -d '' file; do
        file="${file#./}"
        case "${file}" in
            *.html) type="text/html" ;;
            *.css) type="text/css" ;;
            *.js) type="application/javascript" ;;
            *.svg) type="image/svg+xml" ;;
            *.jpg) type="image/jpeg" ;;
            *.woff2) type="font/woff2" ;;
            *.vtt) type="text/vtt" ;;
            *.mp4) type="video/mp4" ;;
            *) die "the website has a file of an unknown type: ${file}" ;;
        esac
        status=200
        local -a request=()
        if [[ "${file}" == *.mp4 ]]; then
            status=206
            request=("Range: bytes=100-199")
        fi
        # A page by the address of its directory, as its links name it.
        path="${file}"
        [[ "${file}" != index.html && "${file}" != */index.html ]] || path="${file%index.html}"
        headers="$(site_headers "${path}" "${request[@]}")" || die "the image does not serve /${path}"
        grep -q "^HTTP/1.1 ${status} " <<<"${headers}" || die "/${path}: not ${status}: ${headers}"
        grep -qi "^Content-Type: ${type}\(;.*\)\?$" <<<"${headers}" || die "/${path}: not ${type}: ${headers}"
        if [[ "${status}" == 206 ]]; then
            grep -qi "^Content-Range: bytes 100-199/" <<<"${headers}" || die "/${path}: no range: ${headers}"
        fi
        for header in "${SERVER_HEADERS[@]}"; do
            grep -qxF "${header}" <<<"${headers}" || die "/${path}: no header '${header}': ${headers}"
        done
        count=$((count + 1))
    done < <(cd "${SITE_DIR}" && find . -type f -print0 | LC_ALL=C sort -z)

    headers="$(site_headers tutorials)"
    if ! grep -q "^HTTP/1.1 301 " <<<"${headers}" || ! grep -qx "Location: /tutorials/" <<<"${headers}"; then
        die "/tutorials does not redirect to /tutorials/: ${headers}"
    fi
    headers="$(site_headers "missing-${RANDOM}")"
    grep -q "^HTTP/1.1 404 " <<<"${headers}" || die "a missing file is not a 404: ${headers}"
    grep -qxF "${SERVER_HEADERS[0]}" <<<"${headers}" || die "a 404 lacks the headers of the server: ${headers}"
    echo "image.sh: the image serves the ${count} files of the website" >&2
}

cmd_build() {
    [[ $# -le 1 ]] || die "build: takes at most the tag of the release"
    local version="${1:-${DEV_VERSION}}" list label
    local -a labels=()
    [[ "${version}" == "${DEV_VERSION}" ]] || is_release_tag "${version}" ||
        die "build: '${version}' is not the tag of a release, such as aura-v0.10.0-r2"
    require_site
    require_buildx
    list="$(expected_labels "${version}")"
    while IFS= read -r label; do
        labels+=(--label "${label}")
    done <<<"${list}"
    # One platform, and neither the provenance nor the SBOM of Buildx, which
    # are unsigned records that a push would publish beside the image, in an
    # index that the tag would name: the release attests the image itself
    # (docs/deployment.md, Supply-Chain Artifacts).
    docker buildx build --load --platform linux/amd64 --provenance=false --sbom=false \
        --file "${IMAGE_DIR}/Containerfile" --build-context "content=${SITE_DIR}" \
        --tag "${LOCAL_IMAGE}" "${labels[@]}" "${IMAGE_DIR}"
}

cmd_test() {
    [[ $# -eq 0 ]] || die "test: takes no arguments"
    require_image
    require_site
    trap remove_state EXIT

    check_manifest
    check_labels
    check_site
    check_image_content
    start_container
    check_processes
    check_answers
    echo "image.sh: every check passed" >&2
}

# Writes the built image into a new working directory, where Trivy reads it,
# beside the directory of Trivy's cache, and pulls Trivy's image.
prepare_trivy() {
    command -v jq >/dev/null 2>&1 || die "jq is required"
    require_image
    WORK_DIR="$(mktemp -d)"
    trap remove_state EXIT
    mkdir "${WORK_DIR}/cache"
    docker save --output "${WORK_DIR}/image.tar" "${LOCAL_IMAGE}"
    docker image inspect "${TRIVY_IMAGE}" >/dev/null 2>&1 ||
        docker pull --quiet "${TRIVY_IMAGE}" >/dev/null || die "cannot download ${TRIVY_IMAGE}"
}

# Runs Trivy with the arguments $2..., offline when $1 is "offline", in a
# container with the user's IDs, without capabilities, and unable to gain
# privileges. It reads the archive of the image, and writes only its cache,
# which nothing else reads; it receives neither the Docker socket nor a
# token. Its report is its standard output, so no file that it writes reaches
# the host.
run_trivy() {
    local -a network=()
    if [[ "$1" == offline ]]; then
        network=(--network=none)
    fi
    shift
    docker run --rm --pull=never "${network[@]}" \
        --user="$(id -u):$(id -g)" --cap-drop=ALL --security-opt=no-new-privileges \
        --volume="${WORK_DIR}/image.tar:/scan/image.tar:ro" \
        --volume="${WORK_DIR}/cache:/scan/cache" \
        "${TRIVY_IMAGE}" "$@" \
        --cache-dir=/scan/cache --disable-telemetry --skip-version-check
}

# Prints Trivy's SBOM of the image, $1, for the image's version $2, with the
# font of version $3 that the site holds as a component that the image depends
# on. The image is named as a release; the local tag of the build is not part
# of the inventory. The videos, the pages, and the mark of Aura are content of
# this repository and of Aura, not components.
# shellcheck disable=SC2016  # $name, $version, $font, and $release are jq variables
complete_sbom() {
    jq --arg name "${RELEASE_IMAGE}" --arg version "$2" \
        --arg font "${FONT_PACKAGE}" --arg release "$3" '
        ("pkg:npm/" + ($font | sub("@"; "%40")) + "@" + $release) as $purl
        | .metadata.component["bom-ref"] as $image
        | .metadata.component.name = $name
        | .metadata.component.version = $version
        | .metadata.component.properties |= ((. // []) | map(select(.name
            | IN("aquasecurity:trivy:Reference", "aquasecurity:trivy:RepoTag",
                "aquasecurity:trivy:RepoDigest") | not)))
        | .components += [{
            "bom-ref": $purl,
            type: "library",
            group: ($font | split("/")[0]),
            name: ($font | split("/")[1]),
            version: $release,
            purl: $purl,
            licenses: [{license: {id: "OFL-1.1"}}]
        }]
        | .dependencies = [
            (.dependencies[] | if .ref == $image then .dependsOn += [$purl] else . end),
            {ref: $purl, dependsOn: []}
        ]
    ' "$1"
}

# Fails with the message $2 unless the jq filter $3 holds for the SBOM $1,
# with the further arguments of jq.
require_sbom() {
    local sbom="$1" message="$2" filter="$3"
    shift 3
    jq -e "$@" "${filter}" "${sbom}" >/dev/null || die "the SBOM ${message}"
}

# The SBOM $1 is a CycloneDX document that describes the release image of
# version $2 and lists its nginx package and the font of version $3, with
# resolvable references.
# shellcheck disable=SC2016  # $name, $version, $font, and $release are jq variables
check_sbom() {
    local sbom="$1" version="$2" release="$3"
    require_sbom "${sbom}" "is not a CycloneDX document" \
        '.bomFormat == "CycloneDX" and (.specVersion | test("^1\\.[0-9]+$"))'
    require_sbom "${sbom}" "does not describe the image ${RELEASE_IMAGE} ${version}" \
        '.metadata.component | .type == "container" and .name == $name and .version == $version' \
        --arg name "${RELEASE_IMAGE}" --arg version "${version}"
    require_sbom "${sbom}" "lists no nginx package of the image" \
        'any(.components[]; .name == "nginx" and (.purl // "" | startswith("pkg:apk/")))'
    require_sbom "${sbom}" "does not list ${FONT_PACKAGE} ${release}, and no other npm package" \
        '[.components[] | select(.purl // "" | startswith("pkg:npm/")) | "\(.group)/\(.name)@\(.version)"] == [$font + "@" + $release]' \
        --arg font "${FONT_PACKAGE}" --arg release "${release}"
    require_sbom "${sbom}" "has duplicate or unresolved references" '
        ([.metadata.component["bom-ref"]] + [.components[]["bom-ref"]]) as $refs
        | ($refs | length) == ($refs | unique | length)
            and all(.dependencies[]; (.ref | IN($refs[])) and all(.dependsOn[]?; IN($refs[])))
    '
}

# Trivy reads the operating system packages from the image. The site holds
# one file of a package, the font, without its manifest, where Trivy cannot
# see it, so the script adds it at the version of package-lock.json.
cmd_sbom() {
    [[ $# -eq 1 ]] || die "sbom: takes the path of the SBOM"
    local output="$1" version font
    prepare_trivy
    version="$(image_version)"
    font="$(jq -er --arg path "node_modules/${FONT_PACKAGE}" '.packages[$path].version' "${REPO_ROOT}/package-lock.json")" ||
        die "package-lock.json does not lock ${FONT_PACKAGE}"
    run_trivy offline image --input=/scan/image.tar --pkg-types=os \
        --format=cyclonedx --offline-scan >"${WORK_DIR}/image.cdx.json"
    complete_sbom "${WORK_DIR}/image.cdx.json" "${version}" "${font}" >"${WORK_DIR}/sbom.cdx.json"
    check_sbom "${WORK_DIR}/sbom.cdx.json" "${version}" "${font}"
    mkdir -p -- "$(dirname -- "${output}")"
    cp -- "${WORK_DIR}/sbom.cdx.json" "${output}"
    echo "image.sh: ${output} holds the SBOM of ${RELEASE_IMAGE} ${version}" >&2
}

# The complete report reuses the vulnerability database of the first scan. A
# finding never fails the command; a scan that does not complete does.
cmd_scan() {
    [[ $# -eq 1 ]] || die "scan: takes the directory of the reports"
    local reports="$1"
    mkdir -p -- "${reports}"
    prepare_trivy
    run_trivy online image --input=/scan/image.tar --scanners=vuln --pkg-types=os \
        --ignore-unfixed --severity=HIGH,CRITICAL --exit-code=0 \
        --format=json >"${reports}/trivy-fixable.json"
    run_trivy online image --input=/scan/image.tar --scanners=vuln --pkg-types=os \
        --skip-db-update --exit-code=0 \
        --format=table >"${reports}/trivy-full.txt"
}

cmd_save() {
    [[ $# -eq 1 ]] || die "save: takes the path of the archive"
    require_image
    mkdir -p -- "$(dirname -- "$1")"
    docker save --output "$1" "${LOCAL_IMAGE}"
}

cmd_load() {
    [[ $# -eq 1 ]] || die "load: takes the path of the archive"
    docker load --quiet --input "$1" >&2
    require_image
}

# The version label is checked, so that only the image built for a release
# is published under its tag.
cmd_push() {
    [[ $# -eq 1 ]] || die "push: takes the tag of the release"
    local tag="$1" label digest
    is_release_tag "${tag}" || die "push: '${tag}' is not the tag of a release, such as aura-v0.10.0-r2"
    require_image
    label="$(image_version)"
    [[ "${label}" == "${tag}" ]] ||
        die "the built image is labeled as version '${label}', not as the release ${tag}"
    docker tag "${LOCAL_IMAGE}" "${RELEASE_IMAGE}:${tag}"
    docker push --quiet "${RELEASE_IMAGE}:${tag}" >&2
    digest="$(resolve_digest "${RELEASE_IMAGE}:${tag}")"
    printf '%s@%s\n' "${RELEASE_IMAGE}" "${digest}"
}

# The tag is resolved once and the image pulled by that digest, so that the
# printed reference names the pulled image even if the tag moves meanwhile.
cmd_pull() {
    [[ $# -eq 1 ]] || die "pull: takes the tag of the release"
    local tag="$1" digest reference label
    is_release_tag "${tag}" || die "pull: '${tag}' is not the tag of a release, such as aura-v0.10.0-r2"
    digest="$(resolve_digest "${RELEASE_IMAGE}:${tag}")"
    reference="${RELEASE_IMAGE}@${digest}"
    docker pull --quiet "${reference}" >&2
    docker tag "${reference}" "${LOCAL_IMAGE}"
    label="$(image_version)"
    [[ "${label}" == "${tag}" ]] ||
        die "the image ${reference} is labeled as version '${label}', not as the release ${tag}"
    printf '%s\n' "${reference}"
}

main() {
    if [[ $# -eq 0 ]]; then
        usage
        exit 2
    fi
    local command="$1"
    shift
    command -v docker >/dev/null 2>&1 || die "Docker is required"
    case "${command}" in
        build | test | sbom | scan | save | load | push | pull) "cmd_${command}" "$@" ;;
        -h | --help | help) usage ;;
        *)
            usage
            die "unknown command: ${command}"
            ;;
    esac
}

main "$@"
