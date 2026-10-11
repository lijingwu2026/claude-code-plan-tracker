import { describe, expect, test } from './testing'
import type { Engine } from 'claude-code/testing'

import { MASCOT, REVEAL_LEFT, cardView, displayWidth, laneWidth, overflowLabel } from '../hooks/board'
import type { PlanBoard } from '../types'
import type { Node } from './fixtures'
import { ALPHA_ROWS, BOARD, FRAME_MS, PANE_ID, SESSION, paneProps, plans, kids, textIn, cardRowsIn, textOf, world, openCard } from './fixtures'

const SURFACES = ['terminal', 'desktop'] as const

const mountPane = ($: Engine, surface: (typeof SURFACES)[number], columns = 96) =>
  $.ui.mount({
    plugin: 'plan-tracker',
    surface,
    component: 'Pane',
    requestId: PANE_ID,
    props: paneProps(columns),
    viewport: { columns: columns + 60, rows: 50, isFullscreen: true },
  })

type Pane = Awaited<ReturnType<typeof mountPane>>

const LANES = ['Todo', 'In Progress', 'Verify', 'Done']

/** The card Boxes of a lane, in order (the lane's header, `—` and `+N more` are Text). */
/** A lane's card Boxes in drawing order; the desktop wraps each in a slot inside a reversed stack. */
const cardsOf = async (ui: Pane, lane: string): Promise<Node[]> => {
  const children = ((await ui.find({ key: `lane:${lane}` }))?.children as Node[]).flatMap(child =>
    String(child.props.key).startsWith('cards:') ? [...child.children].reverse().flatMap(slot => slot.children) : [child],
  )

  return children.filter(child => child.type === 'Box' && child.props.borderStyle === 'round' && child.props.position !== 'absolute')
}

/** The card of the row at `index` in ALPHA_ROWS: found by its first line's key. */
const cardAt = async (ui: Pane, index: number): Promise<Node> => {
  for (const lane of LANES) {
    for (const box of await cardsOf(ui, lane)) {
      if (box.props.key === `cardbox:${index}`) {
        return box
      }
    }
  }

  throw new Error(`no card ${index}`)
}

/** A card's visible rows: its children but the hidden box a hover reveals. */
const rowsOf = (box: Node): Node[] => box.children.filter(child => child.props.position !== 'absolute')

/** The Button of a card row: the row itself without a mascot, else the second child of its Box. */
const buttonOf = (row: Node | undefined): Node | undefined => (row?.type === 'Button' ? row : row?.children.find(child => child.type === 'Button'))

/** The hidden boxes of a lane's cut cards, in order. */
const revealsOf = async (ui: Pane, lane: string): Promise<Node[]> =>
  ((await ui.find({ key: `lane:${lane}` }))?.children as Node[]).filter(child => child.props.position === 'absolute')

const indexOfTask = (start: string) => ALPHA_ROWS.findIndex(one => one.task.startsWith(start))

describe('plan-tracker pane: the header', () => {
  for (const surface of SURFACES) {
    test(`${surface}: one row: ● name state n/m ▾ on the left, "Plan file ›" at the right; a dim plan line under it and no goal`, async ($, on) => {
      world(on)
      await $.session.start(SESSION)
      const ui = await mountPane($, surface)

      const header = await ui.find({ key: 'menu' })

      expect(textOf(header)).toBe('● Alpha plan  In progress  5/13 ▾Plan file ›')
      expect(kids(header).map(child => child.type)).toEqual(['Text', 'Button', 'Text', 'Text', 'Text', 'Text', 'Button', 'Box', 'Button'])
      expect(kids(header)[0]?.props.color).toBe('error')
      expect(await ui.find({ key: 'goal' })).toBeUndefined()
      expect(textOf(await ui.drawn())).not.toContain('Goal')
      expect(textOf(await ui.drawn())).not.toContain('Show every plan, then its deliverables')
      expect(await ui.find({ key: 'summary' })).toBeUndefined()
      expect(textOf(await ui.drawn())).not.toContain('Summary')
      const strip = kids(await ui.find({ key: 'strip' })).map(node => String(node.props?.key))

      expect(strip).toEqual(['menu', 'plan-stats', 'divider'])
      expect(textOf(await ui.find({ key: 'plan-stats' }))).toBe('Not started yet')
      expect(kids(await ui.find({ key: 'plan-stats' }))[0]?.props.dimColor).toBe(true)
      await ui.unmount()
    })

    test(`${surface}: the dropdown lists every plan; the open one is marked ▶`, async ($, on) => {
      world(on)
      await $.session.start(SESSION)
      const ui = await mountPane($, surface)

      await ui.press({ key: 'menu:name' })

      expect((await ui.find({ key: 'menu:list' }))?.children.map(textOf)).toEqual(['▶ Alpha plan  In progress 5/13', '  Beta        Done        2/2', '  Gamma       In progress 0/2'])
      await ui.unmount()
    })

    test(`${surface}: pressing "Plan file ›" shows the plan file's text, read from the plan file`, async ($, on) => {
      const w = world(on)
      await $.session.start(SESSION)
      const ui = await mountPane($, surface)

      await ui.press({ key: 'plan-file' })

      expect(await ui.find({ key: 'kanban' })).toBeUndefined()
      expect(textOf(await ui.find({ key: 'file' }))).toContain('# Alpha plan')
      expect(w.reads.filter(path => path.startsWith('/plans/'))).not.toEqual([])
      await ui.unmount()
    })

    test(`${surface}: a plan file that cannot be read says so and still offers Back`, async ($, on) => {
      world(on, { files: {} })
      await $.session.start(SESSION)
      const ui = await mountPane($, surface)

      await ui.press({ key: 'plan-file' })

      expect(textOf(await ui.find({ key: 'file' }))).toContain('cannot read /plans/alpha-plan.md')
      await ui.press({ key: 'back' })
      expect(await ui.find({ key: 'kanban' })).toBeDefined()
      await ui.unmount()
    })
  }

  test('tracker output that is not JSON shows one line saying so', async ($, on) => {
    world(on, { fixture: 'not json' })
    await $.session.start(SESSION)
    const ui = await mountPane($, 'terminal')

    expect(textOf(await ui.drawn())).toStartWith('plan-tracker: the board command did not print JSON')
    await ui.unmount()
  })

  test('/plans opens the pane titled Plans, with no text', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)

    const { text } = await $.command.run(plans())

    expect(text).toBeUndefined()
    expect(w.opened).toEqual([{ id: PANE_ID, title: 'Plans', focus: true, rows: 60 }])
  })

  test('the pane shows the tracker\'s one-line answer when there is no plan for the session', async ($, on) => {
    world(on, { fixture: { selected: null, message: 'No plan was written in this session.', plans: [] } })
    await $.session.start(SESSION)
    const ui = await mountPane($, 'terminal')

    expect(textOf(await ui.drawn())).toBe('No plan was written in this session.')
    await ui.unmount()
  })

  test('the empty-state line sent by the script is shown as it is, naming /plans', async ($, on) => {
    world(on, { fixture: { selected: null, message: 'No plan yet. Use `/plans <anchor>` to open a plan.', plans: [] } })
    await $.session.start(SESSION)
    const ui = await mountPane($, 'terminal')

    expect(textOf(await ui.drawn())).toBe('No plan yet. Use `/plans <anchor>` to open a plan.')
    await ui.unmount()
  })

  test('a failed run shows the one-line error, and the next good run replaces it', async ($, on) => {
    const w = world(on)
    w.tracker = { exitCode: 3, stderr: 'no registry', doesThrow: false }
    await $.session.start(SESSION)
    await $.command.run(plans())
    const ui = await mountPane($, 'terminal')

    expect(textOf(await ui.drawn())).toBe('plan-tracker: the board command exited 3: no registry')

    w.tracker = { exitCode: 0, stderr: '', doesThrow: false }
    await w.clock.advance(10_000)
    await ui.redraw()

    expect(textOf(await ui.drawn())).toContain('Alpha plan')
    await ui.unmount()
  })

  test('a script that cannot start shows one line with the reason', async ($, on) => {
    const w = world(on)
    w.tracker = { exitCode: 0, stderr: '', doesThrow: true }
    await $.session.start(SESSION)
    const ui = await mountPane($, 'terminal')

    expect(textOf(await ui.drawn())).toStartWith('plan-tracker: could not run the board command: ')
    expect(textOf(await ui.drawn())).toContain('spawn python3 ENOENT')
    await ui.unmount()
  })

  test('the 10 s refresh runs the script again and the pane shows what it now prints', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await $.command.run(plans())
    const ui = await mountPane($, 'terminal')
    const before = w.jsonRuns.length

    w.fixture = { ...BOARD, plans: [{ ...BOARD.plans[0]!, name: 'Alpha renamed' }, ...BOARD.plans.slice(1)] }
    await w.clock.advance(10_000)
    await ui.redraw()

    expect(w.jsonRuns.length).toBe(before + 1)
    expect(textOf(await ui.find({ key: 'menu' }))).toContain('Alpha renamed')
    await ui.unmount()
  })

  test('a real --json output (nulls, the totals, a plan not of this session) is read: null fields are absent, the counts come from the rows', async ($, on) => {
    const real = JSON.stringify({
      session: 'abc12345',
      selected: 'mvp',
      message: null,
      plans: [
        {
          anchor: 'mvp',
          name: 'MVP',
          goal: null,
          plan_file: '/plans/mvp.md',
          status: 'active',
          in_session: true,
          done: 1,
          total: 3,
          canceled: 1,
          updated: '2026-10-10T19:12:36+09:00',
          rows: [
            { task: 'zero', status: 'Done', who: 'serial × inline · Opus', note: null, route: 'serial × inline · Opus — why', deliverable: null, updated: '2026-10-10T17:05:44+09:00' },
            { task: 'one', status: 'Canceled', who: 'unrouted', note: null, route: null, deliverable: 'automation/plans/mvp.md', updated: null },
            { task: 'two', status: 'Todo', who: 'unrouted', note: null, route: null, deliverable: null, updated: null },
          ],
        },
      ],
    })
    world(on, { fixture: real })
    await $.session.start(SESSION)
    const ui = await mountPane($, 'terminal')

    // one plan: nothing to pick, so no ▾
    expect(textOf(await ui.find({ key: 'menu' }))).toBe('● MVP  Idle  1/2Plan file ›')
    expect(await ui.find({ key: 'goal' })).toBeUndefined()
    expect(textOf(await ui.find({ key: 'deliverables' }))).toContain('automation/plans/mvp.md')
    await ui.unmount()
  })
})

