import { describe, expect, test } from './testing'

import {
  MAIN_THREAD_CACHE_WRITE,
  PRICES,
  SCALE_INCLUDES_SUBAGENTS,
  SCALE_MAX,
  SCALE_MIN,
  TIERED_PRICES,
  bookInto,
  briefRow,
  emptyLedger,
  hasEntries,
  keyPaths,
  ledgerNames,
  ledgerText,
  mainOwner,
  normModel,
  parseLedger,
  requestUsd,
  rowOwner,
  scaleInterval,
  tokensOf,
} from '../hooks/ledger'
import type { Request } from '../hooks/ledger'
import type { PlanEntry, PlanRow, PlanStatus } from '../types'
import { isoAt } from './fixtures'

const MILLION = 1_000_000

const usage = (input: number, output = 0, read = 0, write = 0) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: read, cache_creation_input_tokens: write })

describe('the price table, per request', () => {
  test('every model of the table prices the four counts at its rates (USD per million: input, output, cache read, cache write)', () => {
    expect(Object.keys(PRICES).sort()).toEqual([
      'claude-fable-5', 'claude-fable-5-1', 'claude-haiku-4-5', 'claude-haiku-4-5-20251001', 'claude-opus-5', 'claude-opus-5-5', 'claude-sonnet-5', 'claude-sonnet-5-5',
    ])
    expect(PRICES['claude-fable-5']).toEqual([10.0, 50.0, 1.0, 12.5])
    expect(PRICES['claude-fable-5-1']).toEqual([10.0, 50.0, 0.25, 12.5])
    expect(PRICES['claude-opus-5-5']).toEqual([4.0, 20.0, 0.2, 5.0])
    expect(PRICES['claude-opus-5']).toEqual([5.0, 25.0, 0.5, 6.25])
    expect(PRICES['claude-sonnet-5-5']).toEqual([2.0, 10.0, 0.1, 2.5])
    expect(PRICES['claude-sonnet-5']).toEqual([2.0, 10.0, 0.2, 2.5])
    expect(PRICES['claude-haiku-4-5']).toEqual([1.0, 5.0, 0.1, 1.25])
    expect(PRICES['claude-haiku-4-5-20251001']).toEqual([1.0, 5.0, 0.1, 1.25])
    expect(requestUsd('claude-opus-5-5', usage(MILLION, MILLION, MILLION, MILLION))).toBeCloseTo(4 + 20 + 0.2 + 5, 9)
    expect(requestUsd('claude-sonnet-5', usage(MILLION, 0, MILLION, 0))).toBeCloseTo(2 + 0.2, 9)
  })

  test('a [1m] suffix is priced as the base id; a model the table lacks has no price (null), and so does an alias', () => {
    expect(normModel('claude-opus-5-5[1m]')).toBe('claude-opus-5-5')
    expect(requestUsd('claude-opus-5-5[1m]', usage(MILLION))).toBeCloseTo(4, 9)
    expect(requestUsd('claude-mystery-1', usage(MILLION))).toBeNull()
    expect(requestUsd('opus', usage(MILLION))).toBeNull()
  })

  test('haiku-5-5 is priced by prompt size: input + cache read + cache write up to 100k at the low rates, above it at the high ones', () => {
    expect(Object.keys(TIERED_PRICES)).toEqual(['claude-haiku-5-5'])
    expect(requestUsd('claude-haiku-5-5', usage(60_000, 0, 40_000))).toBeCloseTo((60_000 * 0.1 + 40_000 * 0.01) / MILLION, 12)
    expect(requestUsd('claude-haiku-5-5', usage(60_000, 0, 40_001))).toBeCloseTo((60_000 * 0.5 + 40_001 * 0.05) / MILLION, 12)
  })

  test('the four counts map to the ledger\'s: input to in, cache read to cached, cache write to cache_write, output to out', () => {
    expect(tokensOf(usage(1, 2, 3, 4))).toEqual({ in: 1, cached: 3, cache_write: 4, out: 2 })
  })
})

