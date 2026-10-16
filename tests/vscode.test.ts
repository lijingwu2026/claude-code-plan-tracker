import { describe, expect, test } from './testing'
import type { Engine } from 'claude-code/testing'

import { FILE_LABEL, displayWidth, planStateText } from '../hooks/board'
import { actionFor } from '../hooks/register'
import type { PlanBoard } from '../types'
import type { Node } from './fixtures'
import { ALPHA_ROWS, BOARD, PANE_ID, SESSION, bandProps, kids, paneProps, plans, textOf, world } from './fixtures'

/** The columns Cursor's Claude Code panel reported for the band's row. */
const CURSOR_COLUMNS = 59

/** A real plan's name: 56 characters, cut to a few by the terminal layout in Cursor. */
const REAL_NAME = 'Plan board → plan-tracker: Desktop fixes and public repo'

const ONE_PLAN: PlanBoard = { ...BOARD, plans: [{ ...BOARD.plans[0]!, name: REAL_NAME }] }

const TWO_PLANS: PlanBoard = { ...BOARD, plans: [{ ...BOARD.plans[0]!, name: REAL_NAME }, BOARD.plans[1]!] }

const mountBand = ($: Engine, surface: 'vscode' | 'desktop', columns = CURSOR_COLUMNS) =>
  $.ui.mount({ plugin: 'plan-tracker', surface, component: 'AbovePrompt', requestId: 'band', props: bandProps(columns), viewport: { columns: columns + 5, rows: 40, isFullscreen: false } })

const mountPane = ($: Engine, columns = 140) =>
  $.ui.mount({ plugin: 'plan-tracker', surface: 'vscode', component: 'Pane', requestId: PANE_ID, props: paneProps(columns), viewport: { columns: columns + 60, rows: 60, isFullscreen: false } })

/** Every element of a tree, the root first. */
const walk = (node: Node | string | undefined): Node[] => (node === undefined || typeof node === 'string' ? [] : [node, ...(node.children ?? []).flatMap(walk)])

/** Whether the tree holds the whole name in a Text the row cuts by the room left (`wrap="truncate"`). */
const holdsWholeName = (drawn: Node) => walk(drawn).some(node => node.type === 'Text' && node.props?.wrap === 'truncate' && textOf(node) === REAL_NAME)

/** The row Boxes of a tree: vscode wraps a row unless told not to. */
const rowsOf = (drawn: Node) => walk(drawn).filter(node => node.type === 'Box' && (node.props?.flexDirection ?? 'row') === 'row')

/** The task page's text, where the terminal layout draws its table with `│` and `─`. */
const MONOSPACE_TABLE = /[│─]/

/** Characters of proportional text Cursor fits per column it reports (measured about 2.0 on 2026-10-16; 1.8 leaves room for bold). */
const CHARS_PER_COLUMN = 1.8

/**
 * The characters the band's click text may take at `columns` reported columns: the row in characters, less the mascot (4 ch), the frame's
 * padding (2 ch), the dot and its margin (2) and "Plan file ›" with its gap.
 */
const bandRoom = (columns: number) => Math.floor(columns * CHARS_PER_COLUMN) - 4 - 2 - 2 - (2 + displayWidth(FILE_LABEL))

/** How many characters of the real name a click text starts with, before its `…`. */
const keptOfName = (text: string) => {
  let at = 0

  while (at < REAL_NAME.length && text[at] === REAL_NAME[at]) {
    at += 1
  }

  return at
}

/** What a click target reads: a link's label (its markdown unescaped) or a Button's label, no-break spaces read as spaces. */
const clickText = (node: Node | undefined): string =>
  (node?.type === 'Markdown' ? String(node.props.text).replace(/^\[(.*)\]\([^)]*\)$/s, '$1').replace(/\\(.)/g, '$1') : String(node?.props?.label ?? '')).replace(/ /g, ' ').replace(/\u2060/g, '')

/** The one link a Markdown answers. */
const hrefOf = (node: Node | undefined): string => (node?.props?.pressableLinks as string[] | undefined)?.[0] ?? ''

