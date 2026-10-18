import { describe, expect, test } from './testing'
import type { Engine } from 'claude-code/testing'
import type { AgentSpawnInput, TurnCompleteInput } from 'claude-code'

import { BAND_MASCOT, NEEDS_YOU_COLOR, STATE_STYLE, applyOptions, listOf, parseBoard, parseProgress, planStateOf, planStateText, sinceText } from '../hooks/board'
import { listedMatchOf } from '../hooks/draw'
import type { PlanBoard, PlanEntry, PlanRow, PlanStatus } from '../types'
import { FRAME_MS, OPTIONS, ROOT, SESSION, bandProps, clockOf, isoAt, kids, textOf, world } from './fixtures'
import type { World } from './fixtures'

// The word `you` always counts; the suite's `your_name`, Sam, counts when the settings are applied.
const YOUR_CHECK = 'serial × inline · Opus — a reason — check by you: open it → looks right'
const YOUR_TASK = 'serial × you · — — only you can judge the look'
const SAM_CHECK = 'serial × inline · Opus — a reason — check by Sam: open it'
const SAM_TASK = 'serial × Sam · — — only Sam can judge the look'
const MODEL_CHECK = 'serial × inline · Opus — a reason — check by main session · Sonnet: pytest -q → exits 0'

const row = (task: string, status: PlanStatus, route?: string, extra: Partial<PlanRow> = {}): PlanRow => ({
  task,
  status,
  updated: null,
  ...(route === undefined ? {} : { route }),
  ...extra,
})

const plan = (rows: PlanRow[], extra: Partial<PlanEntry> = {}): PlanEntry => ({ anchor: 'delta', name: 'Delta plan', goal: 'g', plan_file: '/plans/delta.md', rows, ...extra })

/** A plan of this session whose only open row waits on your check: no row runs. Fixed times for the pure tests. */
const WAITING_AT = plan([row('built', 'Done'), row('look at it', 'Needs Verification', YOUR_CHECK)], { in_session: true, idle_since: '2026-10-16T22:38:00+09:00' })

/**
 * The same plan for a mounted band, which reads the real `Date.now()`: idle since a minute ago, and the words the band prints for it
 * worked out from the same instant.
 */
const IDLE = isoAt(Date.now() - 60_000)
const IDLE_TEXT = sinceText(IDLE, Date.now()) as string
const WAITING = { ...WAITING_AT, idle_since: IDLE }

const boardOf = (...plans: PlanEntry[]): PlanBoard => ({ selected: plans[0]?.anchor ?? null, message: null, plans })

const mountBand = ($: Engine, surface: 'terminal' | 'desktop' | 'vscode' = 'terminal', columns = 120) =>
  $.ui.mount({ plugin: 'plan-tracker', surface, component: 'AbovePrompt', requestId: 'band', props: bandProps(columns), viewport: { columns: columns + 5, rows: 40, isFullscreen: true } })

type Band = Awaited<ReturnType<typeof mountBand>>

const bandText = async (band: Band) => textOf(await band.find({ key: 'bar' }))
const mascotOf = async (band: Band) => textOf(kids(await band.find({ key: 'bar' }))[0]).slice(0, BAND_MASCOT[0].length)

const turnStart = ($: Engine, turnId = 't1') => $.turn.start({ text: 'go on', turnId })

const turnEnd = ($: Engine, turnId = 't1', agentId?: string) =>
  $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId, reason: 'answer', ...(agentId === undefined ? {} : { agentId }) } as TurnCompleteInput)

const spawnInput = (background: boolean): AgentSpawnInput => ({
  tool_use_id: 'toolu_1',
  prompt: 'do it',
  description: 'a background job',
  subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' } as AgentSpawnInput['provider'],
  parentModel: 'claude-opus-5-5',
  background,
  fork: false,
})

/** The state lines the band's render path logged, in order. */
const stateLines = (w: World) => w.diagnostics().filter(line => line.stage === 'state')

/** The two clock times a stop just now can print as: the minute when it was taken may have ended before the band read it. */
const nowClocks = (before: number) => [clockOf(before), clockOf(Date.now())]

