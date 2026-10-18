import { describe, expect, test } from './testing'
import type { Engine } from 'claude-code/testing'
import type { AgentSpawnInput, TurnCompleteInput, TurnUsage } from 'claude-code'

import { MAIN_THREAD_CACHE_WRITE, SCALE_INCLUDES_SUBAGENTS } from '../hooks/ledger'
import type { PlanBoard, PlanEntry, PlanRow, PlanStatus } from '../types'
import { LEDGER_DIR, OPTIONS, PANE_ID, ROOT, SESSION, SESSION_ID, isoAt, ledgerPath, openCard, paneProps, promptSubmit, world } from './fixtures'
import type { World } from './fixtures'

const MILLION = 1_000_000
const SONNET = 'claude-sonnet-5-5'

/** A response that costs `usd` by the table at Sonnet's rate (2 USD per million uncached input tokens). */
const worth = (usd: number, model = SONNET): TurnUsage => ({ model, input_tokens: (usd * MILLION) / 2, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })

/** The key a board command's plan is counted under: the project root and the plan's anchor. */
const KEY = (anchor: string) => `${ROOT}#${anchor}`

const row = (task: string, status: PlanStatus, route?: string): PlanRow => ({ task, status, updated: null, ...(route === undefined ? {} : { route }) })

const plan = (anchor: string, rows: PlanRow[], extra: Partial<PlanEntry> = {}): PlanEntry => ({ anchor, name: anchor, goal: 'g', plan_file: `/plans/${anchor}.md`, in_session: true, rows, ...extra })

const boardOf = (...plans: PlanEntry[]): PlanBoard => ({ selected: plans[0]?.anchor ?? null, message: null, plans })

const INLINE = 'serial × inline · Opus — x'
const SUB = 'spawn × subagent · Sonnet — x'
const HERS = 'serial × Sam · — — they do it'

/** One row of plan alpha In Progress, by the main session: the main thread's requests are its. */
const ONE_ROW = boardOf(plan('alpha', [row('r1', 'In Progress', INLINE), row('r2', 'Todo', INLINE)]))

type Entry = { plan: string; row: string | null; first: string; last: string; tokens: { in: number; cached: number; cache_write: number; out: number }; cost_usd: number; requests: number }
type File = { version: number; session: string; surface: string; updated: string; measured_usd: number | null; entries: Entry[]; unowned: { tokens: Entry['tokens']; cost_usd: number; requests: number } }

/**
 * A ledger file of this session that already holds one entry (for a plan row gone from the board), with no measurement: the board
 * goes on writing it. A session with no entry of its own writes no file, so the tests of requests nobody owns start from this.
 */
const EARLIER_ENTRIES = [{ plan: 'alpha', row: 'earlier', first: '2026-10-01T09:00:00+09:00', last: '2026-10-01T09:30:00+09:00', tokens: { in: 1, cached: 2, cache_write: 3, out: 4 }, cost_usd: 1, requests: 1 }]
const EARLIER = JSON.stringify({
  version: 1,
  session: SESSION_ID,
  surface: 'terminal',
  updated: '2026-10-01T09:40:00+09:00',
  measured_usd: null,
  entries: EARLIER_ENTRIES,
  unowned: { tokens: { in: 0, cached: 0, cache_write: 0, out: 0 }, cost_usd: 0, requests: 0 },
})

/** The ledger the board wrote for the session, parsed; undefined when it wrote none. */
const fileOf = (w: World, session = SESSION_ID): File | undefined => {
  const text = w.ledgers[ledgerPath(session)]

  return text === undefined ? undefined : (JSON.parse(text) as File)
}

const entryOf = (w: World, task: string | null) => fileOf(w)?.entries.find(one => one.row === task)

/** Starts the session on a world; the tracker's first answer is in. */
const begin = async ($: Engine, on: Parameters<typeof world>[0], board: PlanBoard, setup: Partial<World> = {}) => {
  const w = world(on, { fixture: board, ...setup })

  await $.session.start(SESSION)
  await w.clock.settle()

  return w
}

/** One model request of the main thread, or of subagent `agentId`, whose response reports `usage`. Resolves with what the loop above the board gets. */
const ask = async ($: Engine, w: World, usage: TurnUsage | null, agentId?: string) => {
  w.responseUsage = usage

  const stream = $.turn.step({ turnId: 't1', index: 0, model: usage?.model ?? SONNET, messageCount: 3, ...(agentId === undefined ? {} : { agentId }) })
  let next = await stream.next()

  // drained by hand: the stream's return value is the response, which `for await` drops
  while (!next.done) {
    next = await stream.next()
  }

  return next.value
}

const endTurn = async ($: Engine, w: World) => {
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' } as TurnCompleteInput)
  await w.clock.settle()
}

/** The host's measure after a turn: `usd` is `cost.usd` (undefined for a host with no cost ledger). */
const measure = async ($: Engine, w: World, usd: number | undefined, changed: ('cost' | 'context' | 'rateLimits')[] = ['cost']) => {
  await $.session.measure({ context: { window: 200_000 }, rateLimits: [], ...(usd === undefined ? {} : { cost: { usd } }), changed })
  await w.clock.settle()
}

const spawn = async ($: Engine, w: World, prompt: string, id: string, extra: Partial<AgentSpawnInput> = {}) => {
  w.spawnedId = id

  return $.agent.spawn({
    tool_use_id: 'toolu_1',
    prompt,
    description: 'a job',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' } as AgentSpawnInput['provider'],
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
    ...extra,
  })
}

