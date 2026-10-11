import { describe, expect, test } from './testing'
import type { Engine } from 'claude-code/testing'

import { STATE_STYLE, STYLE, bandLine, displayWidth, planLineOf, planStateOf } from '../hooks/board'
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

describe('the plan line has no state', () => {
  test('a never-started plan reads "Not started yet"; a started one begins with "started"', () => {
    expect(planLineOf(plan('a', 'A', ['Todo']), Date.now(), 100)).toBe('Not started yet')
    expect(planLineOf(plan('a', 'A', ['Todo'], { started: '2026-10-11T20:08:00+09:00' }), Date.parse('2026-10-11T21:00:00+09:00'), 100)).toStartWith('started ')
  })
})

describe('the band line keeps the state word whole', () => {
  test('the name is cut and the word stays, at every width', () => {
    const long = plan('a', 'A very long plan name that cannot fit anywhere at all', ['In Progress', 'Todo'])

    for (const cols of [70, 60, 50]) {
      const line = bandLine(long, cols)

      expect(line.state).toBe('In progress')
      expect(line.name.endsWith('…')).toBe(true)
      expect(displayWidth(`● ${line.name} ▾ ${line.state}  ${'▰'.repeat(line.filled + line.empty)} ${line.count}  Plan file ›`)).toBeLessThanOrEqual(cols + 4)
    }
  })
})

describe('the state word on screen', () => {
  const running = plan('run', 'Running plan', ['Done', 'In Progress', 'Todo'])
  const idle = plan('idle', 'Idle plan', ['Done', 'Needs Verification', 'Todo'])
  const closed = plan('closed', 'Closed plan', ['Done', 'Done'], { finished: '2026-10-11T21:04:00+09:00' })

  for (const surface of SURFACES) {
    test(`${surface}: the header carries the word after the name, in its color`, async ($, on) => {
      world(on, { fixture: boardOf(idle, running, closed) })
      await $.session.start(SESSION)
      const ui = await mountPane($, surface)
      const header = await ui.find({ key: 'menu' })

      expect(textOf(header)).toStartWith('● Idle plan  Idle  1/3')
      expect(kids(header).find(node => textOf(node) === 'Idle')?.props.color).toBe(STATE_STYLE.Idle.color)
      await ui.unmount()
    })

    test(`${surface}: a long name is shortened and the word is not cut`, async ($, on) => {
      world(on, { fixture: boardOf(plan('run', 'A very long plan name that goes on and on and on past the header', ['In Progress', 'Todo'])) })
      await $.session.start(SESSION)
      const ui = await mountPane($, surface, 50)
      const header = textOf(await ui.find({ key: 'menu' }))

      expect(header).toContain('…  In progress  0/2')
      expect(displayWidth(header)).toBeLessThanOrEqual(50)
      await ui.unmount()
    })

    test(`${surface}: every dropdown entry carries its state word in its color`, async ($, on) => {
      world(on, { fixture: boardOf(running, idle, closed) })
      await $.session.start(SESSION)
      const ui = await mountPane($, surface)

      await ui.press({ key: 'menu:name' })
      const entries = (await ui.find({ key: 'menu:list' }))?.children ?? []

      expect(entries.map(textOf)).toEqual(['▶ Running plan  In progress 1/3', '  Idle plan     Idle        1/3', '  Closed plan   Done        2/2'])

      const colorOf = (at: number) => kids(entries[at]).find(node => /^ *(In progress|Idle|Done) *$/.test(textOf(node)))?.props.color

      expect([0, 1, 2].map(colorOf)).toEqual([STATE_STYLE['In progress'].color, STATE_STYLE.Idle.color, STATE_STYLE.Done.color])
      await ui.unmount()
    })

    test(`${surface}: the band shows the word next to the name, in its color`, async ($, on) => {
      world(on, { fixture: boardOf(running, idle) })
      await $.session.start(SESSION)
      const band = await mountBand($, surface)
      const word = (await band.findAll({ type: 'Text' })).find(node => textOf(node) === 'In progress')

      expect(word?.props.color).toBe(STATE_STYLE['In progress'].color)
      expect(textOf(await band.find({ key: 'bar' }))).toContain('Running plan ▾ In progress')
      await band.unmount()
    })

    test(`${surface}: on a narrow band the name is cut and the word stays whole`, async ($, on) => {
      world(on, { fixture: boardOf(plan('run', 'A very long plan name that goes on and on and on', ['In Progress', 'Todo']), idle) })
      await $.session.start(SESSION)
      const band = await mountBand($, surface, 60)
      const text = textOf(await band.find({ key: 'bar' }))

      expect(text).toContain('… ▾ In progress')
      await band.unmount()
    })
  }
})