/** Sonnet 5.5 prices input at 2 USD per million and a 5-minute cache write at 2.5; a 1-hour write costs twice the input price: 4. */
describe('cache writes: the usage\'s 1-hour and 5-minute split', () => {
  const written = (split: unknown, total = MILLION) => ({ ...usage(0, 0, 0, total), cache_creation: split })

  test('1-hour writes cost twice the input price', () => {
    expect(requestUsd('claude-sonnet-5-5', written({ ephemeral_1h_input_tokens: MILLION, ephemeral_5m_input_tokens: 0 }))).toBeCloseTo(4, 9)
  })

  test('5-minute writes cost the cache-write price, as the table has it', () => {
    expect(requestUsd('claude-sonnet-5-5', written({ ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: MILLION }))).toBeCloseTo(2.5, 9)
  })

  test('a mix: each part at its own price', () => {
    expect(requestUsd('claude-sonnet-5-5', written({ ephemeral_1h_input_tokens: 400_000, ephemeral_5m_input_tokens: 600_000 }))).toBeCloseTo(0.4 * 4 + 0.6 * 2.5, 9)
  })

  test('no split (no cache_creation, or one with neither count): today\'s price for every written token', () => {
    expect(requestUsd('claude-sonnet-5-5', usage(0, 0, 0, MILLION))).toBeCloseTo(2.5, 9)
    expect(requestUsd('claude-sonnet-5-5', written({}))).toBeCloseTo(2.5, 9)
    expect(requestUsd('claude-sonnet-5-5', written(null))).toBeCloseTo(2.5, 9)
    expect(requestUsd('claude-sonnet-5-5', written('1h'))).toBeCloseTo(2.5, 9)
  })

  test('only the 1-hour count is read: the rest of the written tokens is at the table price, and a count that makes no sense is no split', () => {
    // 1h given, 5m left out: what is not 1-hour is priced as before
    expect(requestUsd('claude-sonnet-5-5', written({ ephemeral_1h_input_tokens: 250_000 }))).toBeCloseTo(0.25 * 4 + 0.75 * 2.5, 9)
    // a 1-hour count above the total is cut to the total; a negative, non-number or non-finite one is no split
    expect(requestUsd('claude-sonnet-5-5', written({ ephemeral_1h_input_tokens: 5 * MILLION }))).toBeCloseTo(4, 9)
    expect(requestUsd('claude-sonnet-5-5', written({ ephemeral_1h_input_tokens: -1 }))).toBeCloseTo(2.5, 9)
    expect(requestUsd('claude-sonnet-5-5', written({ ephemeral_1h_input_tokens: '1000000' }))).toBeCloseTo(2.5, 9)
    expect(requestUsd('claude-sonnet-5-5', written({ ephemeral_1h_input_tokens: Number.NaN }))).toBeCloseTo(2.5, 9)
  })

  test('the 1-hour price follows the model\'s own input price, the tier of a tiered model included; the ledger counts the total written', () => {
    expect(requestUsd('claude-opus-5-5', written({ ephemeral_1h_input_tokens: MILLION }))).toBeCloseTo(8, 9)
    // haiku-5-5 up to 100k prompt: input 0.10, 1-hour write 0.20; above it: input 0.50, 1-hour write 1.00
    expect(requestUsd('claude-haiku-5-5', written({ ephemeral_1h_input_tokens: 50_000 }, 50_000))).toBeCloseTo((50_000 * 0.2) / MILLION, 12)
    expect(requestUsd('claude-haiku-5-5', written({ ephemeral_1h_input_tokens: 150_000 }, 150_000))).toBeCloseTo((150_000 * 1.0) / MILLION, 12)
    expect(tokensOf(written({ ephemeral_1h_input_tokens: 400_000, ephemeral_5m_input_tokens: 600_000 }))).toEqual({ in: 0, cached: 0, cache_write: MILLION, out: 0 })
  })
})

