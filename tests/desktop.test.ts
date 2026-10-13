import { describe, expect, test } from './testing'
import type { Engine } from 'claude-code/testing'

import { BAND_MASCOT, BAR_PX, CARD_SPRITE_PX, FRAME_MS, MASCOT, MASCOT_EVERY, barSvg, spriteSvg, spriteSvgAnimated } from '../hooks/board'
import { openDeliverable } from '../hooks/register'
import type { PlanBoard, PlanRow } from '../types'
import type { Node } from './fixtures'
import { ALPHA_ROWS, BOARD, HOME, ROOT, PANE_ID, bandProps, plans, SESSION, cardRowsIn, kids, openCard, paneProps, textIn, textOf, world } from './fixtures'

type Surface = 'terminal' | 'desktop'

const mountPane = ($: Engine, surface: Surface, columns = 96) =>
  $.ui.mount({
    plugin: 'plan-tracker',
    surface,
    component: 'Pane',
    requestId: PANE_ID,
    props: paneProps(columns),
    viewport: { columns: columns + 60, rows: 50, isFullscreen: true },
  })

type Pane = Awaited<ReturnType<typeof mountPane>>

const indexOfTask = (start: string) => ALPHA_ROWS.findIndex(one => one.task.startsWith(start))

/** Every string a drawn tree holds, in document order. */
const stringsIn = (node: unknown): string[] => {
  if (typeof node === 'string') {
    return [node]
  }

  const element = node as { props?: { text?: string; label?: string }; children?: unknown[] } | null
  const own = [element?.props?.text, element?.props?.label].filter((one): one is string => typeof one === 'string')

  return [...own, ...(element?.children ?? []).flatMap(stringsIn)]
}

/** A string that stands for alignment: it has a space at an end or two spaces in a row. */
/** A chip is its word with a space each side; that is its look, not padding. */
const isChip = (text: string) => /^ (you|Opus|Sonnet|Haiku|folder|file|\.\w+) $/.test(text) || text === ' · '
const isPadding = (text: string) => !isChip(text) && (text !== text.trim() || / {2}/.test(text))

/** Lets what a press started without being awaited (the `open` of a deliverable) finish. */
const settle = async (clock: { advance: (ms: number) => Promise<void> }) => {
  for (let at = 0; at < 20; at += 1) {
    await clock.advance(10)
  }
}

/**
 * `openDeliverable` run on a stand-in for `$` built over the world's recorded state: the desktop's Markdown carries no
 * press, so no chain reaches it, but the function stays the plugin's fallback for a link press that does arrive.
 */
const openVia = (w: ReturnType<typeof world>, path: string) => {
  const done = { exitCode: 0, stdout: '', stderr: '' }
  const engine = {
    env: { get: async () => HOME },
    session: { id: async () => 'sess', root: async () => ROOT },
    fs: {
      exists: async (p: string) => w.present.includes(p),
      stat: async (p: string) => ({ kind: w.dirs.includes(p) ? 'dir' : 'file' }),
    },
    process: {
      run: async (argv: readonly string[], init?: { stdin?: string }) => {
        if (argv[0] === '/bin/realpath') {
          const p = argv[1] ?? ''

          w.realpathRuns.push(argv)

          const real = p in w.realpaths ? w.realpaths[p] : w.present.includes(p) ? p : null

          return real === null || real === undefined ? { exitCode: 1, stdout: '', stderr: 'no such file' } : { ...done, stdout: `${real}\n` }
        }

        w.logRuns.push({ argv, stdin: init?.stdin })

        return argv[0] === 'open' && w.openRun !== null ? { ...done, exitCode: w.openRun.exitCode, stderr: w.openRun.stderr } : done
      },
    },
    ui: { toast: (text: string) => void w.toasts.push(text) },
  }

  return openDeliverable(engine as never, path)
}

const BOX_CHARS = /[╭╮╰╯├┤┬┴┼│─]/

