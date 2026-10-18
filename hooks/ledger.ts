/**
 * The pure part of the usage ledger: what one API request costs by the price table, whose work a request is, how the requests of one
 * interval between two `session.measure` readings are scaled to the host's own cost, and the file the plugin writes. Nothing here
 * touches `$`; `register.tsx` records, books and writes.
 */
import type { PlanEntry, UsageTokens } from '../types'
import { localIso } from './board'

// ---------------------------------------------------------------- the price table

/**
 * USD per million tokens: (input, output, cache read, cache write 5m). A 1-hour cache write costs twice the input price (`requestUsd`).
 * Source: platform.claude.com/docs/en/about-claude/pricing.md, fetched 2026-10-11.
 */
export const PRICES: Record<string, readonly [number, number, number, number]> = {
  'claude-fable-5': [10.0, 50.0, 1.0, 12.5],
  'claude-fable-5-1': [10.0, 50.0, 0.25, 12.5],
  'claude-opus-5-5': [4.0, 20.0, 0.2, 5.0],
  'claude-opus-5': [5.0, 25.0, 0.5, 6.25],
  'claude-sonnet-5-5': [2.0, 10.0, 0.1, 2.5],
  'claude-sonnet-5': [2.0, 10.0, 0.2, 2.5],
  'claude-haiku-4-5': [1.0, 5.0, 0.1, 1.25],
  'claude-haiku-4-5-20251001': [1.0, 5.0, 0.1, 1.25],
}

/** Priced by prompt size (input + cache read + cache write): [threshold, prices up to it, prices above it]. */
export const TIERED_PRICES: Record<string, readonly [number, readonly [number, number, number, number], readonly [number, number, number, number]]> = {
  'claude-haiku-5-5': [100_000, [0.1, 0.5, 0.01, 0.125], [0.5, 2.5, 0.05, 0.625]],
}

/**
 * How long the cache writes of a main-thread request live when the runtime's usage gives no `cache_creation` split, which it does not
 * (the `usage-shape` line of the probe on 2026-10-18 lists only the four counts and the model). The transcripts of both probes of that day
 * show the main thread writing only 1-hour entries (66,863 and 67,813 tokens) and its subagents only 5-minute ones (75,934 and 47,692), so
 * a main-thread write is priced as 1-hour (twice the input price) and a subagent's as 5-minute (the table's cache-write price). A split in
 * the usage, when a runtime gives one, wins over this.
 */
export const MAIN_THREAD_CACHE_WRITE: '1h' | '5m' = '1h'

/** The model the API reported (`TurnUsage.model`) as the table spells it: a `[1m]` suffix (the 1M-context variant) is priced as the base id. */
export const normModel = (model: string): string => model.replace(/\[1m\]$/, '')

/**
 * The API's four counts of one response (`ModelUsage`). `cache_creation` is the runtime's split of the written tokens by lifetime
 * (`ephemeral_1h_input_tokens`, `ephemeral_5m_input_tokens`); the d.ts type does not list it, so it is read defensively.
 */
export type ApiUsage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; cache_creation?: unknown }

export const tokensOf = (usage: ApiUsage): UsageTokens => ({
  in: usage.input_tokens,
  cached: usage.cache_read_input_tokens,
  cache_write: usage.cache_creation_input_tokens,
  out: usage.output_tokens,
})

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

/**
 * The written tokens the runtime's split says are 1-hour ones (`cache_creation.ephemeral_1h_input_tokens`, at most all of them; 0 when only
 * the 5-minute count is given); undefined when the usage carries no split (neither count is a number of tokens). What is not 1-hour is
 * priced as a 5-minute write.
 */
function splitHourWrites(usage: ApiUsage): number | undefined {
  const split = usage.cache_creation as { ephemeral_1h_input_tokens?: unknown; ephemeral_5m_input_tokens?: unknown } | null | undefined

  if (typeof split !== 'object' || split === null || (!isCount(split.ephemeral_1h_input_tokens) && !isCount(split.ephemeral_5m_input_tokens))) {
    return undefined
  }

  return isCount(split.ephemeral_1h_input_tokens) ? Math.min(split.ephemeral_1h_input_tokens, usage.cache_creation_input_tokens) : 0
}