describe('whose work a request is', () => {
  test('the main thread: its request is counted to the plan\'s own share (row null) when one plan of the session has a row In Progress, never to a row, in tokens, cost and time', async ($, on) => {
    const w = await begin($, on, ONE_ROW)
    const before = Date.now()

    await ask($, w, { model: SONNET, input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 3000, cache_creation_input_tokens: 40 })
    await endTurn($, w)

    const file = fileOf(w)
    const entry = entryOf(w, null)

    expect(file).toMatchObject({ version: 1, session: SESSION_ID, surface: 'terminal' })
    expect(entry).toMatchObject({ plan: KEY('alpha'), row: null, tokens: { in: 1000, cached: 3000, cache_write: 40, out: 200 }, requests: 1 })
    expect(entryOf(w, 'r1')).toBeUndefined()
    // 1000 × 2 + 200 × 10 + 3000 × 0.1 = 4300 millionths, and 40 tokens written with no split: the main thread's at 4 (1-hour), a 5-minute write at 2.5
    expect(entry?.cost_usd).toBeCloseTo((4300 + 40 * (MAIN_THREAD_CACHE_WRITE === '1h' ? 4 : 2.5)) / MILLION, 9)
    expect(Date.parse(entry?.first ?? '')).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000)
    expect(Date.parse(entry?.last ?? '')).toBeLessThanOrEqual(Date.now())
    expect(file?.entries).toHaveLength(1)
    expect(file?.unowned).toMatchObject({ requests: 0 })
  })

  test('a subagent whose brief starts with Tracker row: counted to that row, whatever the main thread is on', async ($, on) => {
    const w = await begin($, on, boardOf(plan('alpha', [row('r1', 'In Progress', INLINE), row('r2', 'In Progress', SUB)])))

    await spawn($, w, 'Tracker row: "r2"\n\n## Scope\nDo it', 'agent-1')
    await ask($, w, worth(2), 'agent-1')
    await ask($, w, worth(1), 'agent-1')
    await ask($, w, worth(4))
    await endTurn($, w)

    expect(entryOf(w, 'r2')).toMatchObject({ plan: KEY('alpha'), requests: 2 })
    expect(entryOf(w, 'r2')?.cost_usd).toBeCloseTo(3, 9)
    expect(entryOf(w, null)).toMatchObject({ requests: 1 })
    expect(entryOf(w, null)?.cost_usd).toBeCloseTo(4, 9)
  })

  test('a brief naming a text that is no row of this session\'s plans, or that does not start with the line, takes the main thread\'s owner at its spawn', async ($, on) => {
    const w = await begin($, on, ONE_ROW)

    await spawn($, w, 'Tracker row: "nowhere"\nDo it', 'agent-1')
    await spawn($, w, 'Do it.\nTracker row: "r2"', 'agent-2')
    await ask($, w, worth(1), 'agent-1')
    await ask($, w, worth(1), 'agent-2')
    await endTurn($, w)

    expect(entryOf(w, null)).toMatchObject({ requests: 2 })
    expect(entryOf(w, 'r2')).toBeUndefined()
  })

  test('a subagent with no Tracker row follows the main thread\'s owner as the tracker has it when each request is recorded (nothing is frozen at its spawn)', async ($, on) => {
    const w = await begin($, on, ONE_ROW)

    await spawn($, w, 'Look at the logs', 'agent-1')
    await ask($, w, worth(1), 'agent-1')
    // the main thread moves on: plan alpha is done and plan beta runs
    w.fixture = boardOf(plan('alpha', [row('r1', 'Done')]), plan('beta', [row('b1', 'In Progress', INLINE)]))
    await $.prompt.submit(promptSubmit())
    await w.clock.settle()
    await ask($, w, worth(1), 'agent-1')
    await ask($, w, worth(2))
    await endTurn($, w)

    const share = (anchor: string) => fileOf(w)?.entries.find(one => one.plan === KEY(anchor) && one.row === null)

    expect(share('alpha')).toMatchObject({ requests: 1 })
    expect(share('beta')).toMatchObject({ requests: 2 })
    expect(share('beta')?.cost_usd).toBeCloseTo(3, 9)
  })

  test('a brief row that the tracker did not have when the agent was spawned (the row was made seconds before) owns its requests once the next answer arrives, those recorded before it too', async ($, on) => {
    const w = await begin($, on, ONE_ROW)

    await spawn($, w, 'Tracker row: "late row"\nDo it', 'agent-1')
    await ask($, w, worth(1), 'agent-1')
    // the tracker answers again with the row: the request already recorded is the row's, not the plan's share
    w.fixture = boardOf(plan('alpha', [row('r1', 'In Progress', INLINE), row('late row', 'In Progress', SUB)]))
    await $.prompt.submit(promptSubmit())
    await w.clock.settle()
    await ask($, w, worth(2), 'agent-1')
    await endTurn($, w)

    expect(entryOf(w, 'late row')).toMatchObject({ plan: KEY('alpha'), requests: 2 })
    expect(entryOf(w, 'late row')?.cost_usd).toBeCloseTo(3, 9)
    expect(entryOf(w, null)).toBeUndefined()
    expect(fileOf(w)?.unowned.requests).toBe(0)
  })

  test('a spawn right after a reload, before the first tracker answer: its requests are the brief row\'s once the answer is in', async ($, on) => {
    let release: () => void = () => undefined
    const held = new Promise<void>(resolve => {
      release = resolve
    })
    // the tracker's answers are held: the board knows no plan at the spawn
    const w = world(on, { fixture: boardOf(plan('alpha', [row('r1', 'In Progress', INLINE), row('r2', 'In Progress', SUB)])), jsonGate: () => held })

    await $.session.start(SESSION)
    await w.clock.settle()
    await spawn($, w, 'Tracker row: "r2"\nDo it', 'agent-1')
    await ask($, w, worth(1), 'agent-1')
    await ask($, w, worth(1), 'agent-1')
    release()
    await w.clock.settle()
    await endTurn($, w)

    expect(entryOf(w, 'r2')).toMatchObject({ plan: KEY('alpha'), requests: 2 })
    expect(fileOf(w)?.unowned.requests).toBe(0)
  })

  test('a brief row that no row of the session\'s plans ever matches: the main thread\'s owner, as for an agent with no brief', async ($, on) => {
    const w = await begin($, on, ONE_ROW)

    await spawn($, w, 'Tracker row: "nowhere"\nDo it', 'agent-1')
    await ask($, w, worth(1), 'agent-1')
    await endTurn($, w)
    await $.prompt.submit(promptSubmit())
    await w.clock.settle()
    await endTurn($, w)

    expect(entryOf(w, null)).toMatchObject({ requests: 1 })
    expect(fileOf(w)?.entries).toHaveLength(1)
  })

  test('each spawn leaves one usage-owner line: the agent, the brief row, whether the tracker had it, the parent, the owner it resolved to and how many plans the board knew', async ($, on) => {
    const w = await begin($, on, ONE_ROW)

    await spawn($, w, 'Tracker row: "r2"\nDo it', 'agent-1')
    await spawn($, w, 'Tracker row: "late row"\nDo it', 'agent-2', { parentAgentId: 'agent-1' })
    await spawn($, w, 'Look', 'agent-3')
    await w.clock.settle()

    const lines = w.diagnostics().filter(line => line.stage === 'usage-owner')

    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatchObject({ kind: 'usage-owner', error: null, agent_id: 'agent-1', brief_row: 'r2', brief_matched: true, parent: null, owner: { plan: KEY('alpha'), row: 'r2' }, tracker_plans: 1 })
    // a row the tracker does not have yet: not matched, so the parent's owner (its row) for now
    expect(lines[1]).toMatchObject({ agent_id: 'agent-2', brief_row: 'late row', brief_matched: false, parent: 'agent-1', owner: { plan: KEY('alpha'), row: 'r2' } })
    expect(lines[2]).toMatchObject({ agent_id: 'agent-3', brief_row: null, brief_matched: false, parent: null, owner: { plan: KEY('alpha'), row: null } })
  })

  test('two rows In Progress by the main session: the plan\'s own share (row null)', async ($, on) => {
    const w = await begin($, on, boardOf(plan('alpha', [row('r1', 'In Progress', INLINE), row('r2', 'In Progress', INLINE)])))

    await ask($, w, worth(2))
    await endTurn($, w)

    expect(entryOf(w, null)).toMatchObject({ plan: KEY('alpha'), row: null, requests: 1 })
    expect(fileOf(w)?.entries).toHaveLength(1)
    expect(fileOf(w)?.unowned.requests).toBe(0)
  })

  // The count is the plan's, plus a row only for what a subagent did: whoever the route says does the row, the main thread's requests are the plan's.
  for (const [who, route] of [['the main session', INLINE], ['Sam', HERS], ['a worker agent type', 'spawn 1 × harness-author · Sonnet — system file edit'], ['nobody (no route)', undefined]] as const) {
    test(`a row In Progress that ${who} does: the main thread\'s requests are the plan\'s own share, the row gets none`, async ($, on) => {
      const w = await begin($, on, boardOf(plan('alpha', [row('r1', 'In Progress', route), row('r2', 'Todo', INLINE)])))

      await ask($, w, worth(2))
      await endTurn($, w)

      expect(entryOf(w, null)).toMatchObject({ plan: KEY('alpha'), row: null, requests: 1 })
      expect(entryOf(w, 'r1')).toBeUndefined()
      expect(fileOf(w)?.entries).toHaveLength(1)
    })
  }

  test('rows In Progress in two of this session\'s plans: unowned', async ($, on) => {
    const w = await begin($, on, boardOf(plan('alpha', [row('r1', 'In Progress', INLINE)]), plan('beta', [row('b1', 'In Progress', INLINE)])), { ledgers: { [ledgerPath()]: EARLIER } })

    await ask($, w, worth(2))
    await endTurn($, w)

    const file = fileOf(w)

    expect(file?.entries).toEqual(EARLIER_ENTRIES)
    expect(file?.unowned).toMatchObject({ requests: 1, tokens: { in: 1_000_000, cached: 0, cache_write: 0, out: 0 } })
    expect(file?.unowned.cost_usd).toBeCloseTo(2, 9)
  })

  test('a plan the session did not write to (in_session false), or no row In Progress: unowned', async ($, on) => {
    const w = await begin($, on, boardOf(plan('alpha', [row('r1', 'In Progress', INLINE)], { in_session: false }), plan('beta', [row('b1', 'Todo')])), { ledgers: { [ledgerPath()]: EARLIER } })

    await ask($, w, worth(2))
    await endTurn($, w)

    expect(fileOf(w)?.entries).toEqual(EARLIER_ENTRIES)
    expect(fileOf(w)?.unowned.requests).toBe(1)
  })

  test('a Workflow agent, and an agent the board never saw spawn, take the main thread\'s owner', async ($, on) => {
    const w = await begin($, on, ONE_ROW)

    await spawn($, w, 'run the step', 'wf-agent', { workflow: { runId: 'wf_1', agentIndex: 1 }, background: false })
    await ask($, w, worth(1), 'wf-agent')
    await ask($, w, worth(1), 'fork-9')
    await endTurn($, w)

    expect(entryOf(w, null)).toMatchObject({ requests: 2 })
  })
})