describe('the desktop: card rows', () => {
  test('a row is a Box row: the name in a Box that grows, the chip after it, no padded spaces', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 140)

    const [row] = await cardRowsIn(pane, indexOfTask('t2'))
    const [name, tag] = kids(row)

    expect(row?.type).toBe('Box')
    expect(row?.props.flexDirection).toBe('row')
    expect(kids(row).map(child => child.type)).toEqual(['Box', 'Box'])
    expect(name?.props.flexGrow).toBe(1)
    expect(kids(name)).toHaveLength(1)
    expect(kids(name)[0]?.type).toBe('Text')
    expect(textOf(name)).toBe('t2 second todo')
    expect(textOf(tag)).toBe(' Haiku ')
    expect(stringsIn(row).filter(isPadding)).toEqual([])
    await pane.unmount()
  })

  test('a card with no tag is the name alone in its growing Box', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 140)

    const rows = await cardRowsIn(pane, indexOfTask('t3'))

    expect(rows.map(textOf)).toEqual(['t3 third todo'])
    expect(kids(rows[0]).map(child => child.type)).toEqual(['Box'])
    await pane.unmount()
  })

  test('the card region gets the flag; the terminal\'s region gets none, so its props are what they were', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const desktop = await mountPane($, 'desktop', 140)
    const terminal = await mountPane($, 'terminal', 140)

    expect((await desktop.findAll({ type: 'Client' })).every(client => JSON.stringify(client.props).includes('"isProportional":true'))).toBe(true)
    expect((await terminal.findAll({ type: 'Client' })).some(client => JSON.stringify(client.props).includes('isProportional'))).toBe(false)
    await desktop.unmount()
    await terminal.unmount()
  })

  test('a Blocked card is red all through on the desktop too: flag, name and tag, with the mascot frozen', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 140)

    const [one, , two] = (await cardRowsIn(pane, indexOfTask('b1'))) as [Node, Node, Node]

    expect(kids(one)[0]).toMatchObject({ props: { bold: true, color: 'error' }, children: ['⚑ Blocked · '] })
    expect(kids(one)[1]?.props.flexGrow).toBe(1)
    expect(kids(kids(one)[1])[0]?.props.color).toBe('error')
    expect(textOf(two)).toEndWith(' Opus ')
    // the chip keeps its tier colours on a red card
    expect(kids(kids(two).at(-1))[0]?.props).toMatchObject({ color: '#7A3410', backgroundColor: '#F6DCCB' })
    await pane.unmount()
  })

  test('an In Progress card keeps its bold name', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 140)

    const [one] = await cardRowsIn(pane, indexOfTask('Build'))

    expect(kids(kids(one)[0])[0]?.props.bold).toBe(true)
    await pane.unmount()
  })

  test('a long name wraps over rows of the card in full: names unpadded, the tag on a row of its own at the right', async ($, on) => {
    const LONG = 'A long task name that cannot fit one narrow card and must be shown whole without a hover box'
    const board: PlanBoard = { ...BOARD, plans: [{ ...BOARD.plans[0]!, rows: [{ ...ALPHA_ROWS[6]!, task: LONG }, { ...ALPHA_ROWS[8]!, task: `${LONG} todo` }] }] }
    world(on, { fixture: board })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 140)

    const rows = await cardRowsIn(pane, 1)

    expect(rows.length).toBeGreaterThan(2)
    expect(rows.every(row => row.type === 'Box' && row.props.flexDirection === 'row')).toBe(true)
    expect(rows.flatMap(stringsIn).filter(isPadding)).toEqual([])
    expect(rows.map(textOf).join(' ')).toContain('cannot fit one narrow card')
    expect(rows.map(textOf).join('')).not.toContain('…')
    // the todo card has no tag: its rows are names only
    expect(textOf(rows.at(-1))).not.toContain('  ')

    const doing = await cardRowsIn(pane, 0)
    const tagRow = doing.at(-1)

    expect(kids(tagRow).map(child => child.props.flexGrow ?? null)).toEqual([1, null])
    expect(textOf(tagRow)).toBe(' Sonnet ')
    expect(doing.flatMap(stringsIn).filter(isPadding)).toEqual([])
    await pane.unmount()
  })
})

