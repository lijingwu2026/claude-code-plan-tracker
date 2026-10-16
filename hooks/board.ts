/**
 * The pure part of the mod: how the board command is called and what it prints (the
 * PLAN-DONE block, the `--json` board), how a status is colored, how wide a string is on
 * screen, and what the band and the board show. Nothing here draws or touches `$`.
 * It shows what the tracker records, and whether its own session is at work on its plans (`withWork`).
 */
import type { CardRef, PlanBoard, PlanEntry, PlanMatch, PlanRow, PlanStatus, PlanTotals, PlanUsage } from '../types'

export const STATUSES: readonly PlanStatus[] = ['Todo', 'In Progress', 'Verifying', 'Needs Verification', 'Blocked', 'Done', 'Canceled']

export type Style = { color: string; dimColor?: true }

/**
 * One color per status, as theme keys: every terminal theme defines them and
 * they follow light and dark. The engine looks a bare name such as 'red' up in
 * the theme too and finds nothing, so it would draw uncolored. No two statuses
 * share a key (the v3 review found In Progress and Review resolving to one color).
 */
export const STYLE: Record<PlanStatus, Style> = {
  Todo: { color: 'inactive' }, // gray
  'In Progress': { color: 'suggestion' }, // blue
  Verifying: { color: 'warning' }, // yellow, the Verify lane's colour
  'Needs Verification': { color: 'warning' }, // yellow
  Blocked: { color: 'error' }, // red
  Done: { color: 'success' }, // green
  Canceled: { color: 'inactive', dimColor: true }, // dim gray
  Other: { color: 'permission' }, // a status the reader does not know
}

/** The color of a "needs you" marker: used by no status. */
export const NEEDS_YOU_COLOR = 'merged'

/**
 * The color of a link, in the note of a task page: the theme's accent for suggestions, which reads on a dark and on a light
 * theme (`remember` is a dark blue on a dark one).
 */
export const LINK_COLOR = 'suggestion'

/** Most urgent first: what "worst" means for a plan. */
const URGENCY: readonly PlanStatus[] = ['Blocked', 'Verifying', 'Needs Verification', 'In Progress', 'Other', 'Todo', 'Done', 'Canceled']

export const isBlocked = (row: PlanRow): boolean => row.status === 'Blocked'

/** Whether the row is still to do: not Done, not Canceled. */
export const isOpen = (row: PlanRow): boolean => row.status !== 'Done' && row.status !== 'Canceled'

export const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const isStatus = (value: unknown): value is PlanStatus => STATUSES.includes(value as PlanStatus)

const asText = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** The row's `usage` when it has the shape the tracker writes, else undefined (an old or damaged row shows "—", never a guess). */
function usageOf(value: unknown): PlanUsage | undefined {
  const raw = value as Partial<Record<keyof PlanUsage, unknown>> | null
  const tokens = raw?.tokens as Record<string, unknown> | null | undefined

  if (
    typeof raw !== 'object' || raw === null ||
    !isNumber(raw.working_ms) || !isNumber(raw.main_ms) || !isNumber(raw.subagent_ms) ||
    typeof raw.effort !== 'object' || raw.effort === null ||
    typeof tokens !== 'object' || tokens === null ||
    !isNumber(tokens.input) || !isNumber(tokens.cache_read) || !isNumber(tokens.cache_write) || !isNumber(tokens.output)
  ) {
    return undefined
  }

  return {
    working_ms: raw.working_ms,
    main_ms: raw.main_ms,
    subagent_ms: raw.subagent_ms,
    effort: raw.effort as Record<string, number>,
    models: Array.isArray(raw.models) ? raw.models.filter((one): one is string => typeof one === 'string') : [],
    tokens: { input: tokens.input, cache_read: tokens.cache_read, cache_write: tokens.cache_write, output: tokens.output },
    cost_usd: isNumber(raw.cost_usd) ? raw.cost_usd : null,
    computed_at: asText(raw.computed_at) ?? '',
  }
}

/** The plan's `usage_totals` when it has the shape the tracker writes, else undefined (the plan line then leaves the tokens and cost out). */
function totalsOf(value: unknown): PlanTotals | undefined {
  const raw = value as Record<string, unknown> | null

  if (
    typeof raw !== 'object' || raw === null ||
    !isNumber(raw.working_ms) || !isNumber(raw.tokens_in) || !isNumber(raw.tokens_cached) || !isNumber(raw.tokens_out) ||
    !isNumber(raw.measured) || !isNumber(raw.total)
  ) {
    return undefined
  }

  return {
    working_ms: raw.working_ms,
    tokens_in: raw.tokens_in,
    tokens_cached: raw.tokens_cached,
    tokens_out: raw.tokens_out,
    cost: isNumber(raw.cost) ? raw.cost : null,
    measured: raw.measured,
    total: raw.total,
  }
}

const MATCH_STATES: readonly PlanMatch['state'][] = ['In progress', 'Idle', 'Done', 'Canceled']

/**
 * The plans the board command lists (`matches`): an entry of another shape is dropped; none left is no list. A plan waiting for the
 * person keeps one of the four words and carries `waiting: true`.
 */
function matchesOf(value: unknown): PlanMatch[] | undefined {
  const out = (Array.isArray(value) ? value : []).flatMap((one: Record<string, unknown> | null): PlanMatch[] => {
    const anchor = asText(one?.anchor)
    const name = asText(one?.name)
    const state = MATCH_STATES.find(word => word === one?.state)
    const done = one?.done
    const total = one?.total
    const updated = asText(one?.updated)

    return anchor !== undefined && name !== undefined && state !== undefined && isNumber(done) && isNumber(total)
      ? [{ anchor, name, state, done, total, ...(updated === undefined ? {} : { updated }), ...(one?.waiting === true ? { waiting: true as const } : {}) }]
      : []
  })

  return out.length === 0 ? undefined : out
}

/** Lower case, with `- _ → : · /` as spaces, so `plan tracker` finds `plan-tracker`. */
const normText = (text: string): string => text.toLowerCase().replace(/[-_→:·/]/g, ' ')

/** The words of `text`, normalised. */
const wordsOf = (text: string): string[] => normText(text).split(/\s+/).filter(word => word !== '')

/** Whether a plan stays in the list for the search `text`: every word of it in the plan's name or anchor, in any order (no word: every plan). */
export function isFound(plan: { anchor: string; name: string }, text: string): boolean {
  const hay = `${normText(plan.name)} ${normText(plan.anchor)}`

  return wordsOf(text).every(word => hay.includes(word))
}

/** The plans the list shows for the search `text`: with no words, every plan but the Done and Canceled ones; with words, every plan they find. */
export function listedMatches<T extends { anchor: string; name: string; state: string }>(plans: readonly T[], text: string): T[] {
  return wordsOf(text).length === 0 ? plans.filter(one => one.state !== 'Done' && one.state !== 'Canceled') : plans.filter(one => isFound(one, text))
}

/**
 * The plan `/plan-tracker <words>` opens at once: the first whose name or anchor equals the words (normalised), else the only one
 * the words leave in the list; undefined when they leave none or several, or are no words.
 */
export function directPick<T extends { anchor: string; name: string }>(plans: readonly T[], text: string): T | undefined {
  const key = wordsOf(text).join(' ')

  if (key === '') {
    return undefined
  }

  const found = plans.filter(plan => isFound(plan, text))

  return plans.find(plan => wordsOf(plan.name).join(' ') === key || wordsOf(plan.anchor).join(' ') === key) ?? (found.length === 1 ? found[0] : undefined)
}

/**
 * The plans the list draws from the board command's answer to `*`: its `matches`; when it has none, its `plans` if there are two or more,
 * latest `updated` first (a command that does not know `*` still lists the plans it prints); else none: one plan opens its board.
 */
export function listOf(board: PlanBoard): PlanMatch[] {
  if (board.matches !== undefined) {
    return board.matches
  }

  const at = (plan: { updated?: string }) => (Number.isNaN(Date.parse(plan.updated ?? '')) ? 0 : Date.parse(plan.updated ?? ''))

  return board.plans.length < 2
    ? []
    : board.plans
        .map((plan): PlanMatch => {
          const state = planStateOf(plan)

          return {
            anchor: plan.anchor,
            name: plan.name,
            state: state === 'Stalled' ? 'In progress' : state === 'Waiting for you' ? 'Idle' : state,
            ...(state === 'Waiting for you' ? { waiting: true as const } : {}),
            ...countOf(plan),
            ...(plan.updated === undefined ? {} : { updated: plan.updated }),
          }
        })
        .sort((a, b) => at(b) - at(a))
}

/**
 * The script's `--view --json` output as a board, or one line saying what is wrong with it. A field the tracker leaves null
 * is dropped, so the drawing code reads an absent field, never a null.
 */
export function parseBoard(text: string): { board: PlanBoard } | { error: string } {
  let data: unknown

  try {
    data = JSON.parse(text)
  } catch (error) {
    return { error: `plan-tracker: the board command did not print JSON: ${messageOf(error)}` }
  }

  const raw = data as { selected?: unknown; message?: unknown; plans?: unknown } | null
  const isShaped =
    Array.isArray(raw?.plans) &&
    raw.plans.every(
      (plan: { anchor?: unknown; rows?: unknown } | null) =>
        typeof plan?.anchor === 'string' &&
        Array.isArray(plan.rows) &&
        plan.rows.every((row: { task?: unknown; status?: unknown } | null) => typeof row?.task === 'string' && isStatus(row.status)),
    )

  if (!isShaped) {
    return { error: 'plan-tracker: the JSON of the board command has no plans[].rows[] with a task and a known status' }
  }

  const plans = (raw.plans as Record<string, unknown>[]).map((plan): PlanEntry => ({
    anchor: plan.anchor as string,
    name: asText(plan.name) ?? (plan.anchor as string),
    goal: asText(plan.goal) ?? '',
    plan_file: asText(plan.plan_file) ?? '',
    ...(asText(plan.created) === undefined ? {} : { created: asText(plan.created) as string }),
    ...(asText(plan.created_at) === undefined ? {} : { created_at: asText(plan.created_at) as string }),
    ...(asText(plan.started) === undefined ? {} : { started: asText(plan.started) as string }),
    ...(asText(plan.finished) === undefined ? {} : { finished: asText(plan.finished) as string }),
    ...(asText(plan.updated) === undefined ? {} : { updated: asText(plan.updated) as string }),
    ...(asText(plan.idle_since) === undefined ? {} : { idle_since: asText(plan.idle_since) as string }),
    ...(totalsOf(plan.usage_totals) === undefined ? {} : { usage_totals: totalsOf(plan.usage_totals) as PlanTotals }),
    ...(asText(plan.recap) === undefined ? {} : { recap: asText(plan.recap) as string }),
    ...(asText(plan.recap) === undefined || asText(plan.recap_updated) === undefined ? {} : { recap_updated: asText(plan.recap_updated) as string }),
    ...(typeof plan.in_session === 'boolean' ? { in_session: plan.in_session } : {}),
    rows: (plan.rows as Record<string, unknown>[]).map((row): PlanRow => {
      const note = asText(row.note)
      const route = asText(row.route)
      const who = asText(row.who)
      const goal = asText(row.goal)
      const progress = asText(row.progress)
      const started = asText(row.started)
      const finished = asText(row.finished)
      const stalledAt = asText(row.stalled_since)
      const stalledSince = stalledAt === undefined || Number.isNaN(Date.parse(stalledAt)) ? undefined : stalledAt
      const usage = usageOf(row.usage)

      return {
        task: row.task as string,
        status: row.status as PlanStatus,
        updated: asText(row.updated) ?? null,
        ...(note === undefined ? {} : { note }),
        ...(route === undefined ? {} : { route }),
        ...(who === undefined ? {} : { who }),
        ...(goal === undefined ? {} : { goal }),
        ...(progress === undefined ? {} : { progress }),
        ...(started === undefined ? {} : { started }),
        ...(finished === undefined ? {} : { finished }),
        ...(stalledSince === undefined ? {} : { stalled_since: stalledSince }),
        ...(usage === undefined ? {} : { usage }),
      }
    }),
  }))

  const message = asText(raw.message)
  const matches = matchesOf((raw as { matches?: unknown }).matches)

  return { board: { selected: asText(raw.selected) ?? null, message: message ?? null, plans, ...(matches === undefined ? {} : { matches }) } }
}