/**
 * What one response costs by the table, in USD; null for a model the table lacks (its tokens are still counted). A 1-hour cache write
 * costs twice the input price, a 5-minute write the table's cache-write price. The usage's split says which; with no split the loop
 * decides: a main-thread request's writes are `MAIN_THREAD_CACHE_WRITE`, a subagent's are 5-minute.
 */
export function requestUsd(model: string, usage: ApiUsage, isMainThread = false): number | null {
  const id = normModel(model)
  const tier = TIERED_PRICES[id]
  const prompt = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  const prices = PRICES[id] ?? (tier === undefined ? undefined : prompt <= tier[0] ? tier[1] : tier[2])

  if (prices === undefined) {
    return null
  }

  const [input, output, read, write] = prices
  const hour = splitHourWrites(usage) ?? (isMainThread && MAIN_THREAD_CACHE_WRITE === '1h' ? usage.cache_creation_input_tokens : 0)

  return (usage.input_tokens * input + usage.output_tokens * output + usage.cache_read_input_tokens * read + (usage.cache_creation_input_tokens - hour) * write + hour * 2 * input) / 1_000_000
}

const KEY_DEPTH = 4
const KEY_LIMIT = 100

/** The key names of an object, a nested key as a dotted path (`cache_creation.ephemeral_1h_input_tokens`): no value is read, an array is one key, and it stops at a depth and a count. */
export function keyPaths(value: unknown, prefix = '', depth = 1): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return []
  }

  const paths: string[] = []

  for (const [key, inner] of Object.entries(value)) {
    const path = prefix === '' ? key : `${prefix}.${key}`

    paths.push(path, ...(depth < KEY_DEPTH ? keyPaths(inner, path, depth + 1) : []))

    if (paths.length >= KEY_LIMIT) {
      break
    }
  }

  return paths.slice(0, KEY_LIMIT)
}

// ---------------------------------------------------------------- whose work a request is

/** The plan (its ledger key) and the row (its exact task text) a request is counted to; `row: null` is the plan's own share. */
export type Owner = { plan: string; row: string | null }

/**
 * The owner of the main thread's requests, from the plans the board last answered: the plan's own share (`row: null`) when exactly one
 * of this session's plans has a row In Progress, whoever does the row; else nobody (null). The main thread's work is never a row's: a
 * row is counted only the work of a subagent that was briefed for it (`briefRow`) or was spawned by one that was.
 */
export function mainOwner(plans: readonly PlanEntry[]): Owner | null {
  const running = plans.filter(plan => plan.in_session === true && plan.rows.some(row => row.status === 'In Progress'))

  return running.length === 1 ? { plan: (running[0] as PlanEntry).anchor, row: null } : null
}

/** The row `task` of this session's plans (those of `anchor` when given) as an owner; null when no plan has it, or several do. */
export function rowOwner(plans: readonly PlanEntry[], task: string, anchor?: string): Owner | null {
  const hits = plans.filter(plan => plan.in_session === true && (anchor === undefined || plan.anchor === anchor)).filter(plan => plan.rows.some(row => row.task === task))

  return hits.length === 1 ? { plan: (hits[0] as PlanEntry).anchor, row: task } : null
}

/** What the plugin knows of a subagent: the row it claimed (its brief's) and the agent that spawned it. */
export type AgentClaims = { claims: Claim[]; parent?: string }

/**
 * Whose work a subagent's request is, against the plans the tracker has now: the row of its latest claim that a row of this session's
 * plans matches; else its parent's owner; else the main thread's owner. Nothing is frozen when the agent is spawned: a brief can name a
 * row made seconds before, which the board's last answer may not have yet. `wanted` is its latest claim that no row matched, for
 * `settle` to look up again once an answer holds it.
 */
