# plan-tracker reference

What the [README](../README.md) leaves out: how the board is laid out, what each state looks like, and everything you can set or send.

## Lanes

The board has four lanes: Todo, In Progress, Verify and Done. Side by side they need a pane 100 columns wide; below that they stack. A lane header counts its cards: `In Progress 2 · 1 blocked`, `Verify 1 · 1 verifying`. `3/8` counts the Done tasks over every task but the Canceled ones.

| Lane | Holds | Cards shown |
|---|---|---|
| Todo | `Todo` | 3, then a `+N more` button that unfolds the lane |
| In Progress | `In Progress` and `Blocked`, Blocked first | 5, then `+N blocked · N running` |
| Verify | `Verifying` first, then `Needs Verification` waiting on you, then the rest | 5, then a count that says how many need you |
| Done | `Done` | 3, then `+N more` |

Each lane lists its latest-updated task first. Without times (a plain `PROGRESS.md`), Todo, In Progress and Verify keep file order and Done lists the later row first.

## Plan states

Shown in the header, the band and the plan list. The plan's only time is in the state word; a time from another day carries its day (`Done at Oct 11 21:40`).

| Looks like | State | When | Time shown |
|---|---|---|---|
| <img src="states/plan-in-progress.png" alt="In progress plan header" height="16"> | In progress | A task is In Progress or Verifying and is not marked stalled; or Claude is working on the plan now: this session runs a turn or a background agent, and the plan is this session's (the one plan of a `PROGRESS.md`; with a board command, a plan sent with `in_session: true`). Agents a Workflow starts are not counted | none |
| <img src="states/plan-stalled.png" alt="Stalled plan header" height="16"> | Stalled | Every In Progress or Verifying task is stalled and this session is not working on the plan: your board command marks a task with `stalled_since`, meaning no session is working on it. A plain `PROGRESS.md` has no session data and never shows this | `Stalled since 19:23`, the newest `stalled_since` |
| <img src="states/plan-waiting.png" alt="Waiting for you plan header" height="16"> | Waiting for you | Nothing is In Progress or Verifying, and a Needs Verification task has you as its checker or its executor. Drawn in the colour of the `◆ needs you` marker | `Waiting for you since 19:40`, the later of `idle_since` and when this session last stopped working; plain without either |
| <img src="states/plan-idle.png" alt="Idle plan header" height="16"> | Idle | No task is In Progress or Verifying and none waits on you, including a plan nothing has started | `Idle since 19:40`, the later of `idle_since` and when this session last stopped working; plain `Idle` without either |
| <img src="states/plan-done.png" alt="Done plan header" height="16"> | Done | Every task is Done or Canceled (one at least Done), or your board command sends `finished` | `Done at 21:40`, from `finished`, else `updated`; plain `Done` with neither |

`Plan file ›` in the header and the band opens the plan file as a page, drawn as Markdown. For a plain `PROGRESS.md` that is the file itself.

## Card states

The tag names who does the task or takes it next, so a Done card has none. A task whose route names neither a model nor you has none either.

| Looks like | Card | How it looks |
|---|---|---|
| <img src="states/card-running.png" alt="Running task card" height="64"> | Running | In Progress or Verifying: the mascot moves; the tag is the model doing it (`Opus`, `Sonnet`, `Haiku`) or `you`; on a Verifying card it is the checker |
| <img src="states/card-stalled.png" alt="Stalled task card" height="64"> | Stalled | Running but marked `stalled_since`: the mascot stands still and a grey tag, `stalled 19:23` (`stalled Oct 11` from another day), replaces the model tag; a card too narrow for the time shows the bare `stalled` |
| <img src="states/card-waiting-for-you.png" alt="Waiting for you task card" height="64"> | Waiting for you | Needs Verification and you are its checker or its executor: `◆ needs you ·` before the name, tag `you` |
| <img src="states/card-waiting-for-check.png" alt="Waiting for a check task card" height="64"> | Waiting for a check | Needs Verification with another checker: no marker; the tag is the checker's model, none for a script |
| <img src="states/card-blocked.png" alt="Blocked task card" height="64"> | Blocked | Red, `⚑ Blocked ·` before the name, the mascot frozen; the tag is who runs it |
| <img src="states/card-todo.png" alt="Todo task card" height="64"> | Todo | No mascot; the tag is who will do it: a model, or `you` |
| <img src="states/card-done.png" alt="Done task card" height="64"> | Done | No tag; its page says who did it |