describe('the plan state with its session at work', () => {
  test('a plan of this session reads In progress while it is worked on, though no row runs; Done beats working', () => {
    expect(planStateOf(WAITING)).toBe('Waiting for you')
    expect(planStateOf({ ...WAITING, working: true })).toBe('In progress')
    expect(planStateOf(plan([row('a', 'Done')], { working: true }))).toBe('Done')
    expect(planStateOf(plan([row('a', 'Todo')], { working: true, finished: '2026-10-16T22:00:00+09:00' }))).toBe('Done')
  })

  test('Stalled stays Stalled when not working; working makes it In progress', () => {
    const stalled = plan([row('a', 'In Progress', undefined, { stalled_since: '2026-10-16T21:00:00+09:00' })])

    expect(planStateOf(stalled)).toBe('Stalled')
    expect(planStateOf({ ...stalled, working: true })).toBe('In progress')
  })

  test('Waiting for you: a Needs Verification row you check or you do (`you`, or your_name); Idle with only a model-checked one', () => {
    applyOptions(OPTIONS)
    expect(planStateOf(plan([row('a', 'Needs Verification', YOUR_CHECK)]))).toBe('Waiting for you')
    expect(planStateOf(plan([row('a', 'Needs Verification', YOUR_TASK)]))).toBe('Waiting for you')
    expect(planStateOf(plan([row('a', 'Needs Verification', SAM_CHECK)]))).toBe('Waiting for you')
    expect(planStateOf(plan([row('a', 'Needs Verification', SAM_TASK)]))).toBe('Waiting for you')
    expect(planStateOf(plan([row('a', 'Needs Verification', MODEL_CHECK)]))).toBe('Idle')
    expect(planStateOf(plan([row('a', 'Needs Verification')]))).toBe('Idle')
    expect(planStateOf(plan([row('a', 'Todo', YOUR_TASK)]))).toBe('Idle')
    expect(planStateOf(plan([row('a', 'Blocked', SAM_TASK)]))).toBe('Idle')
    expect(planStateOf(plan([row('a', 'In Progress'), row('b', 'Needs Verification', YOUR_CHECK)]))).toBe('In progress')
  })

  test('the time is the later of idle_since and the stop; Waiting for you has the needs-you colour', () => {
    const now = Date.parse('2026-10-16T23:00:00+09:00')

    expect(planStateText(WAITING_AT, now)).toBe('Waiting for you since 22:38')
    expect(planStateText({ ...WAITING_AT, stopped_at: '2026-10-16T22:51:00+09:00' }, now)).toBe('Waiting for you since 22:51')
    expect(planStateText({ ...WAITING_AT, stopped_at: '2026-10-16T22:10:00+09:00' }, now)).toBe('Waiting for you since 22:38')
    expect(planStateText(plan([row('a', 'Todo')], { stopped_at: '2026-10-16T22:51:00+09:00' }), now)).toBe('Idle since 22:51')
    expect(planStateText(plan([row('a', 'Needs Verification', YOUR_CHECK)]), 0)).toBe('Waiting for you')
    expect(STATE_STYLE['Waiting for you'].color).toBe(NEEDS_YOU_COLOR)
  })
})

