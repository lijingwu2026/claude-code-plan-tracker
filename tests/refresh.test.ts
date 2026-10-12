import { describe, expect, test } from './testing'

import { BOARD, PANE_ID, SESSION, promptSubmit, world } from './fixtures'
import type { World } from './fixtures'

const SLOW_MS = 15_000

/** A board whose selected plan (all Done) shows nothing that moves, so the clock is not spent on animation frames. */
const STILL = { ...BOARD, selected: 'beta' }

/** The `--json` runs of the script take `SLOW_MS` to answer; the test reads how many ran at once (`w.jsonRuns` counts the starts). */
function slowRuns(w: World) {
  const seen = { running: 0, mostAtOnce: 0 }

  w.jsonGate = async () => {
    seen.running += 1
    seen.mostAtOnce = Math.max(seen.mostAtOnce, seen.running)
    await w.clock.sleep(SLOW_MS)
    seen.running -= 1
  }

  return seen
}

/** The `--json` runs of the script never answer. */
function hungRuns(w: World) {
  w.jsonGate = () => new Promise<never>(() => undefined)
}

/** Whether `work` has resolved after the clock has let what is under way run. */
async function resolves(w: World, work: Promise<unknown>): Promise<boolean> {
  let isDone = false

  void work.then(() => {
    isDone = true
  })
  await w.clock.settle()

  return isDone
}

describe('one run of the script at a time', () => {
  test('a burst of prompts while a run is in flight starts one more run, after it, never two at once', async ($, on) => {
    const w = world(on, { fixture: STILL })
    const seen = slowRuns(w)
    const started = $.session.start(SESSION)

    await w.clock.settle()
    expect(w.jsonRuns.length).toBe(1)

    void $.prompt.submit(promptSubmit())
    void $.prompt.submit(promptSubmit())
    void $.prompt.submit(promptSubmit())
    await w.clock.advance(SLOW_MS / 2)
    expect(w.jsonRuns.length, 'nothing new starts while the first run is in flight').toBe(1)

    await w.clock.advance(SLOW_MS * 2)
    await started

    expect(w.jsonRuns.length, 'the three prompts share one queued rerun').toBe(2)
    expect(seen.mostAtOnce).toBe(1)
  })

  test('the 10 s timer does not start a run while one is in flight', async ($, on) => {
    const w = world(on, { fixture: STILL })

    w.panes = [{ id: PANE_ID, title: 'Plans', isShown: true, isFocused: false, isPlaced: true }]

    const seen = slowRuns(w)
    const started = $.session.start(SESSION)

    await w.clock.advance(10_000)
    expect(w.jsonRuns.length, 'the timer fired at 10 s while the first run (15 s) was in flight').toBe(1)

    await w.clock.advance(35_000)
    await started

    expect(seen.mostAtOnce).toBe(1)
  })

  test('the queued rerun asks for the query of the moment it starts', async ($, on) => {
    const w = world(on, { fixture: STILL })

    slowRuns(w)

    const started = $.session.start(SESSION)

    await w.clock.settle()

    const run = $.command.run({ command: 'plan-tracker', args: 'gamma', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })

    await w.clock.advance(SLOW_MS * 2)
    await started
    await run

    // (the pane /plan-tracker opened then keeps refreshing, so only the first two runs are the ones in question)
    expect(w.jsonRuns.slice(0, 2).map(one => one.argv.filter(arg => arg.startsWith('--query')))).toEqual([[], ['--query=gamma']])
  })
})

describe('a script that does not answer does not hold her prompt or a Bash result', () => {
  test('prompt.submit resolves', async ($, on) => {
    const w = world(on)

    hungRuns(w)
    void $.session.start(SESSION)
    await w.clock.settle()

    expect(await resolves(w, $.prompt.submit(promptSubmit()))).toBe(true)
  })

  test('session.start resolves', async ($, on) => {
    const w = world(on)

    hungRuns(w)

    expect(await resolves(w, $.session.start(SESSION))).toBe(true)
  })

  test('tool.call of a Bash call that runs the script resolves', async ($, on) => {
    const w = world(on, { bash: 'updated' })

    hungRuns(w)
    void $.session.start(SESSION)
    await w.clock.settle()

    expect(await resolves(w, $.tool.call({ tool: 'Bash', command: 'python3 board.py --status Done' }))).toBe(true)
  })

  test('a PLAN-DONE block is still a toast, a chime and a notice, and the call still resolves', async ($, on) => {
    const w = world(on, { bash: 'PLAN-DONE alpha · d1 oldest · 0 left' })

    hungRuns(w)
    void $.session.start(SESSION)
    await w.clock.settle()

    expect(await resolves(w, $.tool.call({ tool: 'Bash', command: 'python3 board.py --status Done' }))).toBe(true)
    expect(w.toasts).toEqual(['✅ d1 oldest · 0 left'])
    expect(w.played).toHaveLength(1)
  })
})
