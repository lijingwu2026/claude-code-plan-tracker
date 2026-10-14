import { describe, expect, test } from './testing'
import type { Engine } from 'claude-code/testing'

import { BAND_MASCOT, CHIPS, MASCOT, cardView, isStalled, movement, parseBoard, parseProgress, planStateOf, statusWords } from '../hooks/board'
import type { PlanBoard, PlanEntry, PlanRow, PlanStatus } from '../types'
import { ALPHA_ROWS, BOARD, FRAME_MS, PANE_ID, SESSION, bandProps, cardRowsIn, dayName, kids, localTime, openCard, paneProps, textOf, world } from './fixtures'

/** Today at 14:02 and three days ago at 14:02, written on this machine's clock as the tracker writes them: the screen tests read the real clock. */
const STALLED_AT = localTime(0, 14, 2)
const STALLED_BEFORE = localTime(3, 14, 2)

/** What a pure function is told is "now": later today, so STALLED_AT is today and STALLED_BEFORE is three days back. */
const NOW = Date.parse(localTime(0, 16, 30))

const row = (task: string, status: PlanStatus, stalled?: string): PlanRow => ({ task, status, updated: null, ...(stalled === undefined ? {} : { stalled_since: stalled }) })

const planOf = (...rows: PlanRow[]): PlanEntry => ({ anchor: 'p', name: 'Plan', goal: '', plan_file: '/p.md', rows })

/** BOARD with `stalled_since` (`at`) on the rows of its first plan whose task starts with one of `starts`. */
const stalledBoardAt = (at: string, ...starts: string[]): PlanBoard => ({
  ...BOARD,
  plans: BOARD.plans.map((plan, index) =>
    index === 0 ? { ...plan, rows: plan.rows.map(one => (starts.some(start => one.task.startsWith(start)) ? { ...one, stalled_since: at } : one)) } : plan,
  ),
})

const stalledBoard = (...starts: string[]): PlanBoard => stalledBoardAt(STALLED_AT, ...starts)

const BUILD = ALPHA_ROWS.findIndex(one => one.task.startsWith('Build'))

describe('stalled_since: read from the board command only', () => {
  const json = (...rows: Record<string, unknown>[]) => JSON.stringify({ selected: 'p', message: null, plans: [{ anchor: 'p', name: 'Plan', rows }] })

  test('a row\'s stalled_since is read as written; absent, null, empty and not a time are dropped', () => {
    const parsed = parseBoard(
      json(
        { task: 'a', status: 'In Progress', stalled_since: STALLED_AT },
        { task: 'b', status: 'In Progress' },
        { task: 'c', status: 'In Progress', stalled_since: null },
        { task: 'd', status: 'In Progress', stalled_since: '' },
        { task: 'e', status: 'In Progress', stalled_since: 'yesterday-ish' },
      ),
    )

    expect('board' in parsed && parsed.board.plans[0]?.rows.map(one => one.stalled_since)).toEqual([STALLED_AT, undefined, undefined, undefined, undefined])
  })

  test('a plain PROGRESS.md never has it, even with a stalled_since column', () => {
    const parsed = parseProgress('| task | status | stalled_since |\n|---|---|---|\n| a | In Progress | 2026-10-12T05:02:00Z |\n', '/work/PROGRESS.md', 'proj')
    const rows = 'board' in parsed ? parsed.board.plans[0]!.rows : []

    expect(rows).toHaveLength(1)
    expect(rows[0]).not.toHaveProperty('stalled_since')
    expect(isStalled(rows[0]!)).toBe(false)
  })
})