describe('plan-tracker pane: the lanes', () => {
  for (const surface of SURFACES) {
    test(`${surface}: four lanes (Todo, In Progress, Verify, Done) with their counts and four colors; Done adds the canceled count`, async ($, on) => {
      world(on)
      await $.session.start(SESSION)
      const ui = await mountPane($, surface, 140)

      expect((await ui.find({ key: 'kanban' }))?.props.flexDirection).toBe('row')

      const headers = await Promise.all(LANES.map(async lane => (await ui.find({ key: `lane:${lane}` }))?.children[0] as unknown as Node))

      expect(headers.map(textOf)).toEqual(['Todo 5', 'In Progress 2 · 1 blocked', 'Verify 1', 'Done 5 · 1 canceled'])
      expect(headers.map(header => header.props.color)).toEqual(['inactive', 'suggestion', 'warning', 'success'])
      expect(await ui.find({ key: 'lane:Blocked' })).toBeUndefined()
      expect(await ui.find({ key: 'lane:Review' })).toBeUndefined()
      expect(await ui.find({ key: 'lane:QA' })).toBeUndefined()
      expect(textOf(await ui.drawn())).not.toContain('c1 dropped')
      await ui.unmount()
    })

    test(`${surface}: Needs Verification is in Verify; Blocked is in In Progress`, async ($, on) => {
      world(on)
      await $.session.start(SESSION)
      const ui = await mountPane($, surface)

      expect(await textIn(ui, await ui.find({ key: 'lane:Verify' }))).toContain('v1 look at the prototype')
      expect(await textIn(ui, await ui.find({ key: 'lane:In Progress' }))).toContain('b1 hook fix waits for settings')
      await ui.unmount()
    })

    test(`${surface}: Todo shows 3 cards and "+2 more"; Done shows its 3 latest and "+2 more"`, async ($, on) => {
      world(on)
      await $.session.start(SESSION)
      const ui = await mountPane($, surface)

      const todo = await textIn(ui, await ui.find({ key: 'lane:Todo' }))
      const done = await textIn(ui, await ui.find({ key: 'lane:Done' }))

      expect(await cardsOf(ui, 'Todo')).toHaveLength(3)
      expect(todo).toContain('t3 third todo')
      expect(todo).not.toContain('t4 fourth todo')
      expect(todo).toContain('+2 more')
      expect(await cardsOf(ui, 'Done')).toHaveLength(3)
      // the desktop stacks a lane's cards in reverse order, so its text reads from the last card up
      expect(surface === 'desktop' ? done.indexOf('d2 newest but one') : done.indexOf('d4 newest')).toBeLessThan(surface === 'desktop' ? done.indexOf('d4 newest') : done.indexOf('d2 newest but one'))
      expect(done).not.toContain('d1 oldest')
      expect(done).toContain('+2 more')
      await ui.unmount()
    })

    test(`${surface}: a lane with 3 cards or fewer has no "+N more"`, async ($, on) => {
      world(on)
      await $.session.start(SESSION)
      const ui = await mountPane($, surface)

      expect(textOf(await ui.find({ key: 'lane:In Progress' }))).not.toContain('more')
      expect(textOf(await ui.find({ key: 'lane:Verify' }))).not.toContain('more')
      await ui.unmount()
    })
  }

  test('100 columns and up lay the lanes side by side at a quarter of the width; under 100 they stack', async ($, on) => {
    world(on)
    await $.session.start(SESSION)

    const wide = await mountPane($, 'terminal', 140)

    expect((await wide.find({ key: 'kanban' }))?.props.flexDirection).toBe('row')
    expect((await cardsOf(wide, 'Todo'))[0]?.props.width).toBe(laneWidth(140))
    expect(laneWidth(140)).toBe(34)
    await wide.unmount()

    const stacked = await mountPane($, 'terminal', 96)

    expect((await stacked.find({ key: 'kanban' }))?.props.flexDirection).toBe('column')
    expect((await cardsOf(stacked, 'Todo'))[0]?.props.width).toBe(96)
    await stacked.unmount()
  })
})

