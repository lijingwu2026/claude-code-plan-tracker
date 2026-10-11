import { describe, expect, test } from './testing'
import type { Engine } from 'claude-code/testing'

import { BAND_MASCOT, BAND_MASCOT_SPACE, RAINBOW, STATE_STYLE, displayWidth, rainbowAt } from '../hooks/board'
import { ALPHA_FILE, ALPHA_ROWS, BOARD, FILES, FRAME_MS, PANE_ID, SESSION, SURVEY, VIEW_INIT, bandProps, jsonArgv, kids, paneProps, plans, promptSubmit, textIn, textOf, world, openCard } from './fixtures'

const SURFACES = ['terminal', 'desktop'] as const

const mountBand = ($: Engine, surface: (typeof SURFACES)[number], columns = 120, hasSurvey = false) =>
  $.ui.mount({
    plugin: 'plan-tracker',
    surface,
    component: 'AbovePrompt',
    requestId: 'band',
    props: bandProps(columns, hasSurvey),
    viewport: { columns: columns + 5, rows: 40, isFullscreen: true },
  })

const mountPane = ($: Engine, surface: (typeof SURFACES)[number], columns = 96) =>
  $.ui.mount({
    plugin: 'plan-tracker',
    surface,
    component: 'Pane',
    requestId: PANE_ID,
    props: paneProps(columns),
    viewport: { columns: columns + 60, rows: 50, isFullscreen: true },
  })

type Band = Awaited<ReturnType<typeof mountBand>>

/** The band's one row without the mascot and its space. */
// The desktop draws the mascot as a picture, which has no text to cut off.
const rowOf = async (band: Band) => textOf(await band.find({ key: 'bar' })).slice((await band.findAll({ type: 'Svg' })).length > 0 ? 0 : BAND_MASCOT_SPACE)

describe('the band while the board shows the plan file', () => {
  test('the right end is "‹ Board" and pressing it returns to the lanes and gives the pane the keys', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    const band = await mountBand($, 'terminal')
    const pane = await mountPane($, 'terminal')

    expect((await rowOf(band)).endsWith('Plan file ›')).toBe(true)
    expect(await band.find({ key: 'band:board' })).toBeUndefined()

    await band.press({ key: 'band:file' })

    expect(await pane.find({ key: 'file' })).toBeDefined()
    expect((await rowOf(band)).endsWith('‹ Board')).toBe(true)
    expect(await band.find({ key: 'band:file' })).toBeUndefined()

    const before = w.opened.filter(one => one.focus === true).length

    await band.press({ key: 'band:board' })

    expect(await pane.find({ key: 'file' })).toBeUndefined()
    expect(await pane.find({ key: 'kanban' })).toBeDefined()
    expect((await rowOf(band)).endsWith('Plan file ›')).toBe(true)
    expect(w.opened.filter(one => one.focus === true).length).toBe(before + 1)
    await pane.unmount()
    await band.unmount()
  })

  test('the pane\'s own ‹ Back puts the band back to "Plan file ›"', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const band = await mountBand($, 'terminal')
    const pane = await mountPane($, 'terminal')

    await band.press({ key: 'band:file' })
    await pane.press({ key: 'back' })

    expect((await rowOf(band)).endsWith('Plan file ›')).toBe(true)
    await pane.unmount()
    await band.unmount()
  })

  test('with the board closed the band says "Plan file ›" even though the file view was left on', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    const band = await mountBand($, 'terminal')

    await band.press({ key: 'band:file' })
    w.panes = []
    await band.press({ key: 'band:plans' })

    expect((await rowOf(band)).endsWith('Plan file ›')).toBe(true)
    await band.unmount()
  })
})