describe('stalled_since: what marks a row', () => {
  test('only an In Progress or Verifying row with stalled_since is stalled', () => {
    expect(isStalled(row('a', 'In Progress', STALLED_AT))).toBe(true)
    expect(isStalled(row('a', 'Verifying', STALLED_AT))).toBe(true)
    expect(isStalled(row('a', 'In Progress'))).toBe(false)
    expect(isStalled(row('a', 'Todo', STALLED_AT))).toBe(false)
    expect(isStalled(row('a', 'Needs Verification', STALLED_AT))).toBe(false)
    expect(isStalled(row('a', 'Blocked', STALLED_AT))).toBe(false)
    expect(isStalled(row('a', 'Done', STALLED_AT))).toBe(false)
  })

  test('its card tag is a grey `stalled` and the time in place of the model tag: the clock time today, the day on another day; the card keeps its mascot', () => {
    const routed = { route: 'spawn × subagent · Sonnet — a change' }
    const running = { ...row('Build it', 'In Progress'), ...routed }
    const stalled = { ...running, stalled_since: STALLED_AT }

    expect(cardView(running, 40, NOW).tag).toBe('Sonnet')
    expect(cardView(stalled, 40, NOW).tag).toBe('stalled 14:02')
    expect(cardView({ ...stalled, stalled_since: STALLED_BEFORE }, 40, NOW).tag).toBe(`stalled ${dayName(3)}`)
    expect(cardView(stalled, 40, NOW).mascot).toBe(true)
    expect(cardView({ ...stalled, status: 'Verifying' }, 40, NOW).tag).toBe('stalled 14:02')
    expect(cardView({ ...stalled, status: 'Todo' }, 40, NOW).tag).toBe('Sonnet')
    expect(CHIPS.stalled).toEqual({ bg: '#E4E2D9', fg: '#44413A' })
  })

  test('its task page reads the status, then `stalled since 14:02` today and `stalled since Oct 9 14:02` on another day', () => {
    expect(statusWords(row('a', 'In Progress', STALLED_AT), NOW)).toBe('In progress · stalled since 14:02')
    expect(statusWords(row('a', 'Verifying', localTime(0, 9, 5)), NOW)).toBe('Being checked · stalled since 09:05')
    expect(statusWords(row('a', 'In Progress', STALLED_BEFORE), NOW)).toBe(`In progress · stalled since ${dayName(3)} 14:02`)
    expect(statusWords(row('a', 'In Progress'), NOW)).toBe('In progress')
    expect(statusWords(row('a', 'Todo', STALLED_AT), NOW)).toBe('To do')
  })

  test('a stalled_since that is no clock time still marks the row, without a time', () => {
    expect(statusWords(row('a', 'In Progress', '2026-10-12 14:02'), NOW)).toBe('In progress · stalled')
    expect(cardView(row('a', 'In Progress', '2026-10-12 14:02'), 40, NOW).tag).toBe('stalled')
  })
})

describe('stalled_since: the plan', () => {
  test('the state word is Stalled when every running row is stalled, In progress while one still works', () => {
    expect(planStateOf(planOf(row('a', 'In Progress', STALLED_AT), row('b', 'Verifying', STALLED_AT), row('c', 'Todo')))).toBe('Stalled')
    expect(planStateOf(planOf(row('a', 'In Progress', STALLED_AT), row('b', 'In Progress')))).toBe('In progress')
    expect(planStateOf(planOf(row('a', 'Todo', STALLED_AT), row('b', 'Needs Verification')))).toBe('Idle')
    expect(planStateOf(planOf(row('a', 'Done'), row('b', 'Canceled')))).toBe('Done')
  })

  test('the band and the board stop moving when every running row is stalled, not before', () => {
    const view = { finished: null, isPaneUp: true, isBoard: true }

    expect(movement(planOf(row('a', 'In Progress', STALLED_AT), row('b', 'Todo')), view)).toEqual({ band: false, pane: false })
    expect(movement(planOf(row('a', 'In Progress', STALLED_AT), row('b', 'In Progress')), view)).toEqual({ band: true, pane: true })
    expect(movement(planOf(row('a', 'In Progress')), view)).toEqual({ band: true, pane: true })
  })
})