describe('plan-tracker pane: the cards', () => {
  /** The shape of a card's Client region, without the press handles. */
  const shape = (nodes: unknown) => JSON.stringify(nodes).replace(/"handle":\d+/g, '"handle":0')

  // The terminal pads a card's rows with spaces so the tag sits at the right edge; the desktop's rows are tested in "the desktop".
  for (const surface of ['terminal'] as const) {
    test(`${surface}: a Blocked card is red all through: border (not dim), text, flag and tag, with the mascot frozen on one pose`, async ($, on) => {
      const w = world(on)
      await $.session.start(SESSION)
      const pane = await mountPane($, surface, 140)
      const at = indexOfTask('b1')

      const first = await cardAt(pane, at)
      const rows = await cardRowsIn(pane, at)

      expect(first.props).toMatchObject({ borderStyle: 'round', borderColor: 'error', borderDimColor: false })
      expect(rows).toHaveLength(3)

      // row 1: frozen mascot (error color), the bold flag, the task in error
      const [one, two, three] = rows as [Node, Node, Node]

      expect(one.children[0]).toMatchObject({ type: 'Text', props: { color: 'error' }, children: [`${MASCOT[0][0]} `] })
      expect(one.children[1]).toMatchObject({ props: { bold: true, color: 'error' }, children: ['⚑ Blocked · '] })
      expect(one.children[2]?.props.color).toBe('error')
      expect(textOf(one).startsWith(`${MASCOT[0][0]} ⚑ Blocked · b1`)).toBe(true)
      // row 2: the mascot's legs beside the rest of the title; row 3: the tag's chip on the right, in its tier colours (not red)
      expect(two.children[0]).toMatchObject({ type: 'Text', props: { color: 'error' }, children: [`${MASCOT[0][1]} `] })
      expect(three.children.at(-1)?.children.at(-1)).toMatchObject({ props: { color: '#7A3410', backgroundColor: '#F6DCCB' }, children: [' Opus '] })
      expect(textOf(three)).toEndWith(' Opus ')

      // the frame advances (the In Progress card moves) but the blocked card does not
      await w.clock.advance(FRAME_MS * 3)
      expect(shape(await cardRowsIn(pane, at))).toBe(shape(rows))
      await pane.unmount()
    })

    test(`${surface}: the In Progress card moves its mascot, in the claude color, with a full-strength blue border and a bold name`, async ($, on) => {
      const w = world(on)
      await $.session.start(SESSION)
      const pane = await mountPane($, surface, 140)
      const at = indexOfTask('Build')

      const art = async () => (await cardRowsIn(pane, at))[1]?.children[0]?.children[0]
      const before = await cardAt(pane, at)
      const [one] = await cardRowsIn(pane, at)

      expect(before.props).toMatchObject({ borderColor: 'suggestion', borderDimColor: false })
      expect(one?.children[0]).toMatchObject({ props: { color: 'claude' }, children: [`${MASCOT[0][0]} `] })
      expect(one?.children[1]).toMatchObject({ props: { bold: true } })
      expect(await art()).toBe(`${MASCOT[0][1]} `)

      await w.clock.advance(FRAME_MS * 3)
      expect(await art()).toBe(`${MASCOT[1][1]} `)
      await pane.unmount()
    })

    test(`${surface}: "◆ needs you" is only on a Sam row waiting for her decision (Needs Verification); her Todo, Blocked and Done rows show the tag alone`, async ($, on) => {
      world(on)
      await $.session.start(SESSION)
      const pane = await mountPane($, surface, 140)
      const width = laneWidth(140)

      // v1: Sam + Needs Verification: the marker, in the needs-you colour, and her tag on the right
      const rows = await cardRowsIn(pane, indexOfTask('v1'))
      const [row] = rows as [Node]
      const last = rows.at(-1) as Node

      expect(row.children[0]).toMatchObject({ props: { bold: true, color: 'merged' }, children: ['◆ needs you · '] })
      expect(textOf(row).startsWith('◆ needs you · ')).toBe(true)
      expect(textOf(last)).toEndWith(' you ')
      expect(displayWidth(textOf(last))).toBeLessThanOrEqual(width - 4)

      // t1: Sam + Todo: plain, with "you" as the tag
      const todo = await cardRowsIn(pane, indexOfTask('t1'))

      expect(textOf(todo[0])).toBe(`t1 first todo${' '.repeat(width - 4 - 't1 first todo'.length - ' you '.length)} you `)
      expect(JSON.stringify(todo)).not.toContain('merged')

      const drawn = await textIn(pane, await pane.drawn())

      expect(drawn.match(/needs you/g)).toHaveLength(1)
      expect(await textIn(pane, await pane.find({ key: 'lane:Done' }))).not.toContain('needs you')
      await pane.unmount()
    })

    test(`${surface}: the tag is right-aligned on the card's last line (Haiku on t2), and a card without a route has none`, async ($, on) => {
      world(on)
      await $.session.start(SESSION)
      const pane = await mountPane($, surface, 140)
      const width = laneWidth(140)

      const [line] = await cardRowsIn(pane, indexOfTask('t2'))
      const plain = await cardRowsIn(pane, indexOfTask('t3'))

      expect(textOf(line)).toBe(`t2 second todo${' '.repeat(width - 4 - 't2 second todo'.length - ' Haiku '.length)} Haiku `)
      expect(plain.map(textOf)).toEqual(['t3 third todo'])
      await pane.unmount()
    })
  }

  for (const surface of SURFACES) {
    test(`${surface}: every other card is a round dim Box in its lane's color, with no mascot`, async ($, on) => {
      world(on)
      await $.session.start(SESSION)
      const pane = await mountPane($, surface, 140)

      for (const [lane, color] of [['Todo', 'inactive'], ['Verify', 'warning'], ['Done', 'success']] as const) {
        for (const box of await cardsOf(pane, lane)) {
          expect(box.props).toMatchObject({ borderStyle: 'round', borderColor: color, borderDimColor: true, width: laneWidth(140) })
        }
      }

      await pane.unmount()
    })

    test(`${surface}: pressing a card opens its page; Back returns to the lanes`, async ($, on) => {
      world(on)
      await $.session.start(SESSION)
      const pane = await mountPane($, surface)

      await openCard(pane, indexOfTask('t2'))
      expect(await pane.find({ key: 'kanban' })).toBeUndefined()
      expect(await pane.find({ key: 'detail' })).toBeDefined()
      await pane.press({ key: 'back' })
      expect(await pane.find({ key: 'kanban' })).toBeDefined()
      await pane.unmount()
    })
  }

  test('a narrow pane (16 columns) draws an In Progress card as one bold row without the mascot', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 16)
    const at = indexOfTask('Build')
    const box = await cardAt(pane, at)
    const [row] = await cardRowsIn(pane, at)

    expect(box.props.borderDimColor).toBe(false)
    expect(row?.children.map(child => child.props.color)).not.toContain('claude')
    expect(row?.children.some(child => child.props.bold === true)).toBe(true)
    expect(displayWidth(textOf(row))).toBeLessThanOrEqual(12)
    await pane.unmount()
  })

  test('a name too long for one line wraps to two and the tag goes on a line below', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 60)
    const rows = (await cardRowsIn(pane, indexOfTask('Build'))) as Node[]
    const last = rows.at(-1)

    expect(textOf(rows[0])).toContain('Build the eval suite')
    expect(textOf(last)).toEndWith(' Sonnet ')
    expect(displayWidth(textOf(last))).toBeLessThanOrEqual(56)
    await pane.unmount()
  })

  test('a card is one Client region: no Button in it, so the pointer inverts no row and never the mascot', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 140)
    const clients = await pane.findAll({ type: 'Client' })

    expect(clients.every(client => String(client.props.module).endsWith('card.tsx'))).toBe(true)
    expect(clients.length).toBeGreaterThan(5)
    expect(JSON.stringify(await pane.find({ key: 'kanban' })).includes('"type":"Button"')).toBe(true) // the overflow lines are Buttons

    for (const lane of LANES) {
      for (const box of await cardsOf(pane, lane)) {
        expect(JSON.stringify(box)).not.toContain('"type":"Button"')
        expect(box.children.filter(child => child.type === 'Client')).toHaveLength(1)
      }
    }

    await pane.unmount()
  })

  test('a click opens the page only as the left button down then up on the card; an up alone, a down alone or the right button do nothing', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 140)
    const at = indexOfTask('t2')
    const press = (event: { type: 'down' | 'up'; x: number; y: number; button: 'left' | 'right' }) => pane.pointer({ ...event, in: `card:${at}` })

    // an up that never went down here, the right button, and a down alone open nothing
    await press({ type: 'up', x: 1, y: 0, button: 'left' })
    expect(await pane.find({ key: 'detail' })).toBeUndefined()
    await press({ type: 'down', x: 1, y: 0, button: 'right' })
    await press({ type: 'up', x: 1, y: 0, button: 'right' })
    expect(await pane.find({ key: 'detail' })).toBeUndefined()
    await press({ type: 'down', x: 1, y: 0, button: 'left' })
    expect(await pane.find({ key: 'detail' })).toBeUndefined()
    // down then up with the left button opens it
    await press({ type: 'up', x: 1, y: 0, button: 'left' })
    expect(await pane.find({ key: 'detail' })).toBeDefined()
    await pane.unmount()
  })

  test('Enter on a card that has the keyboard (after a click) opens its page too', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 140)

    await pane.key({ key: 'return', in: `card:${indexOfTask('t3')}` })

    expect(await pane.find({ key: 'detail' })).toBeDefined()
    expect(textOf(await pane.find({ key: 'detail:title' }))).toBe('■ t3 third todo')
    await pane.unmount()
  })

  test('a post that is not a row of the shown plan is ignored', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 140)

    await pane.post({ open: 999 }, { in: `card:${indexOfTask('t3')}` })
    await pane.post({ open: 'x' }, { in: `card:${indexOfTask('t3')}` })
    await pane.post({ other: 1 }, { in: `card:${indexOfTask('t3')}` })

    expect(await pane.find({ key: 'detail' })).toBeUndefined()
    await pane.unmount()
  })
})

describe('plan-tracker pane: deliverables', () => {
  test('the section shows the paths that rows recorded, each once, in a link colour that reads on a dark and a light theme (not `remember`, a dark blue on a dark theme)', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    const section = await pane.find({ key: 'deliverables' })

    expect(textOf(section)).toContain('DELIVERABLE')
    expect(textOf(section)).not.toContain('TASK')
    expect(textOf(section)).not.toContain('d4 newest')
    expect(textOf(section)).toContain(' .md ')
    expect(textOf(section)).toContain('automation/plans/alpha-plan.md  —')
    expect(await pane.findAll({ type: 'Link' })).toEqual([])
    expect(textOf(section).split('automation/plans/alpha-plan.md')).toHaveLength(2)
    expect(JSON.stringify(section)).toContain('"color":"suggestion"')
    expect(JSON.stringify(section)).not.toContain('"color":"remember"')
    await pane.unmount()
  })

  test('with none recorded there is no section at all, not "Deliverables 0"', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    await pane.press({ key: 'menu:name' })
    await pane.press({ key: 'plan:gamma' })

    expect(await pane.find({ key: 'deliverables' })).toBeUndefined()
    expect(textOf(await pane.drawn())).not.toContain('Deliverables')
    await pane.unmount()
  })
})

/** The lines of a task page's note, top to bottom (the heading is the first child). */
const noteRows = async (pane: Pane): Promise<Node[]> =>
  kids(await pane.find({ key: 'field:note' })).map((line): Node => ({ type: 'Box', props: {}, children: kids(line).slice(3, -2) }))

/** The label cell of the note row on the terminal. */
const noteLabel = async (pane: Pane): Promise<Node | undefined> => kids(kids(await pane.find({ key: 'field:note' }))[0])[1]