/** The plan the person picked, else the tracker's own choice, else the first. */
export function planOf(board: PlanBoard, picked: string | null): PlanEntry | undefined {
  return board.plans.find(plan => plan.anchor === picked) ?? board.plans.find(plan => plan.anchor === board.selected) ?? board.plans[0]
}

/** What decides the plan's color: its most urgent open row (Blocked, Verifying, Needs Verification, In Progress, Todo), green once none is left. */
export function worstStatus(plan: PlanEntry): PlanStatus {
  return URGENCY.find(status => status !== 'Done' && status !== 'Canceled' && plan.rows.some(row => row.status === status)) ?? 'Done'
}

/** Rows Done and rows to reach (every row but the Canceled): what `n/m` counts. A Canceled row is not shown anywhere. */
export function countOf(plan: PlanEntry): { done: number; total: number } {
  const canceled = plan.rows.filter(row => row.status === 'Canceled').length

  return { done: plan.rows.filter(row => row.status === 'Done').length, total: plan.rows.length - canceled }
}

/** `5/12`. */
export const countText = (plan: PlanEntry): string => `${countOf(plan).done}/${countOf(plan).total}`

/**
 * A plan's state word: `Done` once closed, `In progress` while a row runs or its session works on it, `Stalled` when every running row
 * is stalled, `Waiting for you` when nothing runs and a row waits on the person's check, else `Idle`. There is no "Todo" state: a plan
 * nobody started is Idle. `Canceled` (an abandoned plan) comes only from a board command's list.
 */
export type PlanState = 'In progress' | 'Stalled' | 'Waiting for you' | 'Idle' | 'Done' | 'Canceled'

/** The state words, widest first, for aligning a column of them. */
export const STATE_COLUMNS = 'In progress'.length

/**
 * One color per state: the In Progress lane's, gray like the Todo lane (Stalled and Idle), the "needs you" color (Waiting for you), the
 * Done lane's, dim gray like a Canceled row.
 */
export const STATE_STYLE: Record<PlanState, Style> = {
  'In progress': STYLE['In Progress'],
  Stalled: STYLE.Todo,
  'Waiting for you': { color: NEEDS_YOU_COLOR },
  Idle: STYLE.Todo,
  Done: STYLE.Done,
  Canceled: STYLE.Canceled,
}

/**
 * Done = the plan is closed (the tracker gave `finished`, or every row is Done or Canceled with one Done). In progress = open,
 * with a row In Progress or Verifying that is not stalled, or its session at work (`working`). Stalled = open, not worked on, with
 * running rows that are all stalled. Waiting for you = open, nothing running, and a Needs Verification row waits on the person
 * (`needsYou`). Idle = open and nothing running (rows Todo, Needs Verification checked by another, or Blocked, or no row started).
 */
export function planStateOf(plan: PlanEntry): PlanState {
  if (plan.finished !== undefined || isComplete(plan)) {
    return 'Done'
  }

  if (isActive(plan)) {
    return 'In progress'
  }

  return hasInProgress(plan) ? 'Stalled' : plan.rows.some(needsYou) ? 'Waiting for you' : 'Idle'
}

/** The later of two tracker times; either may be absent. */
const laterOf = (a: string | undefined, b: string | undefined): string | undefined =>
  a === undefined ? b : b === undefined ? a : Date.parse(b) > Date.parse(a) ? b : a

/**
 * The state word as the header, the band and the plan list write it, and the one place the board shows a plan's time: `Done at 21:40`
 * (the plan's `finished`, else its `updated`), `Stalled since 19:23` (the newest `stalled_since` of its running rows), `Idle since 19:40`
 * and `Waiting for you since 19:40` (the later of the plan's `idle_since` and `stopped_at`, when its session last stopped); a time on
 * another day reads `Oct 11 19:23`. Plain `Done`, `Stalled`, `Idle` or `Waiting for you` when the time is not there or not a clock time
 * (a `PROGRESS.md` has none until its session has stopped once); `In progress` is always the bare label. Colors follow the bare state
 * (`planStateOf`); the room it takes is this text's.
 */
export function planStateText(plan: PlanEntry, now: number = Date.now()): string {
  const state = planStateOf(plan)

  if (state === 'Done') {
    const at = [plan.finished, plan.updated].map(time => (time === undefined ? undefined : sinceText(time, now))).find(one => one !== undefined)

    return at === undefined ? state : `Done at ${at}`
  }

  if (state === 'Stalled') {
    const times = plan.rows.flatMap(row => (isStalled(row) ? [row.stalled_since as string] : []))
    const newest = times.reduce((latest, one) => (Date.parse(one) > Date.parse(latest) ? one : latest))
    const at = sinceText(newest, now)

    return at === undefined ? state : `${state} since ${at}`
  }

  const since = state === 'Idle' || state === 'Waiting for you' ? laterOf(plan.idle_since, plan.stopped_at) : undefined
  const at = since === undefined ? undefined : sinceText(since, now)

  return at === undefined ? state : `${state} since ${at}`
}

// ---------------------------------------------------------------- width

const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x231a, 0x231b],
  [0x23e9, 0x23ec],
  [0x2614, 0x2615],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
]

const ZERO: readonly (readonly [number, number])[] = [
  [0x0300, 0x036f],
  [0x200b, 0x200f],
  [0x20d0, 0x20ff],
  [0xfe00, 0xfe0f],
]

const within = (ranges: readonly (readonly [number, number])[], cp: number) => ranges.some(([from, to]) => cp >= from && cp <= to)

/** Columns one code point takes: 2 for CJK and emoji, 0 for marks and controls, else 1 (`■ ▸ · — ×` are 1). */
export function charWidth(cp: number): 0 | 1 | 2 {
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0) || within(ZERO, cp)) {
    return 0
  }

  return within(WIDE, cp) ? 2 : 1
}

export function displayWidth(text: string): number {
  let width = 0

  for (const char of text) {
    width += charWidth(char.codePointAt(0) ?? 0)
  }

  return width
}

/** Characters a line does not start with (closing marks) and does not end with (opening marks). */
const NO_START = '，。、；：！？）」』】》〉,.;:!?)]}'
const NO_END = '（「『【《〈([{'

/**
 * Where `text` is broken when its first `cut` code units fit a line: the last space that fits, or the last boundary next
 * to a wide (CJK) character, which has no spaces; else the cut itself. `skip` is the code units dropped at the break (the space).
 */
function breakOf(text: string, cut: number): { at: number; skip: number } {
  let best = -1
  let skip = 0
  let prev = ''
  let idx = 0

  for (const char of text) {
    if (idx > cut) {
      break
    }

    if (char === ' ' && idx > 0) {
      best = idx
      skip = 1
    } else if (idx > 0 && char !== ' ' && prev !== ' ' && prev !== '') {
      const isWide = charWidth(char.codePointAt(0) ?? 0) === 2 || charWidth(prev.codePointAt(0) ?? 0) === 2

      if (isWide && !NO_START.includes(char) && !NO_END.includes(prev)) {
        best = idx
        skip = 0
      }
    }

    prev = char
    idx += char.length
  }

  return best > 0 ? { at: best, skip } : { at: Math.max(cut, 1), skip: 0 }
}

/** `text` cut to at most `cols` columns; a cut ends in `…`. */
export function truncate(text: string, cols: number): string {
  if (cols <= 0) {
    return ''
  }

  if (displayWidth(text) <= cols) {
    return text
  }

  let kept = ''
  let used = 0

  for (const char of text) {
    const width = charWidth(char.codePointAt(0) ?? 0)

    if (used + width > cols - 1) {
      break
    }

    kept += char
    used += width
  }

  return `${kept}…`
}

/**
 * `text` broken into lines of at most `cols` columns, at a space when the line has one and else wherever it fills (CJK
 * has no spaces); a line never starts with a space. Fewer than 1 column leaves the text whole. With `maxLines`, the
 * last line takes all that is left of the text, cut with a `…` when it does not fit.
 */
export function wrap(text: string, cols: number, maxLines = Infinity): string[] {
  if (cols < 1) {
    return [text]
  }

  const lines: string[] = []
  let rest = text.trim()

  while (displayWidth(rest) > cols) {
    if (lines.length === maxLines - 1) {
      return [...lines, truncate(rest, cols)]
    }

    let used = 0
    let cut = 0

    for (const char of rest) {
      const width = charWidth(char.codePointAt(0) ?? 0)

      if (used + width > cols) {
        break
      }

      used += width
      cut += char.length
    }

    const { at, skip } = breakOf(rest, cut)

    lines.push(rest.slice(0, at))
    rest = rest.slice(at + skip).trimStart()
  }

  return [...lines, rest]
}

// ---------------------------------------------------------------- band

export const FILE_LABEL = 'Plan file ›'

/** What the band's right end says while the board shows the plan file: the way back, which never scrolls away. */
export const BOARD_LABEL = '‹ Board'

/** Cells of the progress bar when the band has room. */
export const BAR_COLUMNS = 12

/** Columns the band's fixed parts take besides the name, the bar and the count: `● `, ` ▾`, two gaps, the space before the count, `Plan file ›`. */
const BAND_FIXED = 2 + 2 + 2 + 1 + 2 + displayWidth(FILE_LABEL)

/** Columns of name the band keeps before the bar starts to shrink. */
const MIN_BAND_NAME = 8