describe('the keyboard goes to the pane after a click', () => {
  const opens = (w: ReturnType<typeof world>) => w.opened.filter(one => one.focus === true).length

  test('a band pick with the board open asks for the keys again; with it closed it opens nothing', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    const band = await mountBand($, 'terminal')

    await band.press({ key: 'band:plans' })
    await band.press({ key: 'band:plan:gamma' })
    expect(w.opened).toEqual([])

    await $.command.run(plans())
    expect(opens(w)).toBe(1)
    await band.press({ key: 'band:plans' })
    await band.press({ key: 'band:plan:alpha' })
    expect(opens(w)).toBe(2)
    await band.unmount()
  })

  test('"Plan file ›" in the band asks for the keys even with the board already open', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    const band = await mountBand($, 'terminal')

    await $.command.run(plans())
    const pane = await mountPane($, 'terminal')

    await band.press({ key: 'band:file' })

    expect(opens(w)).toBe(2)
    await pane.unmount()
    await band.unmount()
  })

  test('the pane\'s own clicks (card, Back, Plan file ›, plan pick) ask again too', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await $.command.run(plans())
    const pane = await mountPane($, 'terminal')

    await openCard(pane, 8)
    expect(opens(w)).toBe(2)
    await pane.press({ key: 'back' })
    expect(opens(w)).toBe(3)
    await pane.press({ key: 'plan-file' })
    expect(opens(w)).toBe(4)
    await pane.press({ key: 'back' })
    expect(opens(w)).toBe(5)
    await pane.press({ key: 'menu:name' })
    await pane.press({ key: 'plan:gamma' })
    expect(opens(w)).toBe(7)
    await pane.unmount()
  })
})

describe('the desktop band mascot', () => {
  test('is the whole 12×4 card sprite at 2×4 px per pixel, in the pose of the plan; the bar is one rounded Svg', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const band = await mountBand($, 'desktop')
    const svgs = await band.findAll({ type: 'Svg' })
    const sprite = svgs.find(node => String(node.props.source).includes('viewBox="0 0 12 4"'))
    const bar = svgs.find(node => String(node.props.source).includes('rx="3"'))

    expect(sprite?.props).toMatchObject({ width: 24, height: 16 })
    // the fixture plan has a row In Progress: both poses, switched by the Svg itself
    expect(String(sprite?.props.source).match(/<rect /g)).toHaveLength(60)
    expect(String(sprite?.props.source)).toContain('<animate')
    expect(bar?.props).toMatchObject({ width: 64, height: 6 })
    await band.unmount()
  })
})

