# Agent Instructions

This repository makes the video tutorials of Sentinel Aura from tutorial
scripts. Read `README.md` for the approach and `docs/authoring.md` for the
format of the scripts, their style, and the workflows, before changing a
script, a flow, the catalog, or the code that captures and composes.

## Skills

- `tutorial-author` (`.opencode/skills/tutorial-author/`): to add a tutorial,
  extend or fix one, or show a new feature of Aura.
- `aura-bump` (`.opencode/skills/aura-bump/`): to move the submodule `aura/`
  to a new release of Aura, such as for a Renovate pull request, and decide
  which videos it changes.

## Isolation From Aura

- `aura/` is a submodule pinned to a release tag of
  `vulnwatch/sentinel-aura`. Never modify its files or commit in it. Run only
  its scripts, through `scripts/backend.sh`, which write only to directories
  that its `.gitignore` ignores. Only `aura-bump` moves it to another tag.
- Read Aura's documents and end-to-end tests from `aura/` only: its screen
  documents (`aura/docs/screens/`), its screen map, and `aura/test/e2e/` are
  the authorities for what a screen shows and how to find its elements.
- Never read, modify, or switch another clone of Aura, such as
  `../sentinel-aura`: other work may be in progress there.
- The development server listens on `http://localhost:5173`;
  `scripts/backend.sh` fails rather than start when another process holds the
  port. Do not stop a process that you did not start.

## Environment

- Node.js, npm, and npx run only in containers, through
  `scripts/tooling.sh`, never on the host.
- Ask the user before adding a dependency, or before installing a skill or
  plugin of HyperFrames for agents.
- HyperFrames runs without telemetry, update checks, or installations of its
  own (`scripts/tooling.sh`); keep it so.

## Content

- Every file of the repository is in English, whatever the language of the
  conversation.
- Use only Sentinel's example dataset, whose data is fictional, and
  fictional values, such as addresses under `example.com`, for what a script
  types.

## Verification

- `scripts/tutorials.sh validate` after any change of a script, a flow, or
  the catalog; `shellcheck -x scripts/*.sh scripts/lib/*.sh` after a change
  of a shell script.
- Render what you change, then look at the screenshots of
  `out/<id>/capture/` and at frames of the video before you report it done.
- Commit `tutorials.lock.json` with the scripts and the code that it
  describes, after their render.

## Git and GitHub

- Commit messages follow Conventional Commits, such as
  `feat(tutorials): add search-for-a-cve`.
- Never push, open or merge a pull request, create a release or a tag, or
  force-push without the user's explicit consent in the current conversation.