describe('what a request costs', () => {
  test('at each session.measure the interval\'s requests are scaled to sum to the host\'s change in cost.usd; the first interval after a load is the baseline\'s and is not scaled', async ($, on) => {
    const w = await begin($, on, ONE_ROW, { hostUsd: 10 })

    // first interval: table 2.00, host 2.20 (a factor of 1.1, inside the bounds): not scaled. The host measured 12.20 in all, the 10.00 before the
    // board loaded and the 0.20 left over included: unowned is what the host measured less the entries
    await ask($, w, worth(2))
    await measure($, w, 12.2)
    await endTurn($, w)
    expect(entryOf(w, null)?.cost_usd).toBeCloseTo(2, 9)
    expect(fileOf(w)?.unowned.cost_usd).toBeCloseTo(10.2, 9)

    // second interval: table 3.00 (2.00 and 1.00), host 3.30: both scaled by 1.1
    await ask($, w, worth(2))
    await ask($, w, worth(1))
    await measure($, w, 15.5)
    await endTurn($, w)
    expect(entryOf(w, null)?.cost_usd).toBeCloseTo(2 + 3.3, 9)
    expect(fileOf(w)?.unowned.cost_usd).toBeCloseTo(10.2, 9)
    expect(fileOf(w)?.measured_usd).toBeCloseTo(15.5, 9)
    expect(entryOf(w, null)?.requests).toBe(3)
  })

  test('SCALE_INCLUDES_SUBAGENTS decides which requests are scaled: true, main and subagent alike by the host\'s change; false, the main thread\'s alone', async ($, on) => {
    const w = await begin($, on, boardOf(plan('alpha', [row('r1', 'In Progress', INLINE), row('r2', 'In Progress', SUB)])), { hostUsd: 0 })

    await ask($, w, worth(1))
    await measure($, w, 1)
    await spawn($, w, 'Tracker row: "r2"', 'agent-1')
    await ask($, w, worth(2))
    await ask($, w, worth(1), 'agent-1')
    // the host charged the table's 3.00 a fifth more if it counts the subagent's request, else the main thread's 2.00 a fifth more
    await measure($, w, 1 + (SCALE_INCLUDES_SUBAGENTS ? 3.6 : 2.4))
    await endTurn($, w)

    expect(entryOf(w, null)?.cost_usd).toBeCloseTo(1 + 2.4, 9)
    expect(entryOf(w, 'r2')?.cost_usd).toBeCloseTo(SCALE_INCLUDES_SUBAGENTS ? 1.2 : 1, 9)
    // entries and unowned add up to what the host measured: when the host does not count the subagent's request the entries are 1.00 over it
    expect(fileOf(w)?.unowned.cost_usd).toBeCloseTo(SCALE_INCLUDES_SUBAGENTS ? 0 : -1, 9)
  })

  test('no scaling when cost is absent: the requests keep the table price, nothing goes to unowned, measured_usd stays null', async ($, on) => {
    const w = await begin($, on, ONE_ROW)

    await ask($, w, worth(2))
    await measure($, w, undefined, ['context'])
    await endTurn($, w)
    await ask($, w, worth(1))
    await endTurn($, w)

    expect(entryOf(w, null)?.cost_usd).toBeCloseTo(3, 9)
    expect(entryOf(w, null)?.requests).toBe(2)
    expect(fileOf(w)).toMatchObject({ measured_usd: null, unowned: { cost_usd: 0, requests: 0 } })
  })

  test('no priced request in the interval (a model the table lacks): its tokens are counted at no cost, and the host\'s whole change is unowned', async ($, on) => {
    const w = await begin($, on, ONE_ROW, { hostUsd: 0 })

    await ask($, w, worth(1))
    await measure($, w, 1)
    await ask($, w, { model: 'claude-mystery-1', input_tokens: 700, output_tokens: 30, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
    await measure($, w, 6)
    await endTurn($, w)

    expect(entryOf(w, null)).toMatchObject({ requests: 2, tokens: { in: 500_700, out: 30 } })
    expect(entryOf(w, null)?.cost_usd).toBeCloseTo(1, 9)
    expect(fileOf(w)?.unowned.cost_usd).toBeCloseTo(5, 9)
  })

  test('a factor outside 0.8 to 1.25 scales nothing: the table price stays and the difference to the host goes to unowned, in either direction', async ($, on) => {
    const w = await begin($, on, ONE_ROW, { hostUsd: 0 })

    await ask($, w, worth(1))
    await measure($, w, 1)
    // 2.00 against 3.00 (factor 1.5)
    await ask($, w, worth(2))
    await measure($, w, 4)
    expect(entryOf(w, null)?.cost_usd).toBeCloseTo(3, 9)
    expect(fileOf(w)?.unowned.cost_usd).toBeCloseTo(1, 9)
    // 2.00 against 1.00 (factor 0.5)
    await ask($, w, worth(2))
    await measure($, w, 5)
    await endTurn($, w)
    expect(entryOf(w, null)?.cost_usd).toBeCloseTo(5, 9)
    expect(fileOf(w)?.unowned.cost_usd).toBeCloseTo(0, 9)
  })

  test('a measure in which cost did not move closes no interval: the requests wait for the one that does', async ($, on) => {
    const w = await begin($, on, ONE_ROW, { hostUsd: 0 })

    await ask($, w, worth(1))
    await measure($, w, 1)
    await ask($, w, worth(2))
    await measure($, w, 1, ['rateLimits'])
    await measure($, w, 3.3)
    await endTurn($, w)

    // the second interval is 2.00 of requests against 2.30 of host change: a factor of 1.15
    expect(entryOf(w, null)?.cost_usd).toBeCloseTo(1 + 2.3, 9)
    expect(fileOf(w)?.unowned.cost_usd).toBeCloseTo(0, 9)
  })

  test('each session.measure writes one probe line: whether cost was present, the host\'s change, the table sums and request counts of main and subagents, the factor', async ($, on) => {
    const w = await begin($, on, boardOf(plan('alpha', [row('r1', 'In Progress', INLINE), row('r2', 'In Progress', SUB)])), { hostUsd: 0 })

    await spawn($, w, 'Tracker row: "r2"', 'agent-1')
    await ask($, w, worth(2))
    await ask($, w, worth(1), 'agent-1')
    await ask($, w, worth(1), 'agent-1')
    await measure($, w, 4.4)
    await ask($, w, worth(1))
    await measure($, w, undefined, ['context'])

    const lines = w.diagnostics().filter(line => line.stage === 'usage-interval')

    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ kind: 'usage-interval', error: null, cost_present: true, requests_main: 1, requests_sub: 2 })
    expect(lines[0]?.host_delta_usd).toBeCloseTo(4.4, 9)
    expect(lines[0]?.table_sum_main_usd).toBeCloseTo(2, 9)
    expect(lines[0]?.table_sum_sub_usd).toBeCloseTo(2, 9)
    // the host's 4.40 over the table's 4.00 of all requests, or over the main thread's 2.00 alone
    expect(lines[0]?.factor).toBeCloseTo(SCALE_INCLUDES_SUBAGENTS ? 1.1 : 2.2, 9)
    expect(lines[1]).toMatchObject({ kind: 'usage-interval', cost_present: false, host_delta_usd: null, factor: null, requests_main: 1, requests_sub: 0 })
  })
})

