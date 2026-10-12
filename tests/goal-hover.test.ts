import { describe, expect, test } from './testing'
import type { Engine } from 'claude-code/testing'

import { REVEAL_LEFT, cardRows, cardView, displayWidth, fullCard, hasReveal, laneWidth, wrap } from '../hooks/board'
import type { PlanBoard, PlanRow } from '../types'
import type { Node } from './fixtures'
import { ALPHA_ROWS, BOARD, PANE_ID, SESSION, cardRowsIn, kids, paneProps, textIn, textOf, world } from './fixtures'

const mountPane = ($: Engine, surface: 'terminal' | 'desktop', columns = 140) =>
  $.ui.mount({
    plugin: 'plan-tracker',
    surface,
    component: 'Pane',
    requestId: PANE_ID,
    props: paneProps(columns),
    viewport: { columns: columns + 60, rows: 50, isFullscreen: true },
  })

type Pane = Awaited<ReturnType<typeof mountPane>>

/** vscode draws no Client: a card is Buttons. */
const mountVscode = ($: Engine) =>
  $.ui.mount({ plugin: 'plan-tracker', surface: 'vscode', component: 'Pane', requestId: PANE_ID, props: paneProps(140), viewport: { columns: 200, rows: 50, isFullscreen: false } })

const WIDTH = laneWidth(140)

const GOAL = 'Show every plan and its deliverables so the person sees at a glance what the task is for'
const LONG_NAME = 'A long task name that cannot fit one narrow card and must be shown whole when the pointer is on it'

/**
 * Plan rows, by index: 0 In Progress with the mascot and a goal, 1 Todo routed to Haiku with a goal, 2 Todo with neither a goal nor
 * a cut name, 3 Todo whose name is cut and has no goal, 4 Blocked with a goal.
 */
const ROWS: PlanRow[] = [
  { ...ALPHA_ROWS[6]!, goal: GOAL },
  { ...ALPHA_ROWS[9]!, goal: GOAL },
  { ...ALPHA_ROWS[10]! },
  { ...ALPHA_ROWS[11]!, task: LONG_NAME },
  { ...ALPHA_ROWS[7]!, goal: GOAL },
]

const boardOf = (rows: PlanRow[]): PlanBoard => ({ ...BOARD, plans: [{ ...BOARD.plans[0]!, rows }] })

/** The hidden boxes of a lane's cards, in order. */
const revealsOf = async (ui: Pick<Pane, 'find'>, lane: string): Promise<Node[]> =>
  ((await ui.find({ key: `lane:${lane}` }))?.children as Node[]).filter(child => child.props.position === 'absolute')

/** The rows a card's hover box draws (its Client's region), by the card's row index. */
const boxRows = async (ui: Pane, index: number): Promise<Node[]> => kids(await ui.find({ type: 'Box', in: `reveal:${index}` }))

const isDim = (node: Node | undefined): boolean => node?.props?.dimColor === true || kids(node).some(isDim)

describe('the goal in the hover box: what the pure parts say', () => {
  test('a card whose row has a goal has a hover box; one with neither a goal nor a cut name has none', () => {
    expect(hasReveal(ROWS[1]!, WIDTH)).toBe(true)
    expect(hasReveal(ROWS[2]!, WIDTH)).toBe(false)
    expect(hasReveal(ROWS[3]!, WIDTH)).toBe(true)
    expect(cardView(ROWS[1]!, WIDTH).isCut).toBe(false)
  })

  test('an empty or blank goal is no goal', () => {
    expect(hasReveal({ ...ROWS[2]!, goal: '' }, WIDTH)).toBe(false)
    expect(hasReveal({ ...ROWS[2]!, goal: '  \n ' }, WIDTH)).toBe(false)
    expect(fullCard({ ...ROWS[2]!, goal: '  ' }, WIDTH).goal).toEqual([])
  })

  test('fullCard: the name whole, then the goal wrapped to the inside width, then the tag', () => {
    const full = fullCard(ROWS[1]!, WIDTH)
    const inner = WIDTH - 4

    expect(full.lines).toEqual(wrap(ROWS[1]!.task, inner))
    expect(full.goal).toEqual(wrap(GOAL, inner))
    expect(full.goal.length).toBeGreaterThan(1)
    expect(full.tag).toBe('Haiku')
    expect(fullCard(ROWS[2]!, WIDTH).goal).toEqual([])
  })

  test('the goal wraps to the room right of the mascot', () => {
    const full = fullCard(ROWS[0]!, WIDTH, REVEAL_LEFT)

    expect(full.goal).toEqual(wrap(GOAL, WIDTH - REVEAL_LEFT - 4))
  })

  test('whitespace in a goal is folded to single spaces', () => {
    expect(fullCard({ ...ROWS[2]!, goal: 'one\n  two   three' }, WIDTH).goal).toEqual(['one two three'])
  })
})