/** A table row of a task page as one line of words: the frame and the padding gone (`Status Done`); undefined when the page has no such row. */
const fieldText = async (pane: Pane, key: string): Promise<string | undefined> => {
  const found = await pane.find({ key: `field:${key}` })

  return found === undefined ? undefined : textOf(found).replace(/[│╭╮╰╯├┤┬┴┼─]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** The task page's keys, top to bottom. */
const pageKeys = async (pane: Pane): Promise<string[]> => kids(await pane.find({ key: 'detail' })).map(node => String(node.props?.key ?? node.type))

describe('plan-tracker pane: the task page', () => {
  const open = async ($: Engine, start: string) => {
    const pane = await mountPane($, 'terminal')

    // an index of ALPHA_ROWS is the card key whenever the plan is alpha
    await openCard(pane, ALPHA_ROWS.findIndex(one => one.task.startsWith(start)))

    return { pane }
  }

  test('the title, then a framed table of labelled rows: Status and Done by; no Working time, Effort, Tokens or Est. cost rows', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const { pane } = await open($, 'Build')

    expect(await pageKeys(pane)).toEqual(['back', 'detail:title', 'detail:fields'])
    expect(textOf(await pane.find({ key: 'detail:fields' }))).toMatch(/^╭[─┬]+╮/)
    expect(textOf(await pane.find({ key: 'detail:fields' }))).not.toMatch(/Working time|Effort|Tokens|Est\. cost|Goal|Checked by|Progress/)
    expect(textOf(await pane.find({ key: 'detail:title' }))).toBe('■ Build the eval suite (official claude plugin eval) and run it')
    // the status is in words; the tier is a chip, the executor follows
    expect(await fieldText(pane, 'status')).toBe('Status In progress')
    expect(await fieldText(pane, 'who')).toBe('Done by Sonnet subagent')
    expect(JSON.stringify(await pane.find({ key: 'field:who' }))).toContain('"backgroundColor":"#D3E2F4"')
    await pane.unmount()
  })

  test('Goal is the first row when the tracker has one, and no row at all when it has none', async ($, on) => {
    const goal = 'Prove the eval suite runs green on the new plugin'
    const board: PlanBoard = { ...BOARD, plans: [{ ...BOARD.plans[0]!, rows: [{ ...ALPHA_ROWS[6]!, goal }, ALPHA_ROWS[8]!] }] }
    world(on, { fixture: board })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    await openCard(pane, 0)
    expect(kids(await pane.find({ key: 'detail:fields' })).filter(node => String(node.props?.key ?? '').startsWith('field:')).map(node => String(node.props?.key))).toEqual(['field:goal', 'field:status', 'field:who'])
    expect(await fieldText(pane, 'goal')).toBe(`Goal ${goal}`)
    await pane.press({ key: 'back' })
    await openCard(pane, 1)
    expect(await pane.find({ key: 'field:goal' })).toBeUndefined()
    await pane.unmount()
  })

  test('nothing follows the page: no footer line', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const { pane } = await open($, 'Build')

    expect(await pane.find({ key: 'footer' })).toBeUndefined()
    expect(textOf(await pane.drawn())).not.toMatch(/preview|fixture/)
    await pane.unmount()
  })

  test('her own row: "Waiting for your check" and the you chip', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const { pane } = await open($, 'v1')

    expect(await fieldText(pane, 'status')).toBe('Status Waiting for your check')
    expect(await fieldText(pane, 'who')).toBe('Done by you')
    expect(JSON.stringify(await pane.find({ key: 'field:who' }))).toContain('"backgroundColor":"#4B2FB8"')
    expect(await pane.find({ key: 'detail:usage' })).toBeUndefined()
    await pane.unmount()
  })

  test('nothing is drawn for what the tracker does not record: a Todo with no route and no note is the title and "To do"', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const { pane } = await open($, 't3')

    expect(await pageKeys(pane)).toEqual(['back', 'detail:title', 'detail:fields'])
    expect(await fieldText(pane, 'status')).toBe('Status To do')
    expect(await pane.find({ key: 'field:who' })).toBeUndefined()
    expect(await pane.find({ key: 'field:checker' })).toBeUndefined()
    await pane.unmount()
  })

  test('a long note wraps within the pane width: every line fits, the heading shows once', async ($, on) => {
    const note = `${'word '.repeat(60)}end`
    const board: PlanBoard = { ...BOARD, plans: [{ ...BOARD.plans[0]!, rows: [{ ...ALPHA_ROWS[7]!, note }] }] }
    world(on, { fixture: board })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 60)

    await openCard(pane, 0)

    const lines = (await noteRows(pane)).map(textOf)

    expect(lines.length).toBeGreaterThan(2)
    expect(lines.every(line => displayWidth(line) <= 60)).toBe(true)
    expect(textOf(await pane.find({ key: 'detail' })).match(/Blocked because/g)).toHaveLength(1)
    await pane.unmount()
  })

  test('narrow: a 30-column page keeps every line within the width', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 30)

    await openCard(pane, 6)

    // every line of the frame, the rules included, is within the width
    for (const node of kids(await pane.find({ key: 'detail:fields' }))) {
      for (const line of node.type === 'Box' ? kids(node) : [node]) {
        expect(displayWidth(textOf(line))).toBeLessThanOrEqual(30)
      }
    }

    await pane.unmount()
  })

  test('the page has none of the v3 blocks: updates, checks, reviews, changes, commits, diff', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const { pane } = await open($, 'v1')

    const text = textOf(await pane.find({ key: 'detail' }))

    expect(text).toContain('Latest note')
    expect(text).toContain('• built')
    expect(text).toContain('• waits for her eyes')
    expect(text).not.toMatch(/Updates|earlier update|Checks|Reviews|Changes|diff|commit|Session|Assignee/)
    await pane.unmount()
  })

  test('a Blocked task shows ⚑ Blocked in red and its reason, taken from the note', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const { pane } = await open($, 'b1')

    expect(await fieldText(pane, 'status')).toBe('Status ⚑ Blocked')
    expect(JSON.stringify(await pane.find({ key: 'field:status' }))).toContain('"color":"error","bold":true')
    expect(await fieldText(pane, 'note')).toBe('Blocked because waiting on a ruling about the hook')
    expect(JSON.stringify(await pane.find({ key: 'field:note' }))).toContain('"color":"error"')
    expect(await fieldText(pane, 'who')).toBe('Done by Opus main session')
    await pane.unmount()
  })

  test('a task with a deliverable shows it under "Deliverable" as a link; a task with no route has no who', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const first = await open($, 'd4')

    expect(await fieldText(first.pane, 'deliverable')).toBe('Deliverable automation/plans/alpha-plan.md')
    expect((await first.pane.find({ type: 'Link' }))?.props.label).toBe('automation/plans/alpha-plan.md')
    expect(await fieldText(first.pane, 'status')).toBe('Status Done')
    expect(await fieldText(first.pane, 'note')).toStartWith('Latest note • built the suite')
    await first.pane.unmount()
  })

  test('the page of a task replaces the header, the plan line and the lanes', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const { pane } = await open($, 't3')

    expect(await pane.find({ key: 'strip' })).toBeUndefined()
    expect(await pane.find({ key: 'plan-stats' })).toBeUndefined()
    expect(await pane.find({ key: 'deliverables' })).toBeUndefined()
    await pane.unmount()
  })
})

