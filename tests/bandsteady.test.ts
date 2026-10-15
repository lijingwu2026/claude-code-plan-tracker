import { describe, expect, test } from './testing'
import type { Engine } from 'claude-code/testing'

import { BAND_MASCOT } from '../hooks/board'
import type { PlanBoard, PlanEntry } from '../types'
import type { Node } from './fixtures'
import { BOARD, FRAME_MS, SESSION, bandProps, kids, plans, textOf, world } from './fixtures'

/**
 * The band has the pane's trouble (tests/steady.test.ts): its render hook hands every Button a new press handle each time it builds its
 * tree, the engine keeps only the latest tree's handles, and a press that carries an earlier one is "ui_press not handled". A band
 * render that draws what was drawn must hand back the tree it drew. The handles are in `band.drawn()`, as `press: { plugin, handle }`.
 */
const mountBand = ($: Engine, surface: 'terminal' | 'desktop', columns = 120) =>
  $.ui.mount({ plugin: 'plan-tracker', surface, component: 'AbovePrompt', requestId: 'band', props: bandProps(columns), viewport: { columns: columns + 5, rows: 40, isFullscreen: true } })

type Band = Awaited<ReturnType<typeof mountBand>>
type Raw = Node & { press?: { plugin: string; handle: number } }

const walk = (node: Raw | string | undefined): Raw[] => (node === undefined || typeof node === 'string' ? [] : [node, ...(node.children ?? []).flatMap(child => walk(child as Raw))])

/** Every pressable of the band with its handle: `band:plans#114162404`. */
const handlesOf = async (band: Band): Promise<string[]> =>
  walk((await band.drawn()) as Raw)
    .filter(node => node.press !== undefined)
    .map(node => `${String(node.props?.key)}#${node.press?.handle}`)
    .sort()

/** The board with plan `at` changed by `change` and the others as they were. */
const withPlan = (board: PlanBoard, at: number, change: (plan: PlanEntry) => PlanEntry): PlanBoard => ({ ...board, plans: board.plans.map((plan, index) => (index === at ? change(plan) : plan)) })

/** Opens the pane (so the 10 s refresh runs) on a session that draws on one surface only, and mounts the band. */
const open = async ($: Engine, on: Parameters<typeof world>[0], surface: 'terminal' | 'desktop' = 'desktop') => {
  const w = world(on, { fixture: BOARD, surfaces: [surface] })

  await $.session.start(SESSION)
  await $.command.run(plans())
  await w.clock.settle()

  return { w, band: await mountBand($, surface) }
}

describe('the band keeps its handles while nothing it shows changes', () => {
  test('desktop: six polls in a minute that change only another plan\'s notes leave every handle as it was', async ($, on) => {
    const { w, band } = await open($, on)
    const first = await handlesOf(band)
    const seen = new Set([first.join(' ')])

    expect(first.some(handle => handle.startsWith('band:plans#'))).toBe(true)
    expect(first.some(handle => handle.startsWith('band:file#'))).toBe(true)
    expect(first.some(handle => handle.startsWith('band:bar#'))).toBe(true)

    for (let at = 1; at <= 6; at += 1) {
      w.fixture = withPlan(BOARD, 1, plan => ({ ...plan, goal: `edited ${at} times` }))
      await w.clock.advance(10_000)
      seen.add((await handlesOf(band)).join(' '))
    }

    // handle sets seen over the minute: one (a build per poll gave seven)
    expect(seen.size).toBe(1)
    await band.unmount()
  })

  test('desktop: a poll whose answer changes what the band shows draws it, with new handles', async ($, on) => {
    const { w, band } = await open($, on)
    const first = await handlesOf(band)

    expect(textOf(await band.find({ key: 'bar' }))).toContain('5/13')
    w.fixture = withPlan(BOARD, 0, plan => ({ ...plan, rows: plan.rows.map(row => (row.task === 't3 third todo' ? { ...row, status: 'Done' as const } : row)) }))
    await w.clock.advance(10_000)

    expect(textOf(await band.find({ key: 'bar' }))).toContain('6/13')
    expect(await handlesOf(band)).not.toEqual(first)
    await band.unmount()
  })

  test('desktop: a change to what another plan lists (its count) is drawn too, since the open plan list shows it', async ($, on) => {
    const { w, band } = await open($, on)

    await band.press({ key: 'band:plans' })

    const first = await handlesOf(band)

    expect(textOf(await band.find({ key: 'band:list' }))).toContain('Gamma')
    w.fixture = withPlan(BOARD, 2, plan => ({ ...plan, rows: plan.rows.map(row => ({ ...row, status: 'Done' as const })) }))
    await w.clock.advance(10_000)

    expect(await handlesOf(band)).not.toEqual(first)
    expect(textOf(await band.find({ key: 'band:list' }))).toContain('Gamma')
    await band.unmount()
  })

  test('desktop: a press that changes the view draws it; the same view stays as it was drawn', async ($, on) => {
    const { w, band } = await open($, on)
    const closed = await handlesOf(band)

    await band.press({ key: 'band:plans' })
    await w.clock.advance(50)

    const opened = await handlesOf(band)

    expect(opened).not.toEqual(closed)
    expect(await band.find({ key: 'band:list' })).toBeDefined()
    await w.clock.advance(60_000)
    expect(await handlesOf(band)).toEqual(opened)
    await band.unmount()
  })

  test('desktop: what the hooks below draw is part of the band, and a change there is drawn', async ($, on) => {
    const { w, band } = await open($, on)
    const first = await handlesOf(band)

    // the poll that brings the new line also changes the plan list (another plan's goal), so the band is rendered
    w.below = { type: 'Text', children: ['A line from another mod'] }
    w.fixture = withPlan(BOARD, 1, plan => ({ ...plan, goal: 'edited once' }))
    await w.clock.advance(10_000)

    const second = await handlesOf(band)

    expect(textOf(await band.drawn())).toContain('A line from another mod')
    expect(second).not.toEqual(first)
    // the same line on the next poll is the same band
    w.fixture = withPlan(BOARD, 1, plan => ({ ...plan, goal: 'edited twice' }))
    await w.clock.advance(10_000)
    expect(await handlesOf(band)).toEqual(second)
    await band.unmount()
  })

  test('terminal: the band\'s mascot still moves frame by frame while a row is In Progress', async ($, on) => {
    const { w, band } = await open($, on, 'terminal')
    const poses = new Set<string>()

    for (let at = 0; at < 24; at += 1) {
      await w.clock.advance(FRAME_MS)
      poses.add(textOf(kids(await band.find({ key: 'bar' }))[0]).slice(0, BAND_MASCOT[0].length))
    }

    expect([...poses].sort()).toEqual([BAND_MASCOT[0], BAND_MASCOT[1]].sort())
    await band.unmount()
  })
})