/** The element whose children hold the element keyed `key`. */
const parentOf = (tree: Node, key: string): Node | undefined => walk(tree).find(node => (node.children ?? []).some(child => typeof child !== 'string' && child.props?.key === key))

/** The Texts not inside another Text: each is its own box, where vscode drops a trailing space. */
const outerTexts = (node: Node | string | undefined): Node[] =>
  node === undefined || typeof node === 'string' ? [] : node.type === 'Text' ? [node] : (node.children ?? []).flatMap(outerTexts)

/** The rules every vscode drawing keeps: rows told not to wrap, no Button with a label and children, no wrapping Text ending in a space. */
const breaches = (tree: Node) => ({
  wrappingRows: rowsOf(tree).filter(node => node.props?.flexWrap !== 'nowrap').map(node => String(node.props?.key ?? '')),
  styledButtons: walk(tree).filter(node => node.type === 'Button' && node.props?.label !== undefined && (node.children ?? []).length > 0).map(node => String(node.props.key)),
  trailingSpaces: outerTexts(tree).filter(node => node.props?.wrap !== 'truncate' && textOf(node).endsWith(' ')).map(node => JSON.stringify(textOf(node))),
})

const NO_BREACH = { wrappingRows: [], styledButtons: [], trailingSpaces: [] }

const settle = async (clock: { advance: (ms: number) => Promise<void> }) => {
  for (let at = 0; at < 10; at += 1) {
    await clock.advance(10)
  }
}

/** A Done row whose note names a file. */
const NOTED: PlanBoard = {
  ...BOARD,
  plans: [{ ...BOARD.plans[0]!, rows: [{ ...ALPHA_ROWS[3]!, note: 'built it; see docs/report-2026-09-20.md' }] }, BOARD.plans[1]!],
}

describe('vscode: the band draws the Desktop layout', () => {
  test('at the width Cursor reported: the mascot is a picture, no block characters', async ($, on) => {
    world(on, { fixture: ONE_PLAN })
    await $.session.start(SESSION)
    const band = await mountBand($, 'vscode')
    const drawn = (await band.drawn()) as unknown as Node

    expect(await band.findAll({ type: 'Svg' })).not.toEqual([])
    expect(textOf(drawn)).not.toMatch(/[▀-▟]/)
    await band.unmount()
  })

  test('one row: every row Box is told not to wrap, so the name is cut at the edge and nothing drops to a second line', async ($, on) => {
    world(on, { fixture: ONE_PLAN })
    await $.session.start(SESSION)
    const band = await mountBand($, 'vscode')
    const rows = rowsOf((await band.drawn()) as unknown as Node)

    expect(rows.length).toBeGreaterThan(0)
    expect(rows.filter(node => node.props?.flexWrap !== 'nowrap')).toEqual([])
    await band.unmount()
  })

  test('the dot does not shrink; a margin, not a trailing space, follows the dot', async ($, on) => {
    world(on, { fixture: ONE_PLAN })
    await $.session.start(SESSION)
    const band = await mountBand($, 'vscode')
    const parts = kids(await band.find({ key: 'bar' }))
    const part = (key: string) => parts.find(child => child.props?.key === `band:part:${key}`)

    expect(part('dot')?.props.flexShrink).toBe(0)
    expect(walk(part('dot') as unknown as Node).some(node => node.type === 'Box' && node.props?.marginRight === 1)).toBe(true)
    expect(textOf(part('dot') as unknown as Node)).toBe('●')
    await band.unmount()
  })

  test('desktop: the band name is not cut by a count; the row cuts it by the room left', async ($, on) => {
    world(on, { fixture: ONE_PLAN })
    await $.session.start(SESSION)
    const band = await mountBand($, 'desktop')
    const drawn = (await band.drawn()) as unknown as Node

    expect(holdsWholeName(drawn)).toBe(true)
    // Desktop keeps its click zones and Ink's rows: nothing on it is told how to wrap
    expect(await band.find({ key: 'band:head' })).toBeUndefined()
    expect(rowsOf(drawn).filter(node => node.props?.flexWrap !== undefined)).toEqual([])
    await band.unmount()
  })

  test('the band\'s parts are centered in its row, so the bar picture (shorter than a line) is not drawn at the row\'s top', async ($, on) => {
    world(on, { fixture: ONE_PLAN })
    await $.session.start(SESSION)
    const band = await mountBand($, 'vscode')
    const tree = (await band.drawn()) as unknown as Node

    expect(parentOf(tree, 'band:solid')?.props.alignItems).toBe('center')
    await band.unmount()
  })
})