describe('plan-tracker pane: v4 review changes', () => {
  /** A codex-like plan: 6 blocked and 12 running. */
  const BUSY: PlanBoard = {
    ...BOARD,
    selected: 'busy',
    plans: [
      {
        ...BOARD.plans[0]!,
        anchor: 'busy',
        rows: [
          ...Array.from({ length: 6 }, (_, at) => ({ ...ALPHA_ROWS[7]!, task: `stuck ${at}` })),
          ...Array.from({ length: 12 }, (_, at) => ({ ...ALPHA_ROWS[6]!, task: `run ${at}` })),
        ],
      },
    ],
  }

  test('M1: the lane shows 3 blocked and 2 running cards (the running ones have the mascot), the header counts blocked, the overflow line splits', async ($, on) => {
    world(on, { fixture: BUSY })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 140)

    const lane = await pane.find({ key: 'lane:In Progress' })
    const cards = await cardsOf(pane, 'In Progress')

    expect(textOf(kids(lane)[0])).toBe('In Progress 18 · 6 blocked')
    expect(cards.map(box => box.props.borderColor)).toEqual(['error', 'error', 'error', 'suggestion', 'suggestion'])
    const running = Number(String(cards[3]?.props.key).split(':')[1])

    expect(kids((await cardRowsIn(pane, running))[0])[0]).toMatchObject({ props: { color: 'claude' } })
    expect(textOf(kids(lane).at(-1))).toBe('+3 blocked · 10 running ▾')
    await pane.unmount()
  })

  test('M2: a blocked note is one line per ｜ point in the default color; only the label and "⚑ Blocked" are red', async ($, on) => {
    const note = 'Source is here｜ second point docs/report-2026-09-20.md｜ 【Decide】Should it run again?'
    const board: PlanBoard = { ...BOARD, plans: [{ ...BOARD.plans[0]!, rows: [{ ...ALPHA_ROWS[7]!, note }] }] }
    world(on, { fixture: board })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    await openCard(pane, 0)

    const lines = await noteRows(pane)
    const cell = (line: Node) => kids(line).map(textOf).join('')

    expect((await noteLabel(pane))?.props.color).toBe('error')
    expect(lines).toHaveLength(3)
    expect(lines.map(cell).map(text => text.trimEnd())).toEqual(['• Source is here', '• second point docs/report-2026-09-20.md', '• 【Decide】Should it run again?'])
    // the body is in the default colour: no part of a value cell is red
    expect(JSON.stringify(lines.map(line => kids(line)))).not.toContain('"color":"error"')
    // the file path is a link in the link color
    const link = await pane.find({ type: 'Link' })

    expect(link?.props.label).toBe('docs/report-2026-09-20.md')
    expect(String(link?.props.href)).toEndWith('/docs/report-2026-09-20.md')
    expect(JSON.stringify(await pane.find({ key: 'field:note' }))).toContain('"color":"suggestion"')
    expect(JSON.stringify(await pane.find({ key: 'field:status' }))).toContain('"color":"error","bold":true')
    await pane.unmount()
  })

  test('M2: a long single point wraps without a bullet or an indent', async ($, on) => {
    const board: PlanBoard = { ...BOARD, plans: [{ ...BOARD.plans[0]!, rows: [{ ...ALPHA_ROWS[7]!, note: `${'word '.repeat(40)}end` }] }] }
    world(on, { fixture: board })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 60)

    await openCard(pane, 0)

    const lines = (await noteRows(pane)).map(line => kids(line).map(textOf).join('').trimEnd())

    expect(lines.length).toBeGreaterThan(2)
    expect(lines.every(line => !line.startsWith(' ') && !line.startsWith('•'))).toBe(true)
    await pane.unmount()
  })

  test('M3: "◆ needs you" has a color no lane or count uses', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 140)

    const used = new Set(['inactive', 'suggestion', 'warning', 'error', 'success', 'claude', 'remember'])
    const marker = kids((await cardRowsIn(pane, indexOfTask('v1')))[0])[0]

    expect(marker?.props.bold).toBe(true)
    expect(used.has(String(marker?.props.color))).toBe(false)
    await pane.unmount()
  })

  test('m1: the plan file view shows the path with the file name, cut from the left when it is long', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 12)

    await pane.press({ key: 'plan-file' })

    const path = textOf(kids(await pane.find({ key: 'file' }))[1])

    expect(path).toBe('…pha-plan.md')
    expect(displayWidth(path)).toBeLessThanOrEqual(12)
    await pane.unmount()
  })

  test('m3: the deliverable links of the board and the task page use the plan file view\'s link color', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    expect(JSON.stringify(await pane.find({ key: 'deliverables' }))).toContain('"color":"suggestion"')
    await openCard(pane, indexOfTask('d4'))
    expect(JSON.stringify(await pane.find({ key: 'field:deliverable' }))).toContain('"color":"suggestion"')
    await pane.unmount()
  })

  test('m4: every card has one column of padding inside its border: text starts and ends one column in', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 140)

    for (const lane of LANES) {
      for (const box of await cardsOf(pane, lane)) {
        expect(box.props.paddingX).toBe(1)
      }
    }

    // the card's Client region is the card less its border and padding, and its tagged line fills it exactly
    const at = indexOfTask('t2')
    const client = (await pane.find({ type: 'Client', key: `card:${at}` })) as unknown as Node

    expect(client.props.width).toBe(laneWidth(140) - 4)
    expect(displayWidth(textOf((await cardRowsIn(pane, at))[0]))).toBe(laneWidth(140) - 4)
    await pane.unmount()
  })
})

describe('plan-tracker pane: expandable lanes', () => {
  const BUSY: PlanBoard = {
    ...BOARD,
    selected: 'busy',
    plans: [
      {
        ...BOARD.plans[0]!,
        anchor: 'busy',
        rows: [
          ...Array.from({ length: 6 }, (_, at) => ({ ...ALPHA_ROWS[6]!, task: `run ${at}` })),
          ...Array.from({ length: 4 }, (_, at) => ({ ...ALPHA_ROWS[7]!, task: `stuck ${at}` })),
        ],
      },
      BOARD.plans[0]!,
    ],
  }

  const tasksOf = async (pane: Pane, lane: string) => Promise.all((await cardsOf(pane, lane)).map(box => textIn(pane, box)))

  test('the overflow lines are buttons: Todo "+2 more", In Progress "+1 blocked · 5 running", Done "+2 more"', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 140)

    expect(await pane.find({ key: 'lane:Todo:more' })).toMatchObject({ type: 'Button', props: { label: '+2 more ▾' } })
    expect(await pane.find({ key: 'lane:Done:more' })).toMatchObject({ type: 'Button', props: { label: '+2 more ▾' } })
    expect(await pane.find({ key: 'lane:In Progress:more' })).toBeUndefined()
    expect(await pane.find({ key: 'lane:Verify:more' })).toBeUndefined()
    await pane.unmount()
  })

  test('pressing "+2 more" shows every Todo card and the line becomes "Show less"; pressing it folds the lane back', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 140)

    await pane.press({ key: 'lane:Todo:more' })

    expect((await tasksOf(pane, 'Todo')).map(line => /t\d/.exec(line)?.[0])).toEqual(['t1', 't2', 't3', 't4', 't5'])
    expect(await pane.find({ key: 'lane:Todo:less' })).toMatchObject({ props: { label: 'Show less ▴' } })
    // the other lanes are untouched
    expect(await cardsOf(pane, 'Done')).toHaveLength(3)

    await pane.press({ key: 'lane:Todo:less' })

    expect(await cardsOf(pane, 'Todo')).toHaveLength(3)
    expect(await pane.find({ key: 'lane:Todo:more' })).toMatchObject({ props: { label: '+2 more ▾' } })
    await pane.unmount()
  })

  test('Done expands to all its cards, latest first', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 140)

    await pane.press({ key: 'lane:Done:more' })

    expect((await tasksOf(pane, 'Done')).map(line => line.slice(0, 2))).toEqual(['d4', 'd2', 'd3', 'd1', 'd5'])
    await pane.unmount()
  })

  test('In Progress expands to every card, Blocked first and each group in row order', async ($, on) => {
    world(on, { fixture: BUSY })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 140)

    expect((await tasksOf(pane, 'In Progress')).map(line => /(?:stuck|run) \d/.exec(line)?.[0])).toEqual(['stuck 0', 'stuck 1', 'stuck 2', 'run 0', 'run 1'])
    expect(await pane.find({ key: 'lane:In Progress:more' })).toMatchObject({ props: { label: '+1 blocked · 4 running ▾' } })

    await pane.press({ key: 'lane:In Progress:more' })

    expect((await cardsOf(pane, 'In Progress')).map(box => box.props.borderColor)).toEqual(['error', 'error', 'error', 'error', 'suggestion', 'suggestion', 'suggestion', 'suggestion', 'suggestion', 'suggestion'])
    expect(await pane.find({ key: 'lane:In Progress:less' })).toMatchObject({ props: { label: 'Show less ▴' } })
    await pane.unmount()
  })

  test('pressing the overflow line hands the keys to the pane again, and does not scroll to the top', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await $.command.run(plans())
    const pane = await mountPane($, 'terminal', 140)
    const before = w.opened.filter(one => one.focus === true).length

    await pane.press({ key: 'lane:Todo:more' })

    expect(w.opened.filter(one => one.focus === true).length).toBe(before + 1)
    await pane.press({ key: 'lane:Todo:less' })
    expect(w.opened.filter(one => one.focus === true).length).toBe(before + 2)
    await pane.unmount()
  })

  test('the state is per plan: expanding in one plan leaves another folded', async ($, on) => {
    world(on, { fixture: BUSY })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 140)

    await pane.press({ key: 'lane:In Progress:more' })
    await pane.press({ key: 'menu:name' })
    await pane.press({ key: 'plan:alpha' })

    expect(await pane.find({ key: 'lane:Todo:more' })).toMatchObject({ props: { label: '+2 more ▾' } })
    await pane.press({ key: 'menu:name' })
    await pane.press({ key: 'plan:busy' })
    expect(await pane.find({ key: 'lane:In Progress:less' })).toMatchObject({ props: { label: 'Show less ▴' } })
    await pane.unmount()
  })
})