export type BandLine = { name: string; state: PlanState; /** The state word as written (`Stalled since 19:23`): the room it takes. */ stateText: string; filled: number; empty: number; count: string }

/** Cells of a `width`-cell bar that are filled for `done` of `total`: at least 1 once started, all of them only when complete. */
export function filledOf(done: number, total: number, width: number): number {
  if (total <= 0 || done <= 0) {
    return 0
  }

  return done >= total ? width : Math.min(width - 1, Math.max(1, Math.round((done / total) * width)))
}

/**
 * The band's one row without the mascot, cut to `cols` columns: the name (cut first), the state word (never cut; its whole text, `Stalled
 * since 19:23` and `Idle since 19:40` included, takes room from the name), the 12-cell bar (shrunk to 4 cells at the least, and only when
 * the name would keep under 8 columns) and `done/total`. `now` decides whether a state time is today's.
 */
export function bandLine(plan: PlanEntry, cols: number, now: number = Date.now()): BandLine {
  const { done, total } = countOf(plan)
  const count = `${done}/${total}`
  const state = planStateOf(plan)
  const stateText = planStateText(plan, now)
  // The state word is never cut: it takes a space and its width from the name's room.
  const rest = cols - BAND_FIXED - displayWidth(count) - 1 - displayWidth(stateText)
  // The bar keeps its 12 cells and the name is cut; only when less than 8 columns would be left for the name does the bar shrink.
  const bar = Math.min(BAR_COLUMNS, Math.max(4, rest - MIN_BAND_NAME))
  const filled = filledOf(done, total, bar)

  return { name: truncate(plan.name, Math.max(4, rest - bar)), state, stateText, filled, empty: bar - filled, count }
}

/** What the terminal band draws in the room its column leaves (`bandFit`). */
export type BandFit = {
  name: string
  state: PlanState
  /** The state word as written (`Stalled since 19:23`). */
  stateText: string
  /** Whether the state word shows: it is dropped whole, never cut. */
  hasState: boolean
  filled: number
  empty: number
  count: string
  /** Whether the right end ("Plan file ›") shows. */
  hasFile: boolean
  /** True when the row cannot hold even the name and the count: the progress takes a second row under it. */
  isStacked: boolean
}

/** Columns of name the terminal band keeps before it drops anything else. */
const MIN_FIT_NAME = 4

/**
 * The terminal band's parts for a row of `cols` columns after the mascot and its space. The name is cut first (to 4 columns at
 * the least, the bar shrinking to 4 cells before the name goes under 8); then the state word (its whole text, `Stalled since 19:23`
 * included) is dropped whole, then the right end, then the bar; when even the name and the count do not fit one row, the progress goes
 * to a second row of `cols` plus the mascot's columns. Nothing is ever cut mid-word or left wider than `cols`. `now` decides whether
 * a state time is today's.
 */
export function bandFit(plan: PlanEntry, cols: number, hasChoice: boolean, fileWidth: number, now: number = Date.now()): BandFit {
  const { done, total } = countOf(plan)
  const count = `${done}/${total}`
  const state = planStateOf(plan)
  const stateText = planStateText(plan, now)
  const countCols = displayWidth(count)
  const stateBit = 1 + displayWidth(stateText) + 2
  // The columns of every part but the name and the bar's cells: the dot, the arrow, the state, the bar's trailing space, the count, the right end.
  const fixed = (hasState: boolean, hasBar: boolean, hasFile: boolean) =>
    2 + (hasChoice ? 2 : 0) + (hasState ? stateBit : 1) + (hasBar ? 1 : 0) + countCols + (hasFile ? 2 + fileWidth : 0)
  const stages = [
    { hasState: true, hasFile: true, hasBar: true },
    { hasState: false, hasFile: true, hasBar: true },
    { hasState: false, hasFile: false, hasBar: true },
    { hasState: false, hasFile: false, hasBar: false },
  ]

  for (const stage of stages) {
    const rest = cols - fixed(stage.hasState, stage.hasBar, stage.hasFile)

    if (rest >= MIN_FIT_NAME + (stage.hasBar ? 4 : 0)) {
      const bar = stage.hasBar ? Math.min(BAR_COLUMNS, Math.max(4, rest - MIN_BAND_NAME)) : 0
      const filled = filledOf(done, total, bar)

      return { name: truncate(plan.name, rest - bar), state, stateText, hasState: stage.hasState, filled, empty: bar - filled, count, hasFile: stage.hasFile, isStacked: false }
    }
  }

  // Stacked: the first row keeps the dot, the name and the arrow; the second row (the whole frame width) the state, the bar and the count.
  const wide = cols + BAND_MASCOT_SPACE
  const second = (hasState: boolean) => wide - (hasState ? stateBit : 1) - 1 - countCols
  const hasState = second(true) >= 4
  const bar = Math.min(BAR_COLUMNS, second(hasState))
  const barCells = bar >= 4 ? bar : 0
  const filled = filledOf(done, total, barCells)
  const name = truncate(plan.name, Math.max(1, cols - 2 - (hasChoice ? 2 : 0)))

  return { name, state, stateText, hasState, filled, empty: barCells - filled, count, hasFile: false, isStacked: true }
}

/** A plan with nothing left to do: each row Done or Canceled, at least one of them Done (an all-Canceled plan was not completed). */
export const isComplete = (plan: PlanEntry): boolean => plan.rows.every(row => !isOpen(row)) && plan.rows.some(row => row.status === 'Done')

/** The plan as the band draws a plan just finished: every row Done, the Canceled ones as they were. */
export const asFinished = (plan: PlanEntry): PlanEntry => ({
  ...plan,
  rows: plan.rows.map((row): PlanRow => (row.status === 'Canceled' ? row : { ...row, status: 'Done' })),
})

/** The plan the band draws: `plan` as it is, or as finished when `finished` names it (a PLAN-DONE with 0 left). */
export const bandPlanOf = (plan: PlanEntry, finished: string | null): PlanEntry => (finished === plan.anchor ? asFinished(plan) : plan)

/** Whether a row is running right now: In Progress, or being verified (a Blocked row is not: its mascot is frozen). */
export const isRunning = (row: PlanRow): boolean => row.status === 'In Progress' || row.status === 'Verifying'

/** Whether a row of the plan is running: In Progress or Verifying. */
export const hasInProgress = (plan: PlanEntry): boolean => plan.rows.some(isRunning)

/** Whether a running row is stalled: the board command says no session is working on it (`stalled_since`). */
export const isStalled = (row: PlanRow): boolean => isRunning(row) && row.stalled_since !== undefined

/** Whether a row of the plan is running and not stalled: what moves the cards' mascot. */
export const hasWorking = (plan: PlanEntry): boolean => plan.rows.some(row => isRunning(row) && !isStalled(row))

/** Whether the plan is at work: a running row that is not stalled, or its session working on it. What reads In progress and moves the band's mascot. */
export const isActive = (plan: PlanEntry): boolean => hasWorking(plan) || plan.working === true

/** What of this session is at work: a main turn, and the ids of its background agents not yet ended. */
export type Work = { turn: boolean; agents: string[] }

/** Whether any of it is at work. */
export const isWorking = (work: Work): boolean => work.turn || work.agents.length > 0

/** `ms` as an ISO time on this machine's clock with its offset, as the tracker writes times (`sinceText` prints its clock part as written). */
export function localIso(ms: number): string {
  const at = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  const offset = -at.getTimezoneOffset()

  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
}

/** The board with this session's work on its own plans (`in_session: true`): `working` while it works, `stopped_at` once it has stopped. */
export function withWork(board: PlanBoard, work: Work, stoppedAt: string | null): PlanBoard {
  const isOn = isWorking(work)

  if (!isOn && stoppedAt === null) {
    return board
  }

  return {
    ...board,
    plans: board.plans.map(plan =>
      plan.in_session !== true ? plan : { ...plan, ...(isOn ? { working: true as const } : {}), ...(stoppedAt === null ? {} : { stopped_at: stoppedAt }) },
    ),
  }
}

/** Rows of the plan still to do: not Done, not Canceled. */
export const openCount = (plan: PlanEntry): number => plan.rows.filter(isOpen).length

/** Rainbow hues, red to violet; raw hex, so they do not follow the theme. */
export const RAINBOW: readonly string[] = ['#ff5555', '#ff9933', '#ffd633', '#55cc66', '#33b5e5', '#5577ff', '#aa66ee']

/** The hue of band cell `cell` at animation frame `frame`: each frame moves the hues one cell along. */
export const rainbowAt = (cell: number, frame: number): string => RAINBOW[(cell + frame) % RAINBOW.length] ?? '#ffffff'

// ---------------------------------------------------------------- board

/** A row on a lane; `index` is its place in the plan's `rows`, which names the card. */
export type Card = { row: PlanRow; index: number }

export type LaneKey = 'Todo' | 'In Progress' | 'Verify' | 'Done' | 'Other'

/** `more` is how many cards the lane does not show; `moreLabel` the line that says so (`+2 more`, `+1 blocked · 12 running`). */
export type Lane = { key: LaneKey; header: string; color: string; cards: Card[]; more: number; moreLabel: string }

/** The overflow line of an expanded lane, which folds it back to its cap. */
export const SHOW_LESS = 'Show less'

/** The overflow button's label: the line, then ▴ to fold or ▾ to unfold (a Button draws the `[ ]` itself). */
export const moreButton = (label: string): string => `${label} ${label === SHOW_LESS ? '▴' : '▾'}`

/** Todo and Done show this many cards, then `+N more`. */
export const CAPPED = 3

/** In Progress shows this many cards, Blocked ones first, then a line counting the rest. */
export const DOING_SHOWN = 5

/** Blocked cards the In Progress lane shows at the most, so that running cards (the mascot) stay in view. */
export const BLOCKED_SHOWN = 3

/** Verify shows this many cards, then a line counting the rest and how many of them wait on her. */
export const VERIFY_SHOWN = 5

const timeOf = (row: PlanRow) => (row.updated === null ? 0 : Date.parse(row.updated) || 0)

/**
 * `cards` with the latest `updated` first; cards updated at the same moment keep the later row first. Cards none of which has a time
 * (a plain PROGRESS.md) keep their file order, so a lane with no times is not reversed by the tie rule.
 */
const latestFirst = (cards: Card[]): Card[] =>
  cards.some(card => timeOf(card.row) > 0) ? [...cards].sort((a, b) => timeOf(b.row) - timeOf(a.row) || b.index - a.index) : cards

/**
 * The four lanes of a plan, each listing its latest updated task first. Verifying and Needs Verification are Verify; Blocked stays on the
 * In Progress lane (its card is red, first in the lane, 3 at the most while running cards fill the rest of 5); a Canceled row is no card
 * and is counted nowhere. The groups of a lane keep their places and each is sorted inside: Blocked, then running in In Progress;
 * verifying, then waiting on you, then other waiting in Verify. A lane whose cards have no times keeps file order.
 * Todo and Done keep 3 cards (Done: the latest).
 */