describe('vscode: the band\'s click targets are links, cut by count, one line', () => {
  test('one plan: "<name>" (band:head) and "<state>  n/m" (band:bar) are links within the room bandFit leaves; only the name can shrink; pressing either opens the board', async ($, on) => {
    const w = world(on, { fixture: ONE_PLAN })
    await $.session.start(SESSION)
    const band = await mountBand($, 'vscode')
    const tree = (await band.drawn()) as unknown as Node
    const head = (await band.find({ key: 'band:head' })) as unknown as Node | undefined
    const bar = (await band.find({ key: 'band:bar' })) as unknown as Node | undefined

    expect([head?.type, bar?.type]).toEqual(['Markdown', 'Markdown'])
    expect(hrefOf(head)).toBe('https://plan-tracker.invalid/band/head')
    expect(clickText(bar)).toBe(`${planStateText(ONE_PLAN.plans[0]!, Date.now())}  5/13`)
    expect(clickText(head).startsWith('Plan bo')).toBe(true)
    expect(displayWidth(clickText(head)) + 1 + displayWidth(clickText(bar))).toBeLessThanOrEqual(bandRoom(CURSOR_COLUMNS))
    // A height clamp makes the Markdown's root scroll in Cursor (a visible scrollbar); a plain space lets the text wrap under the clip.
    for (const key of ['band:head', 'band:bar']) {
      expect(parentOf(tree, key)?.props).toMatchObject({ overflow: 'hidden' })
      expect(parentOf(tree, key)?.props.height).toBeUndefined()
      expect(String((await band.find({ key }))?.props.text)).not.toContain(' ')
    }
    expect(parentOf(tree, 'band:head')?.props).toMatchObject({ flexShrink: 1, minWidth: 0 })
    expect(parentOf(tree, 'band:bar')?.props).toMatchObject({ flexShrink: 0 })
    // the count is no Button any more; the mascot and the bar take no press
    expect((await band.findAll({ type: 'Button' })).map(node => String(node.props.key))).toEqual(['band:file'])
    await band.press({ key: 'band:head', link: { href: hrefOf(head) } })
    await settle(w.clock)
    expect(w.panes.some(pane => pane.id === PANE_ID)).toBe(true)
    expect(w.diagnostics().filter(line => line.stage === 'press')).toMatchObject([{ element: 'band:head', surface: 'vscode', handled: true }])
    await band.unmount()
  })

  test('two plans: "<name> ▾" (band:plans) opens the plan list and "<state>  n/m" (band:bar) opens the board; together no wider than the room', async ($, on) => {
    const w = world(on, { fixture: TWO_PLANS })
    await $.session.start(SESSION)
    const band = await mountBand($, 'vscode')
    const tree = (await band.drawn()) as unknown as Node
    const name = (await band.find({ key: 'band:plans' })) as unknown as Node | undefined
    const bar = (await band.find({ key: 'band:bar' })) as unknown as Node | undefined

    expect([name?.type, bar?.type]).toEqual(['Markdown', 'Markdown'])
    expect(clickText(name)).not.toContain('▾')
    // the ▾ sits after the name in a Box that never shrinks, so cutting the name keeps it
    expect(((await band.find({ key: 'band:plans:mark' })) as unknown as Node | undefined)?.props).toMatchObject({ flexShrink: 0 })
    expect(clickText(name).startsWith('Plan')).toBe(true)
    expect(clickText(bar)).toBe(`${planStateText(TWO_PLANS.plans[0]!, Date.now())}  5/13`)
    expect(displayWidth(clickText(name)) + 1 + displayWidth(clickText(bar))).toBeLessThanOrEqual(bandRoom(CURSOR_COLUMNS))
    expect(parentOf(tree, 'band:plans')?.props).toMatchObject({ overflow: 'hidden', flexShrink: 1 })
    expect(parentOf(tree, 'band:bar')?.props).toMatchObject({ overflow: 'hidden', flexShrink: 0 })
    expect(parentOf(tree, 'band:plans')?.props.height).toBeUndefined()

    await band.press({ key: 'band:plans', link: { href: hrefOf(name) } })
    await settle(w.clock)
    expect(await band.find({ key: 'band:list' })).toBeDefined()
    expect(breaches((await band.drawn()) as unknown as Node)).toEqual(NO_BREACH)

    await band.press({ key: 'band:bar', link: { href: hrefOf((await band.find({ key: 'band:bar' })) as unknown as Node) } })
    await settle(w.clock)
    expect(w.panes.some(pane => pane.id === PANE_ID)).toBe(true)
    await band.unmount()
  })
})