describe('plan-tracker band', () => {
  for (const surface of SURFACES) {
    test(`${surface}: one row: dot, name ▾, bar and n/m, Plan file › at the right end`, async ($, on) => {
      world(on)
      await $.session.start(SESSION)
      const band = await mountBand($, surface)

      const row = await rowOf(band)

      if (surface === 'desktop') {
        expect(row).toBe('● Alpha plan ▾ In progress   5/13Plan file ›')
      } else {
        // the gap between the count and "Plan file ›" is part of the bar's button, so the whole band is pressable
        expect(row).toMatch(/^● Alpha plan ▾ In progress  ▰▰▰▰▰▱▱▱▱▱▱▱ 5\/13 *Plan file ›$/)
      }
      expect(kids(await band.find({ key: 'bar' })).map(child => child.type)).toEqual(
        surface === 'desktop' ? ['Box', 'Box', 'Button', 'Box', 'Box', 'Button', 'Box', 'Button'] : ['Button', 'Button', 'Button', 'Box', 'Button'],
      )
      // the dot is the plan's worst status: a Blocked row makes it red
      const dot = (await band.findAll({ type: 'Text' })).find(node => textOf(node) === '● ')

      expect(dot?.props.color).toBe('error')
      await band.unmount()
    })

    test(`${surface}: no current-task and no needs-you item: no task name is on the band`, async ($, on) => {
      world(on)
      await $.session.start(SESSION)
      const band = await mountBand($, surface)

      const text = textOf(await band.drawn())

      for (const one of ALPHA_ROWS) {
        expect(text).not.toContain(one.task)
      }

      expect(text).not.toMatch(/needs you|Blocked|waiting/i)
      await band.unmount()
    })

    test(`${surface}: the plan list is shut until "name ▾" is pressed; then every plan is a row above the prompt`, async ($, on) => {
      world(on)
      await $.session.start(SESSION)
      const band = await mountBand($, surface)

      expect(await band.find({ key: 'band:list' })).toBeUndefined()

      await band.press({ key: 'band:plans' })

      const list = await band.find({ key: 'band:list' })

      expect(kids(list).map(textOf)).toEqual(['▸ Alpha plan  In progress  5/13', '  Beta        Done         2/2', '  Gamma       In progress  0/2'])
      expect(kids(list).map(child => child.props.key)).toEqual(['band:plan:alpha', 'band:plan:beta', 'band:plan:gamma'])
      // the row stays one row, the list is extra rows under it
      expect(await rowOf(band)).toStartWith('● Alpha plan ▾')

      await band.press({ key: 'band:plans' })
      expect(await band.find({ key: 'band:list' })).toBeUndefined()
      await band.unmount()
    })

    test(`${surface}: picking a plan in the band switches the band AND the board together, and shuts the list`, async ($, on) => {
      world(on)
      await $.session.start(SESSION)
      const band = await mountBand($, surface)
      const pane = await mountPane($, surface)

      expect(textOf(await pane.find({ key: 'menu' }))).toContain('Alpha plan')

      await band.press({ key: 'band:plans' })
      await band.press({ key: 'band:plan:gamma' })

      expect(await rowOf(band)).toStartWith('● Gamma ▾')
      expect(await rowOf(band)).toContain('0/2')
      expect(await band.find({ key: 'band:list' })).toBeUndefined()
      expect(textOf(await pane.find({ key: 'menu' }))).toContain('Gamma')
      expect(textOf(await pane.find({ key: 'menu' }))).not.toContain('Alpha')
      expect(await textIn(pane, await pane.find({ key: 'kanban' }))).toContain('g1')
      await pane.unmount()
      await band.unmount()
    })

    test(`${surface}: picking a plan in the board's dropdown switches the band too`, async ($, on) => {
      world(on)
      await $.session.start(SESSION)
      const band = await mountBand($, surface)
      const pane = await mountPane($, surface)

      await pane.press({ key: 'menu:name' })
      await pane.press({ key: 'plan:beta' })

      expect(await rowOf(band)).toStartWith('● Beta ▾')
      expect(await rowOf(band)).toContain('2/2')
      expect(textOf(await pane.find({ key: 'menu' }))).toContain('Beta')
      await pane.unmount()
      await band.unmount()
    })

    test(`${surface}: picking a plan also leaves a card's page and the plan file view for the board`, async ($, on) => {
      world(on)
      await $.session.start(SESSION)
      const band = await mountBand($, surface)
      const pane = await mountPane($, surface)

      await openCard(pane, 5)
      expect(await pane.find({ key: 'detail' })).toBeDefined()
      await band.press({ key: 'band:plans' })
      await band.press({ key: 'band:plan:gamma' })
      expect(await pane.find({ key: 'detail' })).toBeUndefined()
      expect(await pane.find({ key: 'kanban' })).toBeDefined()

      await band.press({ key: 'band:file' })
      expect(await pane.find({ key: 'file' })).toBeDefined()
      await band.press({ key: 'band:plans' })
      await band.press({ key: 'band:plan:alpha' })
      expect(await pane.find({ key: 'file' })).toBeUndefined()
      expect(await pane.find({ key: 'kanban' })).toBeDefined()
      await pane.unmount()
      await band.unmount()
    })

    test(`${surface}: pressing the bar opens the board, and again closes it`, async ($, on) => {
      const w = world(on)
      await $.session.start(SESSION)
      const band = await mountBand($, surface)

      await band.press({ key: 'band:bar' })
      expect(w.opened).toEqual([{ id: PANE_ID, title: 'Plans', focus: true, rows: 60 }])
      expect(w.panes).toHaveLength(1)

      await band.press({ key: 'band:bar' })
      expect(w.panes).toEqual([])
      await band.unmount()
    })

    test(`${surface}: pressing "Plan file ›" opens the board on the plan file; "‹ Back" returns to the lanes`, async ($, on) => {
      const w = world(on)
      await $.session.start(SESSION)
      const band = await mountBand($, surface)

      await band.press({ key: 'band:file' })

      expect(w.opened).toEqual([{ id: PANE_ID, title: 'Plans', focus: true, rows: 60 }])

      const pane = await mountPane($, surface)
      const file = await pane.find({ key: 'file' })

      expect(file).toBeDefined()
      expect(textOf(file)).toContain('‹ Back')
      expect(textOf(file)).toContain(ALPHA_FILE)
      expect((await pane.find({ type: 'Markdown' }))?.props.text).toBe(FILES[ALPHA_FILE])
      expect(w.reads).toContain(ALPHA_FILE)
      expect(await pane.find({ key: 'kanban' })).toBeUndefined()

      await pane.press({ key: 'back' })
      expect(await pane.find({ key: 'file' })).toBeUndefined()
      expect(await pane.find({ key: 'kanban' })).toBeDefined()
      await pane.unmount()
      await band.unmount()
    })

    test(`${surface}: "Plan file ›" with the board already open does not close it`, async ($, on) => {
      const w = world(on)
      await $.session.start(SESSION)
      const band = await mountBand($, surface)

      await $.command.run(plans())
      await band.press({ key: 'band:file' })

      expect(w.panes).toHaveLength(1)
      await band.unmount()
    })

    test(`${surface}: a survey holds the band: ours yields`, async ($, on) => {
      world(on)
      await $.session.start(SESSION)
      const band = await mountBand($, surface, 120, true)

      expect(textOf(await band.drawn())).not.toContain('Alpha plan')
      await band.unmount()
    })

    test(`${surface}: what the hooks below drew stays under the row`, async ($, on) => {
      world(on, { below: SURVEY })
      await $.session.start(SESSION)
      const band = await mountBand($, surface)

      expect(textOf(await band.drawn())).toEndWith('SURVEY')
      await band.unmount()
    })
  }

  test('a narrow band keeps the row inside its columns', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const band = await mountBand($, 'terminal', 60)

    expect(displayWidth(await rowOf(band))).toBeLessThanOrEqual(60 - BAND_MASCOT_SPACE)
    await band.unmount()
  })

  test('the picked plan\'s counts and mascot: a plan with a row In Progress moves its mascot; a quiet one stands with arms down', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    const band = await mountBand($, 'terminal')
    const mascot = async () => textOf(kids(await band.find({ key: 'bar' }))[0]).slice(0, BAND_MASCOT[0].length)

    await band.press({ key: 'band:plans' })
    await band.press({ key: 'band:plan:beta' })
    expect(await mascot()).toBe(BAND_MASCOT[1])
    await band.press({ key: 'band:plans' })
    await band.press({ key: 'band:plan:gamma' })
    await w.clock.advance(FRAME_MS * 3)
    expect([BAND_MASCOT[0], BAND_MASCOT[1]]).toContain(await mascot())
    await band.unmount()
  })

  test('a PLAN-DONE with 0 left: the filled cells of the finished plan are the rainbow, moving one hue a frame, until the next prompt', async ($, on) => {
    const w = world(on, { bash: 'PLAN-DONE alpha · d1 oldest · 0 left' })
    await $.session.start(SESSION)
    const band = await mountBand($, 'terminal')

    const colors = async () => (await band.findAll({ type: 'Text', text: /^▰$/ })).map(cell => cell.props.color)

    expect(await rowOf(band)).toContain('5/13')
    expect((await colors())[0]).toBe('success')

    await $.tool.call({ tool: 'Bash', command: 'python3 board.py --status Done' })

    expect(await colors()).toEqual(Array.from({ length: 12 }, (_, at) => rainbowAt(at, 0)))
    expect(await rowOf(band)).toContain('▰▰▰▰▰▰▰▰▰▰▰▰ 13/13')
    // the closed plan is no longer in the session's active plans: the tracker is asked for it by name
    expect(w.jsonRuns.at(-1)?.argv).toEqual(jsonArgv('alpha'))
    await w.clock.advance(FRAME_MS)
    expect(await colors()).toEqual(Array.from({ length: 12 }, (_, at) => rainbowAt(at, 1)))
    expect(RAINBOW).toHaveLength(7)

    await $.prompt.submit(promptSubmit())
    expect((await colors())[0]).toBe('success')
    expect(w.jsonRuns.at(-1)?.argv, 'the next prompt reads the tracker again, without the name').toEqual(jsonArgv())
    await band.unmount()
  })

  test('a PLAN-DONE with tasks left is no rainbow', async ($, on) => {
    const w = world(on, { bash: 'PLAN-DONE alpha · d1 oldest · 3 left' })
    await $.session.start(SESSION)
    const band = await mountBand($, 'terminal')

    await $.tool.call({ tool: 'Bash', command: 'python3 board.py --status Done' })

    expect((await band.findAll({ type: 'Text', text: /^▰$/ }))[0]?.props.color).toBe('success')
    expect(w.jsonRuns.at(-1)?.argv).toEqual(jsonArgv())
    await band.unmount()
  })

  test('the tracker output that is not JSON: the band draws nothing of ours', async ($, on) => {
    world(on, { fixture: 'not json' })
    await $.session.start(SESSION)
    const band = await mountBand($, 'terminal')

    expect(textOf(await band.drawn())).toBe('')
    await band.unmount()
  })

  test('a session with no active plan (the tracker has none to show): the band draws nothing of ours', async ($, on) => {
    world(on, { fixture: { selected: null, message: 'No plan was written in this session.', plans: [] } })
    await $.session.start(SESSION)
    const band = await mountBand($, 'terminal')

    expect(textOf(await band.drawn())).toBe('')
    await band.unmount()
  })

  test('a script that fails: the band draws nothing of ours, and what is under it stays', async ($, on) => {
    const w = world(on, { below: SURVEY })
    w.tracker = { exitCode: 2, stderr: 'no registry', doesThrow: false }
    await $.session.start(SESSION)
    const band = await mountBand($, 'terminal')

    expect(textOf(await band.drawn())).toBe('SURVEY')
    await band.unmount()
  })

  test('the band reads the tracker at session start, at each prompt, after a Bash call that runs the script, and not after another', async ($, on) => {
    const w = world(on, { bash: 'updated' })
    await $.session.start(SESSION)
    expect(w.jsonRuns.map(run => run.argv)).toEqual([jsonArgv()])

    // the reads start without holding the prompt or the Bash result, so the clock lets them begin
    await $.prompt.submit(promptSubmit())
    await w.clock.settle()
    expect(w.jsonRuns).toHaveLength(2)

    await $.tool.call({ tool: 'Bash', command: 'ls' })
    await w.clock.settle()
    expect(w.jsonRuns).toHaveLength(2)

    await $.tool.call({ tool: 'Bash', command: 'python3 "/tools/board.py" --status Done "x"' })
    await w.clock.settle()
    expect(w.jsonRuns).toHaveLength(3)
    expect(w.jsonRuns.at(-1)?.init).toEqual(VIEW_INIT)
  })

  test('what the tracker now says is drawn after the next read: a new row count shows in the band', async ($, on) => {
    const w = world(on, { bash: 'updated' })
    await $.session.start(SESSION)
    const band = await mountBand($, 'terminal')

    expect(await rowOf(band)).toContain('5/13')

    w.fixture = { ...BOARD, plans: [{ ...BOARD.plans[0]!, rows: BOARD.plans[0]!.rows.map(one => (one.task === 't1 first todo' ? { ...one, status: 'Done' as const } : one)) }, ...BOARD.plans.slice(1)] }
    await $.tool.call({ tool: 'Bash', command: 'python3 board.py --status Done' })

    expect(await rowOf(band)).toContain('6/13')
    await band.unmount()
  })
})