export function lanesOf(plan: PlanEntry, expanded: readonly LaneKey[] = []): Lane[] {
  const cards = plan.rows.map((row, index): Card => ({ row, index }))
  const of = (...statuses: PlanStatus[]) => cards.filter(card => statuses.includes(card.row.status))
  const todo = latestFirst(of('Todo'))
  const blocked = latestFirst(of('Blocked'))
  const running = latestFirst(of('In Progress'))
  // Blocked cards first, but at most 3 unless there are too few running cards to fill the lane: a lane of red cards only
  // reads "everything is stuck" when 12 of 18 are running.
  const blockedShown = Math.min(blocked.length, Math.max(BLOCKED_SHOWN, DOING_SHOWN - running.length))
  const runningShown = Math.min(running.length, DOING_SHOWN - blockedShown)
  const isOpen = (key: LaneKey) => expanded.includes(key)
  // An expanded lane shows every card in the same order: Blocked first in In Progress.
  const doing = isOpen('In Progress') ? [...blocked, ...running] : [...blocked.slice(0, blockedShown), ...running.slice(0, runningShown)]
  // What the collapsed lane hides; a lane that hides nothing has nothing to expand, whatever its state.
  const hiddenBlocked = blocked.length - blockedShown
  const hiddenRunning = running.length - runningShown
  const isFoldable = (key: LaneKey, count: number) => isOpen(key) && count > 0
  // Verify: rows being verified now first, then the ones waiting on her (◆ needs you), then the other waiting rows.
  const verifying = latestFirst(of('Verifying'))
  const waiting = latestFirst(of('Needs Verification'))
  const verify = [...verifying, ...waiting.filter(card => needsYou(card.row)), ...waiting.filter(card => !needsYou(card.row))]
  // What the collapsed Verify lane hides, and how many of those wait on her.
  const hiddenVerify = verify.slice(VERIFY_SHOWN)
  const hiddenAsks = hiddenVerify.filter(card => needsYou(card.row)).length
  // Latest first; rows updated at the same moment keep the later row first.
  const done = of('Done').sort((a, b) => timeOf(b.row) - timeOf(a.row) || b.index - a.index)

  // `+3 blocked · 10 running`: the plus leads the line once; a part that is zero is left out.
  const hidden = (...parts: [number, string][]) => {
    const line = parts.filter(([count]) => count > 0).map(([count, word]) => `${count} ${word}`).join(' · ')

    return line === '' ? '' : `+${line}`
  }

  // A status the markdown reader does not know has its own lane, after the four, only while a row has it; named for the status
  // when the rows share one.
  const other = of('Other')
  const otherNames = [...new Set(other.map(card => card.row.statusText ?? 'Other'))]
  const otherLane: Lane[] =
    other.length === 0
      ? []
      : [
          {
            key: 'Other',
            header: `${otherNames.length === 1 ? otherNames[0] : 'Other'} ${other.length}`,
            color: STYLE.Other.color,
            cards: isOpen('Other') ? other : other.slice(0, CAPPED),
            more: isOpen('Other') ? 0 : Math.max(0, other.length - CAPPED),
            moreLabel: isFoldable('Other', other.length - CAPPED) ? SHOW_LESS : isOpen('Other') ? '' : hidden([other.length - CAPPED, 'more']),
          },
        ]

  return [
    {
      key: 'Todo',
      header: `Todo ${todo.length}`,
      color: STYLE.Todo.color,
      cards: isOpen('Todo') ? todo : todo.slice(0, CAPPED),
      more: isOpen('Todo') ? 0 : Math.max(0, todo.length - CAPPED),
      moreLabel: isFoldable('Todo', todo.length - CAPPED) ? SHOW_LESS : isOpen('Todo') ? '' : hidden([todo.length - CAPPED, 'more']),
    },
    {
      key: 'In Progress',
      header: `In Progress ${blocked.length + running.length}${blocked.length > 0 ? ` · ${blocked.length} blocked` : ''}`,
      color: STYLE['In Progress'].color,
      cards: doing,
      more: isOpen('In Progress') ? 0 : hiddenBlocked + hiddenRunning,
      moreLabel: isFoldable('In Progress', hiddenBlocked + hiddenRunning)
        ? SHOW_LESS
        : isOpen('In Progress')
          ? ''
          : hidden([hiddenBlocked, 'blocked'], [hiddenRunning, 'running']),
    },
    {
      key: 'Verify',
      header: `Verify ${verify.length}${verifying.length > 0 ? ` · ${verifying.length} verifying` : ''}`,
      color: STYLE['Needs Verification'].color,
      cards: isOpen('Verify') ? verify : verify.slice(0, VERIFY_SHOWN),
      more: isOpen('Verify') ? 0 : hiddenVerify.length,
      moreLabel: isFoldable('Verify', hiddenVerify.length)
        ? SHOW_LESS
        : isOpen('Verify')
          ? ''
          : hidden([hiddenVerify.length, 'more'], [hiddenAsks, 'needs you']),
    },
    {
      key: 'Done',
      header: `Done ${done.length}`,
      color: STYLE.Done.color,
      cards: isOpen('Done') ? done : done.slice(0, CAPPED),
      more: isOpen('Done') ? 0 : Math.max(0, done.length - CAPPED),
      moreLabel: isFoldable('Done', done.length - CAPPED) ? SHOW_LESS : isOpen('Done') ? '' : hidden([done.length - CAPPED, 'more']),
    },
    ...otherLane,
  ]
}

/** The pane lays the lanes side by side from this width, stacked below it. */
export const SIDE_BY_SIDE_FROM = 100

/** Columns between two lanes side by side: two, so a title that fills its lane does not read as one phrase with the next. */
export const LANE_GAP = 2

/** Columns one lane gets side by side: four lanes and the gaps between them. */
export const laneWidth = (bodyColumns: number, count = 4) => Math.floor((bodyColumns - (count - 1) * LANE_GAP) / count)

/** A card is a Box with a round border and one column of padding on each side: four columns in all. */
export const BORDER_COLUMNS = 4

/**
 * Claude Code's mascot, the orange pixel creature, as a small sprite of block characters: 2 rows of `MASCOT_COLUMNS`
 * columns, in two poses (the second has its arms up and its legs shifted).
 */
export type Pose = readonly [string, string]

export const MASCOT: readonly [Pose, Pose] = [
  ['▄█▜▛█▄', ' ▛▛▜▜ '],
  ['▚█▜▛█▞', ' ▜▜▛▛ '],
]

/** The quadrants (upper left, upper right, lower left, lower right) each block character of the mascot fills. */
const QUADRANTS: Readonly<Record<string, readonly [number, number, number, number]>> = {
  '▄': [0, 0, 1, 1],
  '█': [1, 1, 1, 1],
  '▜': [1, 1, 0, 1],
  '▛': [1, 1, 1, 0],
  '▟': [0, 1, 1, 1],
  '▙': [1, 0, 1, 1],
  '▚': [1, 0, 0, 1],
  '▞': [0, 1, 1, 0],
}

/** The colours of the mascot as raw hex, for a surface that draws it as a picture and cannot look up a theme key. */
export const SPRITE_COLORS: Readonly<Record<string, string>> = { claude: '#D77757', error: '#E5484D' }

/** The animation frame's period in ms: what the one timer ticks at, and so how long a pose lasts (`MASCOT_EVERY` frames). */
export const FRAME_MS = 120

/** The mascot's rows as an SVG pixel sprite: every block character is 2×2 sub-pixels, one `<rect>` for each one it fills. */
export function spriteSvg(rows: readonly string[], color: string): { source: string; rects: number } {
  const fill = SPRITE_COLORS[color] ?? color
  const cols = Math.max(...rows.map(row => [...row].length))
  const rects = spriteRects(rows)

  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cols * 2} ${rows.length * 2}" preserveAspectRatio="none" shape-rendering="crispEdges"><g fill="${fill}">${rects.join('')}</g></svg>`

  return { source, rects: rects.length }
}

/**
 * Both poses in one SVG that switches between them by itself (SMIL `<animate>` on each group's opacity, discrete), a pose
 * lasting what it lasts on the terminal: `MASCOT_EVERY` frames of `FRAME_MS`. The desktop animates this without a redraw, which
 * would issue the buttons new handles. `rects` counts the rects of both poses.
 */
export function spriteSvgAnimated(poses: readonly [readonly string[], readonly string[]], color: string): { source: string; rects: number } {
  const fill = SPRITE_COLORS[color] ?? color
  const cols = Math.max(...poses[0].map(row => [...row].length))
  const lists = poses.map(spriteRects)
  const cycle = MASCOT_EVERY * FRAME_MS * 2

  const group = (rects: string[], values: string) =>
    `<g fill="${fill}" opacity="${values.split(';')[0]}">${rects.join('')}<animate attributeName="opacity" values="${values}" keyTimes="0;0.5" calcMode="discrete" dur="${cycle}ms" repeatCount="indefinite"/></g>`

  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cols * 2} ${poses[0].length * 2}" preserveAspectRatio="none" shape-rendering="crispEdges">${group(lists[0] ?? [], '1;0')}${group(lists[1] ?? [], '0;1')}</svg>`

  return { source, rects: lists.reduce((all, list) => all + list.length, 0) }
}

/** The `<rect>`s of a pose, one per filled sub-pixel. */
function spriteRects(rows: readonly string[]): string[] {
  const rects: string[] = []

  rows.forEach((row, y) =>
    [...row].forEach((char, x) =>
      (QUADRANTS[char] ?? [0, 0, 0, 0]).forEach((isOn, at) => {
        if (isOn === 1) {
          rects.push(`<rect x="${x * 2 + (at % 2)}" y="${y * 2 + Math.floor(at / 2)}" width="1" height="1"/>`)
        }
      }),
    ),
  )

  return rects
}

/** CSS pixels of the card's sprite (6 columns, 2 rows of text) and of the band's (5 columns, 1 row). */
export const CARD_SPRITE_PX = { width: 36, height: 24 } as const
export const BAND_SPRITE_PX = { width: 24, height: 16 } as const

/** Cells the desktop gives the card's and the band's sprite beside it (a cell is about 8 px). */
export const CARD_SPRITE_CELLS = 5
export const BAND_SPRITE_CELLS = 4

/** The desktop's solid bars: the Svg bar's size in CSS pixels, and the card's fixed width in cells (the Client region has no Svg). */
export const BAR_PX = { width: 64, height: 6 } as const
export const CARD_BAR_CELLS = 8

/**
 * A progress bar as an SVG: a rounded track and a rounded fill of `fraction` of it. With `colors` the fill is those colours in
 * equal stripes (the band's rainbow), clipped to the same rounded shape.
 */
