import type { On } from 'claude-code'
import { describe, expect, test } from './testing'

import { SESSION, SESSION_ID, bandProps, jsonArgv, plans, world } from './fixtures'

describe('/plan-tracker opens the board, never text', () => {
  // A Desktop client joins the surface list only once it attaches, and `/plan-tracker` can be a session's first input: whatever the
  // list says, the pane is asked for.
  for (const surfaces of [[], ['desktop'], ['terminal'], ['terminal', 'mobile'], ['vscode']] as const) {
    test(`surfaces [${surfaces.join(', ')}]: the pane opens, no text, the text script never runs`, async ($, on) => {
      const { opened, scriptRuns, toasts } = world(on, surfaces)
      await $.session.start(SESSION)

      const result = await $.command.run(plans())

      expect(result.text).toBeUndefined()
      expect(opened).toEqual([{ id: 'plan-tracker', title: 'Plans', focus: true, rows: 60 }])
      expect(scriptRuns).toEqual([])
      expect(toasts).toEqual([])
    })
  }

  test('with arguments it sets the query, trimmed, and the board is read for it', async ($, on) => {
    const { jsonRuns, scriptRuns } = world(on, [])
    await $.session.start(SESSION)

    await $.command.run(plans('  Alpha plan '))

    expect(jsonRuns.map(r => r.argv).at(-1)).toEqual(jsonArgv('Alpha plan'))
    expect(scriptRuns).toEqual([])
  })

  test('arguments of only spaces are no query', async ($, on) => {
    const { jsonRuns } = world(on, [])
    await $.session.start(SESSION)

    await $.command.run(plans('   '))

    expect(jsonRuns.map(r => r.argv).at(-1)).toEqual(jsonArgv())
  })

  test('the pane waiting undrawn (isPlaced false) is a toast "Board waits: <reason>", and no text', async ($, on) => {
    const { toasts, opened } = world(on, ['desktop'], { openDenial: 'the attached surfaces place no panes' })
    await $.session.start(SESSION)

    const result = await $.command.run(plans())

    expect(result.text).toBeUndefined()
    expect(opened).toHaveLength(1)
    expect(toasts).toEqual(['Board waits: the attached surfaces place no panes'])
  })

  test('a ui.open that throws is the same toast, with the error as the reason', async ($, on) => {
    const { toasts } = world(on, [], { openFailure: 'no screen to open a pane on' })
    await $.session.start(SESSION)

    const result = await $.command.run(plans())

    expect(result.text).toBeUndefined()
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toStartWith('Board waits: ')
    expect(toasts[0]).toContain('no screen to open a pane on')
  })

  test('each run logs one line: the surfaces seen and whether the pane was placed', async ($, on) => {
    const { logLines } = world(on, ['desktop', 'terminal'])
    await $.session.start(SESSION)

    await $.command.run(plans())
    await $.command.run(plans('alpha'))

    expect(logLines()).toMatchObject([
      { session_id: SESSION_ID, stage: 'open', error: null, surfaces: ['desktop', 'terminal'], isPlaced: true },
      { stage: 'open', error: null, surfaces: ['desktop', 'terminal'], isPlaced: true },
    ])
    expect(Object.keys(logLines()[0] ?? {})).toEqual(['ts', 'session_id', 'stage', 'error', 'surfaces', 'isPlaced'])
  })

  test('the log line of a pane that waits carries the reason, and an empty surface list is logged as it is', async ($, on) => {
    const { logLines } = world(on, [], { openDenial: 'widen the terminal' })
    await $.session.start(SESSION)

    await $.command.run(plans())

    expect(logLines()).toMatchObject([{ stage: 'open', error: 'widen the terminal', surfaces: [], isPlaced: false }])
  })

  test('a surface list that cannot be read is logged as null and the pane still opens', async ($, on) => {
    const { logLines, opened } = world(on, [], { surfacesDenial: 'no session surfaces' })
    await $.session.start(SESSION)

    await $.command.run(plans())

    expect(opened).toHaveLength(1)
    expect(logLines()).toMatchObject([{ stage: 'open', surfaces: null, isPlaced: true }])
  })

  // The test engine raises no `ui.close` of its own; an inline plugin closes the pane as the person's mark would.
  const CLOSER = {
    name: 'closer',
    register: (on: On) => {
      on('command.run', { command: 'close-plans' }, async $ => {
        await $.ui.close({ id: 'plan-tracker' })

        return { text: 'closed' }
      })
    },
  }

  // The pane draws the board from the script's `--json`: its refresh is the `--json` run.
  test('the open pane re-runs the script every 10 s until it closes', { plugins: [CLOSER] }, async ($, on) => {
    const { clock, scriptRuns, jsonRuns } = world(on, ['terminal'])
    await $.session.start(SESSION)
    await $.command.run(plans())
    expect(scriptRuns.length, 'the board opened, so no text view ran').toBe(0)
    // the session start read the board, and /plan-tracker read it again
    const base = jsonRuns.length

    expect(base).toBe(2)

    await clock.advance(30_000)
    expect(jsonRuns.length).toBe(base + 3)

    await $.command.run(plans())
    expect(jsonRuns.length).toBe(base + 4)
    await clock.advance(10_000)
    expect(jsonRuns.length, 'a second /plan-tracker starts no second timer').toBe(base + 5)

    await $.command.run({ ...plans(), command: 'close-plans' })
    await clock.advance(30_000)
    expect(jsonRuns.length).toBe(base + 5)
    expect(scriptRuns.length, 'the refresh never runs the text view').toBe(0)
  })

  test('the refresh keeps the query of the last /plan-tracker', async ($, on) => {
    const { clock, scriptRuns, jsonRuns } = world(on, ['terminal'])
    await $.session.start(SESSION)
    await $.command.run(plans('alpha'))

    await clock.advance(10_000)

    expect(scriptRuns).toEqual([])
    expect(jsonRuns.map(r => r.argv)).toEqual([jsonArgv(), jsonArgv('alpha'), jsonArgv('alpha')])
  })

  test('a /plan-tracker without arguments after /plan-tracker <name> goes back to this session\'s plans', async ($, on) => {
    const { jsonRuns } = world(on, ['terminal'])
    await $.session.start(SESSION)
    await $.command.run(plans('alpha'))
    await $.command.run(plans())

    expect(jsonRuns.map(r => r.argv).at(-1)).toEqual(jsonArgv())
  })
})

