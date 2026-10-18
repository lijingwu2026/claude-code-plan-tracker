import { describe, expect, test } from './testing'
import type { Engine } from 'claude-code/testing'

import { emptyLedger } from '../hooks/ledger'
import type { LedgerEntry, LedgerFile } from '../hooks/ledger'
import { withUsage } from '../hooks/usage'
import type { PlanBoard, PlanEntry, PlanRow } from '../types'
import { PANE_ID, ROOT, SESSION, kids, ledgerFile, ledgerPath, openCard, paneProps, textOf, world } from './fixtures'

const row = (task: string): PlanRow => ({ task, status: 'In Progress', updated: null })

const plan = (anchor: string, rows: PlanRow[]): PlanEntry => ({ anchor, name: anchor, goal: '', plan_file: `/plans/${anchor}.md`, rows })

const entry = (key: string, task: string | null, cost: number, first: string, last: string, tokens = { in: 1, cached: 2, cache_write: 3, out: 4 }, requests = 1): LedgerEntry => ({ plan: key, row: task, first, last, tokens, cost_usd: cost, requests })

const ledger = (session: string, surface: string, ...entries: LedgerEntry[]): LedgerFile => ({ ...emptyLedger(session, surface), entries })

const T = (clock: string) => `2026-10-18T${clock}:00+09:00`

/** One key per plan, as the plugin keys a board command's plans: root and anchor. */
const keyOf = (one: PlanEntry) => `${ROOT}#${one.anchor}`

const board = (...plans: PlanEntry[]): PlanBoard => ({ selected: plans[0]?.anchor ?? null, message: null, plans })