export function barSvg(fraction: number, color: string, colors?: readonly string[]): string {
  const { width, height } = BAR_PX
  const radius = height / 2
  const part = Math.min(1, Math.max(0, fraction))
  const fill = part === 0 ? 0 : Math.max(height, Math.round(width * part))
  const stripe = colors === undefined ? 0 : fill / colors.length

  const body =
    fill === 0
      ? ''
      : colors === undefined
        ? `<rect width="${fill}" height="${height}" rx="${radius}" fill="${color}"/>`
        : `<clipPath id="f"><rect width="${fill}" height="${height}" rx="${radius}"/></clipPath><g clip-path="url(#f)">${colors.map((one, at) => `<rect x="${(at * stripe).toFixed(1)}" width="${(stripe + 0.5).toFixed(1)}" height="${height}" fill="${one}"/>`).join('')}</g>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" rx="${radius}" fill="${TRACK_COLOR}"/>${body}</svg>`
}

/** Theme colours as hex, for a picture (an Svg cannot look a theme key up): the statuses' colours as the light theme has them. */
export const HEX: Readonly<Record<string, string>> = {
  inactive: '#8A8A85',
  suggestion: '#3B6FD4',
  warning: '#B7791F',
  error: '#E5484D',
  success: '#3C9D5A',
  claude: '#D77757',
}

/** The empty part of a solid progress bar on the desktop: a light grey. */
export const TRACK_COLOR = '#D9D6CC'

export const MASCOT_COLUMNS = 6
export const MASCOT_ROWS = 2

/** Animation frames (ticks of the one timer) each pose lasts: 3 ticks of 120 ms, about 360 ms. */
export const MASCOT_EVERY = 3

/** The card mascot's two rows at animation frame `frame`. */
export const mascotAt = (frame: number): Pose => MASCOT[Math.floor(frame / MASCOT_EVERY) % MASCOT.length] ?? MASCOT[0]

/**
 * The band's mascot: Claude Code's creature again, one row of `BAND_MASCOT_COLUMNS` columns, in two poses (arms down,
 * arms up). The two-row `MASCOT` stays on the In Progress cards.
 */
export const BAND_MASCOT: readonly [string, string] = ['▜▟█▙▛', '▞▟█▙▚']

export const BAND_MASCOT_COLUMNS = 5

/** Columns the band's mascot and the space after it take. */
export const BAND_MASCOT_SPACE = BAND_MASCOT_COLUMNS + 1

/** The band's mascot at animation frame `frame`: the pose changes every `MASCOT_EVERY` ticks, as the cards' does. */
export const bandMascotAt = (frame: number): string => BAND_MASCOT[Math.floor(frame / MASCOT_EVERY) % BAND_MASCOT.length] ?? BAND_MASCOT[0]

/**
 * The band mascot's pose: arms up and still when the plan is complete (the rainbow), moving while the plan is at work
 * (`isActive`), else arms down and still.
 */
export const bandPose = (plan: PlanEntry, frame: number): string => BAND_MASCOT[bandPoseIndex(plan, frame)] ?? BAND_MASCOT[0]

/** Which of the two poses the band's mascot is in: the same choice `bandPose` makes, as an index (the desktop draws the card sprite's pose of that index). */
export const bandPoseIndex = (plan: PlanEntry, frame: number): 0 | 1 =>
  isComplete(plan) ? 1 : isActive(plan) ? (Math.floor(frame / MASCOT_EVERY) % 2 === 0 ? 0 : 1) : 0

/** Columns the mascot and the space after it take on a card. */
export const MASCOT_SPACE = MASCOT_COLUMNS + 1

/** Fewest columns of task name an In Progress card keeps beside the mascot; a narrower card has no mascot. */
export const MIN_NAME_COLUMNS = 8

/** Whether a card `cardWidth` wide has the mascot: its inside holds the mascot, a space and `MIN_NAME_COLUMNS`. */
export const hasMascot = (cardWidth: number) => cardWidth - BORDER_COLUMNS >= MASCOT_SPACE + MIN_NAME_COLUMNS

/** The index in `plan.rows` of the card whose page the pane shows, or null while it shows the board. */
export const detailOf = (plan: PlanEntry, open: CardRef | null): number | null =>
  open !== null && open.anchor === plan.anchor && plan.rows[open.index] !== undefined ? open.index : null

/** Whether the band draws the rainbow: the plan is the one a PLAN-DONE with 0 left finished (until her next prompt) and has a Done row. */
export const isRainbow = (plan: PlanEntry, finished: string | null): boolean => finished === plan.anchor && isComplete(bandPlanOf(plan, finished))

/**
 * What moves on screen: the band when it draws the rainbow of a finished plan or the plan is at work (`isActive`: its mascot), the
 * pane's mascots while it is up with the board and the plan is at work. A complete plan nothing finished stands still.
 */
export function movement(plan: PlanEntry, view: { finished: string | null; isPaneUp: boolean; isBoard: boolean }): { band: boolean; pane: boolean } {
  const drawn = bandPlanOf(plan, view.finished)

  return {
    band: isRainbow(plan, view.finished) || isActive(drawn),
    pane: view.isPaneUp && view.isBoard && isActive(plan),
  }
}

// ---------------------------------------------------------------- settings and file links

/** What the person set in the plugin's settings (`userConfig`); `applyOptions` fills it when the module loads. */
export const settings = { boardLocation: 'PROGRESS.md', boardCommand: '', usageCommand: '', yourName: '', root: '' }

/** Reads the four settings out of the options the engine hands the module (a missing or blank one keeps its default). */
export function applyOptions(options: Readonly<Record<string, unknown>> | undefined): void {
  const text = (key: string, fallback: string) => {
    const value = options?.[key]

    return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
  }

  settings.boardLocation = text('board_location', 'PROGRESS.md')
  settings.boardCommand = text('board_command', '')
  settings.usageCommand = text('usage_command', '')
  settings.yourName = text('your_name', '')
}

/** Whether `name` is the person: `you` in any case, or their own name (the setting `your_name`, when set). */
export const isYou = (name: string | undefined): boolean => {
  const who = name?.trim().toLowerCase()

  return who !== undefined && (who === 'you' || (settings.yourName !== '' && who === settings.yourName.toLowerCase()))
}

/** The `file://` link of an absolute path; each segment is percent-encoded (spaces, `#`, CJK). */
const linkOf = (absolute: string) => `file://${absolute.split('/').map(encodeURIComponent).join('/')}`

/**
 * The `file://` link of a file path in a note: `~/…` is under `home`, a path that starts with `/` is as it is and any other is relative to
 * the project root. null for a `~` path when the home directory is not known.
 */
export function fileHref(path: string, home: string | undefined): string | null {
  const absolute = absolutePath(path, home)

  return absolute === null ? null : linkOf(absolute)
}

/** The absolute path of a file path in a note: `~/…` is under `home` (null when not known), `/…` is as it is, any other is relative to the project root (null while that is not known). */
export function absolutePath(path: string, home: string | undefined): string | null {
  if (path === '~' || path.startsWith('~/')) {
    return home === undefined || home === '' ? null : `${home.replace(/\/+$/, '')}${path.slice(1)}`
  }

  return path.startsWith('/') ? path : settings.root === '' ? null : `${settings.root.replace(/\/+$/, '')}/${path}`
}

// ---------------------------------------------------------------- usage on the task page

/** `1.2M`, `48k`, `900`: a count in at most four characters of digits. */
export function compactCount(value: number): string {
  const trim = (n: number) => n.toFixed(1).replace(/\.0$/, '')

  if (value >= 1_000_000) {
    return `${trim(value / 1_000_000)}M`
  }

  return value >= 10_000 ? `${Math.round(value / 1000)}k` : value >= 1000 ? `${trim(value / 1000)}k` : String(Math.round(value))
}

/** `42m`, `1h 5m`, `<1m` (nothing under a minute reads as zero unless it is zero). */
export function durationText(ms: number): string {
  const minutes = Math.round(ms / 60_000)

  if (minutes < 1) {
    return ms > 0 ? '<1m' : '0m'
  }

  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

// ---------------------------------------------------------------- the plan line and the task page's lines

/**
 * The dim label over a plan's recap: `Recap · updated 12 min ago`, from `recap_updated` (ISO, as the tracker wrote it).
 * Just `Recap` when there is no time, it is not an ISO time, or it lies ahead of `now`.
 */
export function recapLabel(plan: PlanEntry, now: number): string {
  const minutes = Math.floor((now - Date.parse(plan.recap_updated ?? '')) / 60_000)

  if (!Number.isFinite(minutes) || minutes < 0) {
    return 'Recap'
  }

  if (minutes < 1) {
    return 'Recap · updated just now'
  }

  if (minutes < 60) {
    return `Recap · updated ${minutes} min ago`
  }

  return minutes < 1440 ? `Recap · updated ${Math.floor(minutes / 60)} h ago` : `Recap · updated ${Math.floor(minutes / 1440)} d ago`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** `YYYY-MM-DDTHH:MM` of an instant on this machine's clock. */
function localMinute(ms: number): string {
  const at = new Date(ms)

  return `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}T${pad2(at.getHours())}:${pad2(at.getMinutes())}`
}

/**
 * A tracker ISO time as the clock time when it is today (`19:23`) and as the day and the clock time on another day (`Oct 11 19:23`):
 * the one way the board writes a time (the plan's `updated`, the state word's `since`, a stalled task's tag and page). A time with an
 * offset reads as written, on its own clock, and "today" is `now` on that clock; a time ending in Z, or with no offset, reads on this
 * machine's clock. Undefined when the text is not an ISO time with a clock time.
 */
export function sinceText(iso: string, now: number): string | undefined {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(iso)) {
    return undefined
  }

  const instant = /Z$/.test(iso) ? Date.parse(iso) : undefined

  if (instant !== undefined && Number.isNaN(instant)) {
    return undefined
  }

  const written = instant === undefined ? iso : localMinute(instant)
  const offset = /([+-])(\d\d):(\d\d)$/.exec(written)
  const today = offset === null ? localMinute(now).slice(0, 10) : new Date(now + (offset[1] === '-' ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3])) * 60_000).toISOString().slice(0, 10)
  const time = written.slice(11, 16)

  return written.slice(0, 10) === today ? time : `${MONTHS[Number(written.slice(5, 7)) - 1] ?? written.slice(5, 7)} ${Number(written.slice(8, 10))} ${time}`
}

/**
 * One figure of the stats row: a big bold `value` over a small dim `label`. `drop` orders what a narrow pane gives up: the
 * lowest goes first.
 */
export type Stat = { value: string; label: string; drop: number }

/** Columns between two stats of a row. */
export const STAT_GAP = 3

/** What a stats row shows when the plan has not begun: no start or finish time, and no row has left Todo. */
export const NOT_STARTED = 'Not started yet'