describe('vscode: the pane draws the Desktop layout', () => {
  test('each card is its name as text and one quiet "Open ›" keyed card:<anchor>:N; the card fills its lane; a row between cards', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($)
    const boxes = (await pane.findAll({ type: 'Box' })).filter(node => String(node.props.key).startsWith('cardbox:'))

    expect(boxes.length).toBeGreaterThan(0)

    for (const box of boxes) {
      const index = Number(String(box.props.key).split(':')[1])
      const buttons = walk(box as unknown as Node).filter(node => node.type === 'Button')

      expect(textOf(box as unknown as Node), `card ${index}`).toContain(BOARD.plans[0]!.rows[index]!.task)
      expect(buttons.map(node => node.props?.key), `card ${index}`).toEqual([`card:alpha:${index}`])
      expect(buttons[0]?.props).toMatchObject({ plain: true, dimColor: true, label: 'Open ›' })
      // A width of 100% is the inside: with its border and padding the card ran into the gap between lanes
      expect(box.props.width, `card ${index}`).toBeUndefined()
    }

    expect((await pane.find({ key: 'lane:Todo' }))?.props.gap).toBe(1)
    await pane.unmount()
  })

  test('the lanes stay on one row, and every row Box is told not to wrap', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($)
    const drawn = (await pane.drawn()) as unknown as Node

    expect((await pane.find({ key: 'kanban' }))?.props).toMatchObject({ flexDirection: 'row', flexWrap: 'nowrap' })
    expect(rowsOf(drawn).filter(node => node.props?.flexWrap !== 'nowrap')).toEqual([])
    await pane.unmount()
  })

  test('from 60 columns the lanes sit side by side, each a share of the row', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 61)

    expect((await pane.find({ key: 'kanban' }))?.props.flexDirection).toBe('row')
    expect((await pane.find({ key: 'lane:Todo' }))?.props.width).toBe('24%')
    await pane.unmount()
  })

  test('a running card has the mascot as a picture beside it, and no block characters', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($)
    const index = BOARD.plans[0]!.rows.findIndex(row => row.status === 'In Progress')
    const box = (await pane.find({ key: `cardbox:${index}` })) as unknown as Node

    expect(walk(box).some(node => node.type === 'Svg')).toBe(true)
    expect(textOf(box)).not.toMatch(/[▀-▟]/)
    await pane.unmount()
  })

  test('the divider and the task page are the Desktop ones: the page has no │ or ─', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($)

    expect(textOf(await pane.find({ key: 'divider' }))).not.toMatch(MONOSPACE_TABLE)
    await pane.press({ key: 'card:alpha:2' })

    const detail = await pane.find({ key: 'detail' })

    expect(detail).toBeDefined()
    expect(textOf(detail)).not.toMatch(MONOSPACE_TABLE)
    await pane.unmount()
  })

  test('a file path in the latest note is plain text: vscode draws a file:// Link as dead text', async ($, on) => {
    const w = world(on, { fixture: NOTED })
    await $.session.start(SESSION)
    const pane = await mountPane($)

    await pane.press({ key: 'card:alpha:0' })
    await settle(w.clock)

    expect(textOf(await pane.find({ key: 'field:note' }))).toContain('docs/report-2026-09-20.md')
    expect(await pane.findAll({ type: 'Link' })).toEqual([])
    await pane.unmount()
  })
})

