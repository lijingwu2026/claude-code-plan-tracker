import { describe, expect, test } from './testing'
import type { Engine } from 'claude-code/testing'

import { parseBoard, parseProgress, recapLabel } from '../hooks/board'
import type { PlanEntry } from '../types'
import { PANE_ID, SESSION, kids, paneProps, textOf, world } from './fixtures'

const SURFACES = ['terminal', 'desktop'] as const

const RECAP = 'The CSV export is built and tested. The review of the copy is next; it needs your yes before anything is pushed.'

const PLAN: PlanEntry = {
  anchor: 'csv',
  name: 'Add CSV export',
  goal: 'g',
  plan_file: '/plans/csv.md',
  started: '2026-10-11T20:08:00+09:00',
  finished: '2026-10-11T21:04:00+09:00',
  updated: '2026-10-11T21:04:00+09:00',
  rows: [
    { task: 'build it', status: 'Done', updated: null },
    { task: 'review the copy', status: 'Needs Verification', updated: null },
  ],
}

const mountPane = ($: Engine, surface: (typeof SURFACES)[number], columns = 60) =>
  $.ui.mount({ plugin: 'plan-tracker', surface, component: 'Pane', requestId: PANE_ID, props: paneProps(columns), viewport: { columns: columns + 60, rows: 50, isFullscreen: true } })

const boardOf = (plan: PlanEntry) => ({ selected: plan.anchor, message: null, plans: [plan] })

describe('the recap: reading it', () => {
  const json = (plan: Record<string, unknown>) => parseBoard(JSON.stringify({ plans: [{ anchor: 'a', rows: [], ...plan }] }))

  test('board data: `recap` and `recap_updated` of a plan are read', () => {
    const read = json({ recap: RECAP, recap_updated: '2026-10-12T14:30:00+09:00' })

    expect('board' in read && read.board.plans[0]).toMatchObject({ recap: RECAP, recap_updated: '2026-10-12T14:30:00+09:00' })
  })

  test('board data: no recap, an empty one or one that is not text is left out', () => {
    for (const recap of [undefined, null, '', 3, ['x']]) {
      const read = json({ recap, recap_updated: '2026-10-12T14:30:00+09:00' })

      expect('board' in read && read.board.plans[0]?.recap).toBeUndefined()
    }
  })

  test('board data: a recap with no time is read; a time that is not text is left out', () => {
    const read = json({ recap: RECAP, recap_updated: 5 })

    expect('board' in read && read.board.plans[0]).toMatchObject({ recap: RECAP })
    expect('board' in read && read.board.plans[0]).not.toHaveProperty('recap_updated')
  })

  const TABLE = '| task | status |\n|---|---|\n| one | Done |\n'

  test('PROGRESS.md: a `Recap: <text>` line above the table is the plan\'s recap, with no time', () => {
    const read = parseProgress(`# Plan\n\nRecap: ${RECAP}\n\n${TABLE}`, '/p/PROGRESS.md', 'p')

    expect('board' in read && read.board.plans[0]?.recap).toBe(RECAP)
    expect('board' in read && read.board.plans[0]).not.toHaveProperty('recap_updated')
  })

  test('PROGRESS.md: no Recap line, or one below the table, is no recap', () => {
    for (const text of [`# Plan\n\n${TABLE}`, `# Plan\n\n${TABLE}\nRecap: ${RECAP}\n`, `# Plan\n\nRecap:\n\n${TABLE}`]) {
      const read = parseProgress(text, '/p/PROGRESS.md', 'p')

      expect('board' in read && read.board.plans[0]?.recap).toBeUndefined()
    }
  })
})

describe('the recap: its label', () => {
  const NOW = Date.parse('2026-10-12T14:42:00+09:00')
  const label = (recap_updated: string | undefined) => recapLabel({ ...PLAN, recap: RECAP, ...(recap_updated === undefined ? {} : { recap_updated }) }, NOW)

  test('relative to now, from the ISO time as written', () => {
    expect(label('2026-10-12T14:30:00+09:00')).toBe('Recap · updated 12 min ago')
    expect(label('2026-10-12T14:41:40+09:00')).toBe('Recap · updated just now')
    expect(label('2026-10-12T11:42:00+09:00')).toBe('Recap · updated 3 h ago')
    expect(label('2026-10-09T14:42:00+09:00')).toBe('Recap · updated 3 d ago')
  })

  test('no time, a time that is not ISO, or one ahead of now: just "Recap"', () => {
    expect(label(undefined)).toBe('Recap')
    expect(label('yesterday')).toBe('Recap')
    expect(label('2026-10-12T15:30:00+09:00')).toBe('Recap')
  })
})

describe('the recap: on the board', () => {
  for (const surface of SURFACES) {
    test(`${surface}: under the plan details line, a dim label and the text wrapped to the pane`, async ($, on) => {
      world(on, { fixture: boardOf({ ...PLAN, recap: RECAP, recap_updated: '2026-10-12T14:30:00+09:00' }) })
      await $.session.start(SESSION)
      const pane = await mountPane($, surface, 40)

      expect(kids(await pane.find({ key: 'strip' })).map(node => String(node.props?.key))).toEqual(['menu', 'plan-stats', 'recap', 'divider'])

      const [label, text] = kids(await pane.find({ key: 'recap' }))

      expect(textOf(label)).toMatch(/^Recap( · updated .+)?$/)
      expect(label?.props.dimColor).toBe(true)
      expect(textOf(text)).toBe(RECAP)
      expect(text?.props.wrap).toBe('wrap')
      expect(text?.props.dimColor).toBeUndefined()
      await pane.unmount()
    })

    test(`${surface}: a recap with no time reads "Recap"; a plan with no usage still shows it under the header`, async ($, on) => {
      world(on, { fixture: boardOf({ ...PLAN, started: undefined, finished: undefined, recap: RECAP }) })
      await $.session.start(SESSION)
      const pane = await mountPane($, surface)

      expect(textOf(kids(await pane.find({ key: 'recap' }))[0])).toBe('Recap')
      await pane.unmount()
    })

    test(`${surface}: no recap draws nothing`, async ($, on) => {
      world(on, { fixture: boardOf(PLAN) })
      await $.session.start(SESSION)
      const pane = await mountPane($, surface)

      expect(await pane.find({ key: 'recap' })).toBeUndefined()
      expect(kids(await pane.find({ key: 'strip' })).map(node => String(node.props?.key))).toEqual(['menu', 'plan-stats', 'divider'])
      await pane.unmount()
    })

    test(`${surface}: a task page and the plan file do not draw the recap`, async ($, on) => {
      world(on, { fixture: boardOf({ ...PLAN, recap: RECAP }) })
      await $.session.start(SESSION)
      const pane = await mountPane($, surface)

      await pane.press({ key: 'plan-file' })
      expect(await pane.find({ key: 'recap' })).toBeUndefined()
      await pane.unmount()
    })
  }
})
