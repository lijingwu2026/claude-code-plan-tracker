import { describe, expect, test } from './testing'
import type { Engine } from 'claude-code/testing'

import * as register from '../hooks/register'
import type { PlanBoard, PlanEntry } from '../types'
import type { Node } from './fixtures'
import { BOARD, FRAME_MS, PANE_ID, SESSION, paneProps, plans, textIn, textOf, world } from './fixtures'

/**
 * Why a press on the Desktop is dropped ("not every time it will open"). The engine hands every Button and every
 * Markdown link with a press a new handle each time the render hook builds its tree, and keeps only the handles of the latest tree:
 * a click that carries the handle of the tree before it is "ui_press not handled" (~/Library/Logs/Claude/claude.ai-web.log: 74
 * of them in 5 minutes against 34 handled, the pane drawn about twice a second). A render that draws what was drawn must therefore
 * hand back the tree it drew. The drawing's handles are in `pane.drawn()`, as `press: { plugin, handle }`.
 */
const { steadily } = register

const mountPane = ($: Engine, surface: 'terminal' | 'desktop', columns = 140) =>
  $.ui.mount({ plugin: 'plan-tracker', surface, component: 'Pane', requestId: PANE_ID, props: paneProps(columns), viewport: { columns: columns + 60, rows: 50, isFullscreen: true } })

type Pane = Awaited<ReturnType<typeof mountPane>>
type Raw = Node & { press?: { plugin: string; handle: number } }

const walk = (node: Raw | string | undefined): Raw[] => (node === undefined || typeof node === 'string' ? [] : [node, ...(node.children ?? []).flatMap(child => walk(child as Raw))])

/** Every pressable of the drawing with its handle: `menu:name#114162404`. */
const handlesOf = async (pane: Pane): Promise<string[]> =>
  walk((await pane.drawn()) as Raw)
    .filter(node => node.press !== undefined)
    .map(node => `${String(node.props?.key)}#${node.press?.handle}`)
    .sort()

/** The board with plan `at` changed by `change` and the others as they were. */
const withPlan = (board: PlanBoard, at: number, change: (plan: PlanEntry) => PlanEntry): PlanBoard => ({ ...board, plans: board.plans.map((plan, index) => (index === at ? change(plan) : plan)) })

/** Opens the pane with its 10 s refresh running, on a session that draws on one surface only. */
const open = async ($: Engine, on: Parameters<typeof world>[0], surface: 'terminal' | 'desktop' = 'desktop') => {
  const w = world(on, { fixture: BOARD, surfaces: [surface] })

  await $.session.start(SESSION)
  await $.command.run(plans())

  return { w, pane: await mountPane($, surface) }
}

describe('steadily: a drawing of the same data is the same tree', () => {
  test('the same data returns the tree it built before, built once; other data builds again; slots are apart', () => {
    let built = 0
    const build = (text: string) => () => ({ type: 'Text', text, built: (built += 1) })
    const first = steadily('a', { n: 1 }, build('one'))

    expect(steadily('a', { n: 1 }, build('again'))).toBe(first)
    expect(built).toBe(1)
    expect(steadily('a', { n: 2 }, build('two'))).not.toBe(first)
    expect(built).toBe(2)
    expect(steadily('b', { n: 1 }, build('other slot'))).not.toBe(first)
    expect(steadily('a', { n: 2 }, build('x'))).toMatchObject({ text: 'two' })
  })
})

describe('the pane keeps its handles while nothing it shows changes', () => {
  test('desktop: six polls in a minute that change only another plan\'s notes leave every handle as it was', async ($, on) => {
    const { w, pane } = await open($, on)
    const first = await handlesOf(pane)
    const seen = new Set([first.join(' ')])

    expect(first.some(handle => handle.startsWith('plan-file#'))).toBe(true)
    expect(first.some(handle => handle.startsWith('menu:name#'))).toBe(true)

    for (let at = 1; at <= 6; at += 1) {
      w.fixture = withPlan(BOARD, 1, plan => ({ ...plan, goal: `edited ${at} times` }))
      await w.clock.advance(10_000)
      seen.add((await handlesOf(pane)).join(' '))
    }

    // handle sets seen over the minute: one (a build per poll gave seven)
    expect(seen.size).toBe(1)
    await pane.unmount()
  })

  test('desktop: a poll whose answer shows something new draws it, with new handles', async ($, on) => {
    const { w, pane } = await open($, on)
    const first = await handlesOf(pane)

    w.fixture = withPlan(BOARD, 0, plan => ({ ...plan, rows: plan.rows.map(row => (row.task === 't3 third todo' ? { ...row, task: 't3 renamed todo' } : row)) }))
    await w.clock.advance(10_000)

    expect(await textIn(pane, await pane.find({ key: 'lane:Todo' }))).toContain('t3 renamed todo')
    expect(await handlesOf(pane)).not.toEqual(first)
    await pane.unmount()
  })

  test('desktop: a change to what another plan lists (its state or its count) is drawn too, since the plan list shows it', async ($, on) => {
    const { w, pane } = await open($, on)
    const first = await handlesOf(pane)

    w.fixture = withPlan(BOARD, 2, plan => ({ ...plan, rows: plan.rows.map(row => ({ ...row, status: 'Done' as const })) }))
    await w.clock.advance(10_000)

    expect(await handlesOf(pane)).not.toEqual(first)
    await pane.press({ key: 'menu:name' })
    expect(textOf(await pane.find({ key: 'menu:list' }))).toContain('Gamma')
    await pane.unmount()
  })

  test('desktop: a press that changes the view draws it; the same view stays as it was drawn', async ($, on) => {
    const { w, pane } = await open($, on)
    const closed = await handlesOf(pane)

    await pane.press({ key: 'menu:name' })
    await w.clock.advance(50)

    const opened = await handlesOf(pane)

    expect(opened).not.toEqual(closed)
    expect(await pane.find({ key: 'menu:list' })).toBeDefined()
    await w.clock.advance(60_000)
    expect(await handlesOf(pane)).toEqual(opened)
    await pane.unmount()
  })

  test('terminal: the frames of a running card are still drawn one by one, each with its own handles', async ($, on) => {
    const { w, pane } = await open($, on, 'terminal')
    const seen = new Set<string>()

    for (let at = 0; at < 6; at += 1) {
      await w.clock.advance(FRAME_MS)
      seen.add((await handlesOf(pane)).join(' '))
    }

    expect(seen.size).toBeGreaterThanOrEqual(5)
    await pane.unmount()
  })
})
