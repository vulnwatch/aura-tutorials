---
name: aura-bump
description: Use when moving the aura/ submodule of aura-tutorials to a new release of Sentinel Aura, such as for a Renovate pull request that updates it, or when asked which tutorial videos a new Aura version changes or which new tutorials it needs. Reads Aura's changes between the two release tags, checks every tutorial against the new version, and proposes new, extended, fixed, or re-rendered tutorials for the user to approve.
---

# Aura Bump

Move `aura/` from the release that it pins to a newer one, and bring the
tutorials, the catalog, and the lock along. The checks decide which videos
change; you decide, with the user, what the new version needs that no
tutorial shows yet. Read `docs/authoring.md` (Move to a New Version of Aura)
and `AGENTS.md` first.

## 1. Start

- The worktree must be clean (`git status`); stop and ask otherwise.
- The current pin: `git -C aura describe --tags`, which `.gitmodules` names as
  the `branch` of the submodule.
- The target: the tag that the user names, the one of a Renovate pull
  request (`gh pr checkout <number>`, then `git submodule update --init aura`,
  and read the old pin from `git diff origin/main -- .gitmodules`), or the
  latest release: `git -C aura fetch --tags`, then
  `git -C aura tag --sort=-v:refname | head`. Only release tags, `vX.Y.Z`.
- Without a Renovate pull request, work on a branch:
  `git switch -c aura-<tag>`.

## 2. Read what changed in Aura

Between the two tags, from `aura/` only:

- `git -C aura show <new>:CHANGELOG.md`: the Features and Bug Fixes of each
  release after the old one. Dependencies alone change nothing that users
  see, except a new pinned Sentinel version, whose example dataset may change
  the screens.
- `git -C aura log --no-merges --format='%h %s' <old>..<new>`.
- `git -C aura diff --stat <old> <new> -- docs/ src/ test/e2e/`, then the
  full diff of `docs/screen-map.md` and of every changed or new document of
  `docs/screens/`: a new screen document is a new screen; a change of Users
  and Frequent Tasks changes the catalog.

## 3. Check the tutorials

1. For screenshots to compare, capture at the old pin first, if
   `out/<id>/capture/` is missing: `scripts/tutorials.sh check` before moving
   the submodule. Every tutorial must be unchanged then; if not, the lock was
   not current, and you report it.
2. Move the submodule, unless the pull request did:
   `git -C aura checkout <new>`, and
   `git config -f .gitmodules submodule.aura.branch <new>`.
3. `scripts/tutorials.sh check`. It restarts the backend for the new
   version, captures every tutorial, records the unchanged videos as current,
   and writes `out/report/check.md`:
   - **unchanged**: nothing to do;
   - **changed**: look at `out/report/<id>/*.png`, the earlier screen on the
     left; say what changed and whether the script still tells the truth;
   - **broken**: the capture failed (`out/<id>/capture/failure.png`); the
     script needs a fix, from the changed screen document and e2e tests.

## 4. Propose, then wait

Present one report to the user:

- the version change, and Aura's features and fixes in one line each;
- the result of the check, per tutorial;
- the catalog: tasks whose status changes (a screen that arrives makes a task
  `available` or `partial`), new tasks from `docs/screen-map.md`;
- for each feature that users see, one proposal with its reason: a **new**
  tutorial, an **extended** one (name it and the steps or chapter to add),
  a **fixed** script, or **none** (and why);
- the videos to render again.

Renovate's other pull requests, which update the tooling, need no skill:
`docs/authoring.md` (Update the Tools) says how to review them, and
`AGENTS.md` (Reviewers) which reviewers they need.

Wait for the user's decisions. Do not write scripts before they choose.

## 5. Apply

1. Update `catalog/tasks.json`: statuses, notes, new tasks, and its `aura`
   field.
2. Fix, extend, or add scripts with the `tutorial-author` skill.
3. `scripts/tutorials.sh render --strict --stale`, then
   `scripts/tutorials.sh frames <id>` and a look at the contact sheets of
   every video rendered again.
4. Run the reviewers that `AGENTS.md` (Reviewers) requires:
   `@accuracy-reviewer` on the tutorials whose screens changed and on the
   catalog, `@visual-reviewer` on every video rendered again, and those of
   `tutorial-author` for the scripts that you fixed, extended, or added.
   Verify their findings, fix the confirmed ones, and render again.
5. `scripts/tutorials.sh status`: every tutorial is up to date.
6. Commit the submodule, `.gitmodules`, the catalog, the scripts, and
   `tutorials.lock.json`, for example
   `build(aura): update Sentinel Aura to v0.10.0`, with the tutorials in
   commits of their own. Push, or update the Renovate pull request, only with
   the user's consent.
