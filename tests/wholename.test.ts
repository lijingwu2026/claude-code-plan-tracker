import { describe, expect, test } from './testing'
import type { Engine } from 'claude-code/testing'

import { CAPPED, cardRows, cardView, laneWidth } from '../hooks/board'
import type { PlanBoard, PlanRow } from '../types'
import type { Node } from './fixtures'
import { BOARD, CJK_TASK, PANE_ID, SESSION, kids, openCard, paneProps, textIn, textOf, world } from './fixtures'

const SURFACES = ['terminal', 'desktop', 'vscode'] as const

const mountPane = ($: Engine, surface: (typeof SURFACES)[number], columns = 140) =>
  $.ui.mount({ plugin: 'plan-tracker', surface, component: 'Pane', requestId: PANE_ID, props: paneProps(columns), viewport: { columns: columns + 60, rows: 60, isFullscreen: true } })

const LONG = 'A long task name that cannot fit one narrow card and must be shown whole, wrapped over as many lines as it needs, with no cut and no hover box to read it in'
const GOAL = 'Make the CLI answer with the plan name, so the plans can be told apart at a glance'
const YOURS = 'serial × Sam · — — you decide'
const SONNET = 'spawn × subagent · Sonnet — cheap'

/** One of each kind of card that has a marker or a tag, with a long name and a goal each. */
const ROWS: PlanRow[] = [
  { task: `${LONG} (todo)`, status: 'Todo', updated: null, goal: GOAL, route: SONNET },
  { task: `${LONG} (running)`, status: 'In Progress', updated: null, goal: GOAL, route: SONNET, progress: '1/3' },
  { task: `${LONG} (blocked)`, status: 'Blocked', updated: null, goal: GOAL, route: 'serial × inline · Opus — settings are yours' },
  { task: `${LONG} (waits for her)`, status: 'Needs Verification', updated: null, goal: GOAL, route: YOURS },
  { task: `${LONG} (done)`, status: 'Done', updated: null, goal: GOAL },
]

const MARKER = ['', '', '⚑ Blocked · ', '◆ needs you · ', ''] as const

const boardOf = (rows: PlanRow[]): PlanBoard => ({ ...BOARD, plans: [{ ...BOARD.plans[0]!, rows }] })

/** The mascot's block characters, which a card row starts with on the terminal. */
const withoutArt = (text: string): string => text.replace(/[▀-▟]/g, '')

const noSpaces = (text: string): string => text.replace(/\s+/g, '')

/** Every element of a tree, the root first. */
const walk = (node: Node | string | undefined): Node[] => (node === undefined || typeof node === 'string' ? [] : [node, ...(node.children ?? []).flatMap(walk)])

describe('a card keeps its whole task name', () => {
  test('the name is wrapped in full at any card width: no line cap, no cut, no `…`', () => {
    for (const width of [20, 25, 34, 40, 60]) {
      for (const [at, row] of ROWS.entries()) {
        const view = cardView(row, width)
        const names = view.lines.slice(0, view.barAt === -1 ? view.lines.length : view.barAt)

        expect(noSpaces(names.join('')), `row ${at} at ${width}`).toBe(noSpaces(`${view.marker}${row.task}`))
        expect(view.lines.join('')).not.toContain('…')
      }
    }
  })

  test('a name of several lines makes the card taller by that many rows: it is not capped at two lines', () => {
    const row = ROWS[0]!
    const view = cardView(row, 34)

    expect(view.lines.length).toBeGreaterThan(4)
    expect(cardRows(row, 34)).toBe(2 + view.lines.length)
  })

  test('a CJK name wraps in full too', () => {
    const task = CJK_TASK.repeat(5)
    const view = cardView({ task, status: 'Todo', updated: null }, 24)

    expect(view.lines.length).toBeGreaterThan(3)
    expect(view.lines.join('')).toBe(task)
  })

  test('the tag keeps the last line of the name when it fits there, else a line of its own: nothing is cut for it', () => {
    const fits = cardView({ task: 'word '.repeat(9).trim(), status: 'Todo', updated: null, route: SONNET }, 40)
    const full = cardView({ task: 'y'.repeat(36), status: 'Todo', updated: null, route: SONNET }, 40)

    expect(fits.tag).toBe('Sonnet')
    expect(fits.tagAt).toBe(fits.lines.length - 1)
    expect(fits.lines[fits.tagAt]).not.toBe('')
    expect(full.lines).toEqual(['y'.repeat(36), ''])
    expect(full.tag).toBe('Sonnet')
    expect(full.tagAt).toBe(1)
  })
})

