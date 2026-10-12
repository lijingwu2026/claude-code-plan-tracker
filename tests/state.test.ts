import { describe, expect, test } from './testing'
import type { Engine } from 'claude-code/testing'

import { STATE_STYLE, STYLE, bandLine, displayWidth, notStartedText, planStateOf, planStatsOf } from '../hooks/board'
import type { PlanBoard, PlanEntry, PlanRow, PlanStatus } from '../types'
import { PANE_ID, SESSION, bandProps, dayName, kids, localTime, paneProps, textOf, world } from './fixtures'

const SURFACES = ['terminal', 'desktop'] as const

const row = (status: PlanStatus): PlanRow => ({ task: `a ${status} task`, status, updated: null })

const plan = (anchor: string, name: string, statuses: PlanStatus[], extra: Partial<PlanEntry> = {}): PlanEntry => ({
  anchor,
  name,
  goal: 'g',
  plan_file: `/plans/${anchor}.md`,
  rows: statuses.map(row),
  ...extra,
})

const mountPane = ($: Engine, surface: (typeof SURFACES)[number], columns = 96) =>
  $.ui.mount({ plugin: 'plan-tracker', surface, component: 'Pane', requestId: PANE_ID, props: paneProps(columns), viewport: { columns: columns + 60, rows: 50, isFullscreen: true } })

const mountBand = ($: Engine, surface: (typeof SURFACES)[number], columns = 120) =>
  $.ui.mount({ plugin: 'plan-tracker', surface, component: 'AbovePrompt', requestId: 'band', props: bandProps(columns), viewport: { columns: columns + 5, rows: 40, isFullscreen: true } })

const boardOf = (...plans: PlanEntry[]): PlanBoard => ({ selected: plans[0]?.anchor ?? null, message: null, plans })

describe('the plan state', () => {
  test('In progress: the plan is open and a row is In Progress or Verifying', () => {
    expect(planStateOf(plan('a', 'A', ['Todo', 'In Progress']))).toBe('In progress')
    expect(planStateOf(plan('a', 'A', ['Needs Verification', 'Verifying']))).toBe('In progress')
  })

  test('Idle: open and nothing running, including a plan nobody started', () => {
    expect(planStateOf(plan('a', 'A', ['Todo', 'Todo']))).toBe('Idle')
    expect(planStateOf(plan('a', 'A', ['Done', 'Needs Verification']))).toBe('Idle')
    expect(planStateOf(plan('a', 'A', ['Blocked', 'Todo']))).toBe('Idle')
    expect(planStateOf(plan('a', 'A', []))).toBe('Idle')
  })

  test('Done: the tracker closed the plan, or every row is Done or Canceled', () => {
    expect(planStateOf(plan('a', 'A', ['Done', 'Todo'], { finished: '2026-10-11T21:04:00+09:00' }))).toBe('Done')
    expect(planStateOf(plan('a', 'A', ['Done', 'Canceled']))).toBe('Done')
    expect(planStateOf(plan('a', 'A', ['Canceled']))).toBe('Idle')
  })

  test('the colors: In progress is the In Progress lane, Idle is gray, Done is the Done lane', () => {
    expect(STATE_STYLE['In progress']).toEqual(STYLE['In Progress'])
    expect(STATE_STYLE.Idle).toEqual(STYLE.Todo)
    expect(STATE_STYLE.Done).toEqual(STYLE.Done)
  })
})