describe('plan-tracker pane: the note cell and the Route row', () => {
  const open = async ($: Engine, on: Parameters<typeof world>[0], note: string, columns = 96) => {
    const board: PlanBoard = { ...BOARD, plans: [{ ...BOARD.plans[0]!, rows: [{ ...ALPHA_ROWS[6]!, note }] }] }

    world(on, { fixture: board })
    await $.session.start(SESSION)

    const pane = await mountPane($, 'terminal', columns)

    await openCard(pane, 0)

    return pane
  }

  const noteCells = async (pane: Pane) => (await noteRows(pane)).map(line => kids(line).map(textOf).join('').trimEnd())

  test('the Route row is gone, Who stays', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    await openCard(pane, indexOfTask('Build'))

    expect(await pane.find({ key: 'detail:route' })).toBeUndefined()
    expect(textOf(await pane.find({ key: 'detail' }))).not.toMatch(/Route|spawn ×|a mechanical change/)
    expect(await fieldText(pane, 'who')).toBe('Done by Sonnet subagent')
    await pane.unmount()
  })

  test('a leading date is on a line of its own, dim, and the points follow as bullets', async ($, on) => {
    const pane = await open($, on, '2026-09-20 — three checks, no diff；T2 lists 27/27；see docs/report-2026-09-20.md')

    expect(await noteCells(pane)).toEqual(['2026-09-20', '• three checks, no diff', '• T2 lists 27/27', '• see docs/report-2026-09-20.md'])

    const lines = await noteRows(pane)
    const dateParts = kids(lines[0])

    expect(dateParts[0]?.props.dimColor).toBe(true)
    expect(JSON.stringify(lines.slice(1))).not.toContain('"dimColor":true,"children":["•')
    // the path is still a link
    expect((await pane.find({ type: 'Link' }))?.props.label).toBe('docs/report-2026-09-20.md')
    await pane.unmount()
  })

  test('points split at ； ; ｜ | and line breaks; empty ones are dropped', async ($, on) => {
    const pane = await open($, on, 'one；two; three ｜ four|\nfive；；')

    expect(await noteCells(pane)).toEqual(['• one', '• two', '• three', '• four', '• five'])
    await pane.unmount()
  })

  test('a date alone is one dim line', async ($, on) => {
    const alone = await open($, on, '2026-10-01')

    expect(await noteCells(alone)).toEqual(['2026-10-01'])
    await alone.unmount()
  })

  test('a note with one point shows it without a bullet', async ($, on) => {
    const one = await open($, on, 'built and waiting for her eyes')

    expect(await noteCells(one)).toEqual(['built and waiting for her eyes'])
    await one.unmount()
  })

  test('a date followed by ": " and one point is the date line, then the point without a bullet', async ($, on) => {
    const dated = await open($, on, '2026-10-02: built and waiting')

    expect(await noteCells(dated)).toEqual(['2026-10-02', 'built and waiting'])
    await dated.unmount()
  })

  test('a long bullet wraps with the next lines indented 2 columns, under the text and not under the bullet', async ($, on) => {
    const pane = await open($, on, `${'alpha '.repeat(25)}end；short`, 50)

    const cells = await noteCells(pane)
    const bulleted = cells.slice(0, -1)

    expect(bulleted.length).toBeGreaterThan(2)
    expect(bulleted[0]?.startsWith('• alpha')).toBe(true)
    expect(bulleted.slice(1).every(line => line.startsWith('  alpha') || line.startsWith('  end'))).toBe(true)
    expect(cells.at(-1)).toBe('• short')
    expect((await noteRows(pane)).every(line => displayWidth(textOf(line)) <= 50)).toBe(true)
    await pane.unmount()
  })

  test('a CJK point wraps at any character and keeps the indent', async ($, on) => {
    const pane = await open($, on, '\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341，\u4e00\u4e8c\u4e09\u56db\u4e94；second', 40)

    const cells = await noteCells(pane)

    expect(cells[0]?.startsWith('• \u4e00\u4e8c')).toBe(true)
    expect(cells.slice(1, -1).every(line => line.startsWith('  ') && !line.startsWith('   '))).toBe(true)
    expect(cells.at(-1)).toBe('• second')
    await pane.unmount()
  })

  test('a Blocked task keeps its colours: red label, default-colour body', async ($, on) => {
    const board: PlanBoard = { ...BOARD, plans: [{ ...BOARD.plans[0]!, rows: [{ ...ALPHA_ROWS[7]!, note: '2026-09-20 — first；second' }] }] }
    world(on, { fixture: board })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    await openCard(pane, 0)

    const lines = await noteRows(pane)

    const label = await noteLabel(pane)

    expect(label?.props.color).toBe('error')
    expect(textOf(label).trim()).toBe('Blocked because')
    expect(JSON.stringify(lines.map(line => kids(line)))).not.toContain('"color":"error"')
    await pane.unmount()
  })
})

describe('plan-tracker pane: overflow buttons, header fold and the ask-for-you point', () => {
  test('m1: the overflow lines are Buttons (drawn with their own [ ] frame, not plain) with ▾, and "Show less" has ▴', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 140)

    const more = await pane.find({ key: 'lane:Todo:more' })

    expect(more).toMatchObject({ type: 'Button', props: { label: '+2 more ▾' } })
    expect(more?.props.plain).toBeUndefined()
    await pane.press({ key: 'lane:Todo:more' })
    expect(await pane.find({ key: 'lane:Todo:less' })).toMatchObject({ type: 'Button', props: { label: 'Show less ▴' } })
    await pane.unmount()
  })

  test('m2: an expanded lane has "Show less ▴" on its header row too, on the right; folding it removes both', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 140)

    expect(await pane.find({ key: 'lane:Todo:less' })).toBeUndefined()
    await pane.press({ key: 'lane:Todo:more' })

    const header = kids(await pane.find({ key: 'lane:Todo' }))[0]

    expect(header?.type).toBe('Box')
    expect(kids(header).map(node => node.type)).toEqual(['Text', 'Box', 'Button'])
    expect(textOf(kids(header)[0])).toBe('Todo 5')
    expect(await pane.find({ key: 'lane:Todo:less' })).toMatchObject({ props: { label: 'Show less ▴' } })
    expect(await pane.find({ key: 'lane:Todo:more' })).toBeUndefined()

    await pane.press({ key: 'lane:Todo:less' })

    expect(await cardsOf(pane, 'Todo')).toHaveLength(3)
    expect(await pane.find({ key: 'lane:Todo:less' })).toBeUndefined()
    expect(await pane.find({ key: 'lane:Todo:more' })).toMatchObject({ props: { label: '+2 more ▾' } })
    await pane.unmount()
  })

  test('m2: the header button also hands the keys back to the pane', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await $.command.run(plans())
    const pane = await mountPane($, 'terminal', 140)

    await pane.press({ key: 'lane:Done:more' })
    const before = w.opened.filter(one => one.focus === true).length
    await pane.press({ key: 'lane:Done:less' })

    expect(w.opened.filter(one => one.focus === true).length).toBe(before + 1)
    await pane.unmount()
  })

  test('m3: a point that says "needs you" is bold in the needs-you colour; the others are not', async ($, on) => {
    const board: PlanBoard = {
      ...BOARD,
      plans: [{ ...BOARD.plans[0]!, rows: [{ ...ALPHA_ROWS[6]!, note: 'first；Needs you to decide；the build needs you to look；plain' }] }],
    }
    world(on, { fixture: board })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    await openCard(pane, 0)

    const lines = await noteRows(pane)
    const parts = lines.map(line => kids(line)[0])

    expect(lines.map(line => kids(line).map(textOf).join('').trimEnd())).toEqual(['• first', '• Needs you to decide', '• the build needs you to look', '• plain'])
    expect(parts.map(part => part?.props?.color === 'merged' && part?.props?.bold === true)).toEqual([false, true, true, false])
    await pane.unmount()
  })

  test('m3: every wrapped line of such a point is bold purple', async ($, on) => {
    const board: PlanBoard = { ...BOARD, plans: [{ ...BOARD.plans[0]!, rows: [{ ...ALPHA_ROWS[6]!, note: `Needs you: ${'decide this one thing '.repeat(8)}；plain` }] }] }
    world(on, { fixture: board })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 50)

    await openCard(pane, 0)

    const lines = await noteRows(pane)
    const flags = lines.map(line => kids(line)[0]?.props?.color === 'merged')

    expect(flags.slice(0, -1).every(Boolean)).toBe(true)
    expect(flags.at(-1)).toBe(false)
    expect(lines.length).toBeGreaterThan(3)
    await pane.unmount()
  })

  test('a ";" inside backticks or inside a path does not split a point', async ($, on) => {
    const board: PlanBoard = {
      ...BOARD,
      plans: [{ ...BOARD.plans[0]!, rows: [{ ...ALPHA_ROWS[6]!, note: 'run `a; b` first；see src/a;b.py now；last' }] }],
    }
    world(on, { fixture: board })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    await openCard(pane, 0)

    const cells = (await noteRows(pane)).map(line => kids(line).map(textOf).join('').trimEnd())

    expect(cells).toEqual(['• run `a; b` first', '• see src/a;b.py now', '• last'])
    await pane.unmount()
  })
})