describe('the plan list reads the board command\'s `waiting` flag', () => {
  const answer = (one: Record<string, unknown>) =>
    (parseBoard(JSON.stringify({ selected: null, message: 'All plans', plans: [], matches: [one] })) as { board: PlanBoard }).board.matches ?? []

  test('a match with `waiting: true` draws Waiting for you; without it, its state word', () => {
    const [waiting] = answer({ anchor: 'x', name: 'X', state: 'Idle', done: 1, total: 2, waiting: true })
    const [idle] = answer({ anchor: 'y', name: 'Y', state: 'Idle', done: 1, total: 2 })

    expect(waiting).toMatchObject({ state: 'Idle', waiting: true })
    expect(listedMatchOf(waiting!, 0)).toMatchObject({ state: 'Waiting for you', stateText: 'Waiting for you' })
    expect(listedMatchOf(idle!, 0)).toMatchObject({ state: 'Idle', stateText: 'Idle' })
  })

  test('the list keeps four state words: an old board still draws a match with `waiting: true`, and an unknown state word is still dropped', () => {
    const [kept] = answer({ anchor: 'x', name: 'X', state: 'Idle', done: 1, total: 2, waiting: true })

    // The key survives the read, which a board of the earlier version does not do; an entry whose state is a fifth word is not a match.
    expect(kept).toMatchObject({ anchor: 'x', state: 'Idle', waiting: true })
    expect(answer({ anchor: 'x', name: 'X', state: 'Waiting for you', done: 1, total: 2 })).toHaveLength(0)
  })

  test('with no `matches`, the list drawn from two plans marks a waiting plan the same way', () => {
    const board = boardOf(plan([row('a', 'Needs Verification', YOUR_CHECK)]), { ...plan([row('b', 'Todo')]), anchor: 'echo', name: 'Echo plan' })
    const [first, second] = listOf(board)

    expect(first).toMatchObject({ anchor: 'delta', state: 'Idle', waiting: true })
    expect(second).toMatchObject({ anchor: 'echo', state: 'Idle' })
    expect(second).not.toHaveProperty('waiting')
  })
})

describe('the board command\'s `in_session` key', () => {
  const plansOf = (extra: Record<string, unknown>) =>
    (parseBoard(JSON.stringify({ selected: 'a', message: null, plans: [{ anchor: 'a', rows: [{ task: 't', status: 'Todo' }], ...extra }] })) as { board: PlanBoard }).board.plans

  test('is read when it is true or false, and absent otherwise', () => {
    expect(plansOf({ in_session: true })[0]?.in_session).toBe(true)
    expect(plansOf({ in_session: false })[0]?.in_session).toBe(false)
    expect(plansOf({})[0]).not.toHaveProperty('in_session')
    expect(plansOf({ in_session: 'yes' })[0]).not.toHaveProperty('in_session')
  })
})