A card shows the whole task name, wrapped. A `progress` value draws a bar on the card, when the card is wide enough.

## Task page

Press a card to open its page; `‹ Back` returns. Each row is left out when there is nothing to show.

| Row | Shows |
|---|---|
| Goal | The `goal` cell |
| Status | `To do`, `In progress`, `Waiting for your check`, `Waiting for a check`, `Being checked`, `⚑ Blocked` or `Done`; a stalled task adds `· stalled since 14:02` |
| Done by | The executor, with its model as a tag; `you` for your own tasks |
| Checked by | The checker, once the task is Done |
| Progress | The `progress` bar |
| Latest note | The `evidence` cell; `Blocked because` on a blocked task. A file path in it is a link; a terminal without OSC 8 hyperlink support prints the address after the link |

Above the table, working time, tokens and est. cost appear when your board command supplies them. A task you run yourself shows none.

## Board file

The file is `board_location` (see Settings). Columns are found by their header name, in any case and any order. The table ends at the first line that does not start with `|`, and a row with no `task` is skipped. The plan's name is the file's first `# ` heading, else the name of the folder that holds the file.

| Column | What it holds | plan-orchestrator writes it |
|---|---|---|
| `task` | The task's name, shown on its card. Required. | yes |
| `status` | One of the statuses below. Required. | yes |
| `executor` | Who runs the task and on which model: `subagent · Sonnet`, `main session · Opus`, `script` or `you`. The model after ` · ` is the card's tag. | yes |
| `check` | Who verifies it, such as `main session · Opus`, `script` or `you`. `you` marks a waiting card `◆ needs you`. | yes |
| `goal` | One sentence on what the task is for. | yes, when it creates the row |
| `evidence` | The latest note on the task. | yes |
| `progress` | `n/m` tasks done. | no |
| `route` | `<split> × <executor> · <tier> — <why>`; read instead of `executor` when both are there. | no |

Statuses are matched in any case, without markdown emphasis or code ticks: `Todo` (or `To do`), `In Progress`, `Verifying`, `Needs Verification`, `Blocked` (red, in In Progress), `Done` and `Canceled` (or `Cancelled`: no card, not counted). Any other status text gets its own lane after the four, named for it; an empty cell reads `no status`. plan-orchestrator writes five of them: `Todo`, `In Progress`, `Needs Verification`, `Done`, `Blocked`.

A line `Recap: <text>` above the table is the plan's recap, drawn under the plan name. A file gives it no time, so its label reads `Recap`. plan-orchestrator rewrites it at each hand-back as two or three sentences: what the plan is for, where it is now, and what is next or needed from you.

plan-orchestrator's `board_fields` setting lists the columns of each row, default `task, status, executor, check, goal, evidence`; a column removed from it is not written. When new work appears, the route skill gives it a row before it is done.

## Settings

Claude Code asks for these when you enable the plugin. Leave `board_command` and `usage_command` empty unless you have your own tracker.

| Setting | Default | What it does |
|---|---|---|
| `board_location` | `PROGRESS.md` | The board file, relative to the project root, or an absolute path. It means what it means in plan-orchestrator, except that plan-orchestrator's `command:<read> ;; <write>` form is not read here: set `board_command` instead. |
| `board_command` | empty | A command that prints the board as JSON, used instead of the file. It runs in the project root with `CLAUDE_PROJECT_DIR` set to it, and no shell runs it. `{session}` is the session id and `{query}` is `*` when the person asks for the plan list, and a plan's `anchor` once they open one; `[ ... ]` keeps its words only when every placeholder inside is non-empty: `mytool --view {session} --json [--query={query}]`. |
| `usage_command` | empty | A command that records a task's time and cost when its page opens; the board command then returns them. Placeholders: `{session}`, `{anchor}` (the plan), `{index}` (the task's row) and `{task}`. |
| `your_name` | empty | A task whose executor or checker is this name is shown as `you`, and the page of a task you run yourself has no time, tokens or cost. The word `you` always counts. |

With `board_command` set, the file is not polled. The board is read at session start, on each prompt, at each turn's start and end, when a background agent starts or stops, after a Bash call that runs the command, and every 10 s while the pane is open.

## Board command JSON

Typed in [types/index.d.ts](../types/index.d.ts). It carries what the file does, plus what only a tracker knows. A plan without `anchor` or `rows`, or a task without `task` or with an unknown `status`, rejects the whole answer.

