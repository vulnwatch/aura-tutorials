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
container image provides Node.js 22 or later, Playwright's Chromium, and
FFmpeg.