describe('the band follows its session\'s turns and background agents', () => {
  test('turn.start with no running row: In progress and a moving mascot, with the pane closed; the main turn.complete: Waiting for you since the stop', async ($, on) => {
    const w = world(on, { fixture: boardOf(WAITING) })

    await $.session.start(SESSION)
    const band = await mountBand($)

    expect(await bandText(band)).toContain(`Waiting for you since ${IDLE_TEXT}`)
    expect(w.panes).toEqual([])

    const before = Date.now()

    await turnStart($)
    expect(await bandText(band)).toContain('In progress')

    const poses = new Set<string>()

    for (let i = 0; i < 8; i++) {
      await w.clock.advance(FRAME_MS)
      poses.add(await mascotOf(band))
    }

    expect(poses.size, 'the mascot moves').toBe(2)

    await turnEnd($)
    const text = await bandText(band)

    expect(nowClocks(before).some(clock => text.includes(`Waiting for you since ${clock}`)), text).toBe(true)
    await band.unmount()
  })

  test('a subagent\'s turn.complete during the main turn does not end it', async ($, on) => {
    world(on, { fixture: boardOf(WAITING) })

    await $.session.start(SESSION)
    const band = await mountBand($)

    await turnStart($)
    await turnEnd($, 'sub-turn', 'agent-7')
    expect(await bandText(band)).toContain('In progress')
    await turnEnd($)
    expect(await bandText(band)).toContain('Waiting for you')
    await band.unmount()
  })

  test('a background agent outliving the main turn keeps In progress until its SubagentStop, even while agent.list still shows it running', async ($, on) => {
    const w = world(on, { fixture: boardOf(WAITING) })

    await $.session.start(SESSION)
    const band = await mountBand($)

    await turnStart($)
    w.spawnedId = 'agent-bg'
    await $.agent.spawn(spawnInput(true))
    w.agents = [{ id: 'agent-bg', description: 'a background job', type: 'general-purpose', status: 'running' } as World['agents'][number]]
    await turnEnd($)
    expect(await bandText(band)).toContain('In progress')

    await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'agent-bg', agent_transcript_path: '', agent_type: 'general-purpose' })
    expect(await bandText(band)).toContain('Waiting for you')
    await band.unmount()
  })

  test('a background agent agent.list shows ended or no longer lists stops counting at the next turn event', async ($, on) => {
    const w = world(on, { fixture: boardOf(WAITING) })

    await $.session.start(SESSION)
    const band = await mountBand($)

    await turnStart($)
    w.spawnedId = 'agent-bg'
    await $.agent.spawn(spawnInput(true))
    expect(await bandText(band)).toContain('In progress')
    w.agents = [{ id: 'agent-bg', description: 'a background job', type: 'general-purpose', status: 'completed' } as World['agents'][number]]
    await turnEnd($)
    expect(await bandText(band)).toContain('Waiting for you')
    await band.unmount()
  })

  test('a foreground agent is the main turn\'s: it alone does not keep the plan In progress after the turn', async ($, on) => {
    const w = world(on, { fixture: boardOf(WAITING) })

    await $.session.start(SESSION)
    const band = await mountBand($)

    await turnStart($)
    w.spawnedId = 'agent-fg'
    await $.agent.spawn(spawnInput(false))
    w.agents = [{ id: 'agent-fg', description: 'a job', type: 'general-purpose', status: 'running' } as World['agents'][number]]
    expect(await bandText(band)).toContain('In progress')
    await turnEnd($)
    expect(await bandText(band)).toContain('Waiting for you')
    await band.unmount()
  })

  test('turn.start with no turn.complete, then session.start: not working', async ($, on) => {
    world(on, { fixture: boardOf(WAITING) })

    await $.session.start(SESSION)
    const band = await mountBand($)

    await turnStart($)
    expect(await bandText(band)).toContain('In progress')
    await $.session.start(SESSION)
    expect(await bandText(band)).toContain('Waiting for you')
    await band.unmount()
  })

  test('a plan with in_session: false keeps its row state during a turn', async ($, on) => {
    world(on, { fixture: boardOf({ ...WAITING, in_session: false }) })

    await $.session.start(SESSION)
    const band = await mountBand($)

    await turnStart($)
    expect(await bandText(band)).toContain(`Waiting for you since ${IDLE_TEXT}`)
    await band.unmount()
  })

  test('a plan the board command gives no in_session key keeps its row state during a turn', async ($, on) => {
    const { in_session: _flag, ...unflagged } = WAITING

    world(on, { fixture: boardOf(unflagged) })

    await $.session.start(SESSION)
    const band = await mountBand($)

    await turnStart($)
    expect(await bandText(band)).toContain(`Waiting for you since ${IDLE_TEXT}`)
    await band.unmount()
  })

  test('a stalled plan of this session reads In progress during a turn and Stalled after it', async ($, on) => {
    const stalled = plan([row('a', 'In Progress', undefined, { stalled_since: isoAt(Date.now() - 60_000) })], { in_session: true })

    world(on, { fixture: boardOf(stalled) })

    await $.session.start(SESSION)
    const band = await mountBand($)

    expect(await bandText(band)).toContain('Stalled')
    await turnStart($)
    expect(await bandText(band)).toContain('In progress')
    await turnEnd($)
    expect(await bandText(band)).toContain('Stalled')
    await band.unmount()
  })

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    // The vscode band is links only: its state is link text, with no colour of its own.
    test(`${surface}: the band draws the state its session is in${surface === 'vscode' ? '' : ", in the state's colour"}`, async ($, on) => {
      world(on, [surface], { fixture: boardOf(WAITING) })

      await $.session.start(SESSION)
      const band = await mountBand($, surface)
      // vscode's link text joins its characters with word joiners and no-break spaces.
      const shown = async () => JSON.stringify(await band.drawn()).replace(/⁠/g, '').replace(/ /g, ' ')
      const colourOf = async (word: string) => (await band.findAll({ text: new RegExp(`^${word}`) })).map(one => one.props.color).find(Boolean)

      expect(await shown()).toContain('Waiting for you')

      if (surface !== 'vscode') {
        expect(await colourOf('Waiting for you')).toBe(NEEDS_YOU_COLOR)
      }

      await turnStart($)
      expect(await shown()).toContain('In progress')
      expect(await shown()).not.toContain('Waiting for you')

      if (surface !== 'vscode') {
        expect(await colourOf('In progress')).toBe(STATE_STYLE['In progress'].color)
      }

      await band.unmount()
    })
  }

  test('the band logs the state text it draws once per change, not per frame', async ($, on) => {
    const w = world(on, { fixture: boardOf(WAITING) })

    await $.session.start(SESSION)
    const band = await mountBand($)

    await turnStart($)
    await w.clock.advance(FRAME_MS * 10)
    await turnEnd($)
    expect(await bandText(band)).toContain('Waiting for you since')
    await w.clock.settle()

    const texts = stateLines(w).map(line => line.text)

    expect(texts.length, JSON.stringify(texts)).toBeGreaterThan(0)
    expect(texts[0]).toBe(`Waiting for you since ${IDLE_TEXT}`)
    expect(texts[1]).toBe('In progress')
    expect(String(texts[2])).toStartWith('Waiting for you since ')
    expect(texts).toHaveLength(3)
    expect(stateLines(w)[1]).toMatchObject({ surface: 'terminal', plan: 'delta', state: 'In progress' })
    await band.unmount()
  })

  test('each turn event reads the tracker again', async ($, on) => {
    const w = world(on, { fixture: boardOf(WAITING) })

    await $.session.start(SESSION)
    await w.clock.settle()

    const runs = w.jsonRuns.length

    await turnStart($)
    await w.clock.settle()
    await turnEnd($)
    await w.clock.settle()

    expect(w.jsonRuns.length).toBeGreaterThanOrEqual(runs + 2)
  })

  test('a turn.start or turn.complete handler that fails does not hold the turn, and the work it noted still shows', async ($, on) => {
    const w = world(on, { fixture: boardOf(WAITING) })

    await $.session.start(SESSION)
    w.panesDenial = 'no panes here'

    expect(await turnStart($, 't9')).toEqual({ turnId: 't9' })

    w.panesDenial = null

    const band = await mountBand($)

    // the handler ran: it noted the turn before the redraw failed
    expect(await bandText(band)).toContain('In progress')
    w.panesDenial = 'no panes here'
    expect(await turnEnd($, 't9')).toMatchObject({ text: 'done' })
    w.panesDenial = null
    await w.clock.settle()
    expect(await bandText(band)).toContain('Waiting for you')
    await band.unmount()
  })
})