describe('entries and unowned never add up to more than the host measured', () => {
  /** Entries and unowned cost of a file: what the board says the session cost. */
  const total = (file: File | undefined) => (file?.entries.reduce((sum, one) => sum + one.cost_usd, 0) ?? 0) + (file?.unowned.cost_usd ?? 0)

  const TWO_PLANS = boardOf(plan('alpha', [row('r1', 'In Progress', INLINE)]), plan('beta', [row('b1', 'In Progress', INLINE)]))

  test('a measure that comes before the board has seen the request, an owned one: the request is in its row and the rest of the measurement is unowned, not counted twice', async ($, on) => {
    const w = await begin($, on, ONE_ROW, { hostUsd: 0 })

    await measure($, w, 0.5)
    await ask($, w, worth(0.4))
    await endTurn($, w)

    expect(entryOf(w, null)?.cost_usd).toBeCloseTo(0.4, 9)
    expect(fileOf(w)?.unowned.cost_usd).toBeCloseTo(0.1, 9)
    expect(total(fileOf(w))).toBeCloseTo(0.5, 9)
  })

  test('the same, a request nobody owns (the headless summarizer): unowned is the measurement less the entries, whatever the request cost by the table', async ($, on) => {
    const w = await begin($, on, TWO_PLANS, { hostUsd: 1, ledgers: { [ledgerPath()]: EARLIER } })

    await measure($, w, 1.124298)
    await ask($, w, worth(0.0788))
    await endTurn($, w)

    const file = fileOf(w)

    expect(file?.entries).toEqual(EARLIER_ENTRIES)
    expect(file?.unowned).toMatchObject({ requests: 1, tokens: { in: 39_400 } })
    expect(file?.unowned.cost_usd).toBeCloseTo(0.124298, 9)
    expect(total(file)).toBeCloseTo(1.124298, 9)
    expect(file?.measured_usd).toBeCloseTo(1.124298, 9)
  })

  test('the next measure counts the request in its interval: the total still equals the measurement', async ($, on) => {
    const w = await begin($, on, ONE_ROW, { hostUsd: 0 })

    await measure($, w, 0.5)
    await ask($, w, worth(0.4))
    // 0.40 of requests against 0.45 of host change: scaled by 1.125
    await measure($, w, 0.95)
    await endTurn($, w)

    expect(entryOf(w, null)?.cost_usd).toBeCloseTo(0.45, 9)
    expect(fileOf(w)?.unowned.cost_usd).toBeCloseTo(0.5, 9)
    expect(total(fileOf(w))).toBeCloseTo(0.95, 9)
  })

  test('with no measurement (the host keeps no cost) unowned is the table price of the requests nobody owns', async ($, on) => {
    const w = await begin($, on, TWO_PLANS, { ledgers: { [ledgerPath()]: EARLIER } })

    await ask($, w, worth(0.5))
    await endTurn($, w)

    expect(fileOf(w)?.measured_usd).toBeNull()
    expect(fileOf(w)?.unowned.cost_usd).toBeCloseTo(0.5, 9)
    expect(fileOf(w)?.unowned.requests).toBe(1)
  })
})

describe('a session with no entry of its own writes no ledger file', () => {
  const NO_ROWS = boardOf(plan('alpha', [row('r1', 'Todo', INLINE)]))

  test('requests nobody owns, measures and the end of the session: no file, however the host measured', async ($, on) => {
    const w = await begin($, on, NO_ROWS, { hostUsd: 0 })

    await ask($, w, worth(0.1))
    await measure($, w, 0.12)
    await endTurn($, w)
    await $.session.end({ reason: 'other', sessionId: SESSION_ID, resume: { id: SESSION_ID } })

    expect(w.ledgerWrites).toEqual([])
    expect(w.ledgers).toEqual({})
  })

  test('and none for a host with no cost ledger either', async ($, on) => {
    const w = await begin($, on, NO_ROWS)

    await ask($, w, worth(0.1))
    await endTurn($, w)
    await $.session.end({ reason: 'other', sessionId: SESSION_ID, resume: { id: SESSION_ID } })
    expect(w.ledgerWrites).toEqual([])
  })

  test('a file that exists keeps being written, though it holds no entry', async ($, on) => {
    const empty = JSON.stringify({ ...JSON.parse(EARLIER), entries: [] })
    const w = await begin($, on, NO_ROWS, { ledgers: { [ledgerPath()]: empty } })

    await ask($, w, worth(0.1))
    await endTurn($, w)

    expect(w.ledgerWrites.length).toBeGreaterThan(0)
    expect(fileOf(w)).toMatchObject({ entries: [], unowned: { requests: 1 } })
  })

  test('the file is made the moment the session has an entry, and carries what nobody owned before', async ($, on) => {
    const w = await begin($, on, NO_ROWS)

    await ask($, w, worth(0.1))
    await endTurn($, w)
    expect(w.ledgerWrites).toEqual([])

    w.fixture = ONE_ROW
    await $.prompt.submit(promptSubmit())
    await w.clock.settle()
    await ask($, w, worth(0.2))
    await endTurn($, w)

    expect(fileOf(w)?.entries).toHaveLength(1)
    expect(entryOf(w, null)).toMatchObject({ requests: 1 })
    expect(fileOf(w)?.unowned).toMatchObject({ requests: 1 })
    expect(fileOf(w)?.unowned.cost_usd).toBeCloseTo(0.1, 9)
  })
})

describe('what a cache write costs', () => {
  /** A Sonnet response that wrote `total` tokens to the cache (2.00 USD per million input; a 5-minute write 2.50), with the runtime's split when given. */
  const wrote = (total: number, split?: unknown): TurnUsage =>
    ({ model: SONNET, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: total, ...(split === undefined ? {} : { cache_creation: split }) }) as unknown as TurnUsage

  const cost = async ($: Engine, on: Parameters<typeof world>[0], usage: TurnUsage, agentId?: string) => {
    const w = await begin($, on, ONE_ROW)

    await ask($, w, usage, agentId)
    await endTurn($, w)

    // the ledger counts every token written, whatever it cost
    expect(entryOf(w, null)?.tokens.cache_write).toBe(usage.cache_creation_input_tokens)

    return entryOf(w, null)?.cost_usd
  }

  test('1-hour writes: twice the input price', async ($, on) => {
    expect(await cost($, on, wrote(MILLION, { ephemeral_1h_input_tokens: MILLION, ephemeral_5m_input_tokens: 0 }))).toBeCloseTo(4, 9)
  })

  test('5-minute writes: the cache-write price of the table', async ($, on) => {
    expect(await cost($, on, wrote(MILLION, { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: MILLION }))).toBeCloseTo(2.5, 9)
  })

  test('a mix of both in one response: each at its price, the total written counted', async ($, on) => {
    expect(await cost($, on, wrote(MILLION, { ephemeral_1h_input_tokens: 400_000, ephemeral_5m_input_tokens: 600_000 }))).toBeCloseTo(0.4 * 4 + 0.6 * 2.5, 9)
  })

  test('no split in the usage, a main-thread request: its writes at the 1-hour price (the runtime gives no split; probes found the main thread writes 1-hour)', async ($, on) => {
    expect(await cost($, on, wrote(MILLION))).toBeCloseTo(MAIN_THREAD_CACHE_WRITE === '1h' ? 4 : 2.5, 9)
  })

  test('no split in the usage, a subagent request: its writes at the 5-minute price of the table', async ($, on) => {
    expect(await cost($, on, wrote(MILLION), 'agent-1')).toBeCloseTo(2.5, 9)
  })

  test('the split wins over the loop\'s default: a main-thread request that says 5-minute', async ($, on) => {
    expect(await cost($, on, wrote(MILLION, { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: MILLION }))).toBeCloseTo(2.5, 9)
  })

  test('the split wins over the loop\'s default: a subagent request that says 1-hour', async ($, on) => {
    expect(await cost($, on, wrote(MILLION, { ephemeral_1h_input_tokens: MILLION, ephemeral_5m_input_tokens: 0 }), 'agent-1')).toBeCloseTo(4, 9)
  })
})

describe('the shape of the runtime\'s usage is logged once per session', () => {
  const SPLIT = { ephemeral_1h_input_tokens: 10, ephemeral_5m_input_tokens: 0 }
  const shapeLines = (w: World) => w.diagnostics().filter(line => line.stage === 'usage-shape')
  const withSplit = (): TurnUsage => ({ ...worth(1), cache_creation: SPLIT, service_tier: 'standard' }) as unknown as TurnUsage

  test('the first usage object seen: one line with its key names, a nested key as a dotted path, and no values', async ($, on) => {
    const w = await begin($, on, ONE_ROW)

    await ask($, w, null)
    expect(shapeLines(w)).toEqual([])

    await ask($, w, withSplit())
    await w.clock.settle()

    const [line] = shapeLines(w)

    expect(shapeLines(w)).toHaveLength(1)
    expect(line).toMatchObject({ kind: 'usage-shape', stage: 'usage-shape', error: null })
    expect(line?.keys).toEqual([
      'model', 'input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens',
      'cache_creation', 'cache_creation.ephemeral_1h_input_tokens', 'cache_creation.ephemeral_5m_input_tokens', 'service_tier',
    ])
    expect(JSON.stringify(line)).not.toContain('standard')
  })

  test('the next requests, main or subagent, log nothing more; a session that follows a /clear logs its first again', async ($, on) => {
    const w = await begin($, on, ONE_ROW)

    await ask($, w, withSplit())
    await ask($, w, withSplit())
    await ask($, w, withSplit(), 'agent-1')
    await w.clock.settle()
    expect(shapeLines(w)).toHaveLength(1)

    await $.session.end({ reason: 'clear', sessionId: SESSION_ID, resume: { id: SESSION_ID } })
    w.sessionId = 'sess-after-clear'
    await ask($, w, withSplit())
    await w.clock.settle()
    expect(shapeLines(w)).toHaveLength(2)
  })

  test('a usage the board does not count (no model) is still the first one seen, and logging it never holds or breaks the request', async ($, on) => {
    const w = await begin($, on, ONE_ROW)
    const odd = { input_tokens: 'x', cache_creation: SPLIT } as unknown as TurnUsage
    const answered = await ask($, w, odd)

    await w.clock.settle()
    expect(answered).toMatchObject({ stopReason: 'end_turn', usage: odd })
    expect(shapeLines(w)[0]?.keys).toEqual(['input_tokens', 'cache_creation', 'cache_creation.ephemeral_1h_input_tokens', 'cache_creation.ephemeral_5m_input_tokens'])
  })
})