describe('the goal in the hover box: the terminal', () => {
  test('a card with a goal and an uncut name has a box: the name, then the goal in dim text, then the tag on a row of its own', async ($, on) => {
    world(on, { fixture: boardOf(ROWS) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')
    const rows = await boxRows(pane, 1)
    const inner = WIDTH - 4
    const nameLines = wrap(ROWS[1]!.task, inner).length
    const goalLines = wrap(GOAL, inner).length

    expect(rows).toHaveLength(nameLines + goalLines + 1)
    expect(rows.slice(0, nameLines).map(row => textOf(row).trim()).join(' ')).toBe(ROWS[1]!.task)
    expect(rows.slice(nameLines, nameLines + goalLines).map(row => textOf(row).trim()).join(' ')).toBe(GOAL)
    expect(textOf(rows.at(-1)).trim()).toBe('Haiku')
    expect(rows.slice(0, nameLines).some(isDim)).toBe(false)
    expect(rows.slice(nameLines, nameLines + goalLines).every(isDim)).toBe(true)
    expect(isDim(rows.at(-1))).toBe(false)
    await pane.unmount()
  })

  test('a long goal wraps inside the box: no row is wider than its inside and the region is as tall as its rows', async ($, on) => {
    const LONG_GOAL = `${'a goal of many words '.repeat(14)}end`

    world(on, { fixture: boardOf([{ ...ROWS[0]!, goal: LONG_GOAL }, { ...ROWS[1]!, goal: LONG_GOAL }]) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    for (const [index, left] of [[0, REVEAL_LEFT], [1, 0]] as const) {
      const rows = await boxRows(pane, index)
      const region = await pane.find({ key: `reveal:${index}` })

      expect(rows.length).toBeGreaterThan(4)

      for (const row of rows) {
        expect(displayWidth(textOf(row))).toBeLessThanOrEqual(WIDTH - left - 4)
      }

      expect(region?.props.height).toBe(rows.length)
      expect(rows.map(textOf).join('').replace(/\s+/g, '')).toContain('agoalofmanywords')
    }

    await pane.unmount()
  })

  test('a card with neither a goal nor a cut name has no box; a cut name with no goal keeps its box', async ($, on) => {
    world(on, { fixture: boardOf(ROWS) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    // Todo holds rows 1, 2 and 3: boxes for the goal card and the cut one only
    const boxes = await revealsOf(pane, 'Todo')

    expect(boxes).toHaveLength(2)
    expect(await pane.find({ key: 'reveal:2' })).toBeUndefined()
    expect(await pane.find({ key: 'reveal:1' })).toBeDefined()
    expect(await pane.find({ key: 'reveal:3' })).toBeDefined()
    // the cut card without a goal draws no goal row: its box is the name and the tag (it has none) only
    expect((await boxRows(pane, 3)).every(row => !isDim(row))).toBe(true)
    await pane.unmount()
  })

  test('the tops of the boxes stay right after a card with a box: each is the rows above its card', async ($, on) => {
    world(on, { fixture: boardOf(ROWS) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')
    const [first, third] = await revealsOf(pane, 'Todo')
    // lane order is 1, 2, 3: the header row, then each card's rows plus its two border rows
    const high = async (index: number) => (await cardRowsIn(pane, index)).length + 2

    expect(first?.props.top).toBe(1)
    expect(third?.props.top).toBe(1 + (await high(1)) + (await high(2)))
    expect(cardRows(ROWS[1]!, WIDTH)).toBe(await high(1))
    await pane.unmount()
  })

  test('the box of a running card leaves its mascot uncovered', async ($, on) => {
    world(on, { fixture: boardOf(ROWS) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')
    const [box] = await revealsOf(pane, 'In Progress')

    expect(box?.props).toMatchObject({ left: REVEAL_LEFT, width: WIDTH - REVEAL_LEFT })
    await pane.unmount()
  })

  test('a click on the box opens that card\'s own page', async ($, on) => {
    world(on, { fixture: boardOf(ROWS) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    await pane.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'reveal:1' })
    await pane.pointer({ type: 'up', x: 1, y: 0, button: 'left', in: 'reveal:1' })

    expect(await pane.find({ key: 'kanban' })).toBeUndefined()
    expect(textOf(await pane.find({ key: 'detail:title' }))).toContain(ROWS[1]!.task)
    await pane.unmount()
  })

  test('a blocked card shows its goal dim, not red, under the red name', async ($, on) => {
    world(on, { fixture: boardOf(ROWS) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')
    const rows = await boxRows(pane, 4)
    const goalRows = rows.filter(row => GOAL.split(' ').some(word => word.length > 4 && textOf(row).includes(word)))

    expect(goalRows.length).toBeGreaterThan(0)
    expect(goalRows.every(isDim)).toBe(true)
    expect(JSON.stringify(goalRows)).not.toContain('"color":"error"')
    expect(JSON.stringify(rows[0])).toContain('"color":"error"')
    await pane.unmount()
  })
})

describe('the goal in the hover box: the desktop', () => {
  test('every card with a goal, the last of its lane included, holds its hidden box at top 0 of its own slot; a card without one holds none', async ($, on) => {
    world(on, { fixture: boardOf(ROWS) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop')
    let withBox = 0

    for (const name of ['Todo', 'In Progress']) {
      const lane = kids(await pane.find({ key: `lane:${name}` }))
      const stack = lane.find(child => child.props.key === `cards:${name}`)

      expect(lane.filter(child => child.props.position === 'absolute'), `${name}: no hidden box is the lane's own child`).toEqual([])

      for (const slot of kids(stack)) {
        const index = Number(String(kids(slot)[0]?.props.key).split(':')[1])
        const hidden = kids(slot).filter(child => child.props.position === 'absolute')

        expect(hidden).toHaveLength(index === 2 ? 0 : 1)

        for (const one of hidden) {
          expect(one.props.top).toBe(0)
          withBox += 1
        }
      }
    }

    // rows 0 (goal), 1 (goal), 3 (cut name) and 4 (goal): the four boxes of those two lanes
    expect(withBox).toBe(4)
    await pane.unmount()
  })

  test('the box rows are the same shape: name, goal dim and unpadded, the tag on a row of its own', async ($, on) => {
    world(on, { fixture: boardOf(ROWS) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop')
    const rows = await boxRows(pane, 1)
    const goal = rows.filter(row => textOf(row).trim() !== '' && textOf(row) !== ' Haiku ' && !ROWS[1]!.task.includes(textOf(row)))

    expect(goal.length).toBeGreaterThan(0)
    expect(goal.every(isDim)).toBe(true)
    expect(textOf(rows.at(-1))).toBe(' Haiku ')
    expect(rows.map(textOf).filter(text => text !== text.trim() && text !== ' Haiku ')).toEqual([])
    await pane.unmount()
  })
})

describe('the goal in the hover box: a surface with no Client', () => {
  test('the box is Boxes of Text: the name, the goal dim, the tag', async ($, on) => {
    world(on, { fixture: boardOf(ROWS) })
    await $.session.start(SESSION)
    const pane = await mountVscode($)
    const [box] = await revealsOf(pane, 'Todo')
    const text = await textIn(pane, box)

    expect(await pane.findAll({ type: 'Client' })).toEqual([])
    expect(text.replace(/\s+/g, ' ')).toContain(GOAL.slice(0, 40))
    expect(isDim(box)).toBe(true)
    await pane.unmount()
  })
})