describe('a plain PROGRESS.md', () => {
  const FILE = `${ROOT}/PROGRESS.md`
  const FILE_MODE = { options: { board_command: '', your_name: '' } }
  const TABLE = '# Progress\n\n| task | status | executor | check |\n|---|---|---|---|\n| built | Done | main session · Opus | script |\n| look at it | Needs Verification | main session · Opus | you |\n'

  test('its one plan has no `in_session` flag and counts as this session\'s', () => {
    const parsed = parseProgress(TABLE, FILE, 'proj')

    expect('board' in parsed && parsed.board.plans[0]?.in_session).toBe(true)
  })

  test('a turn reads In progress though no row runs, and the stop reads Waiting for you since the stop', FILE_MODE, async ($, on) => {
    const w = world(on, { files: { [FILE]: TABLE } })

    await $.session.start(SESSION)
    await w.clock.settle()

    const band = await mountBand($)
    const before = Date.now()

    // no board command: the file is the plan, with no time
    expect(await bandText(band)).toContain('Waiting for you')
    expect(await bandText(band)).not.toContain('Waiting for you since')

    await turnStart($)
    expect(await bandText(band)).toContain('In progress')
    await turnEnd($)

    const text = await bandText(band)

    expect(nowClocks(before).some(clock => text.includes(`Waiting for you since ${clock}`)), text).toBe(true)
    await band.unmount()
  })
})
