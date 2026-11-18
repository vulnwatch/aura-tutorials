# Aura Tutorials

Video tutorials that show the users of Sentinel Aura (`vulnwatch/sentinel-aura`)
what they can do and how. Each video comes from a tutorial script and is made
again, from the same script, when Aura changes what it shows.

The website `https://vulnwatch.github.io/aura-tutorials/` presents them by
profile and task, each with its video, its chapters, and its steps. The latest
video of each tutorial is also at
`https://github.com/vulnwatch/aura-tutorials/releases/latest/download/<id>.mp4`,
and the release lists them all in `videos.json`.

## Approach

A tutorial is a script of steps, in chapters. Each step names an action in the
UI, the caption that the video shows, and the sentence that a voice will read.
One command turns a script into an MP4 in three stages:

1. **Capture.** Playwright drives the real UI against a local Sentinel backend
   loaded with Sentinel's example dataset, whose data is fictional. For each
   step it saves high-resolution screenshots and the bounding box of the
   element that the step acts on. It records no video.
2. **Compose.** HyperFrames (`heygen-com/hyperframes`, Apache 2.0) turns the
   screenshots into animated scenes, one for each chapter: camera zoom and pan
   towards the target, a synthetic pointer that moves and clicks, keycaps,
   highlights, captions, chapter cards, and transitions.
3. **Render.** HyperFrames renders the composition to an MP4, 1920x1080 at 30
   fps, with headless Chrome and FFmpeg, which writes its title and chapters.

A catalog of the tasks that users do in Aura, taken from Aura's own screen
map, says what the tutorials should cover, and a lock file records what each
video was made from. When Aura releases a new version, a capture of every
script tells which videos changed: only those are made again. The
composition checks what needs no judgment, such as a caption that covers the
target of its step, and reviewer agents look at the rest: whether the texts
tell the truth about Aura, how the frames look, and whether the tutorials
agree with each other. `docs/authoring.md` describes the scripts, their
style, the workflows, and the review.

Narration (text to speech) comes later: each step will then last as long as
its sentence, and the same text will produce the subtitles.

## Repository

| Path | Content |
|---|---|
| `tutorials/` | The tutorial scripts, one per video |
| `flows/` | Steps that several scripts share, such as signing in |
| `catalog/tasks.json` | The tasks of Aura's users, and which ones Aura can show |
| `tutorials.lock.json` | What each video was made from |
| `src/` | The capture, the composition, the commands of the set of tutorials, and the website (`src/site.mjs`) |
| `scripts/` | The commands: `tutorials.sh`, `backend.sh`, and `tooling.sh` |
| `docs/authoring.md` | The format of the scripts, their style, the workflows, and the review |
| `aura/` | The submodule of Sentinel Aura, pinned to a release |
| `.opencode/` | The skills that guide agents, `tutorial-author` and `aura-bump`, and the reviewers (`.opencode/README.md`) |

## Usage

Clone with `--recurse-submodules`. Then, on Linux with Docker Engine and its
Compose plugin:

```sh
scripts/tutorials.sh list              # the tutorials
scripts/tutorials.sh status            # which videos are up to date
scripts/tutorials.sh render --stale    # make the stale videos in out/<id>/<id>.mp4
scripts/tutorials.sh frames <id>       # the frames of a video, to look at
scripts/tutorials.sh check             # which videos the pinned Aura changes
scripts/tutorials.sh coverage          # which tasks have a tutorial
scripts/tutorials.sh site --serve      # the website in out/site/, on http://localhost:8080
scripts/backend.sh stop                # remove the backend when done
```

`scripts/tutorials.sh` starts the backend of `aura/` and its development server
when it needs them (`scripts/backend.sh`). Under `out/<id>/`, which Git
ignores, a render leaves the screenshots in `capture/`, the composition in
`composition/`, and the video, and `frames` its frames and contact sheets in
`frames/`; `site` writes the website into `out/site/`, with the videos of
`out/<id>/`, and with `--release` those of the latest release for the others
(docs/authoring.md, Publication). `scripts/tutorials.sh preview <id>` serves the
composition in HyperFrames Studio on `http://localhost:3002`.

## Isolation From Aura

- The UI under capture runs from the submodule `aura/`, which pins a release
  tag of `vulnwatch/sentinel-aura`, the version that the videos show;
  `.gitmodules` names the tag as the submodule's `branch`, from which Renovate
  proposes the next release. Moving to a newer one is a checkout of its tag
  and a commit (`docs/authoring.md`, Move to a New Version of Aura).
- The files of the submodule are never modified and no commit is made in it;
  its scripts write only to directories that its `.gitignore` ignores. Its
  `scripts/dev-env.sh` names its backend and its dependency cache after the
  path of the clone, so they never collide with those of another clone of
  Aura, which is never read for running, modified, or switched.
- The development server listens on `http://localhost:5173`;
  `scripts/backend.sh` checks that the port is free before starting it.

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

## License

Apache License 2.0, for the sources and the videos (`LICENSE`).