/**
 * Whether the plan has begun: it has a start or a finish time, or a row has left Todo (a Canceled row is ignored). The stats are drawn
 * for such a plan; a plan that has not begun reads `Not started yet` instead.
 */
const hasBegun = (plan: PlanEntry): boolean =>
  plan.started !== undefined || plan.finished !== undefined || plan.rows.some(row => row.status !== 'Todo' && row.status !== 'Canceled')

/**
 * `Not started yet` for a plan that has not begun (no start or finish time, and every row Todo or Canceled), '' for any other plan,
 * whose header already says In progress, Idle or Done.
 */
export function notStartedText(plan: PlanEntry): string {
  return hasBegun(plan) ? '' : NOT_STARTED
}

/** Columns a stat takes: the wider of its value and its label. */
const statCols = (stat: Stat): number => Math.max(displayWidth(stat.value), displayWidth(stat.label))

/** `stats` as far as they fit `width` columns: the lowest `drop` goes first, the last one stays however narrow the pane. */
export function fitStats(stats: readonly Stat[], width: number): Stat[] {
  const kept = [...stats]
  const need = () => kept.reduce((all, stat) => all + statCols(stat), 0) + STAT_GAP * Math.max(0, kept.length - 1)

  while (kept.length > 1 && need() > width) {
    const lowest = kept.reduce((low, stat) => (stat.drop < low.drop ? stat : low))

    kept.splice(kept.indexOf(lowest), 1)
  }

  return kept
}

/** A stats row as two lines of text, each stat in a column as wide as the wider of its value and its label. */
export function statLines(stats: readonly Stat[]): { values: string; labels: string } {
  const cell = (text: string, stat: Stat) => `${text}${' '.repeat(statCols(stat) - displayWidth(text))}`
  const gap = ' '.repeat(STAT_GAP)

  return { values: stats.map(stat => cell(stat.value, stat)).join(gap).trimEnd(), labels: stats.map(stat => cell(stat.label, stat)).join(gap).trimEnd() }
}

/**
 * The stats under the plan name: the tokens (in + out, in already holds the cached) over `tokens` and the cost over `est. cost`; no time,
 * which the state word in the header carries. The tokens and the cost are left out when none is measured, the cost alone when it has no
 * price; with neither there is no details line. Narrower than `width`: the tokens go first; the cost stays. Empty for a plan that has not
 * begun (no start or finish time, every row Todo or Canceled): it reads `Not started yet`. A plan under way with no start time (older
 * tracker data) draws the figures it has.
 */
export function planStatsOf(plan: PlanEntry, width: number): Stat[] {
  if (!hasBegun(plan)) {
    return []
  }

  const totals = plan.usage_totals
  const measured = totals !== undefined && totals.measured > 0

  return fitStats(
    [
      ...(measured ? [{ value: compactCount(totals.tokens_in + totals.tokens_out), label: 'tokens', drop: 2 }] : []),
      ...(measured && totals.cost !== null ? [{ value: `~$${totals.cost.toFixed(2)}`, label: 'est. cost', drop: 3 }] : []),
    ],
    width,
  )
}

/**
 * The task page's status in words: `Waiting for your check`, `In progress`, `Done`; a stalled row adds `· stalled since 14:02`, or
 * `· stalled since Oct 11 14:02` when that was another day than `now`'s (just `· stalled` when the time is no clock time).
 */
export function statusWords(row: PlanRow, now: number = Date.now()): string {
  const words = plainStatusWords(row)

  if (!isStalled(row)) {
    return words
  }

  const at = sinceText(row.stalled_since as string, now)

  return `${words} · ${at === undefined ? 'stalled' : `stalled since ${at}`}`
}

function plainStatusWords(row: PlanRow): string {
  switch (row.status) {
    case 'Todo':
      return 'To do'
    case 'In Progress':
      return 'In progress'
    case 'Needs Verification':
      return needsYou(row) ? 'Waiting for your check' : 'Waiting for a check'
    case 'Verifying':
      return 'Being checked'
    case 'Blocked':
      return '⚑ Blocked'
    default:
      return row.status
  }
}

/** Who did it for the status line: the tier as a chip word and the executor after it (`Sonnet` + `subagent`); `you` alone for the user; undefined without a route. */
export function whoLineOf(row: PlanRow): { tier?: string; executor: string } | undefined {
  const raw = executorOf(row)

  if (raw === undefined) {
    return undefined
  }

  if (isYou(raw)) {
    return { executor: 'you' }
  }

  const tier = routeOf(row)?.[2]

  return { executor: raw === 'inline' ? 'main session' : raw, ...(tier === undefined || tier === '—' ? {} : { tier }) }
}

/**
 * The task page's stats: working time, tokens (in + out; in holds the cached), the cost, each a value over a label. The cost is
 * left out with no price; effort (`medium` over `effort`) only when the work ran at one (a mix does not read as a figure).
 * Undefined for no usage.
 */
export function usageStatsOf(usage: PlanUsage | undefined): Stat[] | undefined {
  if (usage === undefined) {
    return undefined
  }

  const total = usage.tokens.input + usage.tokens.cache_read + usage.tokens.cache_write + usage.tokens.output
  const efforts = Object.entries(usage.effort).filter(([, share]) => share > 0)

  return [
    { value: durationText(usage.working_ms), label: 'working time', drop: 1 },
    { value: compactCount(total), label: 'tokens', drop: 2 },
    ...(usage.cost_usd === null ? [] : [{ value: `~$${usage.cost_usd.toFixed(2)}`, label: 'est. cost', drop: 3 }]),
    ...(efforts.length === 1 ? [{ value: (efforts[0] as [string, number])[0], label: 'effort', drop: 0 }] : []),
  ]
}

/** The command that makes the tracker write `usage` into a row: one place for its words. */
export const usageArgv = (anchor: string, index: number, task: string, sessionId: string): string[] =>
  settings.usageCommand === '' ? [] : commandArgv(settings.usageCommand, { anchor, index: String(index), task, session: sessionId })

// ---------------------------------------------------------------- who, and the card's text

/**
 * `[<split> × ]<executor> · <tier>` and then ` — <why>`. The split is optional (`inline · Opus — x`). The tier is the first word after
 * the dot, up to a space, a comma or a bracket, so `Sonnet (fork worker) — …` and `Sonnet, note — …` read `Sonnet`; any note after it,
 * up to the first ` — `, is skipped. The tier can be `—` itself. The split and the executor hold no `—`.
 */