/** The runtime gives no split (a probe of the runtime), so a request's loop decides: the main thread's writes are 1-hour ones, a subagent's 5-minute ones. */
describe('cache writes with no split in the usage: the loop decides', () => {
  const writes = (split?: unknown) => ({ ...usage(0, 0, 0, MILLION), ...(split === undefined ? {} : { cache_creation: split }) })
  const MAIN = true
  const SUBAGENT = false
  // what the main thread's no-split write costs on Sonnet 5.5, whichever way MAIN_THREAD_CACHE_WRITE is set: 1-hour 4.00, 5-minute 2.50
  const mainPrice = MAIN_THREAD_CACHE_WRITE === '1h' ? 4 : 2.5

  test('MAIN_THREAD_CACHE_WRITE names the main thread\'s default lifetime: 1h or 5m', () => {
    expect(['1h', '5m']).toContain(MAIN_THREAD_CACHE_WRITE)
  })

  test('a main-thread request with no split: its writes at the 1-hour price (twice the input price)', () => {
    expect(requestUsd('claude-sonnet-5-5', writes(), MAIN)).toBeCloseTo(mainPrice, 9)
    expect(requestUsd('claude-opus-5-5', writes(), MAIN)).toBeCloseTo(MAIN_THREAD_CACHE_WRITE === '1h' ? 8 : 5, 9)
    // a split that says nothing (no counts) is no split
    expect(requestUsd('claude-sonnet-5-5', writes({}), MAIN)).toBeCloseTo(mainPrice, 9)
    expect(requestUsd('claude-sonnet-5-5', writes(null), MAIN)).toBeCloseTo(mainPrice, 9)
  })

  test('a subagent request with no split: its writes at the 5-minute price of the table', () => {
    expect(requestUsd('claude-sonnet-5-5', writes(), SUBAGENT)).toBeCloseTo(2.5, 9)
    expect(requestUsd('claude-sonnet-5-5', writes({}), SUBAGENT)).toBeCloseTo(2.5, 9)
    // and a call that says nothing of the loop is not the main thread's
    expect(requestUsd('claude-sonnet-5-5', writes())).toBeCloseTo(2.5, 9)
  })

  test('the split wins when the runtime gives one, in either loop', () => {
    const allFiveMinutes = { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: MILLION }
    const allOneHour = { ephemeral_1h_input_tokens: MILLION, ephemeral_5m_input_tokens: 0 }
    const mixed = { ephemeral_1h_input_tokens: 400_000, ephemeral_5m_input_tokens: 600_000 }

    expect(requestUsd('claude-sonnet-5-5', writes(allFiveMinutes), MAIN)).toBeCloseTo(2.5, 9)
    expect(requestUsd('claude-sonnet-5-5', writes(allFiveMinutes), SUBAGENT)).toBeCloseTo(2.5, 9)
    expect(requestUsd('claude-sonnet-5-5', writes(allOneHour), MAIN)).toBeCloseTo(4, 9)
    expect(requestUsd('claude-sonnet-5-5', writes(allOneHour), SUBAGENT)).toBeCloseTo(4, 9)
    expect(requestUsd('claude-sonnet-5-5', writes(mixed), MAIN)).toBeCloseTo(0.4 * 4 + 0.6 * 2.5, 9)
    expect(requestUsd('claude-sonnet-5-5', writes(mixed), SUBAGENT)).toBeCloseTo(0.4 * 4 + 0.6 * 2.5, 9)
    // a split with only the 5-minute count says the rest is not 1-hour
    expect(requestUsd('claude-sonnet-5-5', writes({ ephemeral_5m_input_tokens: MILLION }), MAIN)).toBeCloseTo(2.5, 9)
  })

  test('the headless summarizer (one main-thread request on haiku 4.5: 10 in, 606 out, 60,629 written, no split) costs the host\'s own $0.124298 at the 1-hour price', () => {
    const request = { input_tokens: 10, output_tokens: 606, cache_read_input_tokens: 0, cache_creation_input_tokens: 60_629 }

    // 10 × 1 + 606 × 5 + 60 629 × 2 millionths at 1-hour; × 1.25 for the writes at 5-minute: 0.078820
    expect(requestUsd('claude-haiku-4-5-20251001', request, MAIN)).toBeCloseTo(MAIN_THREAD_CACHE_WRITE === '1h' ? 0.124298 : 0.0788, MAIN_THREAD_CACHE_WRITE === '1h' ? 9 : 4)
    expect(requestUsd('claude-haiku-4-5-20251001', request, SUBAGENT)).toBeCloseTo(0.0788, 4)
  })

  test('only the written tokens are repriced: input, output and reads are the same in either loop; an unpriced model has no price in either', () => {
    const request = { ...usage(MILLION, MILLION, MILLION, 0) }

    expect(requestUsd('claude-sonnet-5-5', request, MAIN)).toBeCloseTo(2 + 10 + 0.1, 9)
    expect(requestUsd('claude-sonnet-5-5', request, SUBAGENT)).toBeCloseTo(2 + 10 + 0.1, 9)
    expect(requestUsd('claude-mystery-1', writes(), MAIN)).toBeNull()
  })
})

