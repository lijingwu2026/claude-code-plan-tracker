/**
 * The statuses a row can have, spelled as the tracker writes them (Blocked is a status here, not a flag), and `Other` for a
 * status the PROGRESS.md reader does not know (its own text is in `statusText`).
 */
export type PlanStatus = 'Todo' | 'In Progress' | 'Verifying' | 'Needs Verification' | 'Blocked' | 'Done' | 'Canceled' | 'Other'

/**
 * One task of a plan, with only what the tracker records: `route` is `<split> × <executor> · <tier> — <why>` (absent when
 * unrouted), `note` the row's latest free text (the reason, on a Blocked row), `updated` when it was last written.
 * Absent fields are the tracker's null, dropped when the `--json` output is read.
 */
export type PlanRow = {
  task: string
  status: PlanStatus
  /** The status as written in the board file, kept for a row whose status is `Other`. */
  statusText?: string
  note?: string
  /** When the row was last written, ISO text; each lane lists the latest first. Null for none (a `PROGRESS.md` has none): a lane with no times keeps file order. */
  updated: string | null
  route?: string
  /** The route's `<split> × <executor> · <tier>` or `unrouted`, as the tracker's `--json` gives it; used when there is no `route`. */
  who?: string
  /** Who checks the work, from the board file's `check` column (`script (grep)`, `you`, `subagent · Opus`); absent when the file has none. */
  check?: string
  deliverable?: string
  /** One line on what the deliverable changed, written with the file; absent when not given. */
  change?: string
  /** One sentence on what the task is for; absent when not given. */
  goal?: string
  /** `n/m` steps done of total, as the agent reported it; absent until it has. */
  progress?: string
  /** When the row first went In Progress, and when it was finished (Done or Canceled); ISO text. Absent on rows written before these fields. */
  started?: string
  finished?: string
  /**
   * When the row last had a session working on it, ISO text: given by a board command for an In Progress or Verifying row that no session is working
   * on. The card then shows a grey `stalled` tag with the time (`stalled 14:02`, or the day, `stalled Oct 11`, when it was not today) and its mascot
   * stops, and the task page says `stalled since 14:02` (`stalled since Oct 11 14:02`). A `PROGRESS.md` never has it.
   */
  stalled_since?: string
  /** What the row's work cost, as the usage command wrote it; absent until computed. */
  usage?: PlanUsage
  /** The deliverable's modification time in epoch seconds; null when the path does not exist; absent on old output. */
  deliverable_mtime?: number | null
  /** An artifact made for the person to view, as a markdown link `[Title](target)`: target an `https://` URL or a local path. Absent when not given or not a link. */
  artifact?: string
  /** One line on what the artifact is; absent when not given. */
  artifact_note?: string
}

/** Time, effort, tokens and cost of one row's work. `effort` holds shares that sum to 1; `cost_usd` is null when a model has no price. */
export type PlanUsage = {
  working_ms: number
  main_ms: number
  subagent_ms: number
  effort: Record<string, number>
  models: string[]
  tokens: { input: number; cache_read: number; cache_write: number; output: number }
  cost_usd: number | null
  computed_at: string
}

/** What the tracker adds up over a plan's rows for the line under its name; `measured` of `total` tasks (not Canceled, not the person's own, by `your_name` or `you`) have usage. */
export type PlanTotals = {
  working_ms: number
  /** Input + cache read + cache write. */
  tokens_in: number
  tokens_cached: number
  tokens_out: number
  /** Null when some measured task has no price. */
  cost: number | null
  measured: number
  total: number
}

export type PlanEntry = {
  anchor: string
  name: string
  goal: string
  /** The absolute path of the plan file the "Plan file ›" view reads. */
  plan_file: string
  /** When the plan was registered: the date, and (plans made since 2026-10-11) the full ISO time. */
  created?: string
  created_at?: string
  /** The earliest row `started`; the latest row `finished`, given only once the plan is closed (the header then reads `Done at 21:40`). */
  started?: string
  finished?: string
  /**
   * When the plan last changed, ISO text: the newest row `updated`. A closed plan with no `finished` reads `Done at 21:40` from it (`Done at Oct 11 21:40`
   * on another day). A `PROGRESS.md` never has it.
   */
  updated?: string
  /**
   * Since when the plan has had no row In Progress or Verifying, ISO text: given by a board command for an idle plan. The state word then reads
   * `Idle since 19:40` (`Idle since Oct 11 19:40`); without it, plain `Idle`.
   */
  idle_since?: string
  /** Absent when the tracker is older than the plan line. */
  usage_totals?: PlanTotals
  /** Claude's 2–3 sentence summary of the plan (what it is for, where it is now, what is next or needed from the person), drawn under the plan line. Absent when none. */
  recap?: string
  /** When the recap was written, ISO text. Absent when the recap has no time (one read from PROGRESS.md has none). */
  recap_updated?: string
  rows: PlanRow[]
}

/** One plan the words of a query found, when several did: the light line the list in the pane draws. */
export type PlanMatch = {
  anchor: string
  name: string
  state: 'In progress' | 'Idle' | 'Done'
  done: number
  total: number
}

/**
 * What the board command prints as JSON (or the board file, read as one), read: the plans of the session and the one the band and
 * the board show. `matches` is present only when a query found several plans (then `message` says how many); `plans` and `selected`
 * are then what they are without a query.
 */
export type PlanBoard = {
  selected: string | null
  message: string | null
  plans: PlanEntry[]
  matches?: PlanMatch[]
}

/** The tracker's answer: a board, or one line saying why there is none. */
export type Live = { board: PlanBoard } | { error: string }

/** The card whose page the pane shows: a plan and the index of the row in its `rows`. */
export type CardRef = { anchor: string; index: number }

declare module 'claude-code' {
  interface PluginState {
    'plan-tracker': {
      /** The tracker's last answer; null until the first one is in. */
      live: Live | null
      /** The `--query` the refreshes pass: the argument of the last `/plan-tracker`, or the plan that just finished; '' for none. */
      query: string
      /** The anchor picked in the band or the pane; null until one is picked (the tracker's `selected` stands). */
      selected: string | null
      /** The card whose page replaces the board; null shows the board. */
      card: CardRef | null
      /** Whether the pane shows the plan file instead of the board. */
      file: boolean
      /** The anchor of the plan a PLAN-DONE with 0 left just finished, until the person's next prompt; null for none. */
      finished: string | null
      /** The animation frame, advanced by the one timer while something moves on screen. */
      frame: number
      /** Whether the pane's plan dropdown shows its list. */
      menu: boolean
      /** The lanes that show all their cards, as `<anchor>:<lane>`. */
      expanded: string[]
      /** Whether the band's plan list shows. */
      bandMenu: boolean
    }
  }
}