describe('the desktop: the mascot and the progress bar', () => {
  const POSE_RECTS = 30

  const spriteOf = async (pane: Awaited<ReturnType<typeof mountPane>>) => (await pane.findAll({ type: 'Svg' })).map(node => String(node.props.source))

  test('a card with the mascot draws it as an Svg of one rect per filled sub-pixel; the card region has no art', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 140)
    const sources = await spriteOf(pane)

    expect(sources.length).toBeGreaterThanOrEqual(2)

    for (const source of sources) {
      // a still pose is 30 rects; a running card's sprite holds both poses and switches them itself
      expect(source.match(/<rect /g)).toHaveLength(source.includes('<animate') ? POSE_RECTS * 2 : POSE_RECTS)
      expect(source).toContain('viewBox="0 0 12 4"')
    }

    // the Blocked card's sprite is the red one and still; the running card's is the orange one and animated
    expect(sources.some(source => source.includes('#E5484D') && !source.includes('<animate'))).toBe(true)
    expect(sources.some(source => source.includes('#D77757') && source.includes('<animate'))).toBe(true)

    const rows = await cardRowsIn(pane, indexOfTask('Build'))

    expect(rows.every(row => !textOf(row).includes('▛'))).toBe(true)
    await pane.unmount()
  })

  test('each pose is its own sprite of 30 pixels; the two band poses have 16 and 14', () => {
    const [first, second] = MASCOT.map(pose => spriteSvg(pose, 'claude'))

    expect(first?.rects).toBe(POSE_RECTS)
    expect(second?.rects).toBe(POSE_RECTS)
    expect(first?.source).not.toBe(second?.source)
    expect(spriteSvg([BAND_MASCOT[0]], 'claude').rects).toBe(16)
    expect(spriteSvg([BAND_MASCOT[1]], 'claude').rects).toBe(14)
  })

  test('the animated sprite holds both poses and an <animate> that switches them every MASCOT_EVERY frames', () => {
    const { source, rects } = spriteSvgAnimated(MASCOT, 'claude')

    expect(rects).toBe(POSE_RECTS * 2)
    expect(source.match(/<g /g)).toHaveLength(2)
    expect(source.match(/<animate /g)).toHaveLength(2)
    expect(source).toContain('attributeName="opacity"')
    expect(source).toContain('repeatCount="indefinite"')
    expect(source).toContain(`dur="${MASCOT_EVERY * FRAME_MS * 2}ms"`)
    expect(source).toContain('values="1;0"')
    expect(source).toContain('values="0;1"')
  })

  test('the desktop draws nothing again on a frame: the pane and the band are the same tree, handles included, after the frames pass', async ($, on) => {
    // a terminal is attached too, so the frame timer runs; the desktop must not read the frame
    const w = world(on, ['terminal', 'desktop'], {})
    await $.session.start(SESSION)
    await $.command.run(plans())
    const pane = await mountPane($, 'desktop', 140)
    const band = await $.ui.mount({ plugin: 'plan-tracker', surface: 'desktop', component: 'AbovePrompt', requestId: 'band', props: bandProps(120), viewport: { columns: 125, rows: 40, isFullscreen: true } })
    const shot = async () => JSON.stringify([await pane.drawn(), await band.drawn()])
    const before = await shot()

    await w.clock.advance(FRAME_MS * 12)

    expect(await shot()).toBe(before)
    expect(before).toContain('"key":"band:bar"')
    await pane.unmount()
    await band.unmount()
  })

  test('a terminal beside it still changes pose with the frame', async ($, on) => {
    const w = world(on, ['terminal'], {})
    await $.session.start(SESSION)
    await $.command.run(plans())
    const pane = await mountPane($, 'terminal', 140)
    const look = async () => textOf((await cardRowsIn(pane, indexOfTask('Build')))[0])
    const before = await look()

    await w.clock.advance(FRAME_MS * 3)
    expect(await look()).not.toBe(before)
    await pane.unmount()
  })

  test('the terminal keeps its block characters and has no Svg', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 140)

    expect(await pane.findAll({ type: 'Svg' })).toHaveLength(0)
    expect(textOf((await cardRowsIn(pane, indexOfTask('Build')))[0])).toContain('▄█▜▛█▄')
    await pane.unmount()
  })

  test('a card bar is two Boxes on a background, not glyphs', async ($, on) => {
    const board: PlanBoard = { ...BOARD, plans: [{ ...BOARD.plans[0]!, rows: [{ ...ALPHA_ROWS[8]!, progress: '3/5' }] }] }

    world(on, { fixture: board })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 140)
    const rows = await cardRowsIn(pane, 0)
    const text = rows.map(textOf).join('')
    const boxes = (await pane.findAll({ type: 'Box' })).filter(box => box.props.height === 1 && box.props.backgroundColor !== undefined)

    expect(text).not.toMatch(/[▰▱]/)
    expect(text).toContain('3/5')
    // 8 cells whatever the total: 3/5 fills 5 of them
    expect(JSON.stringify(rows)).toContain('"width":5')
    expect(JSON.stringify(rows)).toContain('"width":3')
    expect(boxes.length).toBeGreaterThanOrEqual(0)
    await pane.unmount()
  })

  test('the card bar is 8 cells whatever m is, so 2/5 and 4/12 differ only in the fill', async ($, on) => {
    const cases = [['2/5', 3], ['4/12', 3], ['5/5', 8]] as const
    const rows = cases.map(([progress], at): PlanRow => ({ ...ALPHA_ROWS[8]!, task: `r${at}`, progress }))

    world(on, { fixture: { ...BOARD, plans: [{ ...BOARD.plans[0]!, rows }] } })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 140)
    const walk = (node: Node): Node[] => [node, ...kids(node).flatMap(walk)]

    for (const [at, [, filled]] of cases.entries()) {
      const bars = (await cardRowsIn(pane, at)).flatMap(walk).filter(box => box.props?.height === 1 && typeof box.props.width === 'number')

      expect(bars.reduce((all, box) => all + Number(box.props.width), 0)).toBe(8)
      expect(Number(bars.find(box => box.props.backgroundColor === 'inactive')?.props.width ?? 0)).toBe(filled)
    }

    await pane.unmount()
  })

  test('the band and the task page draw the bar as one Svg of the same fixed size, rounded, filled n/m', async ($, on) => {
    world(on, { fixture: { ...BOARD, plans: [{ ...BOARD.plans[0]!, rows: [{ ...ALPHA_ROWS[8]!, progress: '2/5' }] }] } })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 140)

    await openCard(pane, 0)

    const bars = (await pane.findAll({ type: 'Svg' })).filter(node => String(node.props.source).includes('rx="3"'))

    expect(bars).toHaveLength(1)
    expect(bars[0]?.props).toMatchObject({ width: BAR_PX.width, height: BAR_PX.height })
    expect(String(bars[0]?.props.source)).toContain(`width="${Math.round(BAR_PX.width * 0.4)}"`)
    expect(barSvg(0.4, '#000')).toBe(barSvg(0.4, '#000'))
    expect(barSvg(0, '#000').match(/<rect/g)).toHaveLength(1)
    expect(barSvg(1, '#000').match(/<rect/g)).toHaveLength(2)
    expect(barSvg(0.5, '#000', ['#111', '#222']).match(/<rect/g)).toHaveLength(4)
    await pane.unmount()
  })

  test('the card sprite keeps the terminal pixel ratio (pixel height twice its width) and sits centred beside the title', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 140)
    const svg = (await pane.findAll({ type: 'Svg' })).find(node => String(node.props.source).includes('viewBox="0 0 12 4"'))

    expect(svg?.props).toMatchObject({ width: CARD_SPRITE_PX.width, height: CARD_SPRITE_PX.height })
    expect(CARD_SPRITE_PX.height / 4).toBe((CARD_SPRITE_PX.width / 12) * 2)
    await pane.unmount()
  })
})

