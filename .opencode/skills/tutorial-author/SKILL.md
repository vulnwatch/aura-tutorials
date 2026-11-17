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
  story, in `setup` otherwise.
- Every shown step has a caption and a narration (`docs/authoring.md`,
  Style).

## 4. Render and look

1. `scripts/tutorials.sh validate`.
2. `scripts/tutorials.sh render <id>`. When a capture fails, look at
   `out/<id>/capture/failure.png`, fix the locator or the wait, and render
   again.
3. Look at the screenshots of `out/<id>/capture/`: each shows its step's
   state, nothing still loading, no pointer hovering over the UI.
4. Extract frames of the video and look at them, a few per chapter:
   `scripts/tooling.sh ffmpeg -ss <s> -i <id>/<id>.mp4 -frames:v 1 -update 1 <id>/frame.png`
   writes `out/<id>/frame.png`. Check that the camera frames the target, the
   caption fits, and nothing overlaps.
5. `scripts/tooling.sh hyperframes <id> check` must report no error; the
   warning `timeline_track_too_dense` is expected.

## 5. Finish

- Update `catalog/tasks.json` if a task's status changed.
- Show the user the frames, the duration, and the coverage, and take their
  feedback.
- Commit the script, its flows, the catalog, and `tutorials.lock.json`
  together, for example `feat(tutorials): add search-for-a-cve`. Do not push
  without the user's consent.