describe('summing the ledgers per plan, row and session', () => {
  const KEY = `${ROOT}#a`
  const files = [
    ledger('s1', 'terminal', entry(KEY, 'r1', 1.5, T('09:30'), T('10:00'), { in: 10, cached: 20, cache_write: 0, out: 5 }, 3), entry(KEY, null, 0.5, T('09:00'), T('09:10'), { in: 1, cached: 1, cache_write: 1, out: 1 }, 2)),
    ledger('s2', 'desktop', entry(KEY, 'r1', 2, T('08:00'), T('08:20'), { in: 100, cached: 200, cache_write: 0, out: 50 }, 4)),
  ]

  test('a row is its entries over every session: tokens, cost and requests added, one line per session by the time it first worked on the row', () => {
    const [shown] = withUsage(board(plan('a', [row('r1'), row('r2')])), { files, errors: [] }, keyOf).plans

    expect(shown?.rows[0]?.usage).toEqual({ tokens_in: 110, tokens_cached: 220, tokens_cache_write: 0, tokens_out: 55, cost_usd: 3.5, requests: 7 })
    expect(shown?.rows[0]?.sessions_usage).toEqual([
      { session: 's2', surface: 'desktop', first: T('08:00'), last: T('08:20'), tokens: { in: 100, cached: 200, cache_write: 0, out: 50 }, cost_usd: 2 },
      { session: 's1', surface: 'terminal', first: T('09:30'), last: T('10:00'), tokens: { in: 10, cached: 20, cache_write: 0, out: 5 }, cost_usd: 1.5 },
    ])
  })

  test('a row no entry names has neither usage nor sessions_usage', () => {
    const [shown] = withUsage(board(plan('a', [row('r1'), row('r2')])), { files, errors: [] }, keyOf).plans

    expect(shown?.rows[1]).not.toHaveProperty('usage')
    expect(shown?.rows[1]).not.toHaveProperty('sessions_usage')
  })

  test('a plan is its rows plus the entries with no row, and plan_own is that share alone', () => {
    const [shown] = withUsage(board(plan('a', [row('r1'), row('r2')])), { files, errors: [] }, keyOf).plans

    expect(shown?.usage_totals).toEqual({
      tokens_in: 111,
      tokens_cached: 221,
      tokens_cache_write: 1,
      tokens_out: 56,
      cost_usd: 4,
      requests: 9,
      plan_own: { tokens_in: 1, tokens_cached: 1, tokens_cache_write: 1, tokens_out: 1, cost_usd: 0.5, requests: 2 },
    })
  })

  test('a plan nothing was counted to has zero totals, so it draws no figures', () => {
    const [shown] = withUsage(board(plan('b', [row('r1')])), { files, errors: [] }, keyOf).plans
    const zero = { tokens_in: 0, tokens_cached: 0, tokens_cache_write: 0, tokens_out: 0, cost_usd: 0, requests: 0 }

    expect(shown?.usage_totals).toEqual({ ...zero, plan_own: zero })
  })

  test('two rows of one plan with the same text show the same figures and are counted once in the plan', () => {
    const [shown] = withUsage(board(plan('a', [row('r1'), row('r1')])), { files, errors: [] }, keyOf).plans

    expect(shown?.rows[0]?.usage).toEqual(shown?.rows[1]?.usage)
    expect(shown?.usage_totals?.requests).toBe(9)
  })

  test('the plan key decides: an entry of another key (another project\'s PROGRESS.md, or another project\'s plan of the same anchor) is not counted', () => {
    const others = [...files, ledger('s3', 'terminal', entry('/other/PROGRESS.md', 'r1', 9, T('07:00'), T('07:30')), entry('/other#a', 'r1', 9, T('07:00'), T('07:30')))]
    const [shown] = withUsage(board(plan('a', [row('r1')])), { files: others, errors: [] }, keyOf).plans

    expect(shown?.rows[0]?.usage?.cost_usd).toBe(3.5)
    expect(shown?.rows[0]?.sessions_usage?.map(one => one.session)).toEqual(['s2', 's1'])
  })

  test('costs are added and rounded to a millionth of a dollar', () => {
    const sums = [ledger('s1', 'terminal', entry(KEY, 'r1', 0.1, T('09:00'), T('09:01'))), ledger('s2', 'terminal', entry(KEY, 'r1', 0.2, T('09:00'), T('09:01')))]
    const [shown] = withUsage(board(plan('a', [row('r1')])), { files: sums, errors: [] }, keyOf).plans

    expect(shown?.rows[0]?.usage?.cost_usd).toBe(0.3)
  })

  test('one session\'s entries for a row are one line: the earliest first, the latest last', () => {
    const one = [ledger('s1', 'vscode', entry(KEY, 'r1', 1, T('11:00'), T('12:00')), entry(KEY, 'r1', 1, T('09:00'), T('10:00')))]
    const [shown] = withUsage(board(plan('a', [row('r1')])), { files: one, errors: [] }, keyOf).plans

    expect(shown?.rows[0]?.sessions_usage).toEqual([{ session: 's1', surface: 'vscode', first: T('09:00'), last: T('12:00'), tokens: { in: 2, cached: 4, cache_write: 6, out: 8 }, cost_usd: 2 }])
  })

  test('ledger_errors names the sessions that could not be read, and is absent when every one was', () => {
    expect(withUsage(board(plan('a', [row('r1')])), { files, errors: ['bad-1', 'bad-2'] }, keyOf).ledger_errors).toEqual(['bad-1', 'bad-2'])
    expect(withUsage(board(plan('a', [row('r1')])), { files, errors: [] }, keyOf)).not.toHaveProperty('ledger_errors')
  })

  test('the rest of the board is as it was', () => {
    const was = board(plan('a', [row('r1')]))
    const now = withUsage(was, { files, errors: [] }, keyOf)

    expect(now.selected).toBe(was.selected)
    expect(now.message).toBe(was.message)
    expect(now.plans[0]?.rows[0]).toMatchObject(was.plans[0]!.rows[0]!)
    expect(now.plans[0]).toMatchObject({ anchor: 'a', name: 'a' })
  })
})

