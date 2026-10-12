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
   (plan name, the plan's state, bar, done/total) and a pane with four lanes, Todo, In Progress, Verify and Done.
   The state is a coloured word after the plan name in the band, the pane header and the plan dropdown: `In progress`
   while a step is In Progress or Verifying, `Done` once every step is Done or Canceled, otherwise `Idle`. Both also draw
   in the Claude Desktop app.
3. Press a card to open its page: the task name, a row of big figures (`9m` over `working time`, `16.5M` over `tokens`, `~$3.89` over `est. cost`, and `medium` over `effort` when the work ran at one effort) when usage is recorded, then a
   table of labelled rows. `Goal` (the step's `goal` cell), `Status`, `Done by` (the model as a chip), `Checked by` (once
   the step is Done), `Progress` (a bar, when the step reports one), `Latest note` and `Deliverable` (the path and what
   it changed). A row with nothing to show is left out. Below the lanes, `Deliverables` lists every file the steps
   produced: type, path and the `change` cell. More than five rows fold into a `+N more` button (press it again for `Show less`); a pane too narrow for three columns stacks each file, its path first and its `change` dim under it.

It also works without plan-orchestrator: any `PROGRESS.md` with a markdown table that has `task` and `status` columns.
Columns are found by header name, in any order. Statuses read: `Todo`, `In Progress`, `Needs Verification`, `Blocked`,
`Done`, `Canceled`; any other status gets its own lane. Optional columns: `executor`, `check`, `deliverable`, `change`
(one line on what the deliverable changed), `artifact` (a page made for you, as a markdown link `[Title](https://… or a path)`),
`artifact_note` (one line on it), `goal` (one sentence on what the step is for) and `progress`. Artifacts get their own
table above `Deliverables`: the title as a link and the note dim; a local `.html` opens in your browser. A `board_command`
returns the same two keys, `artifact` and `artifact_note`, on each row.

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

Open the board with `/plan-tracker`, or press the bar in the band; `/plan-tracker <words from a plan name>` opens one plan.
If you already have a `/plan-tracker` command of your own, yours is kept and plan-tracker does not register its own;
the band and the board still work.

## Settings

Claude Code asks for these when you enable the plugin.

| Setting | Default | What it does |
|---|---|---|
| `board_location` | `PROGRESS.md` | The board file, relative to the project root. Same meaning as plan-orchestrator's `board_location`. |
| `board_command` | empty | A command that prints the board as JSON, used instead of the file. `{session}` is the session id, `{query}` the `/plan-tracker` argument; `[ ... ]` keeps its words only when every placeholder inside is non-empty. No shell runs it. |
| `usage_command` | empty | A command that records a step's time and cost when its page opens; `board_command` then returns them. |
| `your_name` | empty | A row whose executor or checker is this name is shown as `you`. `you` itself always counts. |

With `board_command`, a query that finds several plans can answer with `matches` (a list of `anchor`, `name`, `state`:
`In progress`, `Idle` or `Done`, `done` and `total`) and a `message`; the pane draws the message, then the list in the style
of the plan list, each plan pressable, and a press opens that plan. `plans` and `selected` stay what they are with no
query. A `PROGRESS.md` board is one plan, so it has no list: `/plan-tracker <words>` opens that plan.

Time, tokens and estimated cost appear only when `usage_command` is set and your `board_command` returns them: on a
task page as a row of figures, and under the plan name as three figures: the time (`2h 41m` over `since 20:08`, or
`since Oct 9 20:08` on another day; `total time` once the plan is closed), `54.8M` over `tokens` and `~$13.19` over
`est. cost`. Each figure is a bold value over a dim label; `Not started yet` shows before any step runs. On a narrow pane
the time goes first, then the tokens; the cost stays. With a plain `PROGRESS.md` there is no usage and no start time: no
figures are drawn once a step is under way, and a task page has none.

## Limits

- Read-only: it never writes the board. The route skill, or whatever writes your `PROGRESS.md`, updates it.
- Polls the file about every 1.5 s; it does not use file-system events. With `board_command` set, the file is not
  polled: the board is read at session start, on each prompt, after a Bash call that runs the command, and every 10 s
  while the pane is open.
- Shows the first table in the file with `task` and `status` columns, as one plan.
- Needs a Claude Code version that loads plugin hooks modules (mods). No minimum version is declared.
- In the terminal the deliverables table shows each path as coloured text, not a link: a terminal without OSC 8
  hyperlink support would print the address after every link. An artifact title is a link, since opening it is the point;
  such a terminal prints the address after it.
- In the Desktop app, a deliverable link (from an optional `deliverable` column) is a plain `file:` link. Inside the
  project root the Desktop opens it itself, in its own viewer; the plugin does not intercept the click. Outside the
  project root the Desktop opens nothing, so the click goes to the plugin, which runs macOS `open` (the file's default
  app) only for a file under `~/.claude` or a regular file under your home directory outside hidden folders (a path
  with a segment starting with `.` is refused, except `~/.claude`); any other path gets a "Not opened" toast. A local
  artifact page (the `artifact` column) is opened the same way, and also from `/tmp` and `/private/tmp`, where a session
  leaves its scratch pages.

## License

MIT