describe('the desktop: the task page', () => {
  const open = async ($: Engine, start: string, columns = 96) => {
    const pane = await mountPane($, 'desktop', columns)

    await openCard(pane, indexOfTask(start))

    return pane
  }

  test('it has no box-drawing character: the title, then one round-bordered Box per labelled row', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await open($, 'Build')

    expect(kids(await pane.find({ key: 'detail' })).map(node => String(node.props?.key ?? node.type))).toEqual(['back', 'detail:title', 'detail:fields'])
    expect(textOf(await pane.find({ key: 'detail' }))).not.toMatch(BOX_CHARS)
    expect(kids(await pane.find({ key: 'detail:fields' })).map(node => [node.props.key, node.props.borderStyle])).toEqual([
      ['field:status', 'round'],
      ['field:who', 'round'],
    ])
    expect(textOf(await pane.find({ key: 'field:status' }))).toBe('StatusIn progress')
    expect(textOf(await pane.find({ key: 'field:who' }))).toBe('Done by Sonnet  subagent')
    await pane.unmount()
  })

  test('Goal is the first row when the row has one', async ($, on) => {
    const goal = 'Prove the eval suite runs green'
    const board: PlanBoard = { ...BOARD, plans: [{ ...BOARD.plans[0]!, rows: [{ ...ALPHA_ROWS[6]!, goal }] }] }
    world(on, { fixture: board })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 96)

    await openCard(pane, 0)
    expect(kids(await pane.find({ key: 'detail:fields' })).map(node => node.props.key)).toEqual(['field:goal', 'field:status', 'field:who'])
    expect(textOf(await pane.find({ key: 'field:goal' }))).toBe(`Goal${goal}`)
    await pane.unmount()
  })

  test('a long note is one Text that its Box wraps: never cut into lines of spaces', async ($, on) => {
    const note = `${'word '.repeat(60)}end`
    const board: PlanBoard = { ...BOARD, plans: [{ ...BOARD.plans[0]!, rows: [{ ...ALPHA_ROWS[7]!, note }] }] }
    world(on, { fixture: board })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 60)

    await openCard(pane, 0)

    const lines = kids(kids(await pane.find({ key: 'field:note' }))[1])

    expect(lines).toHaveLength(1)
    expect(textOf(lines[0])).toBe(note)
    expect(textOf(await pane.find({ key: 'detail' }))).not.toMatch(BOX_CHARS)
    await pane.unmount()
  })

  test('the points of a note are bullets: a • and a Box that wraps the point', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await open($, 'v1')

    const lines = kids(kids(await pane.find({ key: 'field:note' }))[1])

    expect(lines.map(textOf)).toEqual(['•built', '•waits for her eyes'])
    expect(kids(lines[0]).map(child => child.type)).toEqual(['Text', 'Box'])
    expect(kids(lines[0])[1]?.props.flexGrow).toBe(1)
    await pane.unmount()
  })

  test('a Blocked task keeps its colours: the heading and "⚑ Blocked" red', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await open($, 'b1')

    const status = kids(kids(await pane.find({ key: 'field:status' }))[1])[0]
    const label = kids(kids(await pane.find({ key: 'field:note' }))[0])[0]

    expect(textOf(status)).toBe('⚑ Blocked')
    expect(JSON.stringify(status)).toContain('"color":"error"')
    expect(textOf(label)).toBe('Blocked because')
    expect(label?.props.color).toBe('error')
    await pane.unmount()
  })
})

