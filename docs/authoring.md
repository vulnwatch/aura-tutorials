# Authoring Tutorials

This document owns the format of the tutorial scripts, their style, and the
workflows that add, change, and refresh the videos. `README.md` describes the
approach and the isolation from Aura; `AGENTS.md` holds the rules for agents.

## Contents

- [The Pieces](#the-pieces)
- [Script Format](#script-format)
  - [Steps](#steps)
  - [Locators and Waits](#locators-and-waits)
  - [Flows and Variables](#flows-and-variables)
- [Style](#style)
- [Workflows](#workflows)
  - [Add a Tutorial](#add-a-tutorial)
  - [Extend a Tutorial](#extend-a-tutorial)
  - [Change the Look of Every Video](#change-the-look-of-every-video)
  - [Update the Tools](#update-the-tools)
  - [Move to a New Version of Aura](#move-to-a-new-version-of-aura)
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
- **The lock**, `tutorials.lock.json`: for each video, what it was rendered
  from: the version of Aura, the hash of its resolved script (its flows and
  variables included), the hash of the generator (`src/capture.mjs` and
  `src/compose.mjs`, which decide how a video looks), the hash of the tooling
  (the `Containerfile` and `package-lock.json`), and the fingerprints of its
  screenshots. `scripts/tutorials.sh status` compares it with the
  repository; `scripts/tutorials.sh check` compares it with a new capture.
- **The videos**, `out/<id>/<id>.mp4`, which Git ignores: CI renders them and
  publishes them (Publication).

A video is up to date while its script, the generator, and the version of
Aura are those of the lock. A new version of Aura makes every video stale
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
  "user": "jdoe",
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
| `hold` | All | Seconds the step holds after its action, to read its caption; each action has a default |
| `duration` | All | The least duration of the step, in seconds |
| `caption` | Shown steps | The text on screen (Style) |
| `narration` | Shown steps | The sentence that a voice will read; required now, so that narration needs no change of the scripts |

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
- **Captions**: in English, sentence case, at most about eight words, in the
  imperative for an action ("Select Sign in") and as a statement for what a
  screen shows ("The Ticket opens on its Overview"). Name controls as the UI
  does, and use Aura's words: "select", not "click"; "Ticket", capitalized.
- **Narration**: one or two full sentences that the caption shortens, written
  to be read aloud.
- **One idea per step**: a step that both acts and explains becomes two, an
  action and a `show`.
- **Chapters**: a tutorial of several chapters gives each a title of two to
  four words, which a player lists.
- **Users**: the user of the task's profile in the catalog, so that the
  screens show what that profile sees.
- **Tickets**: the same Ticket across tutorials when the task allows it,
  SNTL-12 by default, so that the videos feel like one product tour.

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
4. `scripts/tutorials.sh validate`, then `scripts/tutorials.sh render <id>`.
   A failing capture leaves `out/<id>/capture/failure.png`.
5. Look at the screenshots and the video, then commit the script, the
   catalog, and `tutorials.lock.json`; CI renders and publishes the video.

The `tutorial-author` skill (`.opencode/skills/`) guides an agent through
these steps.

### Extend a Tutorial

Add the steps, or a chapter, to its script and render it again: its script
hash changes, so `status` marks it stale. Extend a tutorial when the new
steps continue its workflow; start a new one when they are another task.

### Change the Look of Every Video

The look lives in `src/compose.mjs`. A change of it, or of the capture
(`src/capture.mjs`), changes the hash of the generator, so every video
becomes stale: `scripts/tutorials.sh render --stale` renders them all.

### Update the Tools

Renovate proposes the updates of the tooling: Playwright, whose npm package
and image move in one pull request, HyperFrames and the other packages, the
actions, and the lockfile, weekly, each version once it is seven days old.
An update of the tooling needs no new video while the screens stay the same:
its pull request passes once `check` finds every fingerprint unchanged, and
CI renders every tutorial with the new tooling as an artifact, to see that
it still renders them well; look at a few frames of each before the merge.
The videos keep the tooling that rendered them until their script, the
generator, or their screens change. When a new version of a tool changes the
screens, such as the rendering of Chromium, `check` reports them changed:
render them again (`scripts/tutorials.sh render --stale` after `check`) and
commit the lock in the pull request.

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
5. `scripts/tutorials.sh render --stale`, then commit the submodule,
   `.gitmodules`, the scripts, the catalog, and the lock together.

## Publication

CI checks every pull request: it validates the scripts and checks the lock
against a capture (`scripts/tutorials.sh check --verify-only`), and renders
the tutorials that the pull request changes, or all of them when it changes
the tooling, as artifacts to review. After a
merge, CI renders the stale videos and publishes a release of this
repository with every video: the unchanged ones copied from the previous
release, and `videos.json`, which lists them. The latest video of a tutorial
is always at
`https://github.com/vulnwatch/aura-tutorials/releases/latest/download/<id>.mp4`.
