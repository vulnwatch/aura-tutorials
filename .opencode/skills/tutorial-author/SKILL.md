---
name: tutorial-author
description: Use when adding a Sentinel Aura video tutorial to aura-tutorials, extending or fixing a tutorial script of tutorials/ or a flow of flows/, or when a new feature of Aura needs a video. Guides the choice between a new and an extended script, writing it from Aura's screen documents and end-to-end tests, rendering it, reviewing its frames, and updating catalog/tasks.json and tutorials.lock.json.
---

# Tutorial Author

Write or change a tutorial so that it fits the others: the same format,
style, users, and Tickets. `docs/authoring.md` owns the format and the style;
read it first, completely.

## 1. Understand the request

- Name the task that the video shows, as a user of Aura would say it.
- Find it in `catalog/tasks.json`. If it is missing, propose to add it, with
  its profile and the section of Aura's documents that describes it
  (`aura/docs/screen-map.md`, Users and Frequent Tasks, or the screen
  document), and wait for the user's agreement.
- If the task's status is `not-in-aura`, stop: Aura cannot show it yet. If it
  is `partial`, show only what its notes say is there.

## 2. New or extended

Run `scripts/tutorials.sh coverage` and `scripts/tutorials.sh list`, and read
the scripts that cover the task or its neighbors. Then propose one of:

- **Extend** a script when the new steps continue its workflow, such as a new
  action on a screen that it already walks through; add steps or a chapter.
- **New** script when the steps are another task or another workflow.
- **Flow**: when steps repeat across scripts, such as signing in or opening a
  Ticket, move them to `flows/` and include them.

Length is no limit: a workflow may take several minutes in chapters. Give the
user the choice and its reason before writing; a renamed script breaks the
published link of its video, so never rename one without the user's consent.

## 3. Write the script

- Read the screen document of every screen that the steps visit
  (`aura/docs/screens/<screen>.md`): its content, its actions, and its words.
  Captions use the words of the UI.
- Take the locators and the waits from Aura's end-to-end tests
  (`aura/test/e2e/<screen>.spec.ts` and `fixtures.ts`): they already find
  each element by role and name, and wait for what arrives late, such as the
  counts of the views (`expectViewCounts`) or the overview of a Ticket
  (`expectOverviewShown`).
- Use the profile's user of the catalog, and SNTL-12 unless the task needs
  another Ticket; the e2e tests' comments say which Tickets of the example
  dataset have what.
- A step that changes data needs `"changesData": true` on the script.
- Sign in through the `sign-in` flow: shown when signing in is part of the
  story, in `setup` otherwise. Open a Ticket from the list through the
  `open-ticket` flow, with the variable `ticket`.
- Every shown step has a caption and a narration (`docs/authoring.md`,
  Style).

## 4. Render and look

1. `scripts/tutorials.sh validate`.
2. `scripts/tutorials.sh render --strict <id>`. When a capture fails, look at
   `out/<id>/capture/failure.png`, fix the locator or the wait, and render
   again. When the checks of the composition report a finding, fix the step
   that it names, with a `zoom`, a `hold`, another `target`, or a shorter
   caption (`docs/authoring.md`, Review), and render again: CI fails on them.
3. Look at the screenshots of `out/<id>/capture/`: each shows its step's
   state, nothing still loading, no pointer hovering over the UI.
4. `scripts/tutorials.sh frames <id>`, then look at the contact sheets of
   `out/<id>/frames/`, one per chapter, and at the frames that they leave in
   doubt: the camera frames the target, the caption hides nothing, nothing
   overlaps. `frames.md` lists them with the times of the steps.
5. `scripts/tooling.sh hyperframes <id> check` must report no error. Its
   warnings `timeline_track_too_dense` and `film_silent`, the video having no
   sound yet, are expected.

## 5. Review

Run the reviewers that `AGENTS.md` (Reviewers) requires, from your own
session: for a new tutorial `@accuracy-reviewer`, `@consistency-reviewer`, and
`@visual-reviewer`; for a changed script or flow the first two, and
`@visual-reviewer` when its frames change. Give each the ids of the
tutorials, the changed files, and the issue, if any. Verify each finding
against its authority, fix the confirmed ones, render again, and resume the
same reviewer for the follow-up.

## 6. Finish

- Update `catalog/tasks.json` if a task's status changed.
- Show the user the frames, the duration, the coverage, and the verdicts of
  the reviewers with the findings that you discarded, and take their
  feedback.
- Commit the script, its flows, the catalog, and `tutorials.lock.json`
  together, for example `feat(tutorials): add search-for-a-cve`. Do not push
  without the user's consent.
