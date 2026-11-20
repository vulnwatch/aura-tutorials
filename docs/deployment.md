# Deployment

The website of the tutorials is also a container image, to host it where
GitHub Pages does not reach, such as on the Kubernetes cluster that runs
Sentinel, beside Sentinel and Aura. This document is the contract of that
image: a deployment, such as the one in `vulnwatch/sentinel-ops`, relies on
what it states and on nothing else. The image is built, attested, published,
and scanned as the image of Aura is (`aura/docs/deployment.md`, Release
Process), so that a deployment verifies both alike; `docs/authoring.md`
(Publication) describes the release that it belongs to.

## Image

- The image is `ghcr.io/vulnwatch/aura-tutorials`. It is public: a cluster
  pulls it without credentials (Settings).
- It holds the website that GitHub Pages receives for the same release, from
  the same artifact of the same run, and a web server that serves it. It
  needs neither GitHub Pages nor GitHub at runtime: the pages, the videos,
  their subtitles, their posters, and the font come from the image, and
  nothing loads from another origin. Only links that a visitor follows, such
  as the one to Aura's repository, lead outside.
- It is built for `linux/amd64`, as the image of Aura is.

## Tags

- Each release of this repository has one image, whose tag is the tag of the
  release, such as `aura-v0.10.0-r2`: the version of Aura that the videos
  show, and the number of the release for that version. There is no `latest`
  and no other moving tag.
- The image of a published release is final, and a correction is a new
  release (Publication and Immutability): a change of a video, of the
  website, of the web server's configuration, or of the base image makes a
  release, and so an image, of its own. The `videos.json` of a release
  records, as `site`, the hash of the website and of the directory `site/`
  that its image was built from.
- The images of earlier releases stay available, so that a deployment shows
  the tutorials of the version of Aura that it runs, which may be older than
  the latest: it chooses the latest release whose tag names that version.
- The registry does not enforce the immutability of tags, so a deployment
  runs the image by the digest that the tag names, after verifying it
  (Verify a Release). The notes of the release state that digest.

## Labels

Every build of the image by `scripts/image.sh build` carries these labels,
which replace those of the base image. The image test fails when the image
carries another label or another value, so no label of the base image
describes this image:

| Label | Value |
|---|---|
| `org.opencontainers.image.title` | `aura-tutorials` |
| `org.opencontainers.image.description` | `Website of the video tutorials of Sentinel Aura` |
| `org.opencontainers.image.source`, `org.opencontainers.image.url` | `https://github.com/vulnwatch/aura-tutorials`, through which the registry links the image to the repository |
| `org.opencontainers.image.licenses` | `Apache-2.0`, the license of the sources and the videos; the SBOM lists the components of the image and their licenses |
| `org.opencontainers.image.version` | The tag of the release, or `dev` for a build outside a release |
| `org.opencontainers.image.revision` | The commit that the image is built from, the commit of the release |
| `org.opencontainers.image.created` | The time of that commit, in UTC, so that two builds of one commit carry the same labels |
| `maintainer` | Empty, in place of the maintainers of the base image |

## Supply-Chain Artifacts

Each release publishes three records of its image, as a release of Aura
does:

| Record | Meaning | Publication |
|---|---|---|
| CycloneDX SBOM | Inventory of the components of the image | The release asset `aura-tutorials-<release>.sbom.cdx.json`, where `<release>` is the tag without its `aura-`, such as `v0.10.0-r2` |
| SBOM attestation | Signed claim that the SBOM describes the image's digest | GitHub's attestations API, the registry, beside the image, and the release asset `aura-tutorials-<release>.sbom.sigstore.json` |
| Build provenance | Signed SLSA provenance of the image's digest: the repository, the commit, the workflow, and the run that built and published it | GitHub's attestations API, the registry, and the release asset `aura-tutorials-<release>.provenance.sigstore.json` |

The subject of both attestations is
`ghcr.io/vulnwatch/aura-tutorials@sha256:<digest>`, never a tag. Each bundle
asset is the Sigstore bundle that `actions/attest` produced, so a deployment
can verify the image without the attestations API or the registry. The
attestations create no storage record.

The image carries no other record: its tag names one image manifest, which
is the subject of both attestations. `scripts/image.sh build` disables the
provenance and the SBOM that Buildx can add, unsigned records that a push
would publish beside the image, in an index that the tag would name; the
image test fails for such an index.

