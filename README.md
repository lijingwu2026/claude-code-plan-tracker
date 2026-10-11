# plan-tracker

**Everything you need to know about your plan's progress — live.**

![plan-tracker board: four lanes of task cards with progress bars, and a band above the prompt showing the plan's done/total](docs/board.png)

A Claude Code plugin that draws your approved plan as a board in the terminal and in the Claude Desktop app:

- **How far along:** done / total and a progress bar for the plan, a card per step.
- **How it's being run:** who runs each step and on which model, from the board's `executor` column.
- **What needs you:** steps waiting on your check are marked `◆ needs you`.

## Why

Claude Code's own views show agents and sessions. plan-tracker shows the steps of the plan you approved, and which of
them are done, running or waiting on you.

## How it works

1. The route skill of [plan-orchestrator](https://github.com/lijingwu2026/claude-code-plan-orchestrator) writes
   `PROGRESS.md`, one row per step: `task, status, executor, check, evidence`.
2. plan-tracker reads that file again about every 1.5 s and redraws when it changed: a band above the prompt
   (plan name, bar, done/total) and a pane with four lanes, Todo, In Progress, Verify and Done. Under the plan name
   sits one dim line with the plan's state (`In progress`, `Done`, `Not started`). Both also draw in the Claude Desktop
   app.
3. Press a card to open its page, kept short: a status line (the status, who runs it, the model as a chip), a progress
   bar when the step reports one, the latest note, and the deliverable with what it changed. `Checked by` appears once
   the step is Done.

It also works without plan-orchestrator: any `PROGRESS.md` with a markdown table that has `task` and `status` columns.
Columns are found by header name, in any order. Statuses read: `Todo`, `In Progress`, `Needs Verification`, `Blocked`,
`Done`, `Canceled`; any other status gets its own lane.

```markdown
| task | status | executor | check | evidence |
|---|---|---|---|---|
| 1. Add the parser | Done | subagent · Sonnet | script | 12 tests pass |
| 2. Review the copy | Needs Verification | main session · Sonnet | you | draft in docs/copy.md |
```

## Install

```
/plugin marketplace add lijingwu2026/claude-code-plan-tracker
/plugin install plan-tracker@plan-tracker
```

Open the board with `/plans`, or press the bar in the band. If you already have a `/plans` command of your own,
yours is kept and plan-tracker does not register its own; the band and the board still work.

## Settings

Claude Code asks for these when you enable the plugin.

| Setting | Default | What it does |
|---|---|---|
| `board_location` | `PROGRESS.md` | The board file, relative to the project root. Same meaning as plan-orchestrator's `board_location`. |
| `board_command` | empty | A command that prints the board as JSON, used instead of the file. `{session}` is the session id, `{query}` the `/plans` argument; `[ ... ]` keeps its words only when every placeholder inside is non-empty. No shell runs it. |
| `usage_command` | empty | A command that records a step's time and cost when its page opens; `board_command` then returns them. |
| `your_name` | empty | A row whose executor or checker is this name is shown as `you`. `you` itself always counts. |

Time, tokens and estimated cost appear only when `usage_command` is set and your `board_command` returns them: on a
task page as one `time · tokens · cost` line, and on the plan line next to the plan's start time and elapsed time
(`In progress · started 20:08 today · 56m so far · 38.2M tokens · ~$9.30`). On a narrow pane the plan line drops the start
time first, then the elapsed time, then the tokens. With a plain `PROGRESS.md` there is no usage: the plan line shows the
state only and a task page has no time line.

## Limits

- Read-only: it never writes the board. The route skill, or whatever writes your `PROGRESS.md`, updates it.
- Polls the file about every 1.5 s; it does not use file-system events. With `board_command` set, the file is not
  polled: the board is read at session start, on each prompt, after a Bash call that runs the command, and every 10 s
  while the pane is open.
- Shows the first table in the file with `task` and `status` columns, as one plan.
- Needs a Claude Code version that loads plugin hooks modules (mods). No minimum version is declared.
- In the Desktop app, a deliverable link (from an optional `deliverable` column) opens the file with macOS `open`, and
  only for a file under the project root or `~/.claude`.

## License

MIT