export function resolveAgent(agents: ReadonlyMap<string, AgentClaims>, plans: readonly PlanEntry[], agentId: string, depth = 0): { owner: Owner | null; wanted?: Claim } {
  const known = agents.get(agentId)
  const claims = known?.claims ?? []

  for (const claim of [...claims].reverse()) {
    const owner = rowOwner(plans, claim.task, claim.anchor)

    if (owner !== null) {
      return { owner }
    }
  }

  const wanted = claims.at(-1)
  const up = known?.parent !== undefined && known.parent !== agentId && depth < 8 ? resolveAgent(agents, plans, known.parent, depth + 1) : undefined
  const missing = wanted ?? up?.wanted

  return { owner: up === undefined ? mainOwner(plans) : up.owner, ...(missing === undefined ? {} : { wanted: missing }) }
}

/** `requests` with each one's `wanted` row looked up again in `plans`: a request whose row the tracker now has is the row's, no longer the fallback's. */
export function settle(requests: readonly Request[], plans: readonly PlanEntry[]): Request[] {
  return requests.map(one => {
    const owner = one.wanted === undefined ? null : rowOwner(plans, one.wanted.task, one.wanted.anchor)

    if (owner === null) {
      return one
    }

    const { wanted: _found, ...rest } = one

    return { ...rest, owner }
  })
}

/** The row text of a brief's first line, `Tracker row: "<exact row text>"`; undefined for a brief that does not start with it. */
export function briefRow(prompt: string): string | undefined {
  const first = prompt.split('\n').find(line => line.trim() !== '')

  return /^\s*Tracker row:\s*"(.+)"\s*$/.exec(first ?? '')?.[1]
}

// ---------------------------------------------------------------- the interval

/** Scaling is kept only inside these bounds: a host change far from the table's own sum means the requests do not match the host's. */
export const SCALE_MIN = 0.8
export const SCALE_MAX = 1.25

/**
 * Whether a subagent's requests are in the host's `cost.usd` (and so scaled with the main thread's). The probe decides it; true until it does.
 * False: only the main thread's requests are scaled, a subagent's keep the table price.
 */
export const SCALE_INCLUDES_SUBAGENTS = true

/** A row a subagent was briefed for: its exact text, and its plan's key when one is named. */
export type Claim = { task: string; anchor?: string }

/**
 * One API response as the plugin records it: whose it is, which loop made it, its counts and table price, and when (ms). `wanted` is the
 * row a subagent claimed that the tracker's answer did not have yet when this was recorded: the owner is then the fallback, and the row
 * once an answer holds it (`settle`).
 */
export type Request = { owner: Owner | null; agentId: string | undefined; wanted?: Claim; tokens: UsageTokens; usd: number | null; at: number }

/** A request with the cost it is booked at. */
export type Booked = Request & { cost: number }

export type Interval = {
  booked: Booked[]
  /** The host's change over the table's sum of the requests in scope; null when it cannot be worked out. */
  factor: number | null
  isScaled: boolean
  tableMain: number
  tableSub: number
  requestsMain: number
  requestsSub: number
}

const priced = (requests: readonly Request[]) => requests.reduce((sum, one) => sum + (one.usd ?? 0), 0)

/**
 * The requests of one interval booked at a cost. `deltaUsd` is the host's `cost.usd` change over the interval (null when there is no
 * baseline); the requests in scope sum to it when the factor is inside `SCALE_MIN`..`SCALE_MAX`. Not scaled (no baseline, the first
 * interval after a load, no priced request, a factor outside the bounds): each keeps its table price. A request with no price books 0.
 * What the host spent that no request covers is not worked out here: the file derives it (`ledgerText`).
 */
