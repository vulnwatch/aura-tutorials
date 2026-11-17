# OpenCode Tooling

The skills and the reviewers that guide the agents of this repository.
`AGENTS.md` holds the rules for agents, among them when each reviewer runs
(Reviewers); `docs/authoring.md` owns the format of the scripts, their style,
the workflows, and the review (Review).

OpenCode reads these files when it starts: restart it after changing an
agent, a skill, or the local model selection.

## Skills

| Skill | Use |
|---|---|
| `tutorial-author` | Add a tutorial, extend or fix one, or show a new feature of Aura |
| `aura-bump` | Move `aura/` to a new release of Aura and decide which videos it changes |

## Reviewers

Every agent of `agents/` is a read-only reviewer, a subagent that the
primary agent invokes from its own session, as `AGENTS.md` (Reviewers)
says. Each reports findings with their evidence and ends with a verdict:
Clean, Minor issues, or Needs revision.

| Agent | Trigger (`AGENTS.md`, Reviewers, is authoritative) | Purpose |
|---|---|---|
| `@accuracy-reviewer` | A new or changed script, flow, or catalog; a new version of Aura | Every text of the videos against Aura's screen documents and the screenshots of the capture; the covers of the scripts and the catalog against Aura |
| `@visual-reviewer` | A render that changes the frames of a video | The frames of the videos as a viewer sees them: framing, captions, keycaps, settled screens, the pointer, overlap, pacing |
| `@consistency-reviewer` | A new or changed script, flow, or catalog; a change of the Style | The scripts against the Style of `docs/authoring.md` and against each other: wording, users, Tickets, flows, data, coverage |
| `@cicd-reviewer` | A change of a workflow, a script, Renovate, or the tooling | Pinning, permissions, the gates of the pipeline, the isolation from Aura and the host, and the documentation of the commands |

### Permissions

Every reviewer has OpenCode's editing disabled (`edit: deny`). Its shell
denies the common commands that change files, Node.js and Docker, FFmpeg,
and the scripts of `scripts/`, except the commands of `scripts/tutorials.sh`
that only read: `list`, `validate`, `status`, and `coverage`. Git and `gh`
are denied, then allowed in read-only forms, under OpenCode's rule that the
last matching pattern wins. `@visual-reviewer` may also run
`scripts/tutorials.sh frames`, which writes only `out/<id>/frames/`, apart
from installing the dependencies of the tooling when they are stale, as the
commands of `scripts/tooling.sh` that run Node.js do; and `@cicd-reviewer` `actionlint` and
`shellcheck`. These denies are defense in
depth, not a sandbox: `AGENTS.md` keeps the reviewers read-only. No check
keeps the shared block of permissions the same in every definition: change
them together.

### Models

The definitions pin no model, since the providers differ between
contributors. Each contributor chooses them in `.opencode/opencode.jsonc`,
which Git ignores, and which OpenCode merges over the global configuration
and the project's, so that its values win over the per-agent models of
`~/.config/opencode/opencode.json`. Copy `opencode.example.jsonc`, which sets
every primary agent, reviewer, and built-in subagent to
`anthropic/claude-opus-5-5` with the variant `high`, and adjust it. The file
belongs to one checkout: copy it into every worktree that should use it.

`@accuracy-reviewer` and `@visual-reviewer` open screenshots and frames:
their models must accept images. Without a local file, the primary agents
use the user's default model, and every subagent the model of the agent that
invokes it.

## Directory Structure

```
.opencode/
├── agents/                 # The reviewers, one file each
├── skills/                 # The skills, one directory each
├── opencode.example.jsonc  # An example of the local model selection
├── opencode.jsonc          # The local model selection (untracked)
└── README.md               # This file
```

OpenCode also writes its plugin dependencies here (`package.json`,
`node_modules/`, a lockfile), with a `.gitignore` that ignores them; they are
never tracked.