`scripts/image.sh sbom` generates the SBOM with Trivy, run offline from the
image that the script pins, and checks it. One CycloneDX document, whose
subject is the image, named `ghcr.io/vulnwatch/aura-tutorials` with the tag
of the release as its version, holds:

- the operating system packages of the image, nginx included, which Trivy
  reads from the image; and
- the font of the site, `@fontsource-variable/inter`, of which the site
  holds one file without a manifest, at the version of `package-lock.json`.

The pages, the videos, and the mark of Aura are content of this repository
and of Aura, not components. The check fails unless the document is
CycloneDX, describes the image and its version, lists the image's nginx
package and that font and no other npm package, and has unique references,
which its dependency graph resolves. CI runs the same generation and check
on every pull request, so a change that breaks the SBOM fails before a
release. The SBOM is an inventory, not a vulnerability report (Vulnerability
Scan).

## Runtime

The image runs under the `restricted` profile of the Pod Security Standards,
with the settings of the image of Aura:

- The server is nginx, from the official unprivileged nginx image, the one
  of Aura's image, pinned by version and digest (`site/Containerfile`), which
  Renovate updates. It listens on port 8080, over HTTP and IPv4; TLS and the
  public name belong to what stands in front of it.
- The image's user is `101:101`, numeric, and the server runs as any other
  non-root user and group as well. It needs no capability and no privilege
  escalation.
- The root filesystem may be read-only. The server writes only under `/tmp`,
  its process ID and its temporary directories, which then needs a writable
  volume, such as an `emptyDir`; a few megabytes suffice, since the site
  takes no upload.
- It makes no outgoing connection, and resolves no name: a network policy
  may deny all egress.
- It takes no setting, no environment variable, and no secret.
- `/` answers `200`, for the readiness and the liveness probes.
- The site is at `/`: a page is `/tutorials/<id>/`, and its video
  `/videos/<id>.mp4`. Every URL of the site is relative, so it also works
  under a path, as on Pages, behind a proxy that removes the prefix. A
  directory without its slash redirects by a relative `Location`, which
  names neither a host nor a port.
- MP4 is served as `video/mp4`, with range requests, which seeking needs;
  WebVTT, the subtitles and the chapters, as `text/vtt`.
- Every answer, a 404 included, carries a Content Security Policy that
  allows only resources of the site's own origin, and no framing of its
  pages, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `Cross-Origin-Opener-Policy: same-origin`, and
  `Cross-Origin-Resource-Policy: same-origin`: another site cannot embed a
  page or a video of this one. `Cache-Control: no-cache` makes a browser ask
  whether its copy is current, because a page or a video keeps its address
  from a release to the next. GitHub Pages sets none of these.
- The access log goes to the standard output, the errors to the standard
  error.

A container that runs so, for a look at a release:

```sh
docker run --rm --read-only --tmpfs /tmp --user 65534:65534 --cap-drop ALL \
    --security-opt no-new-privileges --publish 127.0.0.1:8080:8080 \
    ghcr.io/vulnwatch/aura-tutorials@sha256:…
```

## Publication and Immutability

After a merge to `main`, the workflow `publish.yml` creates the release as a
draft, with its videos (`scripts/release.sh publish`), builds and tests the
image of its website and generates its SBOM in a job that only reads the
repository, and then, in the job that may write, pushes the image, attests
its SBOM and its provenance, and publishes the release
(`scripts/release.sh finish`), which is its last action. Pages receives the
website after that. A run that finds the latest release current drafts
nothing and publishes no image, and only a run on `main` publishes: one
started by hand on another branch does nothing.

A version of the tutorials is released when its GitHub Release is published:

- **Before publication** the release is a draft, which only who may write to
  the repository sees, and a deployment does not use it, even when its image
  tag exists. A rerun of the failed jobs, or a later run, which replaces the
  draft, can rebuild the image, point its tag to a new digest, and add
  attestations of that digest.
- **After publication** the image tag, the Git tag, and the assets are
  final. `scripts/release.sh check` fails for a published release, and for a
  draft of another commit than the one of the run, before the first push, so a rerun neither moves the image tag nor adds an
  attestation. A correction ships as a new release.