describe('the board draws every card with its whole name', () => {
  for (const surface of SURFACES) {
    test(`${surface}: each card's text holds its marker and name in full, and no \`…\``, async ($, on) => {
      world(on, { fixture: boardOf(ROWS) })
      await $.session.start(SESSION)
      const pane = await mountPane($, surface)

      for (const [at, row] of ROWS.entries()) {
        const text = withoutArt(await textIn(pane, await pane.find({ key: `cardbox:${at}` })))

        expect(noSpaces(text), `card ${at}`).toContain(noSpaces(`${MARKER[at]}${row.task}`))
        expect(text).not.toContain('…')
      }

      await pane.unmount()
    })

    test(`${surface}: the card shows no goal; the task page does`, async ($, on) => {
      world(on, { fixture: boardOf(ROWS) })
      await $.session.start(SESSION)
      const pane = await mountPane($, surface)

      for (const at of ROWS.keys()) {
        expect(await textIn(pane, await pane.find({ key: `cardbox:${at}` }))).not.toContain('Make the CLI')
      }

      if (surface === 'vscode') {
        await pane.press({ key: 'card:alpha:0' })
      } else {
        await openCard(pane as unknown as Parameters<typeof openCard>[0], 0)
      }

      expect(textOf(await pane.find({ key: 'field:goal' }))).toContain(GOAL)
      await pane.unmount()
    })
  }
})

