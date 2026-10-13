import { describe, expect, test } from './testing'
import type { Engine } from 'claude-code/testing'

import * as board from '../hooks/board'
import type { PlanBoard, PlanRow } from '../types'
import type { Node } from './fixtures'
import { BOARD, PANE_ID, SESSION, kids, paneProps, world } from './fixtures'

const mountPane = ($: Engine, surface: 'terminal' | 'desktop', columns = 140) =>
  $.ui.mount({ plugin: 'plan-tracker', surface, component: 'Pane', requestId: PANE_ID, props: paneProps(columns), viewport: { columns: columns + 60, rows: 60, isFullscreen: true } })

type Pane = Awaited<ReturnType<typeof mountPane>>

const { DESKTOP_BOX } = board

const GOAL = 'Make the CLI answer with the plan name, so the plans can be told apart at a glance'
const HERS = 'serial × Sam · — — only you can judge'

/**
 * Three cards with a hover box each (a goal), one of each kind the box colours: a plain Todo with a tag, a Blocked one (red text)
 * and one waiting on you (the "needs you" marker).
 */
const ROWS: PlanRow[] = [
  { task: 'Wire the CLI', status: 'Todo', updated: null, goal: GOAL, route: 'spawn × subagent · Sonnet — cheap' },
  { task: 'Waits for a ruling', status: 'Blocked', updated: null, goal: GOAL, route: 'serial × inline · Opus — settings are yours' },
  { task: 'Look at the prototype', status: 'Needs Verification', updated: null, goal: GOAL, route: HERS },
]

const BOARD_WITH_BOXES: PlanBoard = { ...BOARD, plans: [{ ...BOARD.plans[0]!, rows: ROWS }] }

/** The theme keys the engine lists: a colour given by one of these follows the theme (and is not a raw colour). */
const THEME_KEYS = [
  'text', 'inverseText', 'inactive', 'subtle', 'suggestion', 'remember', 'success', 'error', 'warning', 'merged', 'claude', 'permission',
  'planMode', 'autoAccept', 'promptBorder', 'bashBorder', 'ide', 'diffAdded', 'diffRemoved', 'diffAddedDimmed', 'diffRemovedDimmed', 'diffAddedWord', 'diffRemovedWord',
]

/** A raw hex colour as the desktop's colour reader takes it (3, 4, 6 or 8 digits; the chips' hex is upper case and paints, so the case does not matter). */
const RAW_HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/** Every element of a tree, the root first. */
const walk = (node: Node | string | undefined): Node[] => (node === undefined || typeof node === 'string' ? [] : [node, ...(node.children ?? []).flatMap(walk)])

/** The hidden hover boxes of the board: an absolute Box that is `display: none` until a hover. */
const boxesOf = async (pane: Pane): Promise<Node[]> =>
  (await pane.findAll({ type: 'Box' })).filter(box => box.props.position === 'absolute' && box.props.display === 'none') as Node[]

/** What the Client of the hover box of card `index` drew: every element of its rows. */
const boxContent = async (pane: Pane, index: number): Promise<Node[]> => walk({ type: 'Box', props: {}, children: kids(await pane.find({ type: 'Box', in: `reveal:${index}` })) })

const luminance = (hex: string) => {
  const channel = (at: number) => {
    const value = Number.parseInt(hex.slice(1 + at * 2, 3 + at * 2), 16) / 255

    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }

  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
}

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]

  return (hi + 0.05) / (lo + 0.05)
}