describe('keyPaths: the key names of a usage object, nested keys included', () => {
  test('every key, a nested one as a dotted path, values never read; an array is one key', () => {
    expect(
      keyPaths({ input_tokens: 1, cache_creation: { ephemeral_1h_input_tokens: 2, ephemeral_5m_input_tokens: 0 }, server_tool_use: { web_search_requests: 0 }, iterations: [{ a: 1 }], model: 'm' }),
    ).toEqual([
      'input_tokens',
      'cache_creation',
      'cache_creation.ephemeral_1h_input_tokens',
      'cache_creation.ephemeral_5m_input_tokens',
      'server_tool_use',
      'server_tool_use.web_search_requests',
      'iterations',
      'model',
    ])
    expect(keyPaths(null)).toEqual([])
    expect(keyPaths('text')).toEqual([])
  })

  test('it stops at a depth and a count that a runtime object cannot run past', () => {
    const deep: Record<string, unknown> = {}
    let at = deep

    for (let level = 0; level < 20; level++) {
      const next: Record<string, unknown> = {}

      at.n = next
      at = next
    }

    expect(keyPaths(deep).length).toBeLessThanOrEqual(6)
    expect(keyPaths(Object.fromEntries(Array.from({ length: 500 }, (_, at) => [`k${at}`, at]))).length).toBe(100)
  })
})

const request = (usd: number | null, agentId?: string): Request => ({
  owner: { plan: 'alpha', row: 'r1' },
  agentId,
  tokens: { in: 1, cached: 2, cache_write: 3, out: 4 },
  usd,
  at: 0,
})

const costs = (booked: { cost: number }[]) => booked.map(one => one.cost)

describe('scaleInterval: the requests of one interval sum to the host\'s change', () => {
  test('SCALE_INCLUDES_SUBAGENTS is one boolean (true until the probe says otherwise) and the tests above and in ledger.test.ts hold for either value; the bounds are 0.8 to 1.25', () => {
    expect(typeof SCALE_INCLUDES_SUBAGENTS).toBe('boolean')
    expect([SCALE_MIN, SCALE_MAX]).toEqual([0.8, 1.25])
  })

  test('SCALE_INCLUDES_SUBAGENTS true: main and subagent requests are all scaled by host change over the table sum of all of them', () => {
    const interval = scaleInterval([request(2), request(1, 'agent-1'), request(1)], 4.4, { includesSubagents: true, isFirst: false })

    expect(interval.factor).toBeCloseTo(1.1, 9)
    expect(interval.isScaled).toBe(true)
    expect(costs(interval.booked).map(cost => Number(cost.toFixed(9)))).toEqual([2.2, 1.1, 1.1])
    expect([interval.tableMain, interval.tableSub, interval.requestsMain, interval.requestsSub]).toEqual([3, 1, 2, 1])
  })

  test('SCALE_INCLUDES_SUBAGENTS false: only the main thread\'s requests are scaled, by host change over the main table sum; a subagent\'s keeps its table price', () => {
    const interval = scaleInterval([request(2), request(1, 'agent-1'), request(1)], 3.3, { includesSubagents: false, isFirst: false })

    expect(interval.factor).toBeCloseTo(1.1, 9)
    expect(interval.isScaled).toBe(true)
    expect(costs(interval.booked).map(cost => Number(cost.toFixed(9)))).toEqual([2.2, 1, 1.1])
  })

  test('no host change known (cost absent): table prices', () => {
    const interval = scaleInterval([request(2), request(1)], null, { includesSubagents: true, isFirst: false })

    expect(interval).toMatchObject({ factor: null, isScaled: false })
    expect(costs(interval.booked)).toEqual([2, 1])
  })

  test('no priced request: nothing to scale; an unpriced request books 0', () => {
    const interval = scaleInterval([request(null), request(null, 'agent-1')], 5, { includesSubagents: true, isFirst: false })

    expect(interval).toMatchObject({ factor: null, isScaled: false })
    expect(costs(interval.booked)).toEqual([0, 0])
  })

  test('a factor outside 0.8 to 1.25 scales nothing: table prices stay', () => {
    const high = scaleInterval([request(2)], 3, { includesSubagents: true, isFirst: false })
    const low = scaleInterval([request(2)], 1, { includesSubagents: true, isFirst: false })
    const edge = scaleInterval([request(2)], 2.5, { includesSubagents: true, isFirst: false })
    const edgeLow = scaleInterval([request(2)], 1.6, { includesSubagents: true, isFirst: false })

    expect(high).toMatchObject({ factor: 1.5, isScaled: false })
    expect(costs(high.booked)).toEqual([2])
    expect(low).toMatchObject({ factor: 0.5, isScaled: false })
    expect(costs(low.booked)).toEqual([2])
    expect(edge.isScaled).toBe(true)
    expect(edgeLow.isScaled).toBe(true)
  })

  test('the first interval after a load is not scaled even inside the bounds', () => {
    const interval = scaleInterval([request(2)], 2.2, { includesSubagents: true, isFirst: true })

    expect(interval.factor).toBeCloseTo(1.1, 9)
    expect(interval.isScaled).toBe(false)
    expect(costs(interval.booked)).toEqual([2])
  })

  test('with subagents out of scope and not scaled, the factor is against the main sum alone', () => {
    const interval = scaleInterval([request(2), request(1, 'agent-1')], 3, { includesSubagents: false, isFirst: false })

    expect(interval).toMatchObject({ factor: 1.5, isScaled: false })
    expect(costs(interval.booked)).toEqual([2, 1])
  })
})