describe('one command: /plan-tracker', () => {
  test('only /plan-tracker is registered, named like the plugin; the old name plans is not, and running it reaches no hook of the plugin', async ($, on) => {
    const { registered, opened } = world(on)
    await $.session.start(SESSION)

    expect(registered.map(one => one.name)).toEqual(['plan-tracker'])
    await expect($.command.run({ ...plans('gamma'), command: 'plans' })).rejects.toThrow('no implementation for command.run')
    expect(opened).toEqual([])
  })

  test('its hint says the plan-name words need a board command', async ($, on) => {
    const { registered } = world(on)
    await $.session.start(SESSION)

    expect(registered).toEqual([{ name: 'plan-tracker', argumentHint: '[words from a plan name, with a board command]' }])
  })
})

describe('/plan-tracker refused', () => {
  const REFUSAL = "/plan-tracker refused: it is the user's own command"

  test('the refusal is logged as one line, session.start still goes through and the band and the board read the tracker', async ($, on) => {
    const { logLines, jsonRuns, registered } = world(on, ['terminal'], { registerDenial: REFUSAL })

    await $.session.start(SESSION)

    expect(registered.map(one => one.name)).toEqual(['plan-tracker'])
    expect(logLines()).toMatchObject([{ session_id: SESSION_ID, stage: 'command', error: expect.stringContaining('refused') }])
    expect(Object.keys(logLines()[0] ?? {})).toEqual(['ts', 'session_id', 'stage', 'error'])
    expect(jsonRuns).toHaveLength(1)
  })

  test('the band still draws after the refusal', async ($, on) => {
    world(on, ['terminal'], { registerDenial: REFUSAL })
    await $.session.start(SESSION)
    const band = await $.ui.mount({
      plugin: 'plan-tracker',
      surface: 'terminal',
      component: 'AbovePrompt',
      requestId: 'band',
      props: bandProps(120),
      viewport: { columns: 125, rows: 40, isFullscreen: true },
    })

    expect(await band.find({ key: 'bar' })).toBeDefined()
    await band.unmount()
  })

  test('a pane open from before the reload gets its refresh timer back even after the refusal', async ($, on) => {
    const w = world(on, ['terminal'], { registerDenial: REFUSAL })
    w.panes = [{ id: 'plan-tracker', title: 'Plans', isShown: true, isFocused: false, isPlaced: true }]

    await $.session.start(SESSION)
    await w.clock.advance(10_000)

    expect(w.jsonRuns).toHaveLength(2)
  })

  test('a command that is accepted logs nothing', async ($, on) => {
    const { logRuns } = world(on, ['terminal'])

    await $.session.start(SESSION)

    expect(logRuns).toEqual([])
  })
})
