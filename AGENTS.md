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

`.opencode/README.md` catalogs the skills and the reviewers (Reviewers), and
how each contributor chooses their models. Restart OpenCode after changing
an agent, a skill, or the model selection.

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
- The voice of the videos is a paid speech service
  (`docs/authoring.md`, Narration). Only `scripts/tooling.sh narrate`, which
  `scripts/tutorials.sh render` runs, calls it, and only for a clip that
  `narration/` lacks, with the user's key, which it reads from
  `~/.config/aura-tutorials/openrouter.key` or from `OPENROUTER_API_KEY`.
  Never read that file yourself, and never write the key into a file of the
  repository, a command line, or a log.
  Ask the user before changing `narration/voice.json`, which reads every
  sentence again, and never delete clips to have them read again unasked.

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
- Render what you change: `scripts/tutorials.sh render` reports the findings
  of the checks of the composition, which CI fails on; resolve every one
  (`docs/authoring.md`, Review).
- Then look at the screenshots of `out/<id>/capture/` and at the frames of
  the video, which `scripts/tutorials.sh frames <id>` extracts, and run the
  reviewers that Reviewers requires, before you report it done.
- Commit `tutorials.lock.json` and `narration/` with the scripts and the
  code that they describe, after their render.

## Reviewers

The reviewers of `.opencode/agents/` are read-only subagents. Run every
reviewer that the matrix below selects for the change once it is complete,
rendered, and looked at, and before you report the work done or open a pull
request.

| Change | Reviewers |
|---|---|
| A new tutorial | `@accuracy-reviewer`, `@consistency-reviewer`, and `@visual-reviewer` |
| A changed script or flow, or `catalog/tasks.json` | `@accuracy-reviewer` and `@consistency-reviewer`; `@visual-reviewer` too when the render changes its frames |
| A render that changes the frames of a video: a change of `src/compose.mjs` or `src/capture.mjs`, another voice (`narration/voice.json`), which changes the times of the steps, or screens that a new version of Aura or of the tooling changes | `@visual-reviewer`, on the videos that changed |
| A new version of Aura (`aura-bump`) | `@accuracy-reviewer`, on the tutorials whose screens changed and on the catalog; `@visual-reviewer`, on the videos rendered again |
| The Style of `docs/authoring.md` | `@consistency-reviewer`, on every tutorial |
| A workflow, a script of `scripts/`, `renovate.json`, `.gitmodules`, or the tooling (`Containerfile`, `package.json`, `package-lock.json`) | `@cicd-reviewer` |

- Invoke each reviewer from your own session, after any task that you
  delegated has returned: a subagent cannot invoke another, and must never
  work around that limit, such as with `opencode run`; it names the reviewers
  that its work needs in its result instead.
- Give each reviewer its scope: the tutorials, the changed files, and the
  issue or pull request. Each starts from that scope and reads its own
  authorities; never ask it to rely on your summary of them.
- You may resume a reviewer's session for a follow-up of the same work, with
  the new diff and its earlier findings, while its scope is unchanged;
  otherwise start a fresh one.
- Findings are hypotheses: verify each against its authority, a document of
  Aura, `docs/authoring.md`, or a frame. Discard the speculative, the
  already handled, and the disproportionate, and say why in the pull request.
  Use the smallest correction; a correction that adds a field to the scripts,
  a check, a command, or a document needs the user's decision first.

## Git and GitHub

- Commit messages follow Conventional Commits, such as
  `feat(tutorials): add search-for-a-cve`.
- Never push, open or merge a pull request, create a release or a tag, or
  force-push without the user's explicit consent in the current conversation.
