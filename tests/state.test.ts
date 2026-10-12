import { describe, expect, test } from './testing'
import type { Engine } from 'claude-code/testing'

import { STATE_STYLE, STYLE, bandLine, displayWidth, notStartedText, planStateOf, planStatsOf } from '../hooks/board'
import type { PlanBoard, PlanEntry, PlanRow, PlanStatus } from '../types'
import { PANE_ID, SESSION, bandProps, kids, paneProps, textOf, world } from './fixtures'

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
  test('a never-started plan reads "Not started yet" and has no stats; a started one has stats with no state word', () => {
    expect(notStartedText(plan('a', 'A', ['Todo']))).toBe('Not started yet')
    expect(planStatsOf(plan('a', 'A', ['Todo']), Date.now(), 100)).toEqual([])
    expect(planStatsOf(plan('a', 'A', ['Todo'], { started: '2026-10-11T20:08:00+09:00' }), Date.parse('2026-10-11T21:00:00+09:00'), 100).map(stat => stat.label)).toEqual(['since 20:08'])
  })
})