describe('no hover box is left on the board', () => {
  for (const [surface, columns] of [['terminal', 140], ['terminal', 105], ['desktop', 140], ['desktop', 105], ['vscode', 140]] as const) {
    test(`${surface} at ${columns} columns: no element is hidden until a hover, none floats over the cards, no region reveals`, async ($, on) => {
      world(on, { fixture: boardOf(ROWS) })
      await $.session.start(SESSION)
      const pane = await mountPane($, surface, columns)
      const clients = (await pane.findAll({ type: 'Client' })).map(node => String(node.props.key))
      const inside = await Promise.all(clients.map(async key => walk({ type: 'Box', props: {}, children: kids(await pane.find({ type: 'Box', in: key })) })))
      const everything = [...walk((await pane.drawn()) as Node), ...inside.flat()]

      expect(everything.filter(node => node.props?.display === 'none')).toEqual([])
      expect(everything.filter(node => node.props?.position === 'absolute')).toEqual([])
      expect(clients.filter(key => key.startsWith('reveal:'))).toEqual([])

      for (const node of everything) {
        const hover = (node as unknown as { hover?: { display?: string; scope?: string } }).hover

        expect(hover?.display).toBeUndefined()
        expect(hover?.scope).toBeUndefined()
      }

      await pane.unmount()
    })
  }

  test('desktop: the cards are the lane\'s own children, with a row between them: no slot, no stack', async ($, on) => {
    world(on, { fixture: boardOf(ROWS.map(row => ({ ...row, status: 'Todo' }))) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop')
    const lane = await pane.find({ key: 'lane:Todo' })

    expect(kids(lane).filter(child => child.type === 'Box').map(child => String(child.props.key))).toEqual(['cardbox:0', 'cardbox:1', 'cardbox:2'])
    expect(kids(lane).at(-1)?.props.key).toBe('lane:Todo:more')
    expect(lane?.props.gap).toBe(1)
    expect(kids(lane).filter(child => child.props.position !== undefined)).toEqual([])
    expect(await pane.find({ key: 'slot:0' })).toBeUndefined()
    expect(await pane.find({ key: 'cards:Todo' })).toBeUndefined()
    await pane.unmount()
  })

  test('desktop: a card Box still lights its border under the pointer, by itself', async ($, on) => {
    world(on, { fixture: boardOf(ROWS) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop')

    const card = kids(await pane.find({ key: 'lane:Todo' })).find(child => child.props.key === 'cardbox:0')

    expect((card as unknown as { hover?: unknown }).hover).toEqual({ borderStyle: 'bold', borderDimColor: false })
    await pane.unmount()
  })
})

describe('the lanes count the rows of a wrapped card', () => {
  /** Eight Todo cards whose name takes exactly three lines in a terminal lane at 140 columns (the old cap was two). */
  const NAME = 'word '.repeat(15).trim()
  const THREE: PlanRow[] = Array.from({ length: 8 }, (): PlanRow => ({ task: NAME, status: 'Todo', updated: null }))

  test('the name takes three lines, so each card is five rows', () => {
    expect(cardView(THREE[0]!, laneWidth(140)).lines).toHaveLength(3)
    expect(cardRows(THREE[0]!, laneWidth(140))).toBe(5)
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${surface}: the lane shows ${CAPPED} cards and the count of the rest, as with short names`, async ($, on) => {
      world(on, { fixture: boardOf(THREE) })
      await $.session.start(SESSION)
      const pane = await mountPane($, surface)

      expect(kids(await pane.find({ key: 'lane:Todo' })).filter(child => String(child.props.key).startsWith('cardbox:'))).toHaveLength(CAPPED)
      expect(await pane.find({ key: 'lane:Todo:more' })).toMatchObject({ props: { label: `+${THREE.length - CAPPED} more ▾` } })
      await pane.unmount()
    })
  }

  test('terminal: an opened lane taller than the pane keeps its Show less at the bottom, counted with the wrapped rows', async ($, on) => {
    world(on, { fixture: boardOf(THREE) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    await pane.press({ key: 'lane:Todo:more' })
    // 1 header row, 8 cards of 5 rows and 1 for the bottom line is 42 rows; the pane shows 40 (with the old cap of two lines it was 34)
    expect(await pane.find({ key: 'lane:Todo:less' })).toMatchObject({ props: { label: 'Show less ▴' } })
    expect(await pane.find({ key: 'lane:Todo:more' })).toMatchObject({ props: { label: 'Show less ▴' } })
    await pane.unmount()
  })

  test('terminal: an opened lane that fits the pane has only its header Show less', async ($, on) => {
    world(on, { fixture: boardOf(THREE.map((row, at) => ({ ...row, task: `short ${at}` }))) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    await pane.press({ key: 'lane:Todo:more' })
    expect(await pane.find({ key: 'lane:Todo:less' })).toMatchObject({ props: { label: 'Show less ▴' } })
    expect(await pane.find({ key: 'lane:Todo:more' })).toBeUndefined()
    await pane.unmount()
  })
})

describe('the desktop paints no theme-key background', () => {
  test('desktop: no background on the whole board is a theme key', async ($, on) => {
    world(on, { fixture: boardOf(ROWS.map(({ progress: _bar, ...row }) => row)) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop')
    const regions = (await pane.findAll({ type: 'Client' })).map(node => String(node.props.key))
    const inside = await Promise.all(regions.map(async key => walk({ type: 'Box', props: {}, children: kids(await pane.find({ type: 'Box', in: key })) })))
    const backgrounds = [...walk((await pane.drawn()) as Node), ...inside.flat()].flatMap(node => (typeof node.props?.backgroundColor === 'string' ? [node.props.backgroundColor] : []))

    expect(backgrounds.length).toBeGreaterThan(0)
    expect(backgrounds.filter(colour => !/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(colour))).toEqual([])
    await pane.unmount()
  })
})