describe('reading the ledger directory: only what changed', () => {
  const FILE = `${ROOT}/PROGRESS.md`
  const FILE_MODE = { options: { board_command: '', your_name: '' } }
  const TABLE = '# Progress\n\n| task | status |\n|---|---|\n| one | In Progress |\n| two | Todo |\n'
  const mountPane = ($: Engine) =>
    $.ui.mount({ plugin: 'plan-tracker', surface: 'terminal', component: 'Pane', requestId: PANE_ID, props: paneProps(140), viewport: { columns: 200, rows: 50, isFullscreen: true } })

  const text = (session: string, cost: number, key = FILE) => ledgerFile(session, 'terminal', [entry(key, 'one', cost, T('09:00'), T('09:30'), { in: 1000, cached: 0, cache_write: 0, out: 0 }, 2)])

  /** What the first row's page shows for its figures, or undefined for none. */
  const figures = async (pane: Awaited<ReturnType<typeof mountPane>>) => {
    await openCard(pane, 0)

    const stats = await pane.find({ key: 'detail:usage' })
    const shown = stats === undefined ? undefined : kids(stats).map(textOf).join(' / ')

    await pane.press({ key: 'back' })

    return shown
  }

  const errorLine = async (pane: Awaited<ReturnType<typeof mountPane>>) => {
    const found = await pane.find({ key: 'ledger-errors' })

    return found === undefined ? undefined : textOf(found)
  }

  test('two sessions\' files are summed for the row of a plain PROGRESS.md, and another project\'s file with a row of the same text is not', FILE_MODE, async ($, on) => {
    const w = world(on, { files: { [FILE]: TABLE }, ledgers: { [ledgerPath('s1')]: text('s1', 1), [ledgerPath('s2')]: text('s2', 2), [ledgerPath('s3')]: text('s3', 50, '/other/project/PROGRESS.md') } })

    await $.session.start(SESSION)
    await w.clock.settle()
    const pane = await mountPane($)

    expect(await figures(pane)).toContain('$3.00')
    expect(textOf(await pane.find({ key: 'plan-stats' }))).toContain('$3.00')
    await openCard(pane, 0)
    expect(textOf(await pane.find({ key: 'field:sessions' })).match(/terminal/g)).toHaveLength(2)
    await pane.unmount()
  })

  test('an unchanged file is not read again: not on the file\'s poll, and not by a refresh', FILE_MODE, async ($, on) => {
    const w = world(on, { files: { [FILE]: TABLE }, ledgers: { [ledgerPath('s1')]: text('s1', 1) } })

    await $.session.start(SESSION)
    await w.clock.settle()
    expect(w.ledgerReads).toEqual([ledgerPath('s1')])

    await w.clock.advance(7_500)
    await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })
    await w.clock.settle()
    expect(w.ledgerReads).toEqual([ledgerPath('s1')])
  })

  test('a file whose modification time moved is read again, and so is one whose size changed with the same time', FILE_MODE, async ($, on) => {
    const w = world(on, { files: { [FILE]: TABLE }, ledgers: { [ledgerPath('s1')]: text('s1', 1) } })

    await $.session.start(SESSION)
    await w.clock.settle()
    const pane = await mountPane($)

    expect(await figures(pane)).toContain('$1.00')

    // a rewrite of the same length, a new time
    w.ledgers[ledgerPath('s1')] = text('s1', 2)
    w.touch(ledgerPath('s1'))
    await w.clock.advance(1_500)
    expect(w.ledgerReads).toHaveLength(2)

    // another length, the time as it was
    w.ledgers[ledgerPath('s1')] = text('s1', 12.5)
    await w.clock.advance(1_500)
    expect(w.ledgerReads).toHaveLength(3)
    expect(await figures(pane)).toContain('$12.50')
    await pane.unmount()
  })

  test('a new file is read and a removed one forgotten', FILE_MODE, async ($, on) => {
    const w = world(on, { files: { [FILE]: TABLE }, ledgers: { [ledgerPath('s1')]: text('s1', 1), [ledgerPath('s9')]: text('s9', 0.5) } })

    await $.session.start(SESSION)
    await w.clock.settle()
    const pane = await mountPane($)

    expect(await figures(pane)).toContain('$1.50')

    w.ledgers[ledgerPath('s2')] = text('s2', 2)
    delete w.ledgers[ledgerPath('s9')]
    await w.clock.advance(1_500)
    expect(await figures(pane)).toContain('$3.00')
    expect(w.ledgerReads.filter(path => path === ledgerPath('s1'))).toHaveLength(1)
    await pane.unmount()
  })

  test('a file that fails once and parses 200 ms later is not an error: the retry reads the finished file', FILE_MODE, async ($, on) => {
    const whole = text('s1', 1)
    const w = world(on, { files: { [FILE]: TABLE }, ledgers: { [ledgerPath('s1')]: whole.slice(0, 40) } })

    await $.session.start(SESSION)
    await w.clock.settle()
    // the first read caught the writer mid-write; the file is whole by the time the retry reads it
    expect(w.ledgerReads).toHaveLength(1)
    w.ledgers[ledgerPath('s1')] = whole
    await w.clock.advance(199)
    expect(w.ledgerReads).toHaveLength(1)
    await w.clock.advance(1)

    const pane = await mountPane($)

    expect(w.ledgerReads).toHaveLength(2)
    expect(await errorLine(pane)).toBeUndefined()
    expect(await figures(pane)).toContain('$1.00')
    await pane.unmount()
  })

  test('a file that still fails is listed in ledger_errors and read again only after its size or time changes', FILE_MODE, async ($, on) => {
    const w = world(on, { files: { [FILE]: TABLE }, ledgers: { [ledgerPath('s1')]: text('s1', 1), [ledgerPath('bad')]: '{"version":1,' } })

    await $.session.start(SESSION)
    await w.clock.advance(200)

    const pane = await mountPane($)
    const readsOfBad = () => w.ledgerReads.filter(path => path === ledgerPath('bad')).length

    expect(readsOfBad()).toBe(2)
    expect(await errorLine(pane)).toBe('Usage of 1 session could not be read')
    // the rest is not held up by the one that fails
    expect(await figures(pane)).toContain('$1.00')

    // later polls and refreshes list it at once, with no read and no wait
    await w.clock.advance(7_500)
    expect(readsOfBad()).toBe(2)
    expect(await errorLine(pane)).toBe('Usage of 1 session could not be read')

    // the writer finishes: the file changed, so it is read again, once
    w.ledgers[ledgerPath('bad')] = text('bad', 2)
    w.touch(ledgerPath('bad'))
    await w.clock.advance(1_500)
    expect(readsOfBad()).toBe(3)
    expect(await errorLine(pane)).toBeUndefined()
    expect(await figures(pane)).toContain('$3.00')
    await pane.unmount()
  })

  test('a file that is a ledger of no known version, or whose entries are damaged, is unreadable too', FILE_MODE, async ($, on) => {
    const damaged = JSON.parse(text('s1', 1)) as { entries: Record<string, unknown>[] }

    damaged.entries[0]!.requests = 'x'

    const w = world(on, {
      files: { [FILE]: TABLE },
      ledgers: { [ledgerPath('v2')]: JSON.stringify({ ...JSON.parse(text('v2', 1)), version: 2 }), [ledgerPath('s1')]: JSON.stringify(damaged), [ledgerPath('ok')]: text('ok', 1) },
    })

    await $.session.start(SESSION)
    await w.clock.advance(200)

    const pane = await mountPane($)

    expect(await errorLine(pane)).toBe('Usage of 2 sessions could not be read')
    expect(await figures(pane)).toContain('$1.00')
    await pane.unmount()
  })

  test('a session\'s ledger is told by the session in the file, not by its name: a recovered file adds to the same session', FILE_MODE, async ($, on) => {
    const w = world(on, { files: { [FILE]: TABLE }, ledgers: { [ledgerPath('s1')]: text('s1', 1), [ledgerPath('s1.recovered')]: text('s1', 2) } })

    await $.session.start(SESSION)
    await w.clock.settle()
    const pane = await mountPane($)

    expect(await figures(pane)).toContain('$3.00')
    await openCard(pane, 0)
    // one session, one line
    expect(textOf(await pane.find({ key: 'field:sessions' })).match(/terminal/g)).toHaveLength(1)
    await pane.unmount()
  })

  test('no ledger directory yet: no figures and no error', FILE_MODE, async ($, on) => {
    const w = world(on, { files: { [FILE]: TABLE } })

    await $.session.start(SESSION)
    await w.clock.settle()
    const pane = await mountPane($)

    expect(await figures(pane)).toBeUndefined()
    expect(await errorLine(pane)).toBeUndefined()
    expect(await pane.find({ key: 'plan-stats' })).toBeUndefined()
    await pane.unmount()
  })
})