describe('the hover box is opaque on the desktop', () => {
  test('its colours are raw hex, not theme keys: the desktop paints raw backgrounds (the type chips, the tag chips, the solid progress bars) and the box was the only background that was a theme key', () => {
    for (const colour of Object.values(DESKTOP_BOX)) {
      expect(colour).toMatch(RAW_HEX)
      expect(THEME_KEYS).not.toContain(colour)
    }
  })

  test('the box is readable whatever the theme: the text, the dim goal, the red and the "needs you" marker all keep their contrast on the fill', () => {
    expect(contrast(DESKTOP_BOX.text, DESKTOP_BOX.fill)).toBeGreaterThanOrEqual(7)
    expect(contrast(DESKTOP_BOX.dim, DESKTOP_BOX.fill)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(DESKTOP_BOX.error, DESKTOP_BOX.fill)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(DESKTOP_BOX.needsYou, DESKTOP_BOX.fill)).toBeGreaterThanOrEqual(4.5)
  })

  test('desktop: each hidden box is filled with the raw colour, and so is every element its rows draw', async ($, on) => {
    world(on, { fixture: BOARD_WITH_BOXES })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop')
    const boxes = await boxesOf(pane)

    expect(boxes).toHaveLength(3)

    for (const box of boxes) {
      expect(box.props.backgroundColor).toBe(DESKTOP_BOX.fill)
    }

    for (const index of [0, 1, 2]) {
      const content = await boxContent(pane, index)
      const texts = content.filter(node => node.type === 'Text')

      expect(texts.length).toBeGreaterThan(1)

      // every text of the box is on the fill, in a colour of its own (the default text colour follows the theme and may be dark on the fill)
      for (const text of texts) {
        expect(text.props.backgroundColor).toMatch(RAW_HEX)
        expect(text.props.color).toMatch(RAW_HEX)
      }

      // the rows are filled as a whole: no gap shows what is under the box
      for (const row of kids(await pane.find({ type: 'Box', in: `reveal:${index}` }))) {
        expect(row.props.backgroundColor).toBe(DESKTOP_BOX.fill)
      }
    }

    await pane.unmount()
  })

  test('desktop: the name is in the text colour, the goal in the dim colour (not dimColor), a blocked card\'s name in red, the "needs you" marker in its own', async ($, on) => {
    world(on, { fixture: BOARD_WITH_BOXES })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop')
    const colours = async (index: number, text: string) => {
      const found = (await boxContent(pane, index)).find(node => node.type === 'Text' && JSON.stringify(node.children).includes(text))

      return found?.props
    }

    expect(await colours(0, 'Wire the CLI')).toMatchObject({ color: DESKTOP_BOX.text, backgroundColor: DESKTOP_BOX.fill })
    expect(await colours(0, 'Make the CLI')).toMatchObject({ color: DESKTOP_BOX.dim, backgroundColor: DESKTOP_BOX.fill })
    expect((await colours(0, 'Make the CLI'))?.dimColor).toBeUndefined()
    // the long name wraps over rows in the narrow box: its first words are in red
    expect(await colours(1, 'Waits for')).toMatchObject({ color: DESKTOP_BOX.error })
    expect(await colours(2, '◆ needs you')).toMatchObject({ color: DESKTOP_BOX.needsYou })
    await pane.unmount()
  })

  test('desktop: no background on the whole board is a theme key', async ($, on) => {
    world(on, { fixture: BOARD_WITH_BOXES })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop')
    const regions = (await pane.findAll({ type: 'Client' })).map(node => String(node.props.key))
    const inside = await Promise.all(regions.map(async key => walk({ type: 'Box', props: {}, children: kids(await pane.find({ type: 'Box', in: key })) })))
    const backgrounds = [...walk((await pane.drawn()) as Node), ...inside.flat()].flatMap(node => (typeof node.props?.backgroundColor === 'string' ? [node.props.backgroundColor] : []))

    expect(backgrounds.length).toBeGreaterThan(0)
    expect(backgrounds.filter(colour => !RAW_HEX.test(colour))).toEqual([])
    await pane.unmount()
  })
})

describe('the terminal\'s hover box is as it was', () => {
  test('terminal: the box and every text of its rows are filled with the theme key inverseText, in the theme\'s own text colours', async ($, on) => {
    world(on, { fixture: BOARD_WITH_BOXES })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')
    const boxes = await boxesOf(pane)

    expect(boxes).toHaveLength(3)
    expect(boxes.every(box => box.props.backgroundColor === 'inverseText')).toBe(true)

    for (const index of [0, 1, 2]) {
      const texts = (await boxContent(pane, index)).filter(node => node.type === 'Text')

      // a tag chip has its own colours; every other text is on inverseText and none is given a raw colour
      expect(texts.filter(text => text.props.backgroundColor === 'inverseText').length).toBeGreaterThan(1)
      expect(texts.every(text => text.props.color === undefined || !RAW_HEX.test(String(text.props.color)) || text.props.backgroundColor !== 'inverseText')).toBe(true)
    }

    const marker = (await boxContent(pane, 2)).find(node => node.type === 'Text' && JSON.stringify(node.children).includes('◆ needs you'))

    expect(marker?.props.color).toBe('merged')
    await pane.unmount()
  })
})