describe('the band is framed so it reads as a panel, not a chat message', () => {
  for (const surface of SURFACES) {
    test(`${surface}: the band row sits in a dim round frame and its press targets are inside it`, async ($, on) => {
      world(on)
      await $.session.start(SESSION)
      const band = await mountBand($, surface)
      const frame = await band.find({ key: 'band:frame' })

      expect(frame?.props).toMatchObject({ borderStyle: 'round', borderDimColor: true })
      expect(await band.find({ key: 'bar' })).toBeDefined()
      expect(await band.find({ key: 'band:bar' })).toBeDefined()
      expect(await band.find({ key: 'band:file' })).toBeDefined()
      if (surface === 'desktop') {
        expect((await band.findAll({ type: 'Client' })).length).toBeGreaterThan(0)
      }
      await band.unmount()
    })
  }

  test('terminal at 80 columns: the row still fits one line inside the frame', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const band = await mountBand($, 'terminal', 80)

    expect(displayWidth(await rowOf(band)) + BAND_MASCOT_SPACE + 4).toBeLessThanOrEqual(80 + BAND_MASCOT_SPACE)
    await band.unmount()
  })
})

describe('the band in a column a docked pane leaves it', () => {
  const WORDS = /In progress|Idle|Done/
  const FRAGMENT = /\bIn\b|progress|rogre|Idl\b|Don\b/
  const LONG = 'A very long plan name that keeps going and going'

  /** Each row inside the frame, as text. */
  const rowsOf = async (band: Band) => {
    const rows = [await band.find({ key: 'bar' }), await band.find({ key: 'bar:2' })]

    return rows.filter(row => row !== undefined).map(textOf)
  }

  for (const columns of [19, 24, 30, 40, 80, 155]) {
    test(`terminal, ${columns} columns: every row stays inside the frame and the state word is whole or gone`, async ($, on) => {
      const w = world(on)

      w.fixture = { ...BOARD, plans: [{ ...BOARD.plans[0]!, name: LONG }, ...BOARD.plans.slice(1)] }
      await $.session.start(SESSION)
      const band = await mountBand($, 'terminal', columns)
      const rows = await rowsOf(band)

      for (const row of rows) {
        expect(displayWidth(row)).toBeLessThanOrEqual(columns - 4)
      }
      const text = rows.join('\n')

      expect(text.includes('In progress') || !FRAGMENT.test(text)).toBe(true)
      expect(WORDS.test(text) || columns < 60).toBe(true)
      expect(text).toContain('5/13')
      await band.unmount()
    })
  }

  test('terminal: a very narrow column drops the state word whole and the progress goes under the name', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const band = await mountBand($, 'terminal', 19)
    const rows = await rowsOf(band)

    expect(rows).toHaveLength(2)
    expect(rows.join('')).not.toMatch(FRAGMENT)
    expect(rows[1]).toMatch(/^ *▰+▱* 5\/13$/)
    await band.unmount()
  })

  test('terminal: the name is cut before the state word goes', async ($, on) => {
    const w = world(on)

    w.fixture = { ...BOARD, plans: [{ ...BOARD.plans[0]!, name: LONG }, ...BOARD.plans.slice(1)] }
    await $.session.start(SESSION)
    const band = await mountBand($, 'terminal', 54)
    const [row] = await rowsOf(band)

    expect(row).toContain('In progress')
    expect(row).toContain('…')
    expect(row).toContain('Plan file ›')
    await band.unmount()
  })

  test('terminal: the plan list fits the column too, the state word whole or dropped', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const band = await mountBand($, 'terminal', 24)

    await band.press({ key: 'band:plans' })

    const lines = kids(await band.find({ key: 'band:list' })).map(textOf)

    expect(lines).toHaveLength(3)
    for (const line of lines) {
      expect(displayWidth(line)).toBeLessThanOrEqual(24)
      expect(FRAGMENT.test(line) && !/In progress/.test(line)).toBe(false)
    }
    await band.unmount()
  })
})

