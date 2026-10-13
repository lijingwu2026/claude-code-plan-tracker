import { describe, expect, test } from './testing'
import type { Engine } from 'claude-code/testing'

import type { PlanBoard, PlanRow } from '../types'
import { BOARD, PANE_ID, SESSION, cardRowsIn, openCard, paneProps, textOf, world } from './fixtures'

const mountPane = ($: Engine, surface: 'terminal' | 'desktop', columns = 140) =>
  $.ui.mount({ plugin: 'plan-tracker', surface, component: 'Pane', requestId: PANE_ID, props: paneProps(columns), viewport: { columns: columns + 60, rows: 60, isFullscreen: true } })

const GOAL = 'Make the CLI answer with the plan name, so the plans can be told apart at a glance'

const todo = (task: string, extra: Partial<PlanRow> = {}): PlanRow => ({ task, status: 'Todo', updated: null, ...extra })

const boardOf = (...rows: PlanRow[]): PlanBoard => ({ ...BOARD, plans: [{ ...BOARD.plans[0]!, rows }] })

describe('a row\'s goal is on its task page only', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${surface}: the card is the name and the tag, rows as tall as the name: the goal adds none`, async ($, on) => {
      world(on, { fixture: boardOf(todo('Wire the CLI', { goal: GOAL, route: 'spawn × subagent · Sonnet — cheap' }), todo('Wire the CLI', { route: 'spawn × subagent · Sonnet — cheap' })) })
      await $.session.start(SESSION)
      const pane = await mountPane($, surface)

      const [withGoal, without] = [await cardRowsIn(pane, 0), await cardRowsIn(pane, 1)]

      expect(withGoal.map(textOf)).toEqual(without.map(textOf))
      expect(withGoal.map(textOf).join('')).not.toContain('Make the CLI')
      await pane.unmount()
    })

    test(`${surface}: the task page of the card shows the goal`, async ($, on) => {
      world(on, { fixture: boardOf(todo('Wire the CLI', { goal: GOAL })) })
      await $.session.start(SESSION)
      const pane = await mountPane($, surface)

      await openCard(pane, 0)
      expect(textOf(await pane.find({ key: 'field:goal' }))).toContain(GOAL)
      await pane.unmount()
    })
  }
})