describe('the file', () => {
  test('it is the whole ledger, written after the main thread\'s turn.complete and not per request; a session that made no request writes none', async ($, on) => {
    const w = await begin($, on, ONE_ROW)

    await endTurn($, w)
    expect(w.ledgerWrites).toEqual([])

    await ask($, w, worth(1))
    await ask($, w, worth(1))
    await ask($, w, worth(1))
    await w.clock.settle()
    expect(w.ledgerWrites).toEqual([])

    await endTurn($, w)
    expect(w.ledgerWrites.length).toBeGreaterThan(0)
    expect(w.ledgerWrites.every(write => write.path === ledgerPath())).toBe(true)
    expect(Object.keys(fileOf(w) ?? {}).sort()).toEqual(['entries', 'measured_usd', 'session', 'surface', 'unowned', 'updated', 'version'])
    expect(fileOf(w)).toMatchObject({ version: 1, session: SESSION_ID, surface: 'terminal', measured_usd: null })
    expect(Number.isNaN(Date.parse(fileOf(w)?.updated ?? ''))).toBe(false)
    expect(entryOf(w, null)?.requests).toBe(3)
  })

  test('a subagent\'s turn.complete writes nothing; session.end writes what is recorded since, before the end step', async ($, on) => {
    const w = await begin($, on, ONE_ROW)

    await ask($, w, worth(1), 'agent-1')
    await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 'sub', reason: 'answer', agentId: 'agent-1' } as TurnCompleteInput)
    await w.clock.settle()
    expect(w.ledgerWrites).toEqual([])

    await $.session.end({ reason: 'other', sessionId: SESSION_ID, resume: { id: SESSION_ID } })
    expect(entryOf(w, null)).toMatchObject({ requests: 1 })
  })

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    test(`${surface}: the file records the surface the session draws on`, async ($, on) => {
      const w = world(on, [surface], { fixture: ONE_ROW })

      await $.session.start({ ...SESSION, surface })
      await w.clock.settle()
      await ask($, w, worth(1))
      await endTurn($, w)
      expect(fileOf(w)?.surface).toBe(surface)
    })
  }

  test('a reload mid-session keeps the earlier entries: the board reads its file first and adds to it', async ($, on) => {
    const before = {
      version: 1,
      session: SESSION_ID,
      surface: 'terminal',
      updated: '2026-10-01T09:40:00+09:00',
      measured_usd: null,
      entries: [{ plan: KEY('alpha'), row: null, first: '2026-10-01T09:00:00+09:00', last: '2026-10-01T09:30:00+09:00', tokens: { in: 100, cached: 200, cache_write: 10, out: 50 }, cost_usd: 1.5, requests: 4 }],
      unowned: { tokens: { in: 5, cached: 0, cache_write: 0, out: 1 }, cost_usd: 0.25, requests: 2 },
    }
    const w = await begin($, on, ONE_ROW, { ledgers: { [ledgerPath()]: JSON.stringify(before) } })

    await ask($, w, worth(1))
    await endTurn($, w)

    const entry = entryOf(w, null)

    expect(entry).toMatchObject({ first: '2026-10-01T09:00:00+09:00', tokens: { in: 100 + 500_000, cached: 200, cache_write: 10, out: 50 }, requests: 5 })
    expect(Date.parse(entry?.last ?? '')).toBeGreaterThan(Date.parse('2026-10-01T09:30:00+09:00'))
    expect(entry?.cost_usd).toBeCloseTo(2.5, 9)
    expect(fileOf(w)?.unowned).toMatchObject({ requests: 2, cost_usd: 0.25 })
  })

  test('a file that is not this session\'s ledger is left as it is, a new one is started beside it, and the board says so in its log', async ($, on) => {
    const foreign = '{"version":1,"session":"someone-else","entries":[]}'
    const w = await begin($, on, ONE_ROW, { ledgers: { [ledgerPath()]: foreign } })

    await ask($, w, worth(1))
    await endTurn($, w)

    const recovered = JSON.parse(w.ledgers[`${LEDGER_DIR}/${SESSION_ID}.recovered.json`] ?? 'null') as File

    expect(w.ledgers[ledgerPath()]).toBe(foreign)
    expect(recovered.session).toBe(SESSION_ID)
    expect(recovered.entries).toHaveLength(1)
    expect(recovered.entries[0]?.requests).toBe(1)
    expect(w.logLines()).toMatchObject([{ stage: 'ledger', error: expect.stringContaining('not read') }])
  })

  test('the baseline of the first interval is the host\'s cost at load, read from $.session.usage()', async ($, on) => {
    const w = await begin($, on, ONE_ROW, { hostUsd: 40 })

    // not scaled (the first interval), so the difference is host change (41 - 40) less the table sum (0.9)
    await ask($, w, worth(0.9))
    await measure($, w, 41)
    await endTurn($, w)
    expect(entryOf(w, null)?.cost_usd).toBeCloseTo(0.9, 9)
    // the host measured 41 in all, 40 of it before the board loaded: what no entry owns
    expect(fileOf(w)?.unowned.cost_usd).toBeCloseTo(40.1, 9)
  })

  test('a /clear ends the session with its file written and the next session id starts a new ledger; until the tracker has answered for the new session its requests are nobody\'s, not the old session\'s row', async ($, on) => {
    const w = await begin($, on, ONE_ROW)

    await ask($, w, worth(1))
    await $.session.end({ reason: 'clear', sessionId: SESSION_ID, resume: { id: SESSION_ID } })
    expect(entryOf(w, null)).toMatchObject({ requests: 1 })

    // the process goes on under a new id; the old session's plans are forgotten, so this request has no owner and the new session no file yet
    // (it is the old plan's share otherwise: the old session's plan is still In Progress in the fixture)
    w.sessionId = 'sess-after-clear'
    await ask($, w, worth(2))
    await endTurn($, w)
    expect(fileOf(w, 'sess-after-clear')).toBeUndefined()

    // the tracker answers for the new session: its requests are counted to its plan's share from then on
    await $.prompt.submit(promptSubmit())
    await w.clock.settle()
    await ask($, w, worth(3))
    await endTurn($, w)

    expect(fileOf(w, 'sess-after-clear')?.session).toBe('sess-after-clear')
    expect(fileOf(w, 'sess-after-clear')?.entries).toHaveLength(1)
    expect(fileOf(w, 'sess-after-clear')?.entries[0]).toMatchObject({ plan: KEY('alpha'), row: null, requests: 1 })
    expect(fileOf(w, 'sess-after-clear')?.unowned).toMatchObject({ requests: 1 })
    expect(entryOf(w, null)).toMatchObject({ requests: 1 })
  })
})

describe('a request is never held by the ledger', () => {
  test('a write that fails is logged, and the turn and the request go on', async ($, on) => {
    const w = await begin($, on, ONE_ROW, { ledgerFailure: 'disk full' })

    await ask($, w, worth(1))
    await endTurn($, w)

    expect(w.ledgerWrites.length).toBeGreaterThan(0)
    expect(w.logLines()).toMatchObject([{ stage: 'ledger', error: expect.stringContaining('disk full') }])
    // the next turn writes again: the failure did not stop the board
    w.ledgerFailure = null
    await ask($, w, worth(1))
    await endTurn($, w)
    expect(entryOf(w, null)).toMatchObject({ requests: 2 })
  })

  test('a write that never ends holds neither turn.step nor turn.complete', async ($, on) => {
    const w = await begin($, on, ONE_ROW, { ledgerGate: () => new Promise<void>(() => undefined) })

    await ask($, w, worth(1))
    await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' } as TurnCompleteInput)

    // still hanging: the next request is answered at once
    const result = await ask($, w, worth(1))

    await w.clock.settle()
    expect(result).toMatchObject({ stopReason: 'end_turn', usage: { model: SONNET } })
    expect(w.ledgerWrites).toHaveLength(1)
  })

  test('turn.step answers first: the response comes back unchanged, whatever the board makes of it', async ($, on) => {
    const w = await begin($, on, ONE_ROW)
    const odd = { model: undefined, input_tokens: 'x', output_tokens: null } as unknown as TurnUsage
    const answered = await ask($, w, odd)

    expect(answered).toMatchObject({ turnId: 't1', stopReason: 'end_turn', usage: odd })
    expect(await ask($, w, null)).toMatchObject({ usage: null })
    // nothing was recorded for either
    await endTurn($, w)
    expect(fileOf(w)).toBeUndefined()
  })
})