describe('vscode: a card is opened by its key, with no closure', () => {
  test('actionFor answers card:<anchor>:<N> and the line forms card:N and card:N:<line>', () => {
    for (const key of ['card:alpha:3', 'card:zany-herding-spring:12', 'card:3', 'card:87:2']) {
      expect(actionFor({} as never, key, 'vscode'), key).toBeDefined()
    }

    expect(actionFor({} as never, 'card:', 'vscode')).toBeUndefined()
    expect(actionFor({} as never, 'cardbox:3', 'vscode')).toBeUndefined()
  })

  test('a press on "Open ›" is run by the press hook as card:<anchor>:<N>, and the page opens', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($)

    await pane.press({ key: 'card:alpha:2' })

    expect(await pane.find({ key: 'detail' })).toBeDefined()
    expect(textOf(await pane.find({ key: 'detail' }))).toContain(BOARD.plans[0]!.rows[2]!.task)
    expect(w.diagnostics().filter(line => line.stage === 'press')).toMatchObject([{ element: 'card:alpha:2', surface: 'vscode', handled: true }])
    await pane.unmount()
  })
})

describe('vscode: the pane header', () => {
  test('two plans: the name is a quiet Button with its label only; the state and the count do not shrink; pressing the name opens the list', async ($, on) => {
    const w = world(on, { fixture: TWO_PLANS })
    await $.session.start(SESSION)
    const pane = await mountPane($, 59)

    expect(await pane.find({ key: 'menu:name' })).toMatchObject({ type: 'Button', props: { dimColor: true }, children: [] })
    expect((await pane.find({ key: 'menu:state' }))?.props.flexShrink).toBe(0)
    expect((await pane.find({ key: 'menu:count' }))?.props.flexShrink).toBe(0)
    await pane.press({ key: 'menu:name' })
    await settle(w.clock)
    expect(await pane.find({ key: 'menu:list' })).toBeDefined()
    expect(breaches((await pane.drawn()) as unknown as Node)).toEqual(NO_BREACH)
    await pane.unmount()
  })

  test('the header\'s ▾ button sits a margin away from the count', async ($, on) => {
    world(on, { fixture: TWO_PLANS })
    await $.session.start(SESSION)
    const pane = await mountPane($, 66)
    const tree = (await pane.drawn()) as unknown as Node

    expect(Number(parentOf(tree, 'menu:arrow')?.props.marginLeft ?? 0)).toBeGreaterThanOrEqual(1)
    await pane.unmount()
  })
})