| Failure of a `publish.yml` run | Repair |
|---|---|
| A job fails for a transient cause, such as a download | Re-run failed jobs, within the day that the artifact of the website lasts; later, re-run all jobs |
| A job fails for a cause in the merged commit | The draft stays a draft; the next run that makes a release removes it and creates a draft of its own. A rerun of the earlier run then publishes nothing: `scripts/release.sh check` accepts only the draft of its own commit |
| The deployment to Pages fails after the release is published | Re-run failed jobs, within the day that the artifact of the website lasts; later, re-run all jobs, which find the release current and deploy |
| The release is published | Nothing to repair: a rerun of the publication fails at `scripts/release.sh check`, before any push or attestation |

Release immutability, a setting of the repository (Settings), locks the Git
tag and the assets of every release published while it is enabled; it does
not protect the image tag, which the check of the workflow protects.
`scripts/release.sh finish` warns when the release that it published is not
immutable.

## Verify a Release

A deployment uses a release only once it is published, resolves its tag to
its digest once, verifies the image by that digest, and deploys the image by
the same digest, so that the deployed image is the verified one. The
commands need Docker with its Buildx plugin and the GitHub CLI, `gh`, signed
in:

```sh
set -euo pipefail

TAG="aura-v0.10.0-r2" # the published release to verify
REPOSITORY="vulnwatch/aura-tutorials"
WORKFLOW="${REPOSITORY}/.github/workflows/publish.yml"

gh release view "${TAG}" --repo "${REPOSITORY}" --json isDraft --jq '.isDraft == false' | grep -qx true
DIGEST="$(docker buildx imagetools inspect "ghcr.io/${REPOSITORY}:${TAG}" --format '{{.Manifest.Digest}}')"
IMAGE="ghcr.io/${REPOSITORY}@${DIGEST}"

# The build provenance: built and published by the workflow Publish of this
# repository, on main.
gh attestation verify "oci://${IMAGE}" --repo "${REPOSITORY}" \
    --signer-workflow "${WORKFLOW}" --source-ref refs/heads/main

# The signed claim that the SBOM describes the image.
gh attestation verify "oci://${IMAGE}" --repo "${REPOSITORY}" \
    --signer-workflow "${WORKFLOW}" --source-ref refs/heads/main \
    --predicate-type https://cyclonedx.org/bom

# Deploy the image as ${IMAGE}, by its digest.
```

The verification fails for an image that the workflow did not build and
publish. The notes of the release state the same digest.

## Vulnerability Scan

`image-scan.yml` scans the image of the latest release with Trivy for known
vulnerabilities of its operating system packages, every Monday, for the
advisories published between releases, and after every successful run of
`publish.yml`, as Aura scans its image. It scans no earlier release: a fix
reaches only the latest one, and a deployment of an earlier version of Aura
takes the latest release of that version.

`scripts/image.sh pull` pulls the image by the digest that its tag names,
without credentials, and `scripts/image.sh scan` runs Trivy from its
official image, which the script pins by version and digest and Renovate
updates, in a container with the runner's user and group IDs and without
capabilities, which reads an archive of the image and receives neither the
Docker socket nor a token. The scan is advisory: a finding never fails the
run, and only a scan that does not complete does. The job that runs the
scanner only reads the repository; it hands the report of the fixable HIGH
and CRITICAL vulnerabilities to the job that keeps the tracking issue,
`Image scan: fixable HIGH or CRITICAL vulnerabilities`
(`scripts/image-scan-issue.sh`): it opens the issue or updates the open one
when the scan finds such vulnerabilities, and closes it when it finds none.
The run keeps the complete report as an artifact.

A fix usually arrives as the pull request of Renovate that updates the base
image; its merge makes a release, whose image has the new base
(`docs/authoring.md`, Update the Tools).

## Build and Check the Image

`scripts/image.sh` builds, tests, and inventories the image locally, from
the website in `out/site/`, which `scripts/tutorials.sh site --release`
generates, and from `site/`; its header lists its commands. `build` then
`test` check what this document states of the image and of its answers,
with a container that runs as the cluster runs it, and `sbom` what it states
of the SBOM. They publish nothing, and CI runs them on every pull request
and before it publishes an image.

## Settings

What the repository and its organization must hold, outside of the files:

- **The package is public.** The first release creates the package
  `aura-tutorials` of the organization, which may be private at first: make
  it public once, in the settings of the package, so that a cluster and the
  image scan pull it without credentials.
- **Release immutability** is enabled for the repository, as for Aura's.
- **GitHub Pages** deploys from GitHub Actions.
