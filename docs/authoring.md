# Authoring Tutorials

This document owns the format of the tutorial scripts, their style, the
workflows that add, change, and refresh the videos, and their review.
`README.md` describes the approach and the isolation from Aura; `AGENTS.md`
holds the rules for agents.

## Contents

- [The Pieces](#the-pieces)
- [Script Format](#script-format)
  - [Steps](#steps)
  - [Locators and Waits](#locators-and-waits)
  - [Flows and Variables](#flows-and-variables)
- [Style](#style)
- [Narration](#narration)
- [Workflows](#workflows)
  - [Add a Tutorial](#add-a-tutorial)
  - [Extend a Tutorial](#extend-a-tutorial)
  - [Change the Look of Every Video](#change-the-look-of-every-video)
  - [Update the Tools](#update-the-tools)
  - [Move to a New Version of Aura](#move-to-a-new-version-of-aura)
- [Review](#review)
  - [Checks of the Composition](#checks-of-the-composition)
  - [Frames](#frames)
  - [Reviewers](#reviewers)
- [Publication](#publication)

## The Pieces

- **The catalog**, `catalog/tasks.json`: what users do in Aura, from the
  frequent tasks of each profile in Aura's `docs/screen-map.md` (Users and
  Frequent Tasks), plus the basics that every task needs, such as signing in.
  Each task has a status for the pinned Aura: `available`, `partial` (its
  notes say what is missing), or `not-in-aura`. The catalog says what the
  tutorials should cover; `scripts/tutorials.sh coverage` says what they do.
- **A script**, `tutorials/<id>.json`: one tutorial, the steps that it shows
  in chapters, and the tasks of the catalog that it covers. Its id is its
  file name and the name of its video, `<id>.mp4`; renaming a script breaks
  the links to its video, so an id stays once published.
- **A flow**, `flows/<id>.json`: steps that several scripts share, such as
  signing in. A script includes a flow among the steps that it shows, or in
  its setup, which runs without being shown.
- **The narration**, `narration/`: the voice that reads the narration of
  each shown step, `voice.json`, and its clips, one for each sentence, which
  `clips.json` lists (Narration).
- **The lock**, `tutorials.lock.json`: for each video, what it was rendered
  from: the version of Aura, the hash of its resolved script (its flows and
  variables included), the hash of the generator (`src/capture.mjs` and
  `src/compose.mjs`, which decide how a video looks), the hash of its
  narration (the clips that its voice reads), the hash of the tooling
  (the `Containerfile` and `package-lock.json`), and the fingerprints of its
  screenshots; and what describes it to the website and in `videos.json`
  (Publication): its title and subtitle, its duration, the times of its
  chapters, and its steps, with their captions, which the search of the
  website looks in, and their times. `scripts/tutorials.sh status` compares
  it with the
  repository; `scripts/tutorials.sh check` compares it with a new capture.
- **The videos**, `out/<id>/<id>.mp4`, each with its subtitles,
  `out/<id>/<id>.vtt`, which Git ignores: CI renders them and publishes them
  (Publication).

A video is up to date while its script, the generator, its narration, and the
version of Aura are those of the lock. A new version of Aura makes every video stale
until `check` captures it again: a video whose fingerprints are unchanged is
then current again without a render; the others need one. The tooling makes
no video stale: the lock only records what each video was rendered with, and
`status` notes a video rendered with earlier tooling (Update the Tools).

## Script Format

```json
{
  "title": "Find SUSE's status for a CVE",
  "subtitle": "Search the Tickets, open one, and read its packages",
  "outro": { "title": "Search finds more than CVEs", "subtitle": "…" },
  "user": "hgray",
  "covers": ["search", "cve-status"],
  "changesData": false,
  "vars": { "cve": "CVE-2099-0012", "ticket": "SNTL-12" },
  "setup": [{ "include": "sign-in" }],
  "chapters": [{ "title": "Find SUSE's status for a CVE", "steps": [ … ] }]
}
```

| Field | Required | Meaning |
|---|---|---|
| `title` | Yes | The title card at the start, and the title of the MP4 |
| `subtitle` | No | The line under the title |
| `outro` | No | The closing card: `title`, and an optional `subtitle` |
| `user` | Yes | The user of Sentinel's example dataset who signs in: the profile's user of the catalog, unless the tutorial needs another role |
| `covers` | Yes | The ids of the catalog's tasks that the tutorial shows |
| `changesData` | No | `true` when a step changes data, such as adding a reference: the tutorial then captures on a fresh backend of its own |
| `vars` | No | Variables for the strings of the steps (Flows and Variables) |
| `setup` | No | Steps that run before the video, without being shown, such as signing in |
| `chapters` | Yes | The chapters, each a `title` and its `steps`. A tutorial of one chapter shows no chapter card; one of several opens each chapter with a card, and its MP4 lists the chapters |

A tutorial takes as long as its task needs: one short task makes a video of
under a minute, a workflow one of several minutes in chapters.

### Steps

| Field | Actions | Meaning |
|---|---|---|
| `id` | All | Unique in the script, lowercase words joined by hyphens; a step of a flow gets the flow's id as a prefix |
| `action` | All | `goto`, `fill`, `click`, `press`, or `show` |
| `path` | `goto` | The path to open, such as `/login` |
| `target` | `fill`, `click`; optional for `press` and `show` | The element that the step acts on or points at (Locators and Waits) |
| `value` | `fill` | The text to type, one screenshot per character |
| `key` | `press` | The key, as Playwright names it, such as `Enter` or `Escape`; the video shows it on a keycap |
| `waitFor`, `waitForUrl` | All | What must hold after the action before its screenshot |
| `zoom` | All | How far the camera zooms towards the target, from 1 (the whole window) to 3; each action has a default |
| `hold` | All | Seconds the step holds after its action, to see its result; each action has a default |
| `duration` | All | The least duration of the step, in seconds; a step also lasts until its sentence ends (Narration) |
| `caption` | Shown steps | The title of the step, which the search of the website looks in and the frames list (Style); the video does not show it |
| `narration` | Shown steps | The sentence that the voice reads during the step, and the text of its subtitles (Narration) |

The actions:

- `goto` opens a path and shows the screen.
- `fill` moves the pointer to the target, clicks it, and types the value.
- `click` moves the pointer to the target, rings it, clicks it, and shows
  the result.
- `press` presses a key, in the target when there is one, and shows the
  result.
- `show` points at the target, scrolled into view, with a ring and a zoom,
  or shows the screen as it is without one.

### Locators and Waits

A locator finds an element as a user does, by its role and accessible name,
as Aura's end-to-end tests do (Aura `test/e2e/`): copy their locators when
they exist.

- `{ "role": "button", "name": "Sign in" }`, with the optional `exact`,
  `level` for a heading, and `nth` for the nth match;
- `{ "label": "Password" }`, or `{ "text": "added the reference" }`;
- a chain, each part found inside the previous one:
  `[{ "role": "grid", "name": "Tickets" }, { "role": "link", "name": "SNTL-12", "exact": true }]`.

`waitFor` is a locator or a list of them that must be visible after the
action; with `child`, a locator inside it that must be visible too, and with
`allHaveText`, a regular expression that the text of every such child must
match, such as the counts of the views once they have arrived
(`"\\s\\d[\\d,]*$"`). `waitForUrl` is a regular expression that the path must
match. After them, the capture waits until no request is in flight and the
fonts are loaded. Wait for whatever arrives late and moves the page, as
Aura's end-to-end tests do, or the screenshot shows a page still loading.

### Flows and Variables

`{ "include": "<flow>" }` among the steps inserts the steps of
`flows/<flow>.json`; `"with": { "name": "value" }` sets variables for it.
A flow has a `description` and `steps`, each with a caption and a narration,
since a script may show them.

Every string of a step may hold `{name}`: a variable of `vars`, of `with`,
`{user}`, the user of the script, or `{password}`, the published password of
the example dataset. An unknown variable fails the validation.

## Style

- **Data**: only Sentinel's example dataset, whose data is fictional. A step
  that types data uses fictional values, such as addresses under
  `example.com`.
- **Captions**: the title of each step, which the video does not show: the
  voice and the subtitles tell the step. In English, sentence case, at most
  about eight words, in the imperative for an action ("Select Sign in") and as a statement for what a
  screen shows ("The Ticket opens on its Overview"). Name controls as the UI
  does, and use Aura's words: "select", not "click"; "Ticket", capitalized.
- **Verbs**: one verb for each kind of action, in captions and narrations:
  "Select" for a button or a link that the text names ("Select Sign in");
  "Open" for a tab, a view, or a Ticket ("Open the tab References", "Open the
  Ticket"); "Enter" for a value typed into a field ("Enter your username");
  and "Press" for a key, with its purpose ("Press Escape to close it").
- **Narration**: one or two full sentences that the caption shortens, written
  to be read aloud, and addressed to the viewer as "you", whatever the
  profile. The narration of a click starts with its action, "Select" or
  "Open", names what it selects or opens next, and gives its purpose, when
  it has one, after that ("Select Filters to narrow the list."), because the click lands early
  in the sentence (Narration, Timing); the validation fails on another
  start.
- **One idea per step**: a step that both acts and explains becomes two, an
  action and a `show`.
- **Chapters**: a tutorial of several chapters gives each a title of two to
  four words, which a player lists.
- **Users**: the user of the task's profile in the catalog, so that the
  screens show what that profile sees.
- **Tickets**: the same Ticket across tutorials when the task allows it,
  SNTL-12 by default, so that the videos feel like one product tour.

## Narration

A voice reads the narration of each shown step, and the video shows the same
text as subtitles.

- **The voice**, `narration/voice.json`: the `model` of the speech service,
  OpenRouter (`src/narrate.mjs`), and its `voice`. One voice reads every
  tutorial, in English.
- **The clips**, `narration/clips/<key>.mp3`: one for each sentence, MP3 at
  48 kbit/s, mono. `narration/clips.json` lists them with their text and
  duration. The key of a clip is the hash of its text, the model, and the
  voice: two steps with the same sentence share a clip, and a changed
  sentence, or another voice, needs a new one.
- **Making them**: `scripts/tutorials.sh render` first makes the clips that
  `narration/` lacks and removes those that no tutorial uses any more
  (`scripts/tooling.sh narrate`). Only a clip to make calls the speech
  service, with the key of the contributor (The key); without one, the
  render fails and names the sentences. A render that finds
  every clip needs no key and no network, as in CI, which holds no key; a
  render of CI removes nothing, and fails when `narration/` holds a clip
  that no tutorial uses. After removing a tutorial, which leaves no video
  to render, run `scripts/tooling.sh narrate` to remove its clips.
- **The key**: an API key of OpenRouter, in the file
  `~/.config/aura-tutorials/openrouter.key`, or `openrouter.key` under
  `$XDG_CONFIG_HOME/aura-tutorials/`, which holds only the key and which
  only its owner reads (`chmod 600`). The environment variable
  `OPENROUTER_API_KEY` wins over the file, for a key that a password manager
  holds. The key never lives in the repository, not even in a file that Git
  ignores: every container mounts the repository, the one that installs the
  dependencies included. Give the key a low spending limit.
- **Why the repository keeps them**: the service reads the same sentence
  another way each time, with another duration, and retires its models. The
  clips are the recording that the videos were made from, as their scripts
  are; the videos are not, since a render gives them again.
- **Timing**: the voice starts 0.3 s after its step, and the step ends no
  sooner than 0.45 s after the sentence (`src/compose.mjs`, `VOICE`). A
  `hold` or a `duration` only lengthens a step beyond that. A click lands
  1.8 s into its sentence, or as a shorter sentence ends, once the voice has
  named the action while the pointer waits on the ringed target
  (`CLICK_AFTER_VOICE_START`); its result then shows while the voice reads
  the rest of the sentence, and for at least 2.5 s after the click, unless
  the step names a shorter `hold`.
- **Subtitles**: `out/<id>/<id>.vtt`, WebVTT, the narrations while the voice
  reads them, a long one in cues of at most 84 characters, where a player
  puts them, at the bottom of the video, or at the top during a step whose
  target is at the bottom. The video itself shows no caption and no narration,
  so the website turns the subtitles on.
- **The lock** records the hash of the keys, the durations, and the files of
  the clips of each video: a changed sentence makes its video stale through its
  script, and another voice, or another reading of a sentence, through its
  narration, as `scripts/tutorials.sh status` reports it
  (`narration-changed`).

To change the voice, edit `narration/voice.json` and render every tutorial:
each sentence is read again. To have one sentence read again, delete its clip and render.
Commit `narration/` with the scripts and the lock.

Write a narration as it should sound: the voice reads abbreviations that
people say as words or letters, such as CVE, SUSE, P1, and QA, but reads
long identifiers, such as the number of a CVE, unevenly. Say "the CVE", not
its number, which the screen shows.

## Workflows

Every command runs from the root of the repository. `scripts/backend.sh`
starts the UI under capture; `scripts/tutorials.sh` starts it when it needs
it.

### Add a Tutorial

1. Find the task in the catalog, or add it there first, with the section of
   Aura's documents that describes it.
2. Check whether a tutorial already covers a part of it
   (`scripts/tutorials.sh coverage`): extend that one if the new steps belong
   to the same workflow (Extend a Tutorial).
3. Write `tutorials/<id>.json`, reusing the flows; take the locators from
   Aura's end-to-end tests and the wording from its screen documents.
4. `scripts/tutorials.sh validate`, then
   `scripts/tutorials.sh render --strict <id>`, which needs the key of the
   speech service for the new sentences (Narration, The key). A
   failing capture leaves
   `out/<id>/capture/failure.png`; a finding of the checks of the
   composition names the step to fix (Review).
5. Look at the screenshots and at the frames of the video
   (`scripts/tutorials.sh frames <id>`), and have the reviewers look at them
   (Review). Then commit the script, the catalog, `narration/`, and
   `tutorials.lock.json`; CI renders and publishes the video.

The `tutorial-author` skill (`.opencode/skills/`) guides an agent through
these steps.

### Extend a Tutorial

Add the steps, or a chapter, to its script and render it again: its script
hash changes, so `status` marks it stale. A changed narration needs its clip,
and so the key of the speech service (Narration). Extend a tutorial when the new
steps continue its workflow; start a new one when they are another task.

### Change the Look of Every Video

The look lives in `src/compose.mjs`. A change of it, or of the capture
(`src/capture.mjs`), changes the hash of the generator, so every video
becomes stale: `scripts/tutorials.sh render --strict --stale` renders them
all, and the frames of every video are reviewed again (Review).

### Update the Tools

Renovate proposes the updates of the tooling: Playwright, whose npm package
and image move in one pull request, HyperFrames and the other packages, the
actions, and the lockfile, weekly, each version once it is seven days old.
An update of the tooling needs no new video while the screens stay the same:
its pull request passes once `check` finds every fingerprint unchanged, and
CI renders every tutorial with the new tooling as an artifact, to see that
it still renders them well; look at the contact sheets of each, which the
artifact holds (Review, Frames), before the merge.
The videos keep the tooling that rendered them until their script, the
generator, or their screens change. When a new version of a tool changes the
screens, such as the rendering of Chromium, `check` reports them changed:
render them again (`scripts/tutorials.sh render --strict --stale` after
`check`) and commit the lock in the pull request.

### Move to a New Version of Aura

The submodule pins a release of Aura, whose tag `.gitmodules` names as its
`branch`, so that Renovate proposes the next release in a pull request. The
`aura-bump` skill guides the update:

1. Read what changed: the Features and Bug Fixes of Aura's `CHANGELOG.md`
   between the two tags, the commits, and the changed screen documents.
2. Move the submodule: `git -C aura fetch --tags`, then
   `git -C aura checkout <tag>` and `branch = <tag>` in `.gitmodules`.
   `git submodule update --remote` does not work with a tag.
3. `scripts/tutorials.sh check`: it captures every tutorial again on a fresh
   backend and compares its screens with the lock. Unchanged videos become
   current for the new version without a render; changed ones are listed in
   `out/report/check.md`, beside their earlier screens; a failing capture
   means that the script needs a change.
4. Decide, from the changes of Aura and the catalog: which tasks changed
   status, which need a new tutorial or an extended one, which scripts need a
   fix.
5. `scripts/tutorials.sh render --strict --stale`, review what changed
   (Review), then commit the submodule, `.gitmodules`, the scripts, the
   catalog, and the lock together.

## Review

Every video is reviewed twice before its script and its lock are committed:
by checks that need no judgment, which the composition runs, and by
reviewers, agents that look at what the checks cannot measure.

### Checks of the Composition

`src/compose.mjs` knows the box of each target, the moves of the camera, the
place of each keycap, and every time. For each shown step, at its
focus, the moment when the camera has settled on what the step points at, it
checks:

| Check | Its finding |
|---|---|
| `target-outside-view` | The target is not whole in the part of the window that the camera shows |
| `ring-outside-view` | The ring around the target is cut by the edge of the window or of the video |
| `keycap-outside-view` | The keycap of a key press is not whole in view |
| `caption-too-long` | The caption has more than eight words (Style) |

The composition reports the findings, and writes them into
`out/<id>/compose.json` with the start, the focus, and the end of every step
and the times of the cards. `scripts/tutorials.sh render --strict` fails on
them once the videos are rendered, as CI does for the tutorials that a pull
request changes. A finding is fixed in its script, and no step is exempt: a
lower `zoom` or a smaller `target` for a target or a ring out of view, a
shorter caption.

The ring surrounds its target with the same margin on every side. For a cell
of a table, the capture takes the box of what the cell holds, its text and
its images, since a cell is as wide as its column (`src/capture.mjs`).

### Frames

`scripts/tutorials.sh frames <id>` extracts from the rendered video, into
`out/<id>/frames/`, a frame of each step at its focus and one just before its
end, with the result of its action; a contact sheet of each chapter,
`chapter-<n>.png`, with a row for each step; one of the cards, `cards.png`;
and `frames.md`, which lists them with the captions, the times, and the
findings of the checks. With times in seconds, it extracts only the frames
at those times. CI keeps the contact sheets with the videos that it renders.

### Reviewers

Four read-only agents of `.opencode/agents/` review what needs judgment;
`AGENTS.md` (Reviewers) says when each runs, and `.opencode/README.md`
catalogs them:

| Reviewer | What it checks |
|---|---|
| `@accuracy-reviewer` | Every title, caption, narration, and outro against Aura's screen documents and the screenshots of the capture; the covers of each script and the catalog against Aura |
| `@visual-reviewer` | The frames as a viewer sees them: the camera frames the target, the ring surrounds it, no screen still loading, no pointer over the UI, readable text, no overlap, pacing |
| `@consistency-reviewer` | The scripts against the Style and against each other: wording, users, Tickets, flows, data, coverage |
| `@cicd-reviewer` | The workflows, the scripts, Renovate, and the tooling |

Their findings are hypotheses: the agent that invokes them verifies each
against its authority, fixes the confirmed ones with the smallest change,
renders again, and states in the pull request the findings that it discarded
and why.

## Publication

CI checks every pull request and every push to `main`: it validates the
scripts and checks the lock against a capture
(`scripts/tutorials.sh check --verify-only`). The capture is of the tutorials
that the change can affect, so that its time does not grow with their number:

- every tutorial, when the change touches what every capture depends on:
  `aura/` or `.gitmodules`, the `Containerfile`, `package.json` or
  `package-lock.json`, `src/capture.mjs`, `src/compose.mjs`,
  `src/tutorials.mjs`, `src/lib/`, `scripts/`, or the workflow itself;
- otherwise only the tutorials whose resolved script differs from the one
  that the lock of the base records, so that a change of a flow counts
  through the tutorials that include it, and those whose entry of the lock
  changed. A change of the catalog, of the documents, or of the website
  captures none: the catalog changes no screen, and the validation checks the
  tasks that each script covers against it.

The lock must be current for every tutorial, captured or not, as
`scripts/tutorials.sh status` reports it, and the summary of the run lists
the tutorials that it did not capture. A pull request compares with its base
branch, a push with the commit that `main` held before it;
`scripts/tutorials.sh affected` prints them for the committed and the tracked
changes of a clone. The
job always runs and narrows its scope inside, so that a required check of
`main` never waits for it. A push to `main` is so checked for what it
changes alone, not for what an earlier push left failing; a release still
needs a current lock and renders that give its fingerprints. Every Monday on
`main`, and when started by hand, the same workflow captures every tutorial,
to catch what no diff shows, such as an image that a tag moved, or what a
push left; a failure of it shows in the runs of the workflow.

On a pull request, CI also renders
the tutorials that the pull request changes, or all of them when it changes
the tooling or `src/tutorials.mjs`, which reports the checks and extracts the
frames, as artifacts to review with their contact sheets; the checks of their
composition fail it (Review). It renders each from the capture of the check,
without capturing it again. After a
merge, CI renders the stale videos, with the clips of `narration/` and
without a key of the speech service, and publishes a release of this
repository with every video and its subtitles, `<id>.vtt`: the unchanged
ones copied from the previous release, and `videos.json`, which lists them. The latest video of a tutorial
is always at
`https://github.com/vulnwatch/aura-tutorials/releases/latest/download/<id>.mp4`.

Then CI deploys the website of the tutorials to GitHub Pages, at
`https://vulnwatch.github.io/aura-tutorials/`, also when no video changed,
so that a change of the catalog shows at once: `src/site.mjs` generates it
from the lock, the catalog, and the videos of the latest release, and the
summary of the workflow reports its size, of the 1 GB that Pages allows.
The site serves the MP4s itself, as `video/mp4` with range requests, which
the assets of a release lack; the release stays the versioned archive. It
holds:

- the directory, its home page: the roles, which are the profiles of the
  catalog, and under the chosen one its path, the tutorials that cover its
  tasks, numbered in the order of those tasks. A tutorial that covers a task
  of a specific role belongs to that role; Every user, where every role
  starts, keeps the tutorials whose tasks are all common. A role without a
  tutorial shows as coming soon. A search finds the videos of every role by
  their title, their subtitle, and the captions of their steps;
- a page per tutorial, at `tutorials/<id>/`, always dark, which keeps to
  its video, with a poster, a frame of its intro card, its chapters as a
  WebVTT track, and its subtitles as another, which shows unless the visitor turns it off:
  around it, only the link back to its role, its title, its
  place in the path, and the link to the next video of its role, or to the
  directory after the last one.

A new tutorial, or a change of a script or of the catalog, needs nothing
more: the site follows the lock and the catalog. Each pull request keeps the
site as the artifact `site`, with the videos that it renders and those of
the latest release; `scripts/tutorials.sh site --release --serve` makes the
same site locally and serves it on `http://localhost:3003`.