describe('vscode: every drawing keeps vscode\'s rules', () => {
  test('the board with its plan list open and the task page: rows nowrap, labels only, no trailing space', async ($, on) => {
    const w = world(on, ['vscode'], { fixture: NOTED })
    await $.session.start(SESSION)
    const pane = await mountPane($, 140)

    await pane.press({ key: 'menu:name' })
    await settle(w.clock)
    expect(breaches((await pane.drawn()) as unknown as Node), 'board').toEqual(NO_BREACH)

    await pane.press({ key: 'card:alpha:0' })
    await settle(w.clock)
    expect(await pane.find({ key: 'detail' })).toBeDefined()
    expect(breaches((await pane.drawn()) as unknown as Node), 'task page').toEqual(NO_BREACH)
    await pane.unmount()
  })

  test('the plan list of /plan-tracker: its rows nowrap, its Buttons labels only, no trailing space', async ($, on) => {
    const w = world(on, ['vscode'], { fixture: BOARD })
    await $.session.start(SESSION)
    await $.command.run(plans())
    const pane = await mountPane($, 140)

    await settle(w.clock)
    expect(await pane.find({ key: 'matches:list' })).toBeDefined()
    expect(breaches((await pane.drawn()) as unknown as Node)).toEqual(NO_BREACH)
    await pane.unmount()
  })

  const BUSY: PlanBoard = {
    ...BOARD,
    plans: [
      {
        ...BOARD.plans[0]!,
        rows: [...Array.from({ length: 2 }, (_, at) => ({ ...ALPHA_ROWS[7]!, task: `stuck ${at}` })), ...Array.from({ length: 5 }, (_, at) => ({ ...ALPHA_ROWS[6]!, task: `run ${at}` })), ...ALPHA_ROWS.filter(row => row.status === 'Todo')],
      },
    ],
  }

  test('a lane\'s overflow Button reads "+N more ▾", though its long line would fit the lane', async ($, on) => {
    world(on, { fixture: BUSY })
    await $.session.start(SESSION)
    const pane = await mountPane($, 140)

    expect((await pane.find({ key: 'lane:In Progress:more' }))?.props.label).toMatch(/^\+\d+ more ▾$/)
    await pane.unmount()
  })

  test('an opened lane\'s fold Buttons read "Show less ▴", though the lane is narrow', async ($, on) => {
    const w = world(on, { fixture: BUSY })
    await $.session.start(SESSION)
    const narrow = await mountPane($, 61)

    await narrow.press({ key: 'lane:Todo:more' })
    await settle(w.clock)

    const labels = (await narrow.findAll({ type: 'Button' })).filter(node => String(node.props.key).startsWith('lane:Todo:')).map(node => node.props.label)

    expect(labels.length).toBeGreaterThan(0)
    expect(labels.every(label => label === 'Show less ▴')).toBe(true)
    await narrow.unmount()
  })

  test('at 66 columns a lane header is cut to the characters its lane fits: "In Progress 2 · 1 blocked" is whole', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 66)

    expect(textOf(await pane.find({ key: 'lane:In Progress' }))).toContain('In Progress 2 · 1 blocked')
    await pane.unmount()
  })

  test('a Verify card\'s outline is a hex colour (Cursor\'s "warning" variable can be undefined, which drops the whole border)', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 140)
    const index = BOARD.plans[0]!.rows.findIndex(row => row.status === 'Needs Verification')

    expect(String((await pane.find({ key: `cardbox:${index}` }))?.props.borderColor)).toMatch(/^#[0-9A-Fa-f]{6}$/)
    await pane.unmount()
  })

  test('the task page\'s ■ is set off by a margin, not a trailing space', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 140)

    await pane.press({ key: 'card:alpha:2' })

    const title = kids(await pane.find({ key: 'detail:title' }))

    expect(title[0]).toMatchObject({ type: 'Box', props: { marginRight: 1 } })
    expect(textOf(title[0])).toBe('■')
    await pane.unmount()
  })
})