export function scaleInterval(requests: readonly Request[], deltaUsd: number | null, options: { includesSubagents: boolean; isFirst: boolean }): Interval {
  const main = requests.filter(one => one.agentId === undefined)
  const sub = requests.filter(one => one.agentId !== undefined)
  const inScope = (one: Request) => options.includesSubagents || one.agentId === undefined
  const tableMain = priced(main)
  const tableSub = priced(sub)
  const tableScope = options.includesSubagents ? tableMain + tableSub : tableMain
  const factor = deltaUsd === null || tableScope <= 0 ? null : deltaUsd / tableScope
  const isScaled = factor !== null && !options.isFirst && factor >= SCALE_MIN && factor <= SCALE_MAX

  return {
    booked: requests.map(one => ({ ...one, cost: one.usd === null ? 0 : isScaled && inScope(one) ? one.usd * (factor as number) : one.usd })),
    factor,
    isScaled,
    tableMain,
    tableSub,
    requestsMain: main.length,
    requestsSub: sub.length,
  }
}

// ---------------------------------------------------------------- the file

export type LedgerEntry = { plan: string; row: string | null; first: string; last: string; tokens: UsageTokens; cost_usd: number; requests: number }

export type Unowned = { tokens: UsageTokens; cost_usd: number; requests: number }

/** `~/.claude/mods-logs/plan-tracker-usage/<session id>.json`. */
export type LedgerFile = {
  version: 1
  session: string
  /** Where the session drew: `terminal`, `desktop`, `vscode`, `mobile`, or `unknown` until a surface is known. */
  surface: string
  updated: string
  /** The host's `cost.usd` at the last interval's end; null until one was read. */
  measured_usd: number | null
  entries: LedgerEntry[]
  unowned: Unowned
}

const zeroTokens = (): UsageTokens => ({ in: 0, cached: 0, cache_write: 0, out: 0 })

const addTokens = (to: UsageTokens, from: UsageTokens): UsageTokens => ({ in: to.in + from.in, cached: to.cached + from.cached, cache_write: to.cache_write + from.cache_write, out: to.out + from.out })

/** Where every session's ledger is kept: `~/.claude/mods-logs/plan-tracker-usage`, apart from the plan board's own `usage` folder so the two never read each other's files. */
export const ledgerDir = (home: string): string => `${home.replace(/\/+$/, '')}/.claude/mods-logs/plan-tracker-usage`

/**
 * The files a session's ledger may be written to, in the order the plugin tries them: its own `<id>.json`, then others of the same session
 * id that the plugin sums too (it takes the session from the file's `session`, not its name). A file that cannot be read is left as it
 * is and the next name is tried, so what it holds is never overwritten.
 */
export const ledgerNames = (session: string): string[] => [`${session}.json`, `${session}.recovered.json`, ...[2, 3, 4, 5].map(n => `${session}.recovered-${n}.json`)]

export const emptyLedger = (session: string, surface = 'unknown'): LedgerFile => ({
  version: 1,
  session,
  surface,
  updated: '',
  measured_usd: null,
  entries: [],
  unowned: { tokens: zeroTokens(), cost_usd: 0, requests: 0 },
})

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const tokensFrom = (value: unknown): UsageTokens | undefined => {
  const raw = value as Record<string, unknown> | null

  return typeof raw === 'object' && raw !== null && isNumber(raw.in) && isNumber(raw.cached) && isNumber(raw.cache_write) && isNumber(raw.out)
    ? { in: raw.in, cached: raw.cached, cache_write: raw.cache_write, out: raw.out }
    : undefined
}