const row = (task: string, status: PlanStatus, route?: string): PlanRow => ({ task, status, updated: null, ...(route === undefined ? {} : { route }) })

const plan = (anchor: string, rows: PlanRow[], extra: Partial<PlanEntry> = {}): PlanEntry => ({ anchor, name: anchor, goal: 'g', plan_file: `/plans/${anchor}.md`, in_session: true, rows, ...extra })

const INLINE = 'serial × inline · Opus — x'
const SUB = 'spawn × subagent · Sonnet — x'
const SUB_NAMED = 'spawn × subagent(harness-author) · Sonnet — x'
const HERS = 'serial × Sam · — — they do it'

describe('mainOwner: whose work the main thread\'s requests are (the plan\'s, never a row\'s)', () => {
  test('exactly one of the session\'s plans has a row In Progress: that plan\'s own share (row null), whatever the row, its route or how many rows run', () => {
    expect(mainOwner([plan('a', [row('r1', 'In Progress', INLINE), row('r2', 'Todo', INLINE)])])).toEqual({ plan: 'a', row: null })
    expect(mainOwner([plan('a', [row('r1', 'In Progress', INLINE), row('r2', 'In Progress', INLINE)])])).toEqual({ plan: 'a', row: null })
    expect(mainOwner([plan('a', [row('r1', 'In Progress', SUB), row('r2', 'In Progress', SUB_NAMED)])])).toEqual({ plan: 'a', row: null })
    expect(mainOwner([plan('a', [row('r1', 'In Progress')])])).toEqual({ plan: 'a', row: null })
  })

  test('the executor does not matter: the main session, an agent type, Sam or no route, alone or together', () => {
    const routes = [INLINE, SUB, HERS, 'spawn 1 × harness-author · Sonnet — system file edit', 'spawn 2 × general-purpose · Sonnet — x', 'serial × main session · Opus — x', 'Sam ★ — check: their approval']

    for (const route of routes) {
      expect(mainOwner([plan('p', [row('A', 'In Progress', route)])]), route).toEqual({ plan: 'p', row: null })
    }

    expect(mainOwner([plan('p', routes.map((route, at) => row(`row ${at}`, 'In Progress', route)))])).toEqual({ plan: 'p', row: null })
  })

  test('a plan with no row In Progress beside one that has: the one that has', () => {
    expect(mainOwner([plan('a', [row('r1', 'Todo', INLINE)]), plan('b', [row('b1', 'In Progress', INLINE)])])).toEqual({ plan: 'b', row: null })
  })

  test('rows In Progress in two of this session\'s plans, or none: nobody', () => {
    expect(mainOwner([plan('a', [row('r1', 'In Progress', INLINE)]), plan('b', [row('b1', 'In Progress', INLINE)])])).toBeNull()
    expect(mainOwner([plan('a', [row('r1', 'Todo', INLINE), row('r2', 'Needs Verification', INLINE), row('r3', 'Done')])])).toBeNull()
    expect(mainOwner([])).toBeNull()
  })

  test('a plan that is not this session\'s counts for nothing', () => {
    expect(mainOwner([plan('a', [row('r1', 'In Progress', INLINE)], { in_session: false })])).toBeNull()
    expect(mainOwner([plan('a', [row('r1', 'Todo')]), plan('b', [row('b1', 'In Progress', INLINE)], { in_session: false })])).toBeNull()
    expect(mainOwner([plan('a', [row('r1', 'In Progress', INLINE)]), plan('b', [row('b1', 'In Progress', INLINE)], { in_session: false })])).toEqual({ plan: 'a', row: null })
  })
})