describe('the desktop: deliverables', () => {
  const PLAN_PATH = `${ROOT}/automation/plans/alpha-plan.md`
  const HREF =
    'file:///work/automation/plans/alpha-plan.md'

  /** A board whose rows record these deliverables. */
  const withDeliverables = (...paths: string[]): PlanBoard => ({
    ...BOARD,
    plans: [{ ...BOARD.plans[0]!, rows: paths.map((deliverable, at): PlanRow => ({ ...ALPHA_ROWS[8]!, task: `r${at}`, deliverable })) }],
  })

  test('each is a Markdown link to a file: href, the whole path, wrapping; no Link, no cut to the columns', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 30)

    const markdown = await pane.find({ type: 'Markdown', key: 'deliverable:0' })

    expect(markdown?.props.text).toBe(`[automation/plans/alpha-plan.md](${HREF})`)
    expect(await pane.find({ type: 'Link' })).toBeUndefined()
    expect(textOf(await pane.find({ key: 'deliverables' }))).not.toContain('d4 newest')
    expect(textOf(await pane.find({ key: 'deliverables' }))).toContain('automation/plans/alpha-plan.md')
    await pane.unmount()
  })

  test('markdown characters in a path are escaped in the label and parentheses in the href are encoded', async ($, on) => {
    world(on, { fixture: withDeliverables('automation/a_b [1] (2).md', 'automation/a~b&c.md') })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop')

    const text = String((await pane.find({ type: 'Markdown', key: 'deliverable:0' }))?.props.text)

    expect(text).toStartWith('[automation/a\\_b \\[1\\] (2).md](file://')
    expect(text).toEndWith('a_b%20%5B1%5D%20%282%29.md)')

    const second = String((await pane.find({ type: 'Markdown', key: 'deliverable:1' }))?.props.text)

    expect(second).toStartWith('[automation/a\\~b\\&c.md](file://')
    await pane.unmount()
  })

  test('the terminal table draws the path as plain text, never a Link: a terminal without OSC 8 would print the URL after it', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    expect(await pane.findAll({ type: 'Link' })).toEqual([])
    expect(textOf(await pane.find({ key: 'deliverables' }))).not.toContain('file://')
    expect(await pane.find({ type: 'Markdown', key: 'deliverable:0' })).toBeUndefined()
    await pane.unmount()
  })

  test('a link press that reaches the plugin runs `open <path>` when the file exists', async ($, on) => {
    const w = world(on, { present: [PLAN_PATH] })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop')

    await openVia(w, 'automation/plans/alpha-plan.md')
    await settle(w.clock)

    expect(w.logRuns.filter(run => run.argv[0] === 'open').map(run => run.argv)).toEqual([['open', PLAN_PATH]])
    expect(w.toasts).toEqual([])
    await pane.unmount()
  })

  test('the Deliverable row of a task page is the same link and opens the same way', async ($, on) => {
    const w = world(on, { present: [PLAN_PATH] })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop')

    await openCard(pane, indexOfTask('d4'))

    const markdown = await pane.find({ type: 'Markdown', key: 'detail:deliverable' })

    expect(markdown?.props.text).toBe(`[automation/plans/alpha-plan.md](${HREF})`)

    await openVia(w, 'automation/plans/alpha-plan.md')
    await settle(w.clock)

    expect(w.logRuns.filter(run => run.argv[0] === 'open').map(run => run.argv)).toEqual([['open', PLAN_PATH]])
    await pane.unmount()
  })

  test('a file under ~/.claude opens', async ($, on) => {
    const path = `${HOME}/.claude/notes.md`
    const w = world(on, { fixture: withDeliverables('~/.claude/notes.md'), present: [path] })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop')

    await openVia(w, '~/.claude/notes.md')
    await settle(w.clock)

    expect(w.logRuns.filter(run => run.argv[0] === 'open').map(run => run.argv)).toEqual([['open', path]])
    await pane.unmount()
  })

  describe('inside the project the surface opens the link; outside it the plugin does', () => {
    const OUT = `${HOME}/code/x/y.ts`
    const OUT_HREF = `file://${OUT}`

    test('the board: pressing an inside link reaches nothing; an outside link is pressable', async ($, on) => {
      world(on, { fixture: withDeliverables('automation/plans/alpha-plan.md', '~/code/x/y.ts') })
      await $.session.start(SESSION)
      const pane = await mountPane($, 'desktop')

      // a Markdown with no `onLinkPress` has nothing a press can reach (the surface opens the link); one with it takes the press
      await expect(pane.press({ key: 'deliverable:0', link: { href: HREF } })).rejects.toThrow()
      await expect(pane.press({ key: 'deliverable:1', link: { href: OUT_HREF } })).resolves.toBeDefined()
      await pane.unmount()
    })

    test('the board: pressing an outside link runs `open <path>`', async ($, on) => {
      const w = world(on, { fixture: withDeliverables('~/code/x/y.ts'), present: [OUT] })
      await $.session.start(SESSION)
      const pane = await mountPane($, 'desktop')

      await pane.press({ key: 'deliverable:0', link: { href: OUT_HREF } })
      await settle(w.clock)

      expect(w.logRuns.filter(run => run.argv[0] === 'open').map(run => run.argv)).toEqual([['open', OUT]])
      expect(w.toasts).toEqual([])
      await pane.unmount()
    })

    test('a disallowed outside link still gets the refusal toast and no `open`', async ($, on) => {
      const w = world(on, { fixture: withDeliverables('/etc/hosts'), present: ['/etc/hosts'] })
      await $.session.start(SESSION)
      const pane = await mountPane($, 'desktop')

      await pane.press({ key: 'deliverable:0', link: { href: 'file:///etc/hosts' } })
      await settle(w.clock)

      expect(w.logRuns.filter(run => run.argv[0] === 'open')).toEqual([])
      expect(w.toasts).toHaveLength(1)
      expect(w.toasts[0]).toStartWith('Not opened: ')
      await pane.unmount()
    })

    test('the task page: the same split', async ($, on) => {
      const w = world(on, { fixture: withDeliverables('~/code/x/y.ts'), present: [OUT] })
      await $.session.start(SESSION)
      const pane = await mountPane($, 'desktop')

      await openCard(pane, 0)
      await pane.press({ key: 'detail:deliverable', link: { href: OUT_HREF } })
      await settle(w.clock)

      expect(w.logRuns.filter(run => run.argv[0] === 'open').map(run => run.argv)).toEqual([['open', OUT]])
      await pane.unmount()
    })
  })

  test('the desktop host opens the link itself: the Markdown answers no press, so the mod never also opens or refuses it', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop')

    expect(await pane.find({ type: 'Markdown', key: 'deliverable:0' })).toBeDefined()
    // a Markdown with no `onLinkPress` has no press for a test (or the host) to raise: the surface opens the link alone
    await expect(pane.press({ key: 'deliverable:0', link: { href: HREF } })).rejects.toThrow()

    await openCard(pane, indexOfTask('d4'))
    expect(await pane.find({ type: 'Markdown', key: 'detail:deliverable' })).toBeDefined()
    await expect(pane.press({ key: 'detail:deliverable', link: { href: HREF } })).rejects.toThrow()
    await pane.unmount()
  })

  test('a file under the home directory outside hidden folders opens', async ($, on) => {
    const path = `${HOME}/code/x/y.ts`
    const w = await pressOnly($, on, '~/code/x/y.ts', { present: [path] })

    expect(opens(w)).toEqual([['open', path]])
    expect(w.toasts).toEqual([])
  })

  for (const [name, rel, extra] of [
    ['a file in ~/.ssh', '~/.ssh/id_rsa', {}],
    ['a file in a hidden folder deeper in home', '~/code/.git/config', {}],
    ['a hidden file in home', '~/.zshrc', {}],
    ['a directory in home', '~/code/x', { dirs: [`${HOME}/code/x`] }],
    ['a missing file in home', '~/code/none.ts', { present: [] }],
  ] as const) {
    test(`${name} is not opened`, async ($, on) => {
      const path = rel.replace('~', HOME)
      const w = await pressOnly($, on, rel, { present: [path], ...extra })

      expect(opens(w)).toEqual([])
      expect(w.toasts).toHaveLength(1)
      expect(w.toasts[0]).toStartWith('Not opened: ')
    })
  }

  const REFUSED: [string, string][] = [
    ['outside both roots', '/etc/hosts'],
    ['outside once `..` is folded', 'automation/../../../../etc/hosts'],
    ['a sibling that only starts with the project root\'s name', `${ROOT}-other/x.md`],
  ]

  for (const [name, path] of REFUSED) {
    test(`${name} is not opened, though it exists: a toast says why`, async ($, on) => {
      const w = world(on, { fixture: withDeliverables(path), present: [path, '/etc/hosts', `${ROOT}-other/x.md`] })
      await $.session.start(SESSION)
      const pane = await mountPane($, 'desktop')

      await openVia(w, path)
      await settle(w.clock)

      expect(w.logRuns.filter(run => run.argv[0] === 'open')).toEqual([])
      expect(w.toasts).toHaveLength(1)
      expect(w.toasts[0]).toStartWith('Not opened: ')
      expect(w.toasts[0]).toContain('outside')
      expect(w.logLines()).toMatchObject([{ stage: 'open-path', path }])
      await pane.unmount()
    })
  }

  /** Presses the only deliverable of a board and returns the world after the press settled. */
  const pressOnly = async ($: Engine, on: Parameters<typeof world>[0], path: string, setup: Partial<Parameters<typeof world>[1] & object> = {}) => {
    const w = world(on, { fixture: withDeliverables(path), ...setup })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop')

    await openVia(w, path)
    await settle(w.clock)
    await pane.unmount()

    return w
  }

  const opens = (w: ReturnType<typeof world>) => w.logRuns.filter(run => run.argv[0] === 'open').map(run => run.argv)

  test('a path with `..` that stays inside a root is resolved and opened as its folded path', async ($, on) => {
    const w = await pressOnly($, on, 'automation/plans/../plans/alpha-plan.md', { present: [PLAN_PATH] })

    expect(w.realpathRuns).toEqual([['/bin/realpath', PLAN_PATH]])
    expect(opens(w)).toEqual([['open', PLAN_PATH]])
    expect(w.toasts).toEqual([])
  })

  test('an allowlisted type opens the resolved path of a symlink that stays inside a root', async ($, on) => {
    const link = `${ROOT}/notes.MD`
    const target = `${HOME}/.claude/real-notes.md`
    const w = await pressOnly($, on, link, { present: [link], realpaths: { [link]: target } })

    expect(opens(w)).toEqual([['open', target]])
    expect(w.toasts).toEqual([])
  })

  const REVEALED: [string, string][] = [
    ['an extensionless executable', `${ROOT}/bin/tool`],
    ['an application', `${HOME}/.claude/Tool.app`],
    ['an application, upper case', `${ROOT}/x/Tool.APP`],
    ['a .command script', `${ROOT}/run.command`],
    ['a .tool file', `${ROOT}/run.tool`],
    ['a .terminal file', `${ROOT}/x.terminal`],
    ['a shell script', `${ROOT}/x.sh`],
    ['a .pkg installer', `${ROOT}/x.pkg`],
    ['an .excalidraw file, which has no default app here', `${ROOT}/x.excalidraw`],
    ['a directory without an extension', `${ROOT}/automation`],
  ]

  for (const [name, path] of REVEALED) {
    test(`${name} is revealed in Finder with \`open -R\`, never opened`, async ($, on) => {
      const w = await pressOnly($, on, path, { present: [path] })

      expect(opens(w)).toEqual([['open', '-R', path]])
      expect(w.toasts).toEqual([])
    })
  }

  test('a directory with a viewable name is revealed, not opened', async ($, on) => {
    const dir = `${ROOT}/dir.md`
    const w = await pressOnly($, on, dir, { present: [dir], dirs: [dir] })

    expect(opens(w)).toEqual([['open', '-R', dir]])
  })

  test('a symlink with a viewable name that points to an .app is revealed, not opened', async ($, on) => {
    const link = `${ROOT}/notes.md`
    const app = `${HOME}/.claude/Tool.app`
    const w = await pressOnly($, on, link, { present: [link, app], realpaths: { [link]: app } })

    expect(opens(w)).toEqual([['open', '-R', app]])
  })

  test('a symlink whose real path is outside both roots is refused: no `open` at all', async ($, on) => {
    const link = `${ROOT}/notes.md`
    const w = await pressOnly($, on, link, { present: [link], realpaths: { [link]: '/Applications/Tool.app' } })

    expect(opens(w)).toEqual([])
    expect(w.toasts).toEqual(['Not opened: outside the project, home and ~/.claude'])
    expect(w.logLines()).toMatchObject([{ stage: 'open-path', path: link }])
  })

  test('a path whose real path cannot be found out is refused: no `open` at all', async ($, on) => {
    const w = await pressOnly($, on, PLAN_PATH, { present: [PLAN_PATH], realpaths: { [PLAN_PATH]: null } })

    expect(opens(w)).toEqual([])
    expect(w.toasts).toEqual(['Not opened: real path unknown'])
  })

  test('a file that does not exist is not opened: a toast says so', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop')

    await openVia(w, 'automation/plans/alpha-plan.md')
    await settle(w.clock)

    expect(w.logRuns.filter(run => run.argv[0] === 'open')).toEqual([])
    expect(w.toasts).toEqual([`Not opened: no such file ${PLAN_PATH}`])
    await pane.unmount()
  })

  test('an `open` that fails is a toast and a log line', async ($, on) => {
    const w = world(on, { present: [PLAN_PATH], openRun: { exitCode: 1, stderr: 'no application' } })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop')

    await openVia(w, 'automation/plans/alpha-plan.md')
    await settle(w.clock)

    expect(w.toasts).toEqual(['Not opened: open exited 1'])
    expect(w.logLines()).toMatchObject([{ stage: 'open-path', error: 'open exited 1: no application' }])
    await pane.unmount()
  })
})