describe('a subagent spawned by a subagent', () => {
  const NESTED = boardOf(plan('alpha', [row('r1', 'In Progress', INLINE), row('r2', 'In Progress', SUB), row('r3', 'In Progress', SUB)]))

  test('with no Tracker row of its own it takes its parent\'s owner, not the main thread\'s', async ($, on) => {
    const w = await begin($, on, NESTED)

    await spawn($, w, 'Tracker row: "r2"\nDo it', 'agent-1')
    await spawn($, w, 'Look at the logs', 'agent-2', { parentAgentId: 'agent-1' })
    await ask($, w, worth(2), 'agent-2')
    await ask($, w, worth(1))
    await endTurn($, w)

    expect(entryOf(w, 'r2')).toMatchObject({ requests: 1 })
    expect(entryOf(w, 'r2')?.cost_usd).toBeCloseTo(2, 9)
    expect(entryOf(w, null)).toMatchObject({ requests: 1 })
  })

  test('a Tracker row of its own wins over its parent\'s owner', async ($, on) => {
    const w = await begin($, on, NESTED)

    await spawn($, w, 'Tracker row: "r2"\nDo it', 'agent-1')
    await spawn($, w, 'Tracker row: "r3"\nDo that', 'agent-2', { parentAgentId: 'agent-1' })
    await ask($, w, worth(2), 'agent-2')
    await endTurn($, w)

    expect(entryOf(w, 'r3')).toMatchObject({ requests: 1 })
    expect(entryOf(w, 'r2')).toBeUndefined()
  })

  test('a parent the board did not see spawn (a Workflow\'s, a fork) is the main thread\'s owner at its first sight, and its child follows it', async ($, on) => {
    const w = await begin($, on, NESTED)

    await spawn($, w, 'Look at the logs', 'agent-2', { parentAgentId: 'fork-9' })
    await ask($, w, worth(2), 'agent-2')
    await endTurn($, w)

    expect(entryOf(w, null)).toMatchObject({ requests: 1 })
  })
})

describe('a reload mid-session keeps the subagents\' owners and the open interval ($.state)', () => {
  type Carry = {
    session: string
    agents: Record<string, { claims: { task: string; anchor?: string }[]; parent?: string }>
    unwritten: { owner: { plan: string; row: string | null } | null; wanted?: { task: string; anchor?: string }; tokens: Entry['tokens']; usd: number | null; at: number }[]
    edited: string[]
  }

  /** What the board last wrote into its `usageCarry` state. */
  const watchCarry = (on: Parameters<typeof world>[0]) => {
    const seen: { last: Carry | undefined } = { last: undefined }

    on('state.set', ($, e, next) => {
      if ((e as { key?: string }).key === 'usageCarry') {
        seen.last = (e as unknown as { value: Carry }).value
      }

      return next(e)
    })

    return seen
  }

  const TWO_ROWS = boardOf(plan('alpha', [row('r1', 'In Progress', INLINE), row('r2', 'In Progress', SUB)]))

  /** What the module before the reload had left in the state: the first read of the carry answers it (the kit has no way to write another plugin's state before a session). */
  const leftBehind = (on: Parameters<typeof world>[0], value: Carry) => {
    let isRead = false

    on('state.get', ($, e, next) => {
      if ((e as { key?: string }).key === 'usageCarry' && !isRead) {
        isRead = true

        return { value: { value, version: 1 } } as never
      }

      return next(e)
    })
  }

  test('owners and the requests not yet in the file are kept in the state, with the session\'s id', async ($, on) => {
    const seen = watchCarry(on)
    const w = await begin($, on, TWO_ROWS)

    await spawn($, w, 'Tracker row: "r2"\nDo it', 'agent-1')
    await ask($, w, worth(1), 'agent-1')
    await w.clock.settle()

    expect(seen.last?.session).toBe(SESSION_ID)
    expect(seen.last?.agents).toEqual({ 'agent-1': { claims: [{ task: 'r2' }] } })
    expect(seen.last?.unwritten).toHaveLength(1)
    expect(seen.last?.unwritten[0]).toMatchObject({ owner: { plan: KEY('alpha'), row: 'r2' }, tokens: { in: 500_000 } })

    // written to the file, the request is no longer carried: a reload reads it from the file
    await endTurn($, w)
    expect(seen.last?.unwritten).toEqual([])
    expect(seen.last?.agents).toEqual({ 'agent-1': { claims: [{ task: 'r2' }] } })
  })

  test('after a reload a running subagent keeps its row, and a request that never reached the file is still counted', async ($, on) => {
    const w = world(on, { fixture: TWO_ROWS })
    const at = Date.parse('2026-10-18T09:30:00+09:00')

    leftBehind(on, {
      session: SESSION_ID,
      agents: { 'agent-1': { claims: [{ task: 'r2' }] } },
      unwritten: [{ owner: { plan: KEY('alpha'), row: 'r2' }, tokens: { in: 700, cached: 0, cache_write: 0, out: 30 }, usd: 3, at }],
      edited: [],
    })
    await $.session.start(SESSION)
    await w.clock.settle()
    await ask($, w, worth(2), 'agent-1')
    await endTurn($, w)

    expect(entryOf(w, 'r2')).toMatchObject({ requests: 2, tokens: { in: 700 + 1_000_000, out: 30 } })
    expect(entryOf(w, 'r2')?.cost_usd).toBeCloseTo(5, 9)
    expect(fileOf(w)?.entries).toHaveLength(1)
  })

  test('a carry of another session is not taken up', async ($, on) => {
    const w = world(on, { fixture: TWO_ROWS })

    leftBehind(on, { session: 'someone-else', agents: { 'agent-1': { claims: [{ task: 'r2' }] } }, unwritten: [], edited: [] })
    await $.session.start(SESSION)
    await w.clock.settle()
    await ask($, w, worth(1), 'agent-1')
    await endTurn($, w)

    // agent-1 is unknown here: it takes the main thread's owner, the plan's share
    expect(entryOf(w, null)).toMatchObject({ requests: 1 })
    expect(entryOf(w, 'r2')).toBeUndefined()
  })

  test('the end of the session empties the carry', async ($, on) => {
    const seen = watchCarry(on)
    const w = await begin($, on, TWO_ROWS)

    await spawn($, w, 'Tracker row: "r2"\nDo it', 'agent-1')
    await ask($, w, worth(1), 'agent-1')
    await $.session.end({ reason: 'clear', sessionId: SESSION_ID, resume: { id: SESSION_ID } })
    await w.clock.settle()

    expect(seen.last?.agents).toEqual({})
    expect(seen.last?.unwritten).toEqual([])
  })
})

describe('a file and the ledger it holds belong together', () => {
  test('a write is made under the name of the ledger\'s own session, whatever id the process answers by then', async ($, on) => {
    const w = await begin($, on, ONE_ROW)

    await ask($, w, worth(1))
    // the id changes with no end step in between: the ledger in hand is still the first session's
    w.sessionId = 'sess-other'
    await endTurn($, w)

    expect(fileOf(w)?.session).toBe(SESSION_ID)
    expect(entryOf(w, null)).toMatchObject({ requests: 1 })
    expect(fileOf(w, 'sess-other')).toBeUndefined()
  })
})