describe('"Not started yet" under the header', () => {
  const started = '2026-10-11T20:08:00+09:00'

  test('no times: only while no row has left Todo (Canceled ignored), whatever the plan\'s anchor', () => {
    for (const anchor of ['a', 'progress']) {
      expect(notStartedText(plan(anchor, 'A', ['Todo', 'Todo']))).toBe('Not started yet')
      expect(notStartedText(plan(anchor, 'A', ['Todo', 'Canceled']))).toBe('Not started yet')
      expect(notStartedText(plan(anchor, 'A', ['Canceled']))).toBe('Not started yet')
      expect(notStartedText(plan(anchor, 'A', []))).toBe('Not started yet')
    }
  })

  test('no times, a row that left Todo (In Progress, Verifying, Needs Verification, Blocked, Done, Other): nothing, so it never contradicts the In progress state word', () => {
    for (const anchor of ['a', 'progress']) {
      for (const status of ['In Progress', 'Verifying', 'Needs Verification', 'Blocked', 'Done', 'Other'] as const) {
        expect(notStartedText(plan(anchor, 'A', ['Todo', status]))).toBe('')
        expect(notStartedText(plan(anchor, 'A', ['Canceled', status]))).toBe('')
      }
    }

    expect(planStateOf(plan('a', 'A', ['Todo', 'In Progress']))).toBe('In progress')
  })

  test('a plan with a start or a finish time never reads it', () => {
    expect(notStartedText(plan('a', 'A', ['Todo'], { started }))).toBe('')
    expect(notStartedText(plan('a', 'A', ['Todo'], { finished: started }))).toBe('')
  })
})

describe('the plan stats have no state', () => {
  test('a never-started plan reads "Not started yet" and has no stats; a started one has stats with no state word and no running time', () => {
    const started = '2026-10-11T20:08:00+09:00'
    const now = Date.parse('2026-10-11T21:00:00+09:00')

    expect(notStartedText(plan('a', 'A', ['Todo']))).toBe('Not started yet')
    expect(planStatsOf(plan('a', 'A', ['Todo']), Date.now(), 100)).toEqual([])
    expect(planStatsOf(plan('a', 'A', ['Todo'], { started, updated: '2026-10-11T20:40:00+09:00' }), now, 100).map(stat => [stat.value, stat.label])).toEqual([['20:40', 'updated']])
    expect(planStatsOf(plan('a', 'A', ['Todo'], { started }), now, 100)).toEqual([])
  })
})

describe('the state word says since when the plan is idle', () => {
  const IDLE_AT = localTime(0, 19, 40)
  const board = (idle: string | undefined) => boardOf(plan('a', 'Alpha', ['Done', 'Todo'], idle === undefined ? {} : { idle_since: idle }), plan('b', 'Beta', ['Done', 'Todo']))

  for (const surface of SURFACES) {
    test(`${surface}: the header, the band and the plan dropdown read Idle since 19:40; a plan with no idle_since reads Idle`, async ($, on) => {
      world(on, { surfaces: [surface], fixture: board(IDLE_AT) })
      await $.session.start(SESSION)
      const pane = await mountPane($, surface)
      const band = await mountBand($, surface)

      expect(textOf(await pane.find({ key: 'menu' }))).toContain('Alpha  Idle since 19:40  1/2')
      expect(textOf(await band.drawn())).toContain('Idle since 19:40')

      await pane.press({ key: 'menu:name' })

      const list = textOf(await pane.find({ key: 'menu:list' }))

      expect(list).toMatch(/Alpha\s+Idle since 19:40\s+1\/2/)
      expect(list).toMatch(/Beta\s+Idle\s+1\/2/)
      await pane.unmount()
      await band.unmount()
    })
  }

  test('terminal: another day reads the day and the time; a plan with no idle_since reads plain Idle', async ($, on) => {
    world(on, { fixture: board(localTime(2, 19, 40)) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    expect(textOf(await pane.find({ key: 'menu' }))).toContain(`Alpha  Idle since ${dayName(2)} 19:40  1/2`)
    await pane.unmount()
  })

  test('terminal: no idle_since reads plain Idle in the header and the band', async ($, on) => {
    world(on, { fixture: board(undefined) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')
    const band = await mountBand($, 'terminal')

    expect(textOf(await pane.find({ key: 'menu' }))).toContain('Alpha  Idle  1/2')
    expect(textOf(await band.drawn())).not.toContain('since')
    await pane.unmount()
    await band.unmount()
  })
})
