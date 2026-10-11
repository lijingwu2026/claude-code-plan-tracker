import { describe, expect, test } from './testing'

import { announce } from '../hooks/register'
import { DIAGNOSTIC_STAGES, DONE_BLOCK, HOME, SESSION, SESSION_ID, fakeEngine, world } from './fixtures'

const BASH = { tool: 'Bash', command: 'python3 board.py --status Done' } as const

// Through the engine: which Bash results start a notice, and that the result is never touched.
describe('Bash output', () => {
  test('a PLAN-DONE block gives one toast and leaves the result as it was', async ($, on) => {
    const bash = `updated 1 row\n${DONE_BLOCK}\n\nclosing line`
    const { toasts } = world(on, ['terminal'], { bash })
    await $.session.start(SESSION)

    const r = await $.tool.call(BASH)

    expect(toasts).toEqual(['✅ §2 wire the CLI · 3 left'])
    expect(r.text, 'the model reads the whole output').toBe(bash)
    expect(r.deny).toBeUndefined()
    expect(r.isError).toBeUndefined()
  })

  test('a task that holds the separator is kept whole', async ($, on) => {
    const { toasts } = world(on, [], { bash: 'PLAN-DONE a · §1 map · reduce · 2 left' })
    await $.session.start(SESSION)

    await $.tool.call(BASH)

    expect(toasts).toEqual(['✅ §1 map · reduce · 2 left'])
  })

  test('two blocks in one output give two toasts', async ($, on) => {
    const { toasts } = world(on, [], { bash: 'PLAN-DONE a · one · 1 left\n  x\n\nPLAN-DONE b · two · 0 left' })
    await $.session.start(SESSION)

    await $.tool.call(BASH)

    expect(toasts).toEqual(['✅ one · 1 left', '✅ two · 0 left'])
  })

  test('output without a line that starts with PLAN-DONE gives nothing, not even a log line', async ($, on) => {
    const bash = 'echo PLAN-DONE a · t · 1 left\n  PLAN-DONE a · t · 1 left\nplan done'
    const { toasts, logRuns } = world(on, [], { bash })
    await $.session.start(SESSION)

    const r = await $.tool.call(BASH)

    expect(toasts).toEqual([])
    expect(logRuns).toEqual([])
    expect(r.text).toBe(bash)
  })

  test('other tools are not looked at', async ($, on) => {
    const { toasts } = world(on, [], { bash: DONE_BLOCK })
    await $.session.start(SESSION)

    await $.tool.call({ tool: 'Read', file_path: '/a' })

    expect(toasts).toEqual([])
  })

  test('a notice the engine cannot append is logged, the toast still shows and the result is untouched', async ($, on) => {
    // This build's kit stores the row, so the engine's refusal is made here (`appendDenial`).
    const { toasts, logLines } = world(on, [], { bash: DONE_BLOCK, appendDenial: 'the transcript is read-only' })
    await $.session.start(SESSION)

    const r = await $.tool.call(BASH)

    expect(r.text).toBe(DONE_BLOCK)
    expect(r.deny).toBeUndefined()
    expect(toasts).toHaveLength(1)
    expect(logLines()).toMatchObject([{ session_id: SESSION_ID, stage: 'append' }])
    expect(typeof logLines()[0]?.error).toBe('string')
  })

  test('a header that does not parse gives no toast and a log line naming it; the result is untouched', async ($, on) => {
    const { toasts, logLines } = world(on, [], { bash: 'PLAN-DONE alpha without the rest' })
    await $.session.start(SESSION)

    const r = await $.tool.call(BASH)

    expect(r.text).toBe('PLAN-DONE alpha without the rest')
    expect(toasts).toEqual([])
    expect(logLines()).toMatchObject([{ stage: 'parse', error: 'unreadable header: PLAN-DONE alpha without the rest' }])
  })

  test('a log line goes to ~/.claude/mods-logs/plan-tracker.jsonl, directory made first, with four fields', async ($, on) => {
    const { logRuns } = world(on, [], { bash: 'PLAN-DONE nope' })
    await $.session.start(SESSION)

    await $.tool.call(BASH)

    // the redraw, timer and press lines only measure
    const runs = logRuns.filter(run => !DIAGNOSTIC_STAGES.some(stage => (run.stdin ?? '').includes(`"stage":"${stage}"`)))

    expect(runs).toHaveLength(1)
    expect(runs[0]?.argv).toEqual(['/bin/sh', '-c', 'mkdir -p "$1" && cat >> "$1/plan-tracker.jsonl"', 'sh', `${HOME}/.claude/mods-logs`])
    expect(Object.keys(JSON.parse(runs[0]?.stdin ?? '{}') as object)).toEqual(['ts', 'session_id', 'stage', 'error'])
  })
})

// Against a recording stand-in for `$`: what the notice itself contains.
describe('announce', () => {
  test('one toast and one system notice holding the whole block, then a "sent" log line', async () => {
    const { engine, toasts, appends, logs } = fakeEngine()

    await announce(engine, DONE_BLOCK)

    expect(toasts).toEqual(['✅ §2 wire the CLI · 3 left'])
    expect(appends).toEqual([{ message: { type: 'system', content: [{ type: 'text', text: DONE_BLOCK }] } }])
    expect(logs).toMatchObject([{ session_id: SESSION_ID, stage: 'sent', error: null }])
  })

  test('an append that throws is logged with its reason, the toast stays, nothing is thrown', async () => {
    const { engine, toasts, logs } = fakeEngine({ append: new Error('transcript is read-only') })

    await announce(engine, DONE_BLOCK)

    expect(toasts).toHaveLength(1)
    expect(logs).toMatchObject([{ stage: 'append', error: 'transcript is read-only' }])
  })

  test('an append a hook refuses is logged the same way', async () => {
    const { engine, logs } = fakeEngine({ append: 'denied' })

    await announce(engine, DONE_BLOCK)

    expect(logs).toMatchObject([{ stage: 'append', error: 'append refused: a hook refused it' }])
  })

  test('a toast that throws is logged and the notice is still appended', async () => {
    const { engine, appends, logs } = fakeEngine({ toast: new Error('no screen') })

    await announce(engine, DONE_BLOCK)

    expect(appends).toHaveLength(1)
    expect(logs).toMatchObject([{ stage: 'toast', error: 'no screen' }])
  })

  test('a header that does not parse sends nothing', async () => {
    const { engine, toasts, appends, logs } = fakeEngine()

    await announce(engine, 'PLAN-DONE alpha without the rest')

    expect(toasts).toEqual([])
    expect(appends).toEqual([])
    expect(logs).toMatchObject([{ stage: 'parse' }])
  })
})