describe('plan-tracker pane: card hover', () => {
  /** The Buttons anywhere under `node`. */
  const buttonsUnder = (node: Node): Node[] => (node.type === 'Button' ? [node] : (node.children ?? []).flatMap(buttonsUnder))
  const LONG = 'A long task name that cannot fit one narrow card and must be shown whole when the pointer is on it'

  const board: PlanBoard = {
    ...BOARD,
    plans: [{ ...BOARD.plans[0]!, rows: [{ ...ALPHA_ROWS[6]!, task: LONG }, { ...ALPHA_ROWS[7]!, task: `${LONG} blocked` }, { ...ALPHA_ROWS[8]!, task: `${LONG} todo` }] }],
  }

  test('1: the mascot is plain Text at the start of its row in the card\'s Client, and the card holds no Button the pointer could invert', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 140)

    for (const box of await cardsOf(pane, 'In Progress')) {
      const index = Number(String(box.props.key).split(':')[1])

      expect(buttonsUnder(box)).toEqual([])

      for (const row of await cardRowsIn(pane, index)) {
        expect(row.type).toBe('Box')
        expect(row.children[0]?.type).toBe('Text')
        expect(String(row.children[0]?.props.color)).toMatch(/claude|error/)
        expect(String(row.children[0]?.children[0])).toMatch(/^[ ▄█▜▛▚▞]+ $/)
      }
    }

    await pane.unmount()
  })

  test('2: a cut card is a hover scope; its hidden box is the lane\'s last child, on the card\'s own corner and width', async ($, on) => {
    world(on, { fixture: board })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 140)
    const width = laneWidth(140)

    const lane = (await pane.find({ key: 'lane:In Progress' })) as unknown as Node
    const [one] = await revealsOf(pane, 'In Progress')
    const cards = await cardsOf(pane, 'In Progress')

    // the lane has no border or padding: `top` is the rows above the card (the header row and the cards before it)
    // a card with the mascot is covered only right of it; the box is a heavy-bordered floating layer
    expect(one?.props).toMatchObject({ position: 'absolute', display: 'none', top: 1, left: REVEAL_LEFT, width: width - REVEAL_LEFT, borderStyle: 'bold' })
    expect(REVEAL_LEFT).toBe(2 + 6 + 1 - 1)
    expect((one as unknown as { hover?: unknown }).hover).toEqual({ display: 'flex', scope: 'card:alpha:1' })
    expect((cards[0] as unknown as { hover?: unknown }).hover).toEqual({ scope: 'card:alpha:1' })
    // a hidden keyed Box cannot be hovered: the hidden box has no key; and it is drawn after every card, so none paints over it
    expect(one?.props.key).toBeUndefined()
    const lastCard = lane.children.findLastIndex(child => String(child.props.key).startsWith('cardbox:'))

    expect(lane.children.findIndex(child => child.props.position === 'absolute')).toBeGreaterThan(lastCard)
    expect(cards.length).toBeGreaterThan(0)
    await pane.unmount()
  })

  test('2: the hidden box holds the whole name and the executor, and a click on it opens the task page', async ($, on) => {
    world(on, { fixture: board })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 140)

    const one = (await revealsOf(pane, 'In Progress'))[1]
    const text = await textIn(pane, one)

    expect(text.replace(/\s+/g, '')).toContain(LONG.replace(/\s+/g, ''))
    expect(text.trimEnd()).toEndWith('Sonnet')
    expect(text).not.toContain('Open')
    expect(buttonsUnder(one as Node)).toEqual([])

    await pane.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'reveal:0' })
    await pane.pointer({ type: 'up', x: 1, y: 0, button: 'left', in: 'reveal:0' })
    expect(await pane.find({ key: 'kanban' })).toBeUndefined()
    expect(await pane.find({ key: 'detail' })).toBeDefined()
    await pane.unmount()
  })

  test('2: the second cut card sits below the first: top is the header plus the first card\'s rows', async ($, on) => {
    world(on, { fixture: board })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 140)

    const reveals = await revealsOf(pane, 'In Progress')
    // the blocked card (row 1) is first in the lane
    const first = await cardAt(pane, 1)

    expect(first.props.key).toBe('cardbox:1')
    expect(reveals.map(one => one.props.top)).toEqual([1, 1 + ((await cardRowsIn(pane, 1)).length + 2)])
    await pane.unmount()
  })

  test('2: a blocked card reveals in red with its flag first', async ($, on) => {
    world(on, { fixture: board })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 140)

    const reveals = await revealsOf(pane, 'In Progress')
    const texts = await Promise.all(reveals.map(one => textIn(pane, one)))
    const blocked = reveals[texts.findIndex(text => text.startsWith('⚑ Blocked · A long'))]

    expect(blocked?.props.borderColor).toBe('error')
    expect(JSON.stringify(await pane.find({ type: 'Box', in: 'reveal:1' }))).toContain('"color":"error"')
    await pane.unmount()
  })

  test('3: a card whose name fits has no hidden box: no hover change; a hidden box exists exactly when the name is cut', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 140)

    let fits = 0
    let cut = 0

    for (const lane of LANES) {
      const reveals = await revealsOf(pane, lane)
      const cards = await cardsOf(pane, lane)
      const expected = cards.filter(box => cardView(ALPHA_ROWS[Number(String(box.props.key).split(':')[1])]!, laneWidth(140)).isCut).length

      expect(reveals).toHaveLength(expected)
      cut += expected
      fits += cards.length - expected
    }

    expect(fits).toBeGreaterThan(0)
    expect(cut).toBeGreaterThan(0)
    await pane.unmount()
  })

  test('3: the cut test: isCut is true for a name over two lines or shortened by the tag, false otherwise', () => {
    const row = (task: string, route?: string) => ({ ...ALPHA_ROWS[8]!, task, ...(route === undefined ? {} : { route }) })

    expect(cardView(row('short'), 40).isCut).toBe(false)
    expect(cardView(row('word '.repeat(30)), 40).isCut).toBe(true)
    // a name of exactly the inside width plus a tag: the tag takes a line of its own, nothing is cut
    expect(cardView(row('x'.repeat(30), 'spawn × subagent · Sonnet — x'), 40).isCut).toBe(false)
    // two full lines and a tag: the second line is shortened for the tag
    expect(cardView(row(`${'a'.repeat(35)} ${'b'.repeat(35)}`, 'spawn × subagent · Sonnet — x'), 40).isCut).toBe(true)
  })
})

describe('plan-tracker pane: a surface with no Client', () => {
  test('vscode has no Client in its table: the cards fall back to Buttons and still open their page', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await $.ui.mount({
      plugin: 'plan-tracker',
      surface: 'vscode',
      component: 'Pane',
      requestId: PANE_ID,
      props: paneProps(140),
      viewport: { columns: 200, rows: 50, isFullscreen: false },
    })

    expect(await pane.findAll({ type: 'Client' })).toEqual([])
    await pane.press({ key: `card:${indexOfTask('t2')}` })
    expect(await pane.find({ key: 'detail' })).toBeDefined()
    await pane.unmount()
  })
})

describe('plan-tracker pane: R4 review changes', () => {
  const LONGER = 'A long task name that cannot fit one narrow card and must be shown whole when the pointer is on it'
  const board: PlanBoard = {
    ...BOARD,
    plans: [{ ...BOARD.plans[0]!, rows: [{ ...ALPHA_ROWS[6]!, task: LONGER }, { ...ALPHA_ROWS[8]!, task: `${LONGER} todo` }] }],
  }

  test('M2: a card without the mascot is covered from its own edge; one with it only right of the mascot, which stays in view', async ($, on) => {
    world(on, { fixture: board })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 140)
    const width = laneWidth(140)

    const [doing] = await revealsOf(pane, 'In Progress')
    const [todo] = await revealsOf(pane, 'Todo')

    expect(doing?.props).toMatchObject({ left: REVEAL_LEFT, width: width - REVEAL_LEFT })
    expect(todo?.props).toMatchObject({ left: 0, width })
    // the revealed lines wrap to the room right of the mascot: none is wider than the box's inside
    for (const line of kids(doing)) {
      expect(displayWidth(textOf(line))).toBeLessThanOrEqual(width - REVEAL_LEFT - 4)
    }

    // the mascot is still drawn by the card's own Client, at the card's left
    expect(textOf((await cardRowsIn(pane, 0))[0]).startsWith('▄█▜▛█▄ ')).toBe(true)
    await pane.unmount()
  })

  test('m1: the revealed box is a floating layer: heavy border in the lane colour, not dim', async ($, on) => {
    world(on, { fixture: board })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 140)

    const [doing] = await revealsOf(pane, 'In Progress')
    const [todo] = await revealsOf(pane, 'Todo')

    expect(doing?.props).toMatchObject({ borderStyle: 'bold', borderColor: 'suggestion' })
    expect(todo?.props).toMatchObject({ borderStyle: 'bold', borderColor: 'inactive' })
    expect(doing?.props.borderDimColor).toBeUndefined()
    await pane.unmount()
  })

  test('M1: the overflow button is never cut inside its brackets: it shortens to "+13 more ▾" and "less ▴"', () => {
    const lane = { moreLabel: '+3 blocked · 10 running', more: 13 }

    expect(overflowLabel(lane, 40)).toBe('+3 blocked · 10 running ▾')
    expect(overflowLabel(lane, 29)).toBe('+3 blocked · 10 running ▾')
    expect(overflowLabel(lane, 28)).toBe('+13 more ▾')
    expect(overflowLabel({ moreLabel: 'Show less', more: 0 }, 12)).toBe('less ▴')
    expect(overflowLabel({ moreLabel: 'Show less', more: 0 }, 30)).toBe('Show less ▴')
    for (const width of [20, 24, 27, 30, 34, 40]) {
      const label = overflowLabel(lane, width)

      expect(label.includes('…')).toBe(false)
    }
  })

  test('M1: in a 26-column lane the In Progress overflow draws the short form, whole', async ($, on) => {
    const busy: PlanBoard = {
      ...BOARD,
      plans: [
        {
          ...BOARD.plans[0]!,
          rows: [
            ...Array.from({ length: 6 }, (_, at) => ({ ...ALPHA_ROWS[7]!, task: `stuck ${at}` })),
            ...Array.from({ length: 12 }, (_, at) => ({ ...ALPHA_ROWS[6]!, task: `run ${at}` })),
          ],
        },
      ],
    }
    world(on, { fixture: busy })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 110)

    expect(laneWidth(110)).toBe(26)
    expect(await pane.find({ key: 'lane:In Progress:more' })).toMatchObject({ props: { label: '+13 more ▾' } })
    await pane.unmount()
  })

  test('m2: a point that is only a bracketed tag is a line of its own with no bullet, bold; red when the task is Blocked', async ($, on) => {
    const note = 'three checks, no diff；T2 lists；【Blocked on you】'
    const board2: PlanBoard = { ...BOARD, plans: [{ ...BOARD.plans[0]!, rows: [{ ...ALPHA_ROWS[7]!, note }, { ...ALPHA_ROWS[6]!, note }] }] }

    world(on, { fixture: board2 })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    await openCard(pane, 0)

    const lines = await noteRows(pane)
    const cells = lines.map(line => kids(line))

    expect(cells.map(parts => parts.map(textOf).join('').trimEnd())).toEqual(['• three checks, no diff', '• T2 lists', '【Blocked on you】'])
    expect(cells[2]?.[0]?.props).toMatchObject({ bold: true, color: 'error' })
    expect(cells[0]?.[0]?.props?.bold).toBeUndefined()
    await pane.press({ key: 'back' })

    await openCard(pane, 1)

    const running = (await noteRows(pane)).map(line => kids(line))

    expect(running[2]?.[0]?.props?.bold).toBe(true)
    expect(running[2]?.[0]?.props?.color).toBeUndefined()
    await pane.unmount()
  })

  test('m2: a "needs you" point with text after it stays a bold purple bullet', async ($, on) => {
    const board2: PlanBoard = { ...BOARD, plans: [{ ...BOARD.plans[0]!, rows: [{ ...ALPHA_ROWS[6]!, note: 'one；Needs you to decide' }] }] }

    world(on, { fixture: board2 })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    await openCard(pane, 0)

    const parts = (await noteRows(pane)).map(line => kids(line)[0])

    expect(textOf(parts[1])).toBe('• Needs you to decide')
    expect(parts[1]?.props).toMatchObject({ color: 'merged', bold: true })
    await pane.unmount()
  })
})

