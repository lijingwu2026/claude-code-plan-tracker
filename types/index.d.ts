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
  /** What the API requests counted to this row cost, summed by the plugin from every session's usage ledger (`hooks/usage.ts`); absent for a row no ledger entry names. */
  usage?: RowUsage
  /** The same, one entry per session that worked on the row; absent with `usage`. */
  sessions_usage?: SessionUsage[]
}

/** The four token counts of the usage ledger: uncached input, cache reads, cache writes, output. */
export type UsageTokens = { in: number; cached: number; cache_write: number; out: number }

/** What the API requests counted to a row or to a plan cost, as the plugin sums them over every session's ledger. */
export type RowUsage = {
  tokens_in: number
  tokens_cached: number
  tokens_cache_write: number
  tokens_out: number
  cost_usd: number
  requests: number
}

/** One session's share of a row: when it first and last worked on it (ISO), where it ran (`surface`) and what it used. */
export type SessionUsage = {
  session: string
  /** `terminal`, `desktop`, `vscode`, `mobile`, or `unknown`. */
  surface: string
  first: string
  last: string
  tokens: UsageTokens
  cost_usd: number
}

/** What the plugin adds up over a plan: its rows' usage and the plan's own share (work no single task owns), already inside the total. */
export type PlanTotals = RowUsage & { plan_own?: RowUsage }

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
  /** Set by the plugin from the usage ledgers, never read from a board command's answer. */
  usage_totals?: PlanTotals
  /** Claude's 2–3 sentence summary of the plan (what it is for, where it is now, what is next or needed from the person), drawn under the plan line. Absent when none. */
  recap?: string
  /** When the recap was written, ISO text. Absent when the recap has no time (one read from PROGRESS.md has none). */
  recap_updated?: string
  /**
   * Given by a board command: true for a plan this session works on, false for one added because the person picked or searched it. Only a
   * plan with `in_session: true` reads In progress while this session works; a plan without the key keeps the state its rows give. A
   * `PROGRESS.md` has one plan, which counts as this session's (true).
   */
  in_session?: boolean
  /**
   * Set by the mod, never by a board command, on a plan with `in_session: true`: `working` while this session runs a main turn or has a
   * background agent not yet ended; `stopped_at` when that last stopped (ISO, this machine's clock and offset).
   */
  working?: true
  stopped_at?: string
  rows: PlanRow[]
}

/**
 * One plan of the list `/plan-tracker` draws, as the board command lists it for the query `*`: a light line with the plan's state word
 * (`Canceled` for an abandoned plan), `done` of `total` tasks, and when it was last updated (absent when no row has a time).
 * `waiting` is true when nothing runs and a Needs Verification row waits on the person: the list draws it as Waiting for you.
 */
export type PlanMatch = {
  anchor: string
  name: string
  state: 'In progress' | 'Idle' | 'Done' | 'Canceled'
  done: number
  total: number
  updated?: string
  waiting?: true
}

/**
 * What the board command prints as JSON (or the board file, read as one), read: the plans of the session and the one the band and
 * the board show. `matches` is the list of every plan, latest updated first, for the query `*`; without it the list is drawn from
 * `plans` when there are two or more.
 */
export type PlanBoard = {
  selected: string | null
  message: string | null
  plans: PlanEntry[]
  matches?: PlanMatch[]
  /** The ids of sessions whose usage ledger could not be read, set by the plugin; absent when every one was read. */
  ledger_errors?: string[]
}

/** The plan (its ledger key) and the row (its exact text) a usage request is counted to; `row: null` is the plan's own share. */
export type UsageOwner = { plan: string; row: string | null }

/** A row a subagent claimed: its exact text, and its plan's key when one is named. */
export type UsageClaim = { task: string; anchor?: string }

/**
 * One API request as the usage ledger holds it before it is booked: whose, which loop (`agentId`, absent for the main thread), its counts,
 * its table price (null: no price) and when (ms). `wanted` is a claimed row the tracker did not have yet when it was recorded.
 */
export type UsageRequest = { owner: UsageOwner | null; agentId?: string; wanted?: UsageClaim; tokens: UsageTokens; usd: number | null; at: number }

/**
 * The usage ledger's state across a reload (`PluginState['plan-tracker'].usageCarry`): the session, what is known of each subagent (its
 * claimed rows and its parent), the requests not yet in the file, and the board files this session has changed.
 */
export type UsageCarry = { session: string; agents: Record<string, { claims: UsageClaim[]; parent?: string }>; unwritten: UsageRequest[]; edited: string[] }

/** The tracker's answer: a board, or one line saying why there is none. */
export type Live = { board: PlanBoard } | { error: string }

/** The card whose page the pane shows: a plan and the index of the row in its `rows`. */
export type CardRef = { anchor: string; index: number }

declare module 'claude-code' {
  interface PluginState {
    'plan-tracker': {
      /** The tracker's last answer; null until the first one is in. */
      live: Live | null
      /** The `--query` the refreshes pass: `*` while the pane lists the plans, else the plan opened from the list, the band or the plan menu, or the one that just finished; '' for none. */
      query: string
      /** Whether the pane shows the plan list (set by `/plan-tracker`, cleared by opening a plan). */
      listing: boolean
      /** The text of the list's search field. */
      search: string
      /** Every plan, as the last answer to the query `*` listed them; null until one is in. The list is drawn from it while a new one is read. */
      allPlans: PlanMatch[] | null
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
      /** What of this session is at work: a main turn running, and the ids of its background agents not yet ended. */
      working: { turn: boolean; agents: string[] }
      /** When `working` last went from something to nothing (ISO, this machine's clock and offset); null until it has. */
      stoppedAt: string | null
      /**
       * What the usage ledger keeps across a reload of the module: the session it is for, whose work each subagent's requests are, the
       * requests recorded since the last write of the file (those in the file are read back from it) and the board files this session has changed.
       */
      usageCarry: UsageCarry
    }
  }
}