describe('stalled_since: on screen', () => {
  const mountPane = ($: Engine, surface: 'terminal' | 'desktop', columns = 140) =>
    $.ui.mount({ plugin: 'plan-tracker', surface, component: 'Pane', requestId: PANE_ID, props: paneProps(columns), viewport: { columns: 200, rows: 50, isFullscreen: true } })

  const mountBand = ($: Engine) =>
    $.ui.mount({ plugin: 'plan-tracker', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: bandProps(120), viewport: { columns: 125, rows: 40, isFullscreen: true } })

  const countFrames = (on: Parameters<typeof world>[0]) => {
    const writes = { frames: 0 }

    on('state.set', ($, e, next) => {
      if ((e as { key?: string }).key === 'frame') {
        writes.frames += 1
      }

      return next(e)
    })

    return writes
  }

  test('terminal: the stalled card has the grey tag and a mascot that stands still; the plan reads Stalled and runs no timer', async ($, on) => {
    const w = world(on, { fixture: stalledBoard('Build') })
    const writes = countFrames(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')
    const rows = await cardRowsIn(pane, BUILD)
    const art = async () => textOf((await cardRowsIn(pane, BUILD))[1]?.children[0])

    expect(textOf(rows.at(-1))).toEndWith(' stalled 14:02 ')
    expect(JSON.stringify(rows.at(-1))).toContain('"backgroundColor":"#E4E2D9"')
    expect(textOf(await pane.find({ key: 'menu' }))).toContain('Alpha plan  Stalled since 14:02')

    const before = await art()

    await w.clock.advance(FRAME_MS * 10)
    expect(before).toBe(`${MASCOT[0][1]} `)
    expect(await art()).toBe(before)
    expect(writes.frames).toBe(0)
    await pane.unmount()
  })

  test('terminal: the band says Stalled since 14:02 and its mascot has its arms down', async ($, on) => {
    const w = world(on, { fixture: stalledBoard('Build') })
    await $.session.start(SESSION)
    const band = await mountBand($)

    await w.clock.advance(FRAME_MS * 10)
    expect(textOf(await band.find({ key: 'bar' }))).toContain('Stalled since 14:02')
    expect(textOf(kids(await band.find({ key: 'bar' }))[0]).slice(0, BAND_MASCOT[0].length)).toBe(BAND_MASCOT[0])
    await band.unmount()
  })

  test('terminal: the task page reads `Status In progress · stalled since 14:02`', async ($, on) => {
    world(on, { fixture: stalledBoard('Build') })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    await openCard(pane, BUILD)
    expect(textOf(await pane.find({ key: 'field:status' })).replace(/[│╭╮╰╯├┤┬┴┼─]/g, ' ').replace(/\s+/g, ' ').trim()).toBe('Status In progress · stalled since 14:02')
    await pane.unmount()
  })

  test('terminal: the plan dropdown says Stalled since 14:02 on the stalled plan', async ($, on) => {
    world(on, { fixture: stalledBoard('Build') })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    await pane.press({ key: 'menu:name' })
    expect(textOf(await pane.find({ key: 'menu:list' }))).toContain('Alpha plan  Stalled since 14:02')
    await pane.unmount()
  })

  test('another day: the card tag reads the day, the header and the page the day and the time', async ($, on) => {
    world(on, { fixture: stalledBoardAt(STALLED_BEFORE, 'Build') })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')
    const rows = await cardRowsIn(pane, BUILD)

    expect(textOf(rows.at(-1))).toEndWith(` stalled ${dayName(3)} `)
    expect(textOf(await pane.find({ key: 'menu' }))).toContain(`Alpha plan  Stalled since ${dayName(3)} 14:02`)

    await openCard(pane, BUILD)
    expect(textOf(await pane.find({ key: 'field:status' })).replace(/[│╭╮╰╯├┤┬┴┼─]/g, ' ').replace(/\s+/g, ' ').trim()).toBe(`Status In progress · stalled since ${dayName(3)} 14:02`)
    await pane.unmount()
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${surface}: in a 108-column pane (cards 25 wide) a stalled card keeps a tag: the bare \`stalled\` where the time does not fit`, async ($, on) => {
      world(on, { fixture: stalledBoard('Build') })
      await $.session.start(SESSION)

      const narrow = await mountPane($, surface, 108)

      expect(textOf((await cardRowsIn(narrow, BUILD)).at(-1))).toEndWith(' stalled ')
      expect(textOf((await cardRowsIn(narrow, BUILD)).at(-1))).not.toContain('14:02')
      await narrow.unmount()

      const wide = await mountPane($, surface, 140)

      expect(textOf((await cardRowsIn(wide, BUILD)).at(-1))).toEndWith(' stalled 14:02 ')
      await wide.unmount()
    })
  }

  test('desktop: the stalled card\'s sprite is a still pose, not the animated one', async ($, on) => {
    world(on, { fixture: stalledBoard('Build') })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop')
    const sources = (await pane.findAll({ type: 'Svg' })).map(node => String(node.props.source))

    expect(sources.some(source => source.includes('#D77757'))).toBe(true)
    expect(sources.some(source => source.includes('#D77757') && source.includes('<animate'))).toBe(false)
    await pane.unmount()
  })

  test('a plan with one stalled and one working row still moves, and only the working card moves', async ($, on) => {
    const stalled = stalledBoard('Build')
    const board: PlanBoard = {
      ...stalled,
      plans: [{ ...stalled.plans[0]!, rows: [...stalled.plans[0]!.rows, { ...ALPHA_ROWS[6]!, task: 'Second running one' }] }, ...stalled.plans.slice(1)],
    }
    const w = world(on, { fixture: board })
    const writes = countFrames(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')
    const art = async (at: number) => textOf((await cardRowsIn(pane, at))[1]?.children[0])
    const second = board.plans[0]!.rows.length - 1

    await w.clock.advance(FRAME_MS * 3)
    expect(writes.frames).toBeGreaterThan(0)
    expect(await art(BUILD)).toBe(`${MASCOT[0][1]} `)
    expect(await art(second)).toBe(`${MASCOT[1][1]} `)
    expect(textOf(await pane.find({ key: 'menu' }))).toContain('Alpha plan  In progress')
    await pane.unmount()
  })
})