const ROUTE = /^(?:[^—]+? × )?([^—]+?) · ([^\s,(]+)[^—]*?(?: — (.*))?$/

/** The route as the tracker recorded it: `route`, else `who` (which says `unrouted` for none). */
const routeSource = (row: PlanRow): string => row.route ?? (row.who === undefined || row.who === 'unrouted' ? '' : row.who)

const routeOf = (row: PlanRow) => ROUTE.exec(routeSource(row).replace(/\s+/g, ' ').trim())

/** The first word of `text` when it is the user (`you`, or the setting `your_name`, in any case), else undefined. */
const youWordIn = (text: string | undefined): string | undefined => {
  const first = text?.trim().split(/\s+/)[0]

  return first !== undefined && isYou(first) ? first : undefined
}

/**
 * The executor of the route (your name, `inline`, `subagent(harness-author)`); undefined for no route or one not in the format. It is
 * the user's name word alone (`Sam`, or `you`) when the route starts with that word (`Sam ★ — check: …`, `Sam — direction choice …`)
 * or the executor does (`Sam publishes, inline`): such a task is the user's to do.
 */
export const executorOf = (row: PlanRow): string | undefined => {
  const executor = routeOf(row)?.[1]?.trim() || undefined

  return youWordIn(routeText(row)) ?? youWordIn(executor) ?? executor
}

/**
 * Who checks the work: the board's `check` column when the row has one, else `check by <who>:` in the route (your name,
 * `main session · Opus`, `<agent> · <tier>`, `script`). `you` for the user (`you`, or the setting `your_name`), else the
 * text as written; undefined for no checker (an old `— check:` route names none).
 */
export function checkerOf(row: PlanRow): string | undefined {
  const who = (row.check ?? /check by (.+?):/.exec(routeText(row) ?? '')?.[1])?.trim()

  return who === undefined || who === '' ? undefined : isYou(who) ? 'you' : who
}

/** The tier a checker's text names (`main session · Opus` → `Opus`), or undefined (`script`, a name with no tier). */
const checkerTier = (checker: string): string | undefined => {
  const tier = checker.split(' · ').at(-1)

  return tier === 'Opus' || tier === 'Sonnet' || tier === 'Haiku' ? tier : undefined
}

/**
 * Whether the task waits on her decision: the row is Needs Verification (the Verify lane) and she is its checker or its
 * executor. A row of hers in Todo, In Progress or Blocked is hers to do, not a decision waiting: it keeps the "you" tag only.
 */
export const needsYou = (row: PlanRow): boolean =>
  row.status === 'Needs Verification' && (checkerOf(row) === 'you' || isYou(executorOf(row)))

/**
 * The tag on a card, which names who does the task or is about to take it: none on a Done or Canceled card; in the Verify lanes
 * (Needs Verification, Verifying) the checker's when the route names one (`you`, else the checker's tier; none for a `script`);
 * otherwise `you` when you are the executor, else the tier (`Opus`, `Sonnet`, `Haiku`); undefined for no route, a route not in the
 * format, or a tier that is none of those (`—`, `default`).
 */
export function assigneeOf(row: PlanRow): string | undefined {
  if (row.status === 'Done' || row.status === 'Canceled') {
    return undefined
  }

  const route = routeOf(row)
  const tier = route?.[2]
  const checker = checkerOf(row)

  if (checker !== undefined && (row.status === 'Needs Verification' || row.status === 'Verifying')) {
    return checker === 'you' ? 'you' : checkerTier(checker)
  }

  if (isYou(executorOf(row))) {
    return 'you'
  }

  return tier === 'Opus' || tier === 'Sonnet' || tier === 'Haiku' ? tier : undefined
}

/**
 * The word of a card's tag: for a stalled row `stalled` and the time it stalled, the clock time today (`stalled 19:23`) or only the day
 * on another one (`stalled Oct 11`, to keep the card narrow), plain `stalled` when the time is no clock time; else its assignee;
 * '' for none. `now` decides whether the time is today's.
 */
export function tagWordOf(row: PlanRow, now: number = Date.now()): string {
  if (!isStalled(row)) {
    return assigneeOf(row) ?? ''
  }

  const at = sinceText(row.stalled_since as string, now)

  return at === undefined ? 'stalled' : `stalled ${at.replace(/ \d\d:\d\d$/, '')}`
}

/** A tag's colours as a chip: the word padded one space each side on `bg`. */
export type Chip = { bg: string; fg: string; bold?: true }

/** One chip per tag; raw hex, so they do not follow the theme. */
export const CHIPS: Readonly<Record<string, Chip>> = {
  Opus: { bg: '#F6DCCB', fg: '#7A3410' },
  Sonnet: { bg: '#D3E2F4', fg: '#163F70' },
  Haiku: { bg: '#D6ECD9', fg: '#1E5631' },
  you: { bg: '#4B2FB8', fg: '#FFFFFF', bold: true },
  // Grey: a stalled row has no model tag.
  stalled: { bg: '#E4E2D9', fg: '#44413A' },
}

/** The chip of a card tag's word: `you`, a model, or the grey one of `stalled` with its time (`stalled 19:23`, `stalled Oct 11`); undefined for none. */
export const chipOf = (word: string): Chip | undefined => CHIPS[word] ?? (/^stalled( |$)/.test(word) ? CHIPS.stalled : undefined)

/** Columns a chip of `word` takes: the word and a space each side; 0 for no word. */
export const chipCols = (word: string): number => (word === '' ? 0 : displayWidth(word) + 2)

/** The card's text before the task: the blocked flag, else the needs-you marker, else none. */
export const FLAG = '⚑ Blocked · '
export const NEEDS_YOU = '◆ needs you · '

export const markerOf = (row: PlanRow): string => (isBlocked(row) ? FLAG : needsYou(row) ? NEEDS_YOU : '')

/**
 * `text` as card lines of `width` columns, all of it: no line count caps it and nothing is cut. With a tag of `tagCols`
 * columns, the last line leaves it room (`tagCols` and two spaces), else the tag has a new empty line of its own. At least `minLines`.
 */
export function cardLines(text: string, width: number, tagCols: number, minLines = 1): string[] {
  const lines = wrap(text, width)
  const room = width - tagCols - 2
  const last = lines[lines.length - 1] ?? ''

  if (tagCols > 0 && displayWidth(last) > room) {
    lines.push('')
  }

  while (lines.length < minLines) {
    lines.push('')
  }

  return lines
}

/** Cells of a card's progress bar. */
export const PROGRESS_CELLS = 5

export type Progress = { filled: number; empty: number; count: string; done: number; total: number }

/** The bar of a row's `n/m` (`3/5` → 3 of 5 cells), or undefined when the agent has reported none (or something that is not `n/m` with n ≤ m). */
export function progressOf(row: PlanRow): Progress | undefined {
  const match = /^(\d+)\/(\d+)$/.exec(row.progress ?? '')
  const done = Number(match?.[1])
  const total = Number(match?.[2])

  if (match === null || total <= 0 || done > total) {
    return undefined
  }

  const filled = filledOf(done, total, PROGRESS_CELLS)

  return { filled, empty: PROGRESS_CELLS - filled, count: `${done}/${total}`, done, total }
}

/** The bar as plain text: `▰▰▰▱▱ 3/5`. */
export const progressText = (bar: Progress): string => `${'▰'.repeat(bar.filled)}${'▱'.repeat(bar.empty)} ${bar.count}`

export type CardView = {
  /** Whether the mascot sits beside the name: an In Progress or Blocked card wide enough for it. */
  mascot: boolean
  /** The card's text lines: the first starts with `marker`; a mascot card has 2; a card with a bar ends with the bar's text. */
  lines: string[]
  marker: string
  /** The progress bar, drawn as the last of `lines`; undefined for none. */
  bar: Progress | undefined
  /** The index in `lines` of the bar's line; -1 for none. */
  barAt: number
  /** The tag (the word of its chip) on line `tagAt`, with `pad` spaces before the chip; empty for none. */
  tag: string
  tagAt: number
  pad: number
}

/**
 * The tag word that fits: `wanted` when `fits` accepts it; else, for a stalled word with its time (`stalled 19:23`, `stalled Oct 11`),
 * the bare `stalled` when that fits; else '' (a card with no room for a chip has no tag).
 */
function fittingTag(wanted: string, fits: (word: string) => boolean): string {
  if (wanted === '' || fits(wanted)) {
    return wanted
  }

  return wanted.startsWith('stalled ') && fits('stalled') ? 'stalled' : ''
}

/**
 * How the card of `row`, `cardWidth` wide, is laid out; `now` decides whether a stalled card's tag reads a time or a day. A stalled tag
 * the card has no room for with its time is drawn as the bare `stalled`, so a narrow card (a mascot card in a pane of four lanes) still
 * says it.
 */
export function cardView(row: PlanRow, cardWidth: number, now: number = Date.now()): CardView {
  const mascot = (isRunning(row) || row.status === 'Blocked') && hasMascot(cardWidth)
  const room = Math.max(1, cardWidth - BORDER_COLUMNS - (mascot ? MASCOT_SPACE : 0))
  // The chip, two spaces and at least one column of name must fit.
  const tag = fittingTag(tagWordOf(row, now), word => chipCols(word) + 3 <= room)
  const marker = markerOf(row)
  const reported = progressOf(row)
  // A card too narrow for the whole bar has none.
  const bar = reported !== undefined && displayWidth(progressText(reported)) <= room ? reported : undefined
  const barText = bar === undefined ? '' : progressText(bar)
  // The chip sits at the right end of the bar's line when both fit there; else it keeps the name's last line, as without a bar.
  const isTagOnBar = bar !== undefined && tag !== '' && displayWidth(barText) + chipCols(tag) + 2 <= room
  // Beside the mascot the title keeps the whole width: the chip goes below it, on the bar's line or on a line of its own.
  const isChipBelow = mascot && tag !== ''
  const names = cardLines(`${marker}${row.task}`, room, isTagOnBar || isChipBelow ? 0 : chipCols(tag), bar === undefined && !isChipBelow ? (mascot ? MASCOT_ROWS : 1) : 1)
  const metaLine = isChipBelow && !isTagOnBar ? [''] : []
  const lines = bar === undefined ? [...names, ...metaLine] : [...names, barText, ...metaLine]
  const tagAt = isChipBelow || (bar !== undefined && isTagOnBar) ? lines.length - 1 : names.length - 1
  const last = lines[tagAt] ?? ''

  return { mascot, lines, marker, bar, barAt: bar === undefined ? -1 : names.length, tag, tagAt, pad: tag === '' ? 0 : Math.max(2, room - displayWidth(last) - chipCols(tag)) }
}

/** The route as the tracker wrote it, whitespace folded; undefined for none. */
export const routeText = (row: PlanRow): string | undefined => {
  const text = routeSource(row).replace(/\s+/g, ' ').trim()

  return text === '' ? undefined : text
}

/** The segments of a note: split at `｜` and `|`, trimmed, none empty. */
export const segmentsOf = (note: string): string[] =>
  note
    .split(/[｜|]/)
    .map(part => part.trim())
    .filter(part => part !== '')

/** A date a note starts with (`2026-09-20`), with the dash or colon after it. */
const NOTE_DATE = /^\s*(\d{4}-\d{2}-\d{2})\s*(?:[—–:：-]+\s*)?/

/** What a split leaves whole: a backtick span, and a path with a `;` inside it (`a/b;c.py`). */
const KEEP = /`[^`]*`|[\w.~/-]*\/[\w.~/-]*;[\w.~/-]+\.\w+/g

/**
 * The points of a note: split at `；`, `;`, `｜` and line breaks, trimmed, none empty; not inside backticks or a path. An ASCII `|` stays:
 * the tracker stores a note as written, and in the notes written so far it is a command's alternation or a table's column, never a break.
 */
export function pointsOf(note: string): string[] {
  const kept: string[] = []
  const hidden = note.replace(KEEP, span => {
    kept.push(span)

    return `\uE000${kept.length - 1}\uE001`
  })

  return hidden
    .split(/[；;｜\n]/)
    .map(part => part.trim().replace(/\uE000(\d+)\uE001/g, (_, at: string) => kept[Number(at)] ?? ''))
    .filter(part => part !== '')
}

export type NoteLine = { text: string; dim?: true; needsYou?: true; tag?: true }

/** A point that is only a bracketed tag (`【…】`), nothing else. */
export const isTagPoint = (point: string): boolean => /^【[^】]*】$/.test(point)

/** A point that asks for her: it says "needs you", in any case. */
export const asksForYou = (point: string): boolean => /needs you/i.test(point)

/**
 * A note as the task page's cell shows it, in lines of at most `cols` columns: its leading date, dim, on a line of its own;
 * then each point as `• point` with the lines after the first indented under the text, not under the bullet. A note with
 * one such point shows it without the bullet. A point that is only a bracketed tag has a line of its own, no bullet (`tag`).
 */
export function noteLinesOf(note: string, cols: number): NoteLine[] {
  const date = NOTE_DATE.exec(note)
  const points = pointsOf(date === null ? note : note.slice(date[0].length))
  const lead: NoteLine[] = date === null ? [] : [{ text: date[1] ?? '', dim: true }]

  const mark = (point: string) => (asksForYou(point) ? { needsYou: true as const } : {})
  const texts = points.filter(point => !isTagPoint(point))
  const bulleted = texts.length > 1

  return [
    ...lead,
    ...points.flatMap((point): NoteLine[] => {
      if (isTagPoint(point)) {
        return wrap(point, cols).map((text): NoteLine => ({ text, tag: true }))
      }

      return wrap(point, bulleted ? Math.max(1, cols - 2) : cols).map(
        (text, at): NoteLine => ({ text: bulleted ? `${at === 0 ? '• ' : '  '}${text}` : text, ...mark(point) }),
      )
    }),
  ]
}

/** `text` in lines of at most `cols` columns, every line after the first indented by `indent` spaces (a hanging indent). */
export function hang(text: string, cols: number, indent = 2): string[] {
  const [first = '', ...rest] = wrapAfterFirstLine(text, cols, Math.max(1, cols - indent))

  return [first, ...rest.map(line => `${' '.repeat(indent)}${line}`)]
}

/** `text` broken into lines, the first of at most `firstCols` columns and the others of at most `cols`. */
function wrapAfterFirstLine(text: string, firstCols: number, cols: number): string[] {
  const whole = text.trim()
  const [first = ''] = wrap(whole, firstCols)
  const rest = whole.slice(first.length).trimStart()

  return rest === '' ? [first] : [first, ...wrap(rest, cols)]
}

/** A file path in a note: `word/word.ext` (a folder, then a name with a known extension), or one starting `./`, `../` or `~/`. */
const PATH_IN_TEXT = /(?:(?:~|\.{1,2})\/|(?<![\w./~:-])[\w.-]+\/)[\w.\-/]+\.(?:md|py|json|ts|tsx|txt|toml|yaml|yml|wav)(?!\w)/g

export type Piece = { text: string; path?: string }

/** `text` cut into plain pieces and the file paths it names (`path` set), in order. */
export function piecesOf(text: string): Piece[] {
  const out: Piece[] = []
  let at = 0

  for (const match of text.matchAll(PATH_IN_TEXT)) {
    const start = match.index ?? 0

    if (start > at) {
      out.push({ text: text.slice(at, start) })
    }

    out.push({ text: match[0], path: match[0] })
    at = start + match[0].length
  }

  return at < text.length ? [...out, { text: text.slice(at) }] : out.length === 0 ? [{ text }] : out
}

/** A plan file's path for the file view: relative to the project root when it is in it, then cut from the left to `cols` so the file name stays. */
export function shortPath(path: string, cols: number): string {
  const root = settings.root.replace(/\/+$/, '')
  const short = root !== '' && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path

  if (displayWidth(short) <= cols) {
    return short
  }

  let kept = ''
  let used = 1

  for (const char of [...short].reverse()) {
    const width = charWidth(char.codePointAt(0) ?? 0)

    if (used + width > cols) {
      break
    }

    kept = char + kept
    used += width
  }

  return `…${kept}`
}

/** Rows a card takes: its border, its text lines, its border. */
export const cardRows = (row: PlanRow, cardWidth: number, now: number = Date.now()): number => 2 + cardView(row, cardWidth, now).lines.length

/**
 * The overflow button's label (a Button draws its own `[ ]`, 4 columns): the line as it is when it fits `width`, else the
 * short form that keeps the arrow (`+13 more ▾`, `less ▴`); never cut inside the brackets.
 */
export function overflowLabel(lane: { moreLabel: string; more: number }, width: number): string {
  const full = moreButton(lane.moreLabel)

  if (displayWidth(full) + 4 <= width) {
    return full
  }

  return lane.moreLabel === SHOW_LESS ? 'less ▴' : `+${lane.more} more ▾`
}

// ---------------------------------------------------------------- the board command

/**
 * A command template as an argv: words split on spaces (single or double quotes keep a word whole), `{name}` replaced by its
 * value inside a word, and a `[ ... ]` group kept only when every placeholder in it has a non-empty value. No shell runs it, so
 * a value (a query, a task) is never read as shell syntax.
 */
export function commandArgv(template: string, values: Readonly<Record<string, string>>): string[] {
  const words: { text: string; group: number }[] = []
  let group = 0
  let inGroup = false
  let word = ''
  let quote = ''
  let isWord = false

  const flush = () => {
    if (isWord) {
      words.push({ text: word, group: inGroup ? group : 0 })
    }

    word = ''
    isWord = false
  }

  for (const char of template) {
    if (quote !== '') {
      if (char === quote) {
        quote = ''
      } else {
        word += char
      }
    } else if (char === '"' || char === "'") {
      quote = char
      isWord = true
    } else if (/\s/.test(char)) {
      flush()
    } else if (char === '[' && !isWord) {
      group += 1
      inGroup = true
    } else if (char === ']' && inGroup) {
      flush()
      inGroup = false
    } else {
      word += char
      isWord = true
    }
  }

  flush()

  const fill = (text: string) => text.replace(/\{(\w+)\}/g, (_all, name: string) => values[name] ?? '')
  const needs = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1] ?? '')
  const dropped = new Set(
    words.filter(one => one.group !== 0 && needs(one.text).some(name => (values[name] ?? '') === '')).map(one => one.group),
  )

  return words.filter(one => !dropped.has(one.group)).map(one => fill(one.text))
}

/**
 * The word of a board command that a Bash call to the same tool contains: the file name of the last word before the first flag
 * that is a path or has an extension (`board.py` for `/usr/bin/env X=1 python3 /s/board.py --view {session}`); '' for none.
 */
export function commandMarkOf(argv: readonly string[]): string {
  const flag = argv.findIndex(word => word.startsWith('-'))
  const before = argv.slice(0, flag === -1 ? argv.length : flag)
  const word = before.filter(one => !one.includes('=') && (one.includes('/') || /\.\w+$/.test(one))).at(-1)

  return word?.split('/').at(-1) ?? ''
}

/** The board command for this session and `query` (already trimmed); empty while no `board_command` is set. */
export const boardArgv = (sessionId: string, query: string): string[] =>
  settings.boardCommand === '' ? [] : commandArgv(settings.boardCommand, { session: sessionId, query })

/** One line: the exit code and the last non-empty line of what the script wrote to stderr (a Python crash ends with its error). */
export function failureText(exitCode: number, stderr: string): string {
  const last = stderr.trim().split('\n').at(-1)?.trim().slice(0, 200) ?? ''

  return `plan-tracker: the board command exited ${exitCode}${last === '' ? '' : `: ${last}`}`
}

const DONE_PREFIX = 'PLAN-DONE '
const DONE_HEADER = /^PLAN-DONE (.+?) · (.+) · (\d+) left\s*$/

/** Every block that starts a line with `PLAN-DONE `: that line and those after it up to the first blank line. */
export function doneBlocks(output: string): string[] {
  const lines = output.split('\n')
  const blocks: string[] = []
  let at = 0

  while (at < lines.length) {
    if (!(lines[at] ?? '').startsWith(DONE_PREFIX)) {
      at += 1
      continue
    }

    let end = at + 1

    while (end < lines.length && (lines[end] ?? '').trim() !== '') {
      end += 1
    }

    blocks.push(lines.slice(at, end).join('\n'))
    at = end
  }

  return blocks
}

/** The task and the count left from a block's first line, or undefined when it has another shape. */
export function doneHeader(block: string): { task: string; left: string } | undefined {
  const match = DONE_HEADER.exec(block.split('\n')[0] ?? '')

  return match?.[2] === undefined || match[3] === undefined ? undefined : { task: match[2], left: match[3] }
}

/** The plan a block's first line names (its anchor) when that block finished the plan (`0 left`); undefined for any other block. */
export function finishedAnchor(block: string): string | undefined {
  const match = DONE_HEADER.exec(block.split('\n')[0] ?? '')

  return match?.[1] !== undefined && match[3] === '0' ? match[1] : undefined
}

// ---------------------------------------------------------------- the board file (PROGRESS.md)

const KNOWN_STATUS: Readonly<Record<string, PlanStatus>> = {
  todo: 'Todo',
  'to do': 'Todo',
  'in progress': 'In Progress',
  verifying: 'Verifying',
  'needs verification': 'Needs Verification',
  blocked: 'Blocked',
  done: 'Done',
  canceled: 'Canceled',
  cancelled: 'Canceled',
}

/** A table row's cells: the outer pipes dropped, `\|` kept as a pipe inside a cell, each cell trimmed. */
const cellsOf = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map(cell => cell.replace(/\\\|/g, '|').trim())

const isRule = (line: string): boolean => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line) && line.includes('-')

/** A status cell as the person wrote it, without markdown emphasis or code ticks. */
const plainCell = (cell: string): string => cell.replace(/[*_`]/g, '').trim()