/** A ledger file's text as a ledger of `session`, or undefined when it is not one (unparsable, another version, another session, a damaged entry). */
export function parseLedger(text: string, session: string): LedgerFile | undefined {
  let data: unknown

  try {
    data = JSON.parse(text)
  } catch {
    return undefined
  }

  const raw = data as Record<string, unknown> | null
  const unowned = raw?.unowned as Record<string, unknown> | null | undefined
  const unownedTokens = tokensFrom(unowned?.tokens)

  if (typeof raw !== 'object' || raw === null || raw.version !== 1 || raw.session !== session || !Array.isArray(raw.entries) || unownedTokens === undefined || !isNumber(unowned?.cost_usd) || !isNumber(unowned?.requests)) {
    return undefined
  }

  const entries: LedgerEntry[] = []

  for (const one of raw.entries as (Record<string, unknown> | null)[]) {
    const tokens = tokensFrom(one?.tokens)

    if (
      tokens === undefined || typeof one?.plan !== 'string' || (one.row !== null && typeof one.row !== 'string') ||
      typeof one.first !== 'string' || typeof one.last !== 'string' || !isNumber(one.cost_usd) || !isNumber(one.requests)
    ) {
      return undefined
    }

    entries.push({ plan: one.plan, row: one.row, first: one.first, last: one.last, tokens, cost_usd: one.cost_usd, requests: one.requests })
  }

  return {
    version: 1,
    session,
    surface: typeof raw.surface === 'string' && raw.surface !== '' ? raw.surface : 'unknown',
    updated: typeof raw.updated === 'string' ? raw.updated : '',
    measured_usd: isNumber(raw.measured_usd) ? raw.measured_usd : null,
    entries,
    unowned: { tokens: unownedTokens, cost_usd: unowned.cost_usd as number, requests: unowned.requests as number },
  }
}

const earlier = (a: string, b: string) => (Date.parse(b) < Date.parse(a) ? b : a)
const later = (a: string, b: string) => (Date.parse(b) > Date.parse(a) ? b : a)

/** `ledger` with `booked` added: each request to the entry of its row (or plan), a request with no owner to `unowned`. */
export function bookInto(ledger: LedgerFile, booked: readonly Booked[]): LedgerFile {
  const entries = ledger.entries.map(one => ({ ...one }))
  let unowned = { ...ledger.unowned }

  for (const one of booked) {
    if (one.owner === null) {
      unowned = { tokens: addTokens(unowned.tokens, one.tokens), cost_usd: unowned.cost_usd + one.cost, requests: unowned.requests + 1 }

      continue
    }

    const { plan, row } = one.owner
    const time = localIso(one.at)
    const held = entries.find(entry => entry.plan === plan && entry.row === row)

    if (held === undefined) {
      entries.push({ plan, row, first: time, last: time, tokens: { ...one.tokens }, cost_usd: one.cost, requests: 1 })
    } else {
      held.first = earlier(held.first, time)
      held.last = later(held.last, time)
      held.tokens = addTokens(held.tokens, one.tokens)
      held.cost_usd += one.cost
      held.requests += 1
    }
  }

  return { ...ledger, entries, unowned }
}

/** Whether the ledger, with the requests of the open interval, has an entry: one booked, or an open request that someone owns. A request nobody owns is not an entry. */
export const hasEntries = (ledger: LedgerFile, open: readonly Request[]): boolean => ledger.entries.length > 0 || open.some(one => one.owner !== null)

const roundUsd = (usd: number) => Math.round(usd * 1e6) / 1e6

/**
 * The ledger as the file holds it: `ledger` plus the requests of the interval still open at their table price (they are scaled when the
 * interval closes), its cost rounded to a millionth of a dollar. Pretty-printed JSON.
 *
 * Entries and unowned never add up to more than the host measured. With a measurement (`measured_usd`), the cost nobody owns is what the
 * host measured less the entries' (negative when the entries are over it), whatever the requests nobody owns cost by the table: a request the
 * measurement already counted adds nothing on top. Without one (the host keeps no cost), it is the table price of those requests.
 */
export function ledgerText(ledger: LedgerFile, open: readonly Request[], updated: string): string {
  const whole = bookInto(ledger, open.map(one => ({ ...one, cost: one.usd ?? 0 })))
  const unownedCost = whole.measured_usd === null ? whole.unowned.cost_usd : whole.measured_usd - whole.entries.reduce((sum, one) => sum + one.cost_usd, 0)

  return `${JSON.stringify(
    {
      ...whole,
      updated,
      measured_usd: whole.measured_usd === null ? null : roundUsd(whole.measured_usd),
      entries: whole.entries.map(one => ({ ...one, cost_usd: roundUsd(one.cost_usd) })),
      unowned: { ...whole.unowned, cost_usd: roundUsd(unownedCost) },
    },
    null,
    2,
  )}\n`
}