describe('a file that cannot be read at load is never overwritten', () => {
  const RECOVERED = `${LEDGER_DIR}/${SESSION_ID}.recovered.json`

  test('the new ledger goes to another file of the same session id and the bad one stays as it was', async ($, on) => {
    const bad = '{"version":1,"session":"sess-1234","entries":[{"plan":"alpha"'
    const w = await begin($, on, ONE_ROW, { ledgers: { [ledgerPath()]: bad } })

    await ask($, w, worth(1))
    await endTurn($, w)

    expect(w.ledgers[ledgerPath()]).toBe(bad)
    expect(w.ledgerWrites.every(write => write.path === RECOVERED)).toBe(true)
    expect(JSON.parse(w.ledgers[RECOVERED] ?? 'null')).toMatchObject({ session: SESSION_ID, entries: [{ row: null, requests: 1 }] })
    expect(w.logLines()).toMatchObject([{ stage: 'ledger', error: expect.stringContaining('not read') }])
  })

  test('and the next load goes on from the other file', async ($, on) => {
    const bad = 'not json'
    const w = await begin($, on, ONE_ROW, {
      ledgers: {
        [ledgerPath()]: bad,
        [RECOVERED]: JSON.stringify({ ...JSON.parse(EARLIER), entries: EARLIER_ENTRIES }),
      },
    })

    await ask($, w, worth(1))
    await endTurn($, w)

    expect(w.ledgers[ledgerPath()]).toBe(bad)
    expect(JSON.parse(w.ledgers[RECOVERED] ?? 'null').entries).toHaveLength(2)
  })

  test('when every name is taken by an unreadable file, nothing is written and the board says so', async ($, on) => {
    const names = [ledgerPath(), RECOVERED, ...[2, 3, 4, 5].map(n => `${LEDGER_DIR}/${SESSION_ID}.recovered-${n}.json`)]
    const w = await begin($, on, ONE_ROW, { ledgers: Object.fromEntries(names.map(name => [name, 'not json'])) })

    await ask($, w, worth(1))
    await endTurn($, w)

    expect(w.ledgerWrites).toEqual([])
    expect(w.logLines().length).toBeGreaterThan(0)
  })
})

describe('a write that never ends does not stop the later ones', () => {
  test('it times out, is logged, and the next turn writes again', async ($, on) => {
    let calls = 0
    const w = await begin($, on, ONE_ROW, { ledgerGate: () => (calls++ === 0 ? new Promise<void>(() => undefined) : Promise.resolve()) })

    await ask($, w, worth(1))
    await endTurn($, w)
    expect(w.ledgerWrites).toHaveLength(1)
    expect(w.ledgers[ledgerPath()]).toBeUndefined()

    // later turns find the writer still held, until the write is given up
    await ask($, w, worth(1))
    await endTurn($, w)
    expect(w.ledgerWrites).toHaveLength(1)

    await w.clock.advance(10_000)
    await w.clock.settle()
    expect(w.logLines()).toMatchObject([{ stage: 'ledger', error: expect.stringContaining('not written') }])

    await ask($, w, worth(1))
    await endTurn($, w)

    expect(w.ledgerWrites.length).toBeGreaterThan(1)
    expect(entryOf(w, null)).toMatchObject({ requests: 3 })
  })
})

describe('a subagent\'s end writes the ledger', () => {
  test('a background worker\'s requests reach the file when it ends, before the next main turn', async ($, on) => {
    const w = await begin($, on, boardOf(plan('alpha', [row('r1', 'In Progress', INLINE), row('r2', 'In Progress', SUB)])))

    await spawn($, w, 'Tracker row: "r2"\nDo it', 'agent-1')
    await ask($, w, worth(1), 'agent-1')
    await w.clock.settle()
    expect(w.ledgerWrites).toEqual([])

    await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'agent-1', agent_transcript_path: '', agent_type: 'general-purpose' })
    await w.clock.settle()

    expect(entryOf(w, 'r2')).toMatchObject({ requests: 1 })
  })
})

describe('the probe line is for the intervals the cost moved in', () => {
  test('a measure that moves only the rate limits, with a cost on the host, writes no probe line', async ($, on) => {
    const w = await begin($, on, ONE_ROW, { hostUsd: 0 })

    await measure($, w, 0, ['rateLimits'])
    expect(w.diagnostics().filter(line => line.stage === 'usage-interval')).toEqual([])
    await measure($, w, 0.5)
    expect(w.diagnostics().filter(line => line.stage === 'usage-interval')).toHaveLength(1)
  })
})

describe('the board redraws once after a turn, not per request', () => {
  const mountPane = ($: Engine) =>
    $.ui.mount({ plugin: 'plan-tracker', surface: 'terminal', component: 'Pane', requestId: PANE_ID, props: paneProps(120), viewport: { columns: 180, rows: 50, isFullscreen: true } })

  test('requests read the tracker and redraw nothing; the turn\'s end reads it after the file is written', async ($, on) => {
    const w = await begin($, on, ONE_ROW)
    const pane = await mountPane($)
    const order: string[] = []

    w.jsonGate = async () => {
      order.push(`read after ${w.ledgerWrites.length} writes`)
    }

    const reads = w.jsonRuns.length
    const drawn = JSON.stringify(await pane.drawn())

    for (let n = 0; n < 6; n++) {
      await ask($, w, worth(1))
    }

    await w.clock.settle()
    expect(w.jsonRuns.length).toBe(reads)
    expect(JSON.stringify(await pane.drawn())).toBe(drawn)

    await endTurn($, w)
    expect(w.jsonRuns.length).toBeGreaterThan(reads)
    expect(order.at(-1)).not.toBe('read after 0 writes')
    expect(w.ledgerWrites.length).toBeGreaterThan(0)
    await pane.unmount()
  })

  // The removed setting's name, spelled in parts so a search for leftovers of the setting finds only real ones.
  const REMOVED_SETTING = ['usage', 'command'].join('_')

  test('opening a task page runs nothing: the removed usage setting, left in a user\'s settings, is ignored', { options: { ...OPTIONS, [REMOVED_SETTING]: 'python3 /tools/board.py {anchor} --usage --task {task}' } }, async ($, on) => {
    const w = await begin($, on, boardOf(plan('alpha', [{ ...row('r1', 'In Progress', INLINE), started: isoAt(Date.now()) }])))
    const pane = await mountPane($)

    await openCard(pane, 0)
    await w.clock.advance(60_000)
    const isUsageRun = (run: { argv: readonly string[] }) => run.argv.some(arg => /^--(plan-)?usage$/.test(arg))

    expect(w.scriptRuns.filter(isUsageRun)).toEqual([])
    expect(w.jsonRuns.filter(isUsageRun)).toEqual([])
    await pane.unmount()
  })
})