/**
 * The board file's markdown as a board, or one line saying why it cannot be read. The first table with `task` and `status`
 * columns is the board; the columns are found by their header (any case), so their order does not matter. `evidence` is the
 * note; `executor`, `check`, `route`, `goal` and `progress` are read when present. A status the reader does not know keeps its
 * own text on a row of status `Other`, which has its own lane. `file` is the board file's absolute path; `name` the plan's name
 * unless the file's first `# ` heading gives one.
 */
export function parseProgress(text: string, file: string, name: string): { board: PlanBoard } | { error: string } {
  const where = file.split('/').at(-1) ?? file

  if (text.trim() === '') {
    return { error: `plan-tracker: ${where} is empty` }
  }

  const lines = text.split('\n')
  const title = lines.map(line => /^#\s+(.+?)\s*$/.exec(line)?.[1]).find(one => one !== undefined)
  const start = lines.findIndex((line, at) => {
    if (!line.trim().startsWith('|') || !isRule(lines[at + 1] ?? '')) {
      return false
    }

    const header = cellsOf(line).map(cell => cell.toLowerCase())

    return header.includes('task') && header.includes('status')
  })

  if (start === -1) {
    const hasTable = lines.some((line, at) => line.trim().startsWith('|') && isRule(lines[at + 1] ?? ''))

    return {
      error: hasTable
        ? `plan-tracker: ${where} has a table, but none with both a "task" and a "status" column in its header row`
        : `plan-tracker: ${where} has no markdown table with "task" and "status" columns`,
    }
  }

  const header = cellsOf(lines[start] ?? '').map(cell => cell.toLowerCase())
  const at = (column: string) => header.indexOf(column)
  const cell = (cells: string[], column: string) => (at(column) === -1 ? undefined : asText(plainCell(cells[at(column)] ?? '')))
  const raw = (cells: string[], column: string) => (at(column) === -1 ? undefined : asText((cells[at(column)] ?? '').trim()))
  const rows: PlanRow[] = []

  for (const line of lines.slice(start + 2)) {
    if (!line.trim().startsWith('|')) {
      break
    }

    const cells = cellsOf(line)
    const task = raw(cells, 'task')

    if (task === undefined) {
      continue
    }

    const statusText = cell(cells, 'status') ?? ''
    const known = KNOWN_STATUS[statusText.toLowerCase()]
    const executor = cell(cells, 'executor')
    // An executor cell of `<who> · <tier>` is a route's executor and tier already; a bare one has no tier.
    const route = raw(cells, 'route') ?? (executor === undefined ? undefined : `step × ${executor.includes(' · ') ? executor : `${executor} · —`}`)
    const check = cell(cells, 'check')
    const note = raw(cells, 'evidence')
    const goal = raw(cells, 'goal')
    const progress = cell(cells, 'progress')

    rows.push({
      task,
      status: known ?? 'Other',
      ...(known === undefined ? { statusText: statusText === '' ? 'no status' : statusText } : {}),
      updated: null,
      ...(note === undefined ? {} : { note }),
      ...(route === undefined ? {} : { route }),
      ...(check === undefined ? {} : { check }),
      ...(goal === undefined ? {} : { goal }),
      ...(progress === undefined ? {} : { progress }),
    })
  }

  if (rows.length === 0) {
    return { error: `plan-tracker: the table in ${where} has no rows with a task` }
  }

  // A `Recap: <text>` line above the table is the plan's recap; the file says when it was written nowhere, so it has no time.
  const recap = lines.slice(0, start).map(line => /^Recap:\s*(\S.*?)\s*$/i.exec(line)?.[1]).find(one => one !== undefined)
  // The file's one plan has no flag to say whose it is: it is this session's, so a turn reads In progress on it.
  const plan: PlanEntry = { anchor: 'progress', name: title ?? name, goal: '', plan_file: file, in_session: true, ...(recap === undefined ? {} : { recap }), rows }

  return { board: { selected: 'progress', message: null, plans: [plan] } }
}

/** What the board shows while the board file does not exist yet (no plan has started): not an error. */
export const noBoardFile = (file: string): { board: PlanBoard } => ({
  board: {
    selected: null,
    message: `No ${file.split('/').at(-1) ?? file} yet: the route skill writes it when an approved plan starts.`,
    plans: [],
  },
})