| Key | Effect |
|---|---|
| `plans[]` | Required. One entry per plan. With more than one, `▾` after the plan name opens the plan list in the band and the header. |
| `selected` | The anchor of the plan shown first. |
| `message` | A line above the board, or alone when no plan can be drawn. |
| `matches[]` | The plan list for the query `*`, latest updated first, each `{anchor, name, state, done, total}` and `updated` (ISO, shown beside the count) when it has one. `state` is `In progress`, `Idle`, `Done` or `Canceled`; `waiting: true` on an `Idle` entry draws it as `Waiting for you` (an entry whose `state` is any other word is dropped). `/plan-tracker` lists them under a search field, each pressable; a press opens that plan, and the next queries are its `anchor`, whose answer must hold the plan in `plans[]`. Without `matches[]`, two or more `plans[]` are listed instead; one plan opens its board. |
| plan `anchor`, `rows[]` | Required. |
| plan `name`, `plan_file`, `started` | The name, the file `Plan file ›` opens, and when the first task started. |
| plan `finished`, `updated`, `idle_since` | ISO times behind the state word (see Plan states). |
| plan `in_session` | `true` for a plan this session works on, `false` for one added because the person picked or searched it. Only a plan with `in_session: true` reads `In progress` while this session runs a turn or a background agent; without the key, the state comes from the tasks alone. |
| plan `usage_totals` | `tokens` and `est. cost` under the plan name. They are drawn once a task has left Todo or the plan has `started`; before that the plan reads `Not started yet`. |
| plan `recap`, `recap_updated` | The recap and when it was written: `Recap · updated 12 min ago`. |
| task `task`, `status` | Required. `status` is one of the seven statuses above, spelled as there. |
| task `note`, `goal`, `progress` | As the `evidence`, `goal` and `progress` columns. |
| task `route` (or `who`) | `<split> × <executor> · <tier> — <why>`. A row has no `check` key: the checker is the `check by <who>:` in `route`. |
| task `updated` | Orders each lane. |
| task `started`, `finished` | When the task first went In Progress, and when it was Done or Canceled. A page shows `usage` only for a started task, and the usage command runs only for a started task with no `finished`. |
| task `stalled_since` | Marks a running task that no session is working on: the stalled card, page and plan state. |
| task `usage` | The time, tokens and est. cost on its page. |

A time is shown on the clock it was written in, so an offset counts; a time ending in `Z`, or with no offset, reads on this machine's clock. It reads `19:40` today and `Oct 11 19:40` on another day.

With `board_command` set, the Done pop-up, chime and rainbow come from the command, not the file. A Bash result that holds a block starting `PLAN-DONE <anchor> · <task> · <n> left`, up to the next blank line, puts that block in the conversation and shows a pop-up `✅ <task> · <n> left`; the chime plays in the terminal; `0 left` turns the band's bar to a rainbow until your next prompt, or until a later block for the same plan has tasks left.

A plain `PROGRESS.md` has no usage and no start time, so it draws no figures once a task is under way, and its task pages have none. It never shows a stalled task.

## Messages

`PROGRESS.md` below stands for the file named by `board_location`.

| Where | Text | Means |
|---|---|---|
| Board | `No PROGRESS.md yet: the route skill writes it when an approved plan starts.` | The board file does not exist yet. The band stays hidden. |
| Board | `plan-tracker: PROGRESS.md is empty` | The file has no text. |
| Board | `plan-tracker: PROGRESS.md has no markdown table with "task" and "status" columns` | No table at all. |
| Board | `plan-tracker: PROGRESS.md has a table, but none with both a "task" and a "status" column in its header row` | A table, but not this one. |
| Board | `plan-tracker: the table in PROGRESS.md has no rows with a task` | Header only, or empty `task` cells. |
| Board | `plan-tracker: board_location is a "command:" board; set board_command to a command that prints the board as JSON` | `board_location` starts with `command:`. |
| Board | `plan-tracker: the board command exited <code>: <last stderr line>` | Your board command failed. |
| Toast | `Board waits: <reason>` | `/plan-tracker` could not place the board pane; the reason says why. |

## What it writes

Nothing in your project. It appends one JSON line to `~/.claude/mods-logs/plan-tracker.jsonl` for key presses, each change in the search field (its length, not its text), each change of the state word the band draws (the plan's anchor and the word), `/plan-tracker` runs, Done notices, errors and a few one-off lines, and never rotates the file.