describe('the row a subagent works on', () => {
  test('briefRow: the first line `Tracker row: "<text>"`, however the brief goes on; no other line counts', () => {
    expect(briefRow('Tracker row: "3 Count: usage ledger"\n\n## Scope\nDo it')).toBe('3 Count: usage ledger')
    expect(briefRow('\n  Tracker row: "r1"  \nmore')).toBe('r1')
    expect(briefRow('Tracker row: "say "hi" row"')).toBe('say "hi" row')
    expect(briefRow('Do it.\nTracker row: "r1"')).toBeUndefined()
    expect(briefRow('Tracker row: r1')).toBeUndefined()
    expect(briefRow('')).toBeUndefined()
  })

  test('rowOwner: a row of one of this session\'s plans, by its exact text; none, or two plans with it, is no owner', () => {
    const plans = [plan('a', [row('r1', 'Todo')]), plan('b', [row('r2', 'Todo'), row('r1', 'Todo')]), plan('c', [row('r3', 'Todo')], { in_session: false })]

    expect(rowOwner(plans, 'r2')).toEqual({ plan: 'b', row: 'r2' })
    expect(rowOwner(plans, 'r1', 'a')).toEqual({ plan: 'a', row: 'r1' })
    expect(rowOwner(plans, 'r1')).toBeNull()
    expect(rowOwner(plans, 'r3')).toBeNull()
    expect(rowOwner(plans, 'nope')).toBeNull()
  })
})

describe('ledgerNames: the files a session may write, in the order the plugin tries them', () => {
  test('the session\'s own file first, then others of the same session id that the plugin sums too', () => {
    expect(ledgerNames('s1')).toEqual(['s1.json', 's1.recovered.json', 's1.recovered-2.json', 's1.recovered-3.json', 's1.recovered-4.json', 's1.recovered-5.json'])
    expect(ledgerNames('s1').every(name => name.endsWith('.json'))).toBe(true)
  })
})