describe('vscode: text is cut to the characters Cursor fits, not to its column count', () => {
  /** The band's and the pane's widths Cursor reported on 2026-10-16 (a panel about 880 px wide). */
  const BAND_COLUMNS = 50
  const PANE_COLUMNS = 66

  for (const [label, fixture] of [['one plan', ONE_PLAN], ['two plans', TWO_PLANS]] as const) {
    test(`band at ${BAND_COLUMNS} columns, ${label}: the click text keeps "In progress" and 30 characters of the name or more, within the room`, async ($, on) => {
      world(on, { fixture })
      await $.session.start(SESSION)
      const band = await mountBand($, 'vscode', BAND_COLUMNS)
      const name = (await band.find({ key: fixture === ONE_PLAN ? 'band:head' : 'band:plans' })) as unknown as Node
      const text = `${clickText(name)} ${clickText((await band.find({ key: 'band:bar' })) as unknown as Node)}`

      expect(text).toContain('In progress')
      expect(keptOfName(text)).toBeGreaterThanOrEqual(30)
      expect(displayWidth(text)).toBeLessThanOrEqual(bandRoom(BAND_COLUMNS))
      await band.unmount()
    })
  }

  test(`pane at ${PANE_COLUMNS} columns: the header name and the plan list's name keep 40 characters or more`, async ($, on) => {
    const w = world(on, { fixture: TWO_PLANS })
    await $.session.start(SESSION)
    const pane = await mountPane($, PANE_COLUMNS)

    expect(keptOfName(clickText((await pane.find({ key: 'menu:name' })) as unknown as Node))).toBeGreaterThanOrEqual(40)
    await pane.press({ key: 'menu:name' })
    await settle(w.clock)
    expect(keptOfName(clickText((await pane.find({ key: 'plan:alpha' })) as unknown as Node).replace(/^▶ /, ''))).toBeGreaterThanOrEqual(40)
    await pane.unmount()
  })

  test(`pane at ${PANE_COLUMNS} columns, one plan: the header's name keeps 40 characters or more`, async ($, on) => {
    world(on, { fixture: ONE_PLAN })
    await $.session.start(SESSION)
    const pane = await mountPane($, PANE_COLUMNS)

    expect(keptOfName(textOf(await pane.find({ key: 'menu' })).replace(/^●/, ''))).toBeGreaterThanOrEqual(40)
    await pane.unmount()
  })

  test('in the plan lists the name column has one fixed width, so the state and count columns line up; no partial inverse', async ($, on) => {
    const w = world(on, ['vscode'], { fixture: { ...BOARD, plans: [TWO_PLANS.plans[0]!, BOARD.plans[1]!, BOARD.plans[2]!] } })
    await $.session.start(SESSION)
    const pane = await mountPane($, PANE_COLUMNS)

    await pane.press({ key: 'menu:name' })
    await settle(w.clock)

    const lists = [(await pane.find({ key: 'menu:list' })) as unknown as Node]

    await $.command.run(plans())
    await settle(w.clock)
    lists.push((await pane.find({ key: 'matches:list' })) as unknown as Node)

    for (const list of lists) {
      const rows = kids(list)
      // the name, state and count cells (a listed plan's time follows, where it has one)
      const widths = rows.map(row => kids(row).slice(0, 3).map(cell => cell.props?.width))

      expect(rows.length, String(list?.props?.key)).toBeGreaterThan(1)
      expect(widths.every(cells => typeof cells[0] === 'number' && cells[0] > 0), String(list?.props?.key)).toBe(true)
      expect(new Set(widths.map(cells => JSON.stringify(cells))).size, String(list?.props?.key)).toBe(1)
      expect(walk(list).filter(node => node.props?.inverse === true), String(list?.props?.key)).toEqual([])
    }

    await pane.unmount()
  })
})

describe('vscode 0.7.5: the longest state text, Waiting for you since <time>', () => {
  /** A real plan name, nothing running and your check waiting: the widest state text the band draws. */
  const WAITING: PlanBoard = {
    ...BOARD,
    plans: [
      {
        ...BOARD.plans[0]!,
        name: REAL_NAME,
        idle_since: new Date(Date.now() - 60_000).toISOString(),
        rows: [ALPHA_ROWS[0]!, ALPHA_ROWS[5]!],
      },
    ],
  }

  test('one plan at the width Cursor reported: "<state>  n/m" is whole, the name gives way, and the rules hold', async ($, on) => {
    world(on, ['vscode'], { fixture: WAITING })
    await $.session.start(SESSION)
    const band = await mountBand($, 'vscode')
    const tree = (await band.drawn()) as unknown as Node
    const head = (await band.find({ key: 'band:head' })) as unknown as Node | undefined
    const bar = (await band.find({ key: 'band:bar' })) as unknown as Node | undefined
    const state = planStateText(WAITING.plans[0]!, Date.now())

    expect(state).toStartWith('Waiting for you since ')
    expect(clickText(bar)).toBe(`${state}  1/2`)
    expect(displayWidth(clickText(head)) + 1 + displayWidth(clickText(bar))).toBeLessThanOrEqual(bandRoom(CURSOR_COLUMNS))
    expect(breaches(tree)).toEqual(NO_BREACH)
    await band.unmount()
  })
})
