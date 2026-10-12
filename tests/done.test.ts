import { describe, expect, test } from './testing'
import type { Engine } from 'claude-code/testing'

import { BAND_MASCOT, rainbowAt } from '../hooks/board'
import { announce } from '../hooks/register'
import type { PlanBoard } from '../types'
import { ALPHA_ROWS, BOARD, FRAME_MS, PANE_ID, SESSION, bandProps, fakeEngine, kids, paneProps, promptSubmit, textIn, textOf, world } from './fixtures'

const SURFACES = ['terminal', 'desktop'] as const

const mountBand = ($: Engine, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({
    plugin: 'plan-tracker',
    surface,
    component: 'AbovePrompt',
    requestId: 'band',
    props: bandProps(120),
    viewport: { columns: 125, rows: 40, isFullscreen: true },
  })

const mountPane = ($: Engine, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({
    plugin: 'plan-tracker',
    surface,
    component: 'Pane',
    requestId: PANE_ID,
    props: paneProps(140),
    viewport: { columns: 200, rows: 50, isFullscreen: true },
  })

const CLIP = { asset: 'sounds/done.wav' }
const DOING = ALPHA_ROWS[6]!.task
const WRITE = { tool: 'Bash', command: 'python3 board.py --status Done' } as const

/** The board as the tracker prints it after the first In Progress row of the first plan was made Done. */
const afterDone = (board: PlanBoard = BOARD): PlanBoard => ({
  ...board,
  plans: [
    { ...board.plans[0]!, rows: board.plans[0]!.rows.map(one => (one.task === DOING ? { ...one, status: 'Done' as const, updated: '2026-10-09T09:00:00+09:00' } : one)) },
    ...board.plans.slice(1),
  ],
})

describe('a PLAN-DONE block in a Bash result', () => {
  for (const surface of SURFACES) {
    test(`${surface}: the row moves to the Done lane (newest first) and the counts follow in the lane header, the dropdown and the band`, async ($, on) => {
      const w = world(on, { bash: `updated 1 row\nPLAN-DONE alpha · ${DOING} · 7 left\n  t1 first todo · Todo\n` })
      await $.session.start(SESSION)
      const band = await mountBand($, surface)
      const pane = await mountPane($, surface)

      expect(await textIn(pane, await pane.find({ key: 'lane:In Progress' }))).toContain(DOING.slice(0, 10))

      w.fixture = afterDone()
      await $.tool.call(WRITE)

      expect(textOf((await pane.find({ key: 'lane:In Progress' }))?.children[0])).toBe('In Progress 1 · 1 blocked')
      expect(await textIn(pane, await pane.find({ key: 'lane:In Progress' }))).not.toContain(DOING.slice(0, 10))
      expect(textOf((await pane.find({ key: 'lane:Done' }))?.children[0])).toBe('Done 6')
      expect(await textIn(pane, (await pane.find({ key: 'lane:Done' }))?.children[1])).toContain(DOING.slice(0, 10))
      expect(textOf(await pane.find({ key: 'menu' }))).toContain('Alpha plan  Idle  6/13')
      expect(textOf(await band.find({ key: 'bar' }))).toContain('6/13')
      await pane.unmount()
      await band.unmount()
    })
  }

  test('the toast reads ✅, the task, and how many are left; the clip is the chime, once, at gain 0.6', async ($, on) => {
    const w = world(on, { bash: `PLAN-DONE alpha · ${DOING} · 7 left` })
    await $.session.start(SESSION)

    await $.tool.call(WRITE)

    expect(w.toasts).toEqual([`✅ ${DOING} · 7 left`])
    expect(w.played).toEqual([{ clip: CLIP, shouldLoop: false, gain: 0.6 }])
  })

  test('two blocks in one result are two toasts and one chime', async ($, on) => {
    const w = world(on, { bash: 'PLAN-DONE a · one · 1 left\n  x\n\nPLAN-DONE b · two · 3 left' })
    await $.session.start(SESSION)

    await $.tool.call(WRITE)

    expect(w.toasts).toEqual(['✅ one · 1 left', '✅ two · 3 left'])
    expect(w.played).toHaveLength(1)
  })

  test('a result without a block gives no chime and no toast', async ($, on) => {
    const w = world(on, { bash: 'updated 1 row' })
    await $.session.start(SESSION)

    await $.tool.call(WRITE)

    expect(w.toasts).toEqual([])
    expect(w.played).toEqual([])
  })

  test('a long task name is cut in the toast and kept whole in the notice in the conversation', async ($, on) => {
    const task = 'long '.repeat(40).trim()
    const block = `PLAN-DONE alpha · ${task} · 0 left`
    const { engine, toasts, appends } = fakeEngine()

    await announce(engine, block)

    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatch(/^✅ long long .*… · 0 left$/)
    expect(toasts[0]!.length).toBeLessThan(90)
    expect(appends).toEqual([{ message: { type: 'system', content: [{ type: 'text', text: block }] } }])
  })

  describe('only where a terminal is attached', () => {
    test('a terminal: toast and sound', async ($, on) => {
      const w = world(on, { surfaces: ['terminal'], bash: `PLAN-DONE alpha · ${DOING} · 7 left` })
      await $.session.start(SESSION)

      await $.tool.call(WRITE)

      expect(w.toasts).toHaveLength(1)
      expect(w.played).toHaveLength(1)
    })

    test('a headless run (no surface at all, as a scheduled claude -p): never a sound, and the result is untouched', async ($, on) => {
      const bash = `PLAN-DONE alpha · ${DOING} · 7 left`
      const w = world(on, { surfaces: [], bash })
      await $.session.start(SESSION)

      const r = await $.tool.call(WRITE)

      expect(w.played).toEqual([])
      expect(r.text).toBe(bash)
    })

    test('a toast or a clip that cannot play does not break the Bash call', async ($, on) => {
      const bash = `PLAN-DONE alpha · ${DOING} · 7 left`
      const w = world(on, { bash })
      w.toastDenial = 'no toast'
      w.audioDenial = 'no audio'
      await $.session.start(SESSION)

      const r = await $.tool.call(WRITE)

      expect(r.text).toBe(bash)
      expect(r.deny).toBeUndefined()
      expect(w.toasts).toEqual([])
      expect(w.played).toEqual([])
    })

    test('surfaces that cannot be asked do not break the Bash call or make a sound', async ($, on) => {
      const bash = `PLAN-DONE alpha · ${DOING} · 7 left`
      const w = world(on, { bash })
      w.surfacesDenial = 'no surfaces'
      await $.session.start(SESSION)

      const r = await $.tool.call(WRITE)

      expect(r.text).toBe(bash)
      expect(w.played).toEqual([])
    })
  })
})

describe('plan-tracker animation timer', () => {
  const countFrames = (on: Parameters<typeof world>[0]) => {
    const writes = { frames: 0 }

    on('state.set', ($, e, next) => {
      if ((e as { key?: string }).key === 'frame') {
        writes.frames += 1
      }

      return next(e)
    })

    return writes
  }

  /** The board with a quiet plan selected: a Todo and a Done row, nothing In Progress. */
  const QUIET: PlanBoard = {
    ...BOARD,
    selected: 'quiet',
    plans: [{ ...BOARD.plans[0]!, anchor: 'quiet', name: 'Quiet', rows: [ALPHA_ROWS[0]!, ALPHA_ROWS[8]!] }, ...BOARD.plans.slice(1)],
  }

  test('with nothing animating the timer does not run: no frame is ever written', async ($, on) => {
    const w = world(on, { fixture: QUIET })
    const writes = countFrames(on)
    await $.session.start(SESSION)

    await w.clock.advance(FRAME_MS * 20)

    expect(writes.frames).toBe(0)
  })

  test('the band\'s mascot runs the timer on its own while the plan has a row In Progress, with the pane closed', async ($, on) => {
    const w = world(on)
    const writes = countFrames(on)
    await $.session.start(SESSION)

    await w.clock.advance(FRAME_MS * 10)

    expect(w.panes).toEqual([])
    expect(writes.frames).toBe(10)
  })

  test('a plan with only a Blocked row does not animate (its mascot is frozen)', async ($, on) => {
    const stuck: PlanBoard = { ...QUIET, plans: [{ ...QUIET.plans[0]!, rows: [ALPHA_ROWS[7]!] }, ...QUIET.plans.slice(1)] }
    const w = world(on, { fixture: stuck })
    const writes = countFrames(on)
    await $.session.start(SESSION)
    await $.command.run({ command: 'plan-tracker', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })

    await w.clock.advance(FRAME_MS * 10)

    expect(writes.frames).toBe(0)
  })

  test('picking a plan with a row In Progress (from the band) starts it, picking back ends it', async ($, on) => {
    const w = world(on, { fixture: QUIET })
    const writes = countFrames(on)
    await $.session.start(SESSION)
    const band = await mountBand($, 'terminal')

    await w.clock.advance(FRAME_MS * 10)
    expect(writes.frames).toBe(0)

    await band.press({ key: 'band:plans' })
    await band.press({ key: 'band:plan:gamma' })
    await w.clock.advance(FRAME_MS * 10)
    expect(writes.frames).toBe(10)

    await band.press({ key: 'band:plans' })
    await band.press({ key: 'band:plan:quiet' })
    await w.clock.advance(FRAME_MS * 10)
    expect(writes.frames).toBe(10)
    await band.unmount()
  })

  test('the rainbow runs it for a plan with nothing In Progress, and the next prompt ends it', async ($, on) => {
    const w = world(on, { fixture: QUIET, bash: 'PLAN-DONE quiet · d1 oldest · 0 left' })
    const writes = countFrames(on)
    await $.session.start(SESSION)

    await $.tool.call(WRITE)
    await w.clock.advance(FRAME_MS * 6)
    expect(writes.frames).toBe(6)

    await $.prompt.submit(promptSubmit())
    await w.clock.advance(FRAME_MS * 6)
    expect(writes.frames).toBe(6)
  })

  /** An active plan whose rows are all Done (none closed yet) is selected: nothing of it moves. */
  const ALL_DONE: PlanBoard = { ...BOARD, selected: 'beta' }
  const ALL_CANCELED: PlanBoard = {
    ...BOARD,
    selected: 'dropped',
    plans: [{ ...BOARD.plans[0]!, anchor: 'dropped', name: 'Dropped', rows: [ALPHA_ROWS[4]!, { ...ALPHA_ROWS[4]!, task: 'c2 dropped too' }] }, ...BOARD.plans.slice(1)],
  }

  test('a complete plan that no PLAN-DONE finished (all Done, none closed) draws no rainbow and runs no timer', async ($, on) => {
    const w = world(on, { fixture: ALL_DONE })
    const writes = countFrames(on)
    await $.session.start(SESSION)
    const band = await mountBand($, 'terminal')

    await w.clock.advance(FRAME_MS * 10)

    expect(writes.frames).toBe(0)
    expect((await band.findAll({ type: 'Text', text: /^▰$/ })).map(cell => cell.props.color)).toEqual(['success', 'success', 'success', 'success', 'success', 'success', 'success', 'success', 'success', 'success', 'success', 'success'])
    await band.unmount()
  })

  test('an all-Canceled plan has no arms-up pose, no rainbow and no timer', async ($, on) => {
    const w = world(on, { fixture: ALL_CANCELED })
    const writes = countFrames(on)
    await $.session.start(SESSION)
    const band = await mountBand($, 'terminal')

    await w.clock.advance(FRAME_MS * 10)

    expect(writes.frames).toBe(0)
    expect(textOf(kids(await band.find({ key: 'bar' }))[0]).slice(0, BAND_MASCOT[0].length)).toBe(BAND_MASCOT[0])
    await band.unmount()
  })

  test('a PLAN-DONE with 0 left on a plan the tracker still lists as complete: rainbow until the next prompt, then no timer', async ($, on) => {
    const w = world(on, { fixture: ALL_DONE, bash: 'PLAN-DONE beta · only done 2 · 0 left' })
    const writes = countFrames(on)
    await $.session.start(SESSION)
    const band = await mountBand($, 'terminal')

    await w.clock.advance(FRAME_MS * 6)
    expect(writes.frames).toBe(0)

    await $.tool.call(WRITE)
    await w.clock.advance(FRAME_MS * 6)
    expect(writes.frames).toBe(6)
    expect((await band.findAll({ type: 'Text', text: /^▰$/ })).map(cell => cell.props.color)).toEqual(Array.from({ length: 12 }, (_, at) => rainbowAt(at, 6)))

    await $.prompt.submit(promptSubmit())
    await w.clock.advance(FRAME_MS * 6)
    expect(writes.frames).toBe(6)
    await band.unmount()
  })

  test('a session.start with the pane already open (a reload dropped the old timer) starts it again', async ($, on) => {
    const w = world(on)
    w.panes = [{ id: PANE_ID, title: 'Plans', isShown: true, isFocused: false, isPlaced: true }]
    const writes = countFrames(on)

    await $.session.start(SESSION)
    await w.clock.advance(FRAME_MS * 5)

    expect(writes.frames).toBe(5)
  })

  test('a pane that waits undrawn (not placed) does not animate', async ($, on) => {
    const w = world(on, { fixture: QUIET })
    w.panes = [{ id: PANE_ID, title: 'Plans', isShown: true, isFocused: false, isPlaced: false }]
    const writes = countFrames(on)

    await $.session.start(SESSION)
    await w.clock.advance(FRAME_MS * 5)

    expect(writes.frames).toBe(0)
  })
})
