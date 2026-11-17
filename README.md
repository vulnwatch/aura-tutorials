# Aura Tutorials

Video tutorials that show the users of Sentinel Aura (`vulnwatch/sentinel-aura`)
what they can do and how. This repository is a prototype: it is local only and
may be discarded.

## Approach

A tutorial is a script of steps. Each step names an action in the UI and, later,
the sentence that a voice reads. One command turns the script into an MP4 in
three stages:

1. **Capture.** Playwright drives the real UI against a local Sentinel backend
   loaded with Sentinel's example dataset, whose data is fictional. For each
   step it saves a high-resolution screenshot and the bounding box of the
   element that the step clicks or types into. It records no video.
2. **Compose.** HyperFrames (`heygen-com/hyperframes`, Apache 2.0) turns the
   screenshots into animated scenes: camera zoom and pan towards the target, a
   synthetic cursor that moves and clicks, highlights, captions, and
   transitions.
3. **Render.** HyperFrames renders the composition to an MP4 with headless
   Chrome and FFmpeg. The same script gives the same video.

Narration (text to speech) comes later: each scene will then last as long as
its audio, and the same text will produce the subtitles.

## Prototype Scope

One video of 30 to 60 seconds, without audio: signing in and opening a Ticket.

## Isolation From Aura

- The UI under capture runs from the submodule `aura/`, a clone of
  `vulnwatch/sentinel-aura` that tracks `master`. The submodule pins the
  commit of Aura that the videos show; moving to a newer one is an explicit
  `git submodule update --remote aura` and a commit. Clone this repository
  with `--recurse-submodules`.
- The files of the submodule are never modified and no commit is made in it;
  its scripts write only to directories that its `.gitignore` ignores. Its
  `scripts/dev-env.sh` names its backend and its dependency cache after the
  path of the clone, so they never collide with those of another clone.
- The working clone of Aura in `../sentinel-aura` is never read for running,
  modified, or switched: other work may be in progress there.
- The development server listens on `http://localhost:5173`; check that the
  port is free before starting it.

## Environment

Node.js commands run in containers, never on the host, as in Aura. The
container image (`Containerfile`) is the Playwright image that Aura's tooling
uses, pinned by version and digest, with FFmpeg: it provides Node.js 22 or
later, Playwright's Chromium, whose headless shell HyperFrames also renders
with, and FFmpeg. `scripts/tooling.sh` builds it and runs every command in it;
its header lists the commands, and `scripts/tooling.sh versions` prints the
versions of the tools. The dependencies of `package.json` live outside the
repository, in the user's cache directory. HyperFrames runs without
telemetry, update checks, skills, or installations of its own, and renders
without a network.

## Usage

A tutorial script, `tutorials/<id>.json`, names the title, the steps, and the
closing title of a video. Each step has an action (`goto`, `fill`, `click`, or
`show`), the target of the action as a Playwright locator by role, label, or
text, a caption, and the narration that a voice will read. Then:

```sh
aura/scripts/dev-env.sh start &   # the backend and the development server
scripts/video.sh tutorials/sign-in-and-open-ticket.json
```

writes, under `out/<id>/`, which Git ignores:

- `capture/`: the screenshots, at 1440x900 CSS pixels and a device scale
  factor of 2, and `capture.json`, the steps with the bounding boxes of their
  targets (`src/capture.mjs`);
- `composition/`: the HyperFrames composition (`src/compose.mjs`);
- `<id>.mp4`: the video, 1920x1080 at 30 fps.

`scripts/tooling.sh preview <script>` serves the composition in HyperFrames
Studio on `http://localhost:3002`; `scripts/tooling.sh hyperframes <script>
check` and `snapshot` check it without a render. `aura/scripts/dev-env.sh stop`
removes the backend.