describe('a plain PROGRESS.md: the plan is keyed by the file, and a session works it once it has changed it', () => {
  const FILE = `${ROOT}/PROGRESS.md`
  const FILE_MODE = { options: { board_command: '', your_name: '' } }
  const table = (...rows: [task: string, status: string][]) => `# Progress\n\n| task | status |\n|---|---|\n${rows.map(([task, status]) => `| ${task} | ${status} |`).join('\n')}\n`
  const RUNNING = table(['r1', 'Todo'], ['r2', 'In Progress'])
  const IDLE = table(['r1', 'Todo'], ['r2', 'Todo'])

  /** Starts the session on a world whose board file holds `text`. */
  const beginFile = async ($: Engine, on: Parameters<typeof world>[0], text: string, setup: Partial<World> = {}) => {
    const w = world(on, { files: { [FILE]: text }, ...setup })

    await $.session.start(SESSION)
    await w.clock.settle()

    return w
  }

  /** The session (or its subagent) changes `path` with a file tool. */
  const change = async ($: Engine, w: World, tool: 'Edit' | 'Write' | 'MultiEdit' = 'Edit', path = FILE, agentId?: string) => {
    await $.tool.call({ tool, file_path: path, old_string: 'a', new_string: 'b', content: 'c', edits: [], ...(agentId === undefined ? {} : { agentId }) } as never)
    await w.clock.settle()
  }

  test('a session that edited the file books the main thread\'s requests to the plan\'s own share under the file\'s absolute path, not the anchor `progress`', FILE_MODE, async ($, on) => {
    const w = await beginFile($, on, RUNNING)

    await change($, w)
    await ask($, w, worth(2))
    await endTurn($, w)

    expect(fileOf(w)?.entries).toMatchObject([{ plan: FILE, row: null, requests: 1 }])
    expect(entryOf(w, null)?.cost_usd).toBeCloseTo(2, 9)
  })

  test('a brief naming a row of the plan: that row, whose task is its exact text', FILE_MODE, async ($, on) => {
    const w = await beginFile($, on, RUNNING)

    await change($, w)
    await spawn($, w, 'Tracker row: "r1"\n\n## Scope\nDo it', 'agent-1')
    await ask($, w, worth(2), 'agent-1')
    await ask($, w, worth(1))
    await endTurn($, w)

    expect(entryOf(w, 'r1')).toMatchObject({ plan: FILE, requests: 1 })
    expect(entryOf(w, 'r1')?.cost_usd).toBeCloseTo(2, 9)
    expect(entryOf(w, null)).toMatchObject({ plan: FILE, requests: 1 })
  })

  test('a brief naming no row (or none of the file\'s): the subagent takes the main thread\'s owner, the plan', FILE_MODE, async ($, on) => {
    const w = await beginFile($, on, RUNNING)

    await change($, w)
    await spawn($, w, 'Look at the logs', 'agent-1')
    await spawn($, w, 'Tracker row: "nowhere"\nDo it', 'agent-2')
    await ask($, w, worth(1), 'agent-1')
    await ask($, w, worth(1), 'agent-2')
    await endTurn($, w)

    expect(fileOf(w)?.entries).toMatchObject([{ plan: FILE, row: null, requests: 2 }])
  })

  test('no row In Progress: unowned, however the session changed the file', FILE_MODE, async ($, on) => {
    const w = await beginFile($, on, IDLE, { ledgers: { [ledgerPath()]: EARLIER } })

    await change($, w)
    await ask($, w, worth(2))
    await endTurn($, w)

    expect(fileOf(w)?.entries).toEqual(EARLIER_ENTRIES)
    expect(fileOf(w)?.unowned.requests).toBe(1)
  })

  test('a session that only chats is nobody\'s: the file is not its plan', FILE_MODE, async ($, on) => {
    const w = await beginFile($, on, RUNNING, { ledgers: { [ledgerPath()]: EARLIER } })

    await ask($, w, worth(2))
    await endTurn($, w)

    expect(fileOf(w)?.entries).toEqual(EARLIER_ENTRIES)
    expect(fileOf(w)?.unowned.requests).toBe(1)
  })

  test('a row left In Progress by a closed session, and a new session that never edits the file: the new one\'s requests are unowned', FILE_MODE, async ($, on) => {
    const w = await beginFile($, on, RUNNING)

    await change($, w)
    await ask($, w, worth(1))
    await endTurn($, w)
    expect(fileOf(w)?.entries).toMatchObject([{ plan: FILE, row: null, requests: 1 }])

    // the process goes on under a new id (a /clear): the old session's mark is not the new one's
    await $.session.end({ reason: 'clear', sessionId: SESSION_ID, resume: { id: SESSION_ID } })
    w.sessionId = 'sess-2'
    w.ledgers[ledgerPath('sess-2')] = JSON.stringify({ ...JSON.parse(EARLIER), session: 'sess-2' })
    await $.prompt.submit(promptSubmit())
    await w.clock.settle()
    await ask($, w, worth(5))
    await endTurn($, w)

    expect(fileOf(w, 'sess-2')?.entries).toEqual(EARLIER_ENTRIES)
    expect(fileOf(w, 'sess-2')?.unowned.requests).toBe(1)
    expect(entryOf(w, null)).toMatchObject({ requests: 1 })
  })

  test('an edit by a subagent counts for its session: the main thread\'s later requests are the plan\'s', FILE_MODE, async ($, on) => {
    const w = await beginFile($, on, RUNNING)

    await spawn($, w, 'Look at the logs', 'agent-1')
    await change($, w, 'Edit', FILE, 'agent-1')
    await ask($, w, worth(1))
    await endTurn($, w)

    expect(fileOf(w)?.entries).toMatchObject([{ plan: FILE, row: null, requests: 1 }])
  })

  for (const [tool, path, isWorking] of [
    ['Write', FILE, true],
    ['MultiEdit', FILE, true],
    ['Edit', `${ROOT}/NOTES.md`, false],
    ['Edit', `${ROOT}/sub/PROGRESS.md`, false],
  ] as const) {
    test(`${tool} of ${path.slice(ROOT.length + 1)}: ${isWorking ? 'the session works the plan' : 'not the board file, so the session is nobody\'s'}`, FILE_MODE, async ($, on) => {
      const w = await beginFile($, on, RUNNING, { ledgers: { [ledgerPath()]: EARLIER } })

      await change($, w, tool, path)
      await ask($, w, worth(1))
      await endTurn($, w)
      expect(fileOf(w)?.unowned.requests).toBe(isWorking ? 0 : 1)
    })
  }

  test('a Read of the file does not make the session work the plan', FILE_MODE, async ($, on) => {
    const w = await beginFile($, on, RUNNING, { ledgers: { [ledgerPath()]: EARLIER } })

    await $.tool.call({ tool: 'Read', file_path: FILE })
    await ask($, w, worth(1))
    await endTurn($, w)
    expect(fileOf(w)?.unowned.requests).toBe(1)
  })

  test('an Edit that failed changed nothing: it does not make the session work the plan', FILE_MODE, async ($, on) => {
    const w = await beginFile($, on, RUNNING, { ledgers: { [ledgerPath()]: EARLIER }, toolError: 'old_string not found' })

    await change($, w)
    await ask($, w, worth(1))
    await endTurn($, w)
    expect(fileOf(w)?.unowned.requests).toBe(1)
  })

  test('the mark is kept across a reload of the module: the carry holds the board file the session changed', FILE_MODE, async ($, on) => {
    const w = world(on, { files: { [FILE]: RUNNING } })
    let isRead = false

    on('state.get', ($, e, next) => {
      if ((e as { key?: string }).key === 'usageCarry' && !isRead) {
        isRead = true

        return { value: { value: { session: SESSION_ID, agents: {}, unwritten: [], edited: [FILE] }, version: 1 } } as never
      }

      return next(e)
    })
    await $.session.start(SESSION)
    await w.clock.settle()
    await ask($, w, worth(1))
    await endTurn($, w)

    expect(fileOf(w)?.entries).toMatchObject([{ plan: FILE, row: null, requests: 1 }])
  })

  test('the change is written to the carry, and the end of the session empties it', FILE_MODE, async ($, on) => {
    let last: { edited?: string[] } | undefined

    on('state.set', ($, e, next) => {
      if ((e as { key?: string }).key === 'usageCarry') {
        last = (e as unknown as { value: { edited?: string[] } }).value
      }

      return next(e)
    })

    const w = await beginFile($, on, RUNNING)

    await change($, w)
    expect(last?.edited).toEqual([FILE])
    await $.session.end({ reason: 'clear', sessionId: SESSION_ID, resume: { id: SESSION_ID } })
    await w.clock.settle()
    expect(last?.edited).toEqual([])
  })

  test('the board file is read again right after the change, so the next request already sees the row it made In Progress (no 1.5 s poll has come)', FILE_MODE, async ($, on) => {
    const w = await beginFile($, on, IDLE)

    w.files[FILE] = RUNNING
    await change($, w)
    await ask($, w, worth(1))
    await endTurn($, w)

    expect(fileOf(w)?.entries).toMatchObject([{ plan: FILE, row: null, requests: 1 }])
  })
})

describe('plan keys: a ledger entry belongs to one project\'s plan', () => {
  test('with a board command the key is the project root and the anchor: two projects whose commands return the same anchor stay apart', async ($, on) => {
    const here = await begin($, on, ONE_ROW)

    await ask($, here, worth(1))
    await endTurn($, here)
    expect(fileOf(here)?.entries).toMatchObject([{ plan: `${ROOT}#alpha`, row: null }])
  })

  test('the same anchor under another project root is another key', async ($, on) => {
    const there = world(on, { fixture: ONE_ROW, root: '/other/project' })

    await $.session.start(SESSION)
    await there.clock.settle()
    await ask($, there, worth(1))
    await endTurn($, there)
    expect(fileOf(there)?.entries).toMatchObject([{ plan: '/other/project#alpha', row: null }])
  })

  test('with a board command an edit of PROGRESS.md makes no session work a plan: the command\'s in_session decides', async ($, on) => {
    const w = await begin($, on, boardOf(plan('alpha', [row('r1', 'In Progress', INLINE)], { in_session: false })), { ledgers: { [ledgerPath()]: EARLIER } })

    await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/PROGRESS.md`, old_string: 'a', new_string: 'b' })
    await w.clock.settle()
    await ask($, w, worth(1))
    await endTurn($, w)

    expect(fileOf(w)?.entries).toEqual(EARLIER_ENTRIES)
    expect(fileOf(w)?.unowned.requests).toBe(1)
  })
})