describe('the ledger file', () => {
  const booked = (owner: Request['owner'], cost: number, at: number) => ({ ...request(cost), owner, cost, at })

  test('bookInto: a request goes to the entry of its plan and row (first and last time, counts, cost), a plan\'s own share and a row are apart, no owner goes to unowned', () => {
    const t1 = Date.parse('2026-10-18T09:30:00+09:00')
    const t2 = Date.parse('2026-10-18T11:02:00+09:00')
    const ledger = bookInto(
      emptyLedger('s1', 'terminal'),
      [booked({ plan: 'a', row: 'r1' }, 1.5, t2), booked({ plan: 'a', row: 'r1' }, 0.5, t1), booked({ plan: 'a', row: null }, 0.25, t1), booked(null, 0.125, t1)],
    )

    expect(ledger.entries).toEqual([
      { plan: 'a', row: 'r1', first: isoAt(t1), last: isoAt(t2), tokens: { in: 2, cached: 4, cache_write: 6, out: 8 }, cost_usd: 2, requests: 2 },
      { plan: 'a', row: null, first: isoAt(t1), last: isoAt(t1), tokens: { in: 1, cached: 2, cache_write: 3, out: 4 }, cost_usd: 0.25, requests: 1 },
    ])
    expect(ledger.unowned).toEqual({ tokens: { in: 1, cached: 2, cache_write: 3, out: 4 }, cost_usd: 0.125, requests: 1 })
  })

  test('ledgerText is the whole file: version 1, the session, surface, updated, measured_usd, entries and unowned; the open interval is in it at table price; with a measurement unowned cost is what the host measured less the entries', () => {
    const at = Date.parse('2026-10-18T09:30:00+09:00')
    const text = ledgerText({ ...emptyLedger('s1', 'vscode'), measured_usd: 1.23456789 }, [{ ...request(0.1234567891), owner: { plan: 'a', row: 'r1' }, at }, { ...request(null), owner: null, at }], '2026-10-18T09:31:00+09:00')

    expect(JSON.parse(text)).toEqual({
      version: 1,
      session: 's1',
      surface: 'vscode',
      updated: '2026-10-18T09:31:00+09:00',
      measured_usd: 1.234568,
      entries: [{ plan: 'a', row: 'r1', first: isoAt(at), last: isoAt(at), tokens: { in: 1, cached: 2, cache_write: 3, out: 4 }, cost_usd: 0.123457, requests: 1 }],
      // 1.23456789 less 0.1234567891: tokens and requests are counted, the cost is what no entry owns
      unowned: { tokens: { in: 1, cached: 2, cache_write: 3, out: 4 }, cost_usd: 1.111111, requests: 1 },
    })
  })

  test('without a measurement (the host keeps no cost) unowned cost is the table price of the requests nobody owns', () => {
    const at = Date.parse('2026-10-18T09:30:00+09:00')
    const text = ledgerText(emptyLedger('s1'), [{ ...request(0.5), owner: { plan: 'a', row: 'r1' }, at }, { ...request(0.25), owner: null, at }], '2026-10-18T09:31:00+09:00')

    expect(JSON.parse(text)).toMatchObject({ measured_usd: null, unowned: { cost_usd: 0.25, requests: 1 } })
  })

  test('never more than the host measured: entries and unowned cost add up to measured_usd, a request the measurement already counted adds nothing on top', () => {
    const at = Date.parse('2026-10-18T09:30:00+09:00')
    // the host measured 0.5 before the plugin saw this 0.4 request (owned) and this 0.3 one (nobody\'s): both arrive after the measurement
    const text = ledgerText({ ...emptyLedger('s1'), measured_usd: 0.5 }, [{ ...request(0.4), owner: { plan: 'a', row: 'r1' }, at }, { ...request(0.3), owner: null, at }], '2026-10-18T09:31:00+09:00')
    const file = JSON.parse(text) as { measured_usd: number; entries: { cost_usd: number }[]; unowned: { cost_usd: number; requests: number } }

    expect(file.entries.reduce((sum, one) => sum + one.cost_usd, 0) + file.unowned.cost_usd).toBeCloseTo(file.measured_usd, 9)
    expect(file.unowned).toMatchObject({ cost_usd: 0.1, requests: 1 })
  })

  test('hasEntries: a ledger has entries once one is booked or an open request has an owner; requests nobody owns are not entries', () => {
    const at = Date.parse('2026-10-18T09:30:00+09:00')
    const owned = { ...request(1), owner: { plan: 'a', row: 'r1' }, at }
    const nobodys = { ...request(1), owner: null, at }

    expect(hasEntries(emptyLedger('s1'), [])).toBe(false)
    expect(hasEntries(emptyLedger('s1'), [nobodys])).toBe(false)
    expect(hasEntries(emptyLedger('s1'), [nobodys, owned])).toBe(true)
    expect(hasEntries(bookInto(emptyLedger('s1'), [booked({ plan: 'a', row: null }, 1, at)]), [])).toBe(true)
    expect(hasEntries(bookInto(emptyLedger('s1'), [booked(null, 1, at)]), [])).toBe(false)
  })

  test('parseLedger reads what ledgerText wrote; another session, another version, damage or text that is no JSON is no ledger', () => {
    const at = Date.parse('2026-10-18T09:30:00+09:00')
    const text = ledgerText(bookInto(emptyLedger('s1', 'desktop'), [booked({ plan: 'a', row: 'r1' }, 1, at)]), [], '2026-10-18T09:31:00+09:00')
    const read = parseLedger(text, 's1')

    expect(read).toMatchObject({ version: 1, session: 's1', surface: 'desktop', measured_usd: null, entries: [{ plan: 'a', row: 'r1', cost_usd: 1, requests: 1 }] })
    expect(parseLedger(text, 's2')).toBeUndefined()
    expect(parseLedger(JSON.stringify({ ...JSON.parse(text), version: 2 }), 's1')).toBeUndefined()
    expect(parseLedger(text.slice(0, 40), 's1')).toBeUndefined()
    expect(parseLedger('not json', 's1')).toBeUndefined()

    const damaged = JSON.parse(text)

    damaged.entries[0].requests = 'x'
    expect(parseLedger(JSON.stringify(damaged), 's1')).toBeUndefined()
  })
})