describe('plan-tracker pane: the Verify lane with a Verifying row', () => {
  const row = (task: string, status: 'Verifying' | 'Needs Verification', route?: string) => ({ ...ALPHA_ROWS[10]!, task, status, ...(route === undefined ? {} : { route }) })
  const VERIFY: PlanBoard = {
    ...BOARD,
    plans: [
      {
        ...BOARD.plans[0]!,
        rows: [
          row('w1 waiting plain', 'Needs Verification', 'serial × inline · Opus — x'),
          row('v1 verifying a', 'Verifying', 'serial × subagent · Sonnet — x'),
          row('w2 waiting for her', 'Needs Verification', 'serial × Sam · — — she decides'),
        ],
      },
    ],
  }

  test('lane order, header, and the cards\' borders: Verifying full strength, waiting rows dim, all in the Verify colour', async ($, on) => {
    world(on, { fixture: VERIFY })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 140)

    const lane = await pane.find({ key: 'lane:Verify' })
    const cards = await cardsOf(pane, 'Verify')

    expect(textOf(kids(lane)[0])).toBe('Verify 3 · 1 verifying')
    expect(cards.map(box => box.props.key)).toEqual(['cardbox:1', 'cardbox:2', 'cardbox:0'])
    expect(cards.map(box => box.props.borderColor)).toEqual(['warning', 'warning', 'warning'])
    expect(cards.map(box => box.props.borderDimColor)).toEqual([false, true, true])
    await pane.unmount()
  })

  test('the Verifying card has the mascot, in the claude colour, and a bold name; the Needs Verification cards have none', async ($, on) => {
    world(on, { fixture: VERIFY })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 140)

    const verifying = await cardRowsIn(pane, 1)

    expect(verifying).toHaveLength(2)
    expect(verifying[0]?.children[0]).toMatchObject({ props: { color: 'claude' } })
    expect(verifying[0]?.children[1]).toMatchObject({ props: { bold: true } })

    for (const at of [0, 2]) {
      const rows = await cardRowsIn(pane, at)

      expect(JSON.stringify(rows)).not.toContain('"color":"claude"')
      expect(textOf(rows[0])).not.toMatch(/[▄█▜▛]/)
    }

    await pane.unmount()
  })

  test('the Verifying mascot moves: the pose changes with the frame; a waiting card draws no mascot to move', async ($, on) => {
    const w = world(on, { fixture: VERIFY })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 140)

    const art = async () => (await cardRowsIn(pane, 1))[1]?.children[0]?.children[0]
    const before = await art()

    await w.clock.advance(FRAME_MS * 3)

    expect(await art()).not.toBe(before)
    expect(before).toBe(`${MASCOT[0][1]} `)
    await pane.unmount()
  })

  test('a Verifying row alone starts the animation timer, as the band\'s running mascot', async ($, on) => {
    const count = (on2: Parameters<typeof world>[0]) => {
      const writes = { frames: 0 }

      on2('state.set', ($2, e, next) => {
        if ((e as { key?: string }).key === 'frame') {
          writes.frames += 1
        }

        return next(e)
      })

      return writes
    }
    const only = (status: 'Verifying' | 'Needs Verification'): PlanBoard => ({ ...BOARD, plans: [{ ...BOARD.plans[0]!, rows: [row('only', status)] }] })

    const w1 = world(on, { fixture: only('Verifying') })
    const verifying = count(on)
    await $.session.start(SESSION)
    await w1.clock.advance(FRAME_MS * 5)

    expect(verifying.frames).toBe(5)
  })

  test('the task page words Verifying as "Being checked" in the Verify colour', async ($, on) => {
    world(on, { fixture: VERIFY })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    await openCard(pane, 1)

    const status = kids(kids(await pane.find({ key: 'field:status' }))[0]).find(node => textOf(node).trim() === 'Being checked')

    expect(status?.props.color).toBe('warning')
    await pane.unmount()
  })

  test('a long Verifying name reveals right of the mascot, like a running card', async ($, on) => {
    const board: PlanBoard = { ...VERIFY, plans: [{ ...VERIFY.plans[0]!, rows: [row('A long task name that cannot fit one narrow card and must be shown whole when the pointer is on it', 'Verifying')] }] }
    world(on, { fixture: board })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 140)

    const [reveal] = await revealsOf(pane, 'Verify')

    expect(reveal?.props).toMatchObject({ left: REVEAL_LEFT, borderColor: 'warning', borderStyle: 'bold' })
    await pane.unmount()
  })

  test('a row from the tracker\'s --json (who, no note, no route) draws: a card, its ◆ and tag when it waits on her, and a task page', async ($, on) => {
    const bare = { task: 'from json', status: 'Needs Verification' as const, who: 'serial × Sam · —', updated: null }
    const board: PlanBoard = { ...BOARD, plans: [{ ...BOARD.plans[0]!, rows: [bare] }] }
    world(on, { fixture: board })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 140)

    expect(textOf((await cardRowsIn(pane, 0))[0])).toStartWith('◆ needs you · from json')
    await openCard(pane, 0)
    expect(await fieldText(pane, 'status')).toBe('Status Waiting for your check')
    expect(await fieldText(pane, 'who')).toBe('Done by you')
    expect(await pane.find({ key: 'field:note' })).toBeUndefined()
    await pane.unmount()
  })
})

describe('plan-tracker pane: the Verify lane overflow', () => {
  const row = (task: string, status: 'Verifying' | 'Needs Verification', route?: string) => ({ ...ALPHA_ROWS[10]!, task, status, ...(route === undefined ? {} : { route }) })
  const OVER: PlanBoard = {
    ...BOARD,
    plans: [
      {
        ...BOARD.plans[0]!,
        rows: [
          ...Array.from({ length: 5 }, (_, at) => row(`v${at}`, 'Verifying')),
          row('h1 waits on her', 'Needs Verification', 'serial × Sam · — — she decides'),
          row('w1 waits plain', 'Needs Verification', 'serial × inline · Opus — x'),
        ],
      },
    ],
  }

  test('the button says how many hidden rows are "◆ needs you"; pressing it shows them and a Show less button', async ($, on) => {
    world(on, { fixture: OVER })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 140)

    expect(await cardsOf(pane, 'Verify')).toHaveLength(5)
    expect((await pane.find({ key: 'lane:Verify:more' }))?.props.label).toBe('+2 more · 1 needs you ▾')

    await pane.press({ key: 'lane:Verify:more' })

    expect(await cardsOf(pane, 'Verify')).toHaveLength(7)
    expect(textOf(kids(await pane.find({ key: 'lane:Verify' }))[0])).toContain('Show less')
    await pane.unmount()
  })

  test('a lane too narrow for the long label keeps the short form with the arrow', async ($, on) => {
    world(on, { fixture: OVER })
    await $.session.start(SESSION)
    // 100 columns is the narrowest side-by-side board: lanes of 24 columns, and the long label needs 27
    const pane = await mountPane($, 'terminal', 100)

    expect((await pane.find({ key: 'lane:Verify:more' }))?.props.label).toBe('+2 more ▾')
    await pane.unmount()
  })
})