describe('the band\'s plan list names each plan\'s state', () => {
  for (const surface of SURFACES) {
    test(`${surface}: the word is coloured as in the board's dropdown`, async ($, on) => {
      world(on)
      await $.session.start(SESSION)
      const band = await mountBand($, surface)

      await band.press({ key: 'band:plans' })

      const words = (await band.findAll({ type: 'Text' })).filter(node => ['In progress', 'Done'].includes(textOf(node).trim()) && node.props.color !== undefined)

      // the band's own row names the state first; the list's three follow
      expect(words.slice(1).map(node => [textOf(node).trim(), node.props.color])).toEqual([
        ['In progress', STATE_STYLE['In progress'].color],
        ['Done', STATE_STYLE.Done.color],
        ['In progress', STATE_STYLE['In progress'].color],
      ])
      await band.unmount()
    })
  }
})

describe('the band when a pane left it fewer rows than its frame needs', () => {
  test('terminal: two rows (a pane open inline at 80 columns) draw the band without the frame, as one full-width row', async ($, on) => {
    world(on)
    await $.session.start(SESSION)

    const props = { ...bandProps(80), maxRows: 2 }
    const band = await $.ui.mount({ plugin: 'plan-board', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props, viewport: { columns: 85, rows: 40, isFullscreen: true } })

    expect(await band.find({ key: 'band:frame' })).toBeUndefined()
    expect(await band.find({ key: 'bar:2' })).toBeUndefined()

    const row = textOf(await band.find({ key: 'bar' }))

    expect(displayWidth(row)).toBeLessThanOrEqual(80)
    expect(row).toContain('In progress')
    expect(row.endsWith('Plan file ›')).toBe(true)
    await band.unmount()
  })
})
