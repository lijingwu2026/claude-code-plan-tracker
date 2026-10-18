/**
 * The plan board for a terminal: a one-row band above the prompt (`● <plan> ▾ <bar> n/m  Plan file ›`: "▾" opens the plan
 * list above the prompt, the bar opens or closes the board, "Plan file ›" opens the board on the plan file) and a pane with
 * the plan dropdown, the plan line and four lanes (Todo, In Progress, Verify, Done) of bordered cards (press one for its page).
 * Picking a plan in the band or in the pane switches both.
 *
 * The data is the board file (PROGRESS.md, read again every 1.5 s, so the board follows the file) or, with the setting
 * `board_command`, that command's JSON; read on session.start, on each prompt, at each turn's start and end and each background
 * agent's start and stop, after a Bash call that runs the command, and every 10 s while the pane is open; one run is in flight at a
 * time, and none holds a prompt, a turn or a Bash result. While this session runs a turn or a background agent, its own plans (the
 * board file's one plan; a command's plans marked `in_session: true`) read In progress. With a `board_command`, `/plan-tracker` opens the pane at once on the list of the plans not Done or Canceled, latest updated first, under a
 * search field that has the keys, with no text, whatever the surface says (a Desktop client may not have attached yet), and reads the list again
 * behind it; `/plan-tracker <words>` puts the words in the field, and opens the plan when the answer is in if they are its name or anchor or leave
 * one row. Typing filters every plan in the mod; Enter or a press on a row opens that plan, as do the band and the plan menus. A command that lists
 * no `matches` but two or more `plans` has them listed; one that prints a single plan, and a plain board file, open that plan's board. When the
 * board cannot be drawn a toast says why. A PLAN-DONE block in a Bash result becomes a toast, a chime
 * and a notice in the conversation, and one with `0 left` makes the band's bar a rainbow until the person's next prompt. With no
 * `board_command`, a row of the board file that goes Done does the same, with no block: the file is the only source.
 *
 * The usage ledger: every model request of this session (`turn.step`, the main thread's and each subagent's) is counted to the plan row it
 * worked on, or to the plan, or to nobody (`hooks/ledger.ts` says whose); the requests of one interval between two `session.measure`
 * readings are scaled to the host's own cost; the whole ledger is written to `~/.claude/mods-logs/plan-tracker-usage/<session id>.json`
 * after each main turn and at the session's end, never inside a request's chain. Every session's file is summed (`hooks/usage.ts`) into
 * the figures the board draws, so a plain PROGRESS.md has them too.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer, TurnUsage } from 'claude-code'

import type { Live, PlanBoard, PlanEntry, PlanStatus } from '../types'
import {
  BAND_MASCOT_SPACE,
  MASCOT,
  bandPlanOf,
  bandPose,
  bandPoseIndex,
  detailOf,
  directPick,
  FRAME_MS,
  doneBlocks,
  doneHeader,
  failureText,
  finishedAnchor,
  isActive,
  isComplete,
  isOpen,
  isRainbow,
  isWorking,
  listOf,
  listedMatches,
  localIso,
  messageOf,
  movement,
  noBoardFile,
  parseBoard,
  parseProgress,
  planOf,
  planStateOf,
  planStateText,
  truncate,
  settings,
  applyOptions,
  boardArgv,
  commandMarkOf,
  withWork,
} from './board'
import type { LaneKey, Work } from './board'
import type { FileView } from './draw'
import { drawBand, drawPane, drawPicker, holdsSomething, isProportionalSurface, listedMatchOf, listedOf } from './draw'
import {
  SCALE_INCLUDES_SUBAGENTS,
  bookInto,
  briefRow,
  emptyLedger,
  hasEntries,
  keyPaths,
  ledgerDir,
  ledgerNames,
  ledgerText,
  mainOwner,
  parseLedger,
  requestUsd,
  resolveAgent,
  rowOwner,
  scaleInterval,
  settle,
  tokensOf,
} from './ledger'
import type { AgentClaims, Claim, LedgerFile, Owner, Request } from './ledger'
import { planKey, readLedgers, withUsage } from './usage'

const COMMAND = 'plan-tracker'
const PANE_ID = 'plan-tracker'
const PANE_TITLE = 'Plans'
const REFRESH_MS = 10_000
const SCRIPT_TIMEOUT_MS = 30_000
const DONE_SOUND = 'sounds/done.wav'
const DONE_GAIN = 0.6
const TOAST_COLUMNS = 70
/**
 * Opening the pane asks for the keyboard, so the arrows and PageUp/PageDown scroll it at once (a pane taller than its window
 * scrolls only while focused; the wheel needs a fullscreen terminal), and for 60 rows, up to what the layout spares.
 */
const OPEN = { id: PANE_ID, title: PANE_TITLE, focus: true, rows: 60 } as const

/** The tracker's last answer: a board, or the one line saying why there is none; null until the first answer. */
const live = atom({ plugin: 'plan-tracker', key: 'live' } as const, null)
/** The `--query` the refreshes pass: `*` while the pane lists the plans, else the plan opened from the list, the band or a plan menu, or the one that just finished. */
const query = atom({ plugin: 'plan-tracker', key: 'query' } as const, '')
/** The query that asks the board command for the list of every plan. */
const ALL_PLANS = '*'
/** Whether the pane shows the plan list: `/plan-tracker` turns it on, opening a plan turns it off. */
const listing = atom({ plugin: 'plan-tracker', key: 'listing' } as const, false)
/** The list's search field text; the list is filtered by it here, with no script run per key. */
const search = atom({ plugin: 'plan-tracker', key: 'search' } as const, '')
/** Every plan, from the last answer to the query `*`: the list is drawn from it at once while `/plan-tracker` reads a new one. */
const allPlans = atom({ plugin: 'plan-tracker', key: 'allPlans' } as const, null)
/** The anchor picked in the band or the pane; null until one is picked, when the tracker's own `selected` stands. */
const selected = atom({ plugin: 'plan-tracker', key: 'selected' } as const, null)
const card = atom({ plugin: 'plan-tracker', key: 'card' } as const, null)
/** Whether the pane shows the plan file instead of the board. */
const file = atom({ plugin: 'plan-tracker', key: 'file' } as const, false)
/** The anchor of the plan a PLAN-DONE with 0 left finished; cleared by the person's next prompt. */
const finished = atom({ plugin: 'plan-tracker', key: 'finished' } as const, null)
/** The animation frame; advanced by the one timer, only while something on screen moves. */
const frame = atom({ plugin: 'plan-tracker', key: 'frame' } as const, 0)
/** Whether the pane's plan dropdown shows its list. */
const menu = atom({ plugin: 'plan-tracker', key: 'menu' } as const, false)
/** The lanes that show all their cards, as `<anchor>:<lane>`. */
const expanded = atom({ plugin: 'plan-tracker', key: 'expanded' } as const, [])
/** Whether the band's plan list shows. */
const bandMenu = atom({ plugin: 'plan-tracker', key: 'bandMenu' } as const, false)
/** What of this session is at work: a main turn running, and its background agents not yet ended. */
const working = atom({ plugin: 'plan-tracker', key: 'working' } as const, { turn: false, agents: [] })
/** When `working` last went from something to nothing; null until it has. */
const stoppedAt = atom({ plugin: 'plan-tracker', key: 'stoppedAt' } as const, null)
/** What the usage ledger keeps across a reload of the module (see `persistCarry`): the session, what is known of each subagent, the requests not yet in the file, the board files the session changed. */
const carried = atom({ plugin: 'plan-tracker', key: 'usageCarry' } as const, { session: '', agents: {}, unwritten: [], edited: [] })

/** The session's project root: where the board file and a relative path in a note are looked up. */
async function projectRoot($: EngineInterface): Promise<string> {
  if (settings.root === '') {
    settings.root = (await $.session.root().catch(() => '')).replace(/\/+$/, '')
  }

  return settings.root
}

/** How a command runs: in the project root, with `CLAUDE_PROJECT_DIR` pointing at it. */
async function commandInit($: EngineInterface, timeoutMs = SCRIPT_TIMEOUT_MS) {
  const root = await projectRoot($)

  return { cwd: root, env: { CLAUDE_PROJECT_DIR: root }, timeoutMs }
}

/** The board file's absolute path (`board_location`, relative to the project root). */
const boardFile = (root: string): string => (settings.boardLocation.startsWith('/') ? settings.boardLocation : `${root}/${settings.boardLocation}`)

// ---------------------------------------------------------------- the board: a command, or the board file

/** The board file read as a board, or the one line saying why there is none. */
async function readBoardFile($: EngineInterface): Promise<Live> {
  if (settings.boardLocation.startsWith('command:')) {
    return { error: 'plan-tracker: board_location is a "command:" board; set board_command to a command that prints the board as JSON' }
  }

  const file = boardFile(await projectRoot($))

  if (!(await $.fs.exists(file).catch(() => false))) {
    return noBoardFile(file)
  }

  try {
    return parseProgress(await $.fs.read(file), file, file.split('/').at(-2) ?? 'Plan')
  } catch (error) {
    return { error: `plan-tracker: cannot read ${file}: ${messageOf(error)}` }
  }
}

/** The board for `text`: `board_command`'s JSON when it is set, else the board file. */
async function fetchBoard($: EngineInterface, text: string): Promise<Live> {
  if (settings.boardCommand === '') {
    return readBoardFile($)
  }

  try {
    const { exitCode, stdout, stderr } = await $.process.run(boardArgv(await $.session.id(), text), await commandInit($))

    return exitCode === 0 ? parseBoard(stdout) : { error: failureText(exitCode, stderr) }
  } catch (error) {
    return { error: `plan-tracker: could not run the board command: ${messageOf(error)}` }
  }
}

/** The answer last written to `live`, as text; undefined until one is. */
let shownJson: string | undefined

/**
 * The board command's (or the board file's) answer for `text` with the usage the ledgers hold (`withUsage`), the ledgers read while the
 * board is. The plans the answer names are kept for the usage ledger's owners as soon as the board is in, without waiting for a ledger
 * that is being read again. A board command's own `usage` keys are not read: the plugin counts by itself, so there is one source.
 */
async function fetchWithUsage($: EngineInterface, text: string): Promise<Live> {
  const reading = readLedgers($).catch(async (error: unknown) => {
    await log($, 'ledger', `the usage ledgers were not read: ${messageOf(error)}`)

    return undefined
  })
  const answer = await fetchBoard($, text)

  if (!('board' in answer)) {
    return answer
  }

  trackerPlans = answer.board.plans

  const ledgers = await reading

  return ledgers === undefined ? answer : { board: withUsage(answer.board, ledgers, planKey) }
}

/** The run of the script under way, and the one rerun waiting behind it. */
let inFlight: Promise<void> | undefined
let queued: Promise<void> | undefined

/** Runs the script once for the current query and stores its answer (an answer to `*` also as the list); the state write redraws the band and the pane. */
async function refreshOnce($: EngineInterface) {
  const asked = await read($, query)
  const answer = await fetchWithUsage($, asked)
  const text = JSON.stringify(answer)

  if (asked === ALL_PLANS && 'board' in answer) {
    const list = listOf(answer.board)

    // Written only when it changed, as `live` is below: a write redraws, and a redraw hands the desktop's buttons new handles.
    if (JSON.stringify(list) !== JSON.stringify(await read($, allPlans))) {
      await update($, allPlans, () => list)
    }
  }

  // A write redraws what read the value, even one that changes nothing, and a redraw hands the desktop's buttons new handles:
  // an answer like the one shown is not written.
  if (text === shownJson) {
    return
  }

  await update($, live, () => answer)
  shownJson = text

  // Only the board file has no PLAN-DONE to say that a row went Done; a board command prints its own.
  if (settings.boardCommand === '') {
    await announceFileDone($, answer)
  }
}

/** The status of each row of the board file at its last read, by task; undefined until the first read, which is the baseline. */
let lastStatuses: Map<string, PlanStatus> | undefined

/**
 * A read of the board file that moved rows to Done: each is a toast and a notice, `✅ <task> · N left` (N: rows neither Done nor
 * Canceled), the read as a whole one chime, and a read that leaves every row Done or Canceled turns the band to a rainbow until
 * the person's next prompt. The first read, a row first seen already Done, and an error answer (the baseline stays) give nothing.
 */
async function announceFileDone($: EngineInterface, answer: Live) {
  if (!('board' in answer)) {
    return
  }

  const plan = answer.board.plans[0]
  const before = lastStatuses

  lastStatuses = new Map((plan?.rows ?? []).map(row => [row.task, row.status]))

  if (plan !== undefined && plan.anchor === (await read($, finished)) && plan.rows.some(isOpen)) {
    await unmarkFinished($, plan.anchor)
  }

  if (before === undefined || plan === undefined) {
    return
  }

  const went = plan.rows.filter(row => row.status === 'Done' && before.has(row.task) && before.get(row.task) !== 'Done')
  const left = plan.rows.filter(isOpen).length

  for (const [at, row] of went.entries()) {
    await notify($, row.task, String(left + went.length - 1 - at))
  }

  if (went.length > 0) {
    await chime($)

    if (isComplete(plan)) {
      await markFinished($, plan.anchor)
    }
  }
}

/**
 * Reads the tracker again. One run is in flight at a time: a call that comes meanwhile (the 10 s timer, a prompt, a Bash
 * call) shares the one rerun that starts when it ends, which reads the query as it is by then. The promise ends with the
 * run that answers the call.
 */
function refreshBoard($: EngineInterface): Promise<void> {
  if (inFlight === undefined) {
    const run = refreshOnce($).finally(() => {
      if (inFlight === run) {
        inFlight = undefined
      }
    })

    inFlight = run

    return run
  }

  queued ??= inFlight
    .catch(() => undefined)
    .then(() => {
      queued = undefined

      return refreshBoard($)
    })

  return queued
}

/** `refreshBoard` for a place that must not fail because the script did. */
const refreshQuietly = ($: EngineInterface) => refreshBoard($).catch(() => undefined)

const lastDrawn = new Map<string, { key: string; tree: unknown }>()

/**
 * The tree `build` makes for `data`, or the one made last time in `slot` when `data` is the same. Every Button and every link with a
 * press gets a new handle when a render hook builds its tree, and the engine keeps only the latest tree's handles: a click that
 * carries an earlier tree's handle is "ui_press not handled" and nothing happens. A render that draws what was drawn therefore hands
 * back the tree it drew, whose handles are the ones the surface holds. `data` is every input of the drawing (JSON, closures left out).
 */
export function steadily<T>(slot: string, data: unknown, build: () => T): T {
  const key = JSON.stringify(data)
  const held = lastDrawn.get(slot)

  if (held !== undefined && held.key === key) {
    return held.tree as T
  }

  const tree = build()

  lastDrawn.set(slot, { key, tree })

  return tree
}

/** Starts a read of the tracker without waiting for it (a slow script must not hold a prompt or a Bash result), then redraws what moves. */
function refreshInBackground($: EngineInterface) {
  void refreshQuietly($)
    .then(() => syncAnimation($))
    .catch(() => undefined)
}

let refresh: Timer | undefined
/** The poll of the board file: it runs for the whole session, so the band and the board follow the file without a command. */
let watch: Timer | undefined

/** How often the board file is read again (it is read whole and redrawn only when its content changed). */
const WATCH_MS = 1_500

function startWatch($: EngineInterface) {
  if (settings.boardCommand === '') {
    watch ??= $.clock.every(WATCH_MS, () => void refreshInBackground($))
  }
}

function startRefresh($: EngineInterface) {
  refresh ??= $.clock.every(REFRESH_MS, () => void refreshQuietly($))
}

function stopRefresh() {
  refresh?.cancel()
  refresh = undefined
}

// ---------------------------------------------------------------- what is shown

/**
 * The board the tracker last answered, with this session's work on its own plans (`withWork`), or undefined while there is none (no
 * answer yet, or an error line). A drawing that reads it is redrawn when the work changes.
 */
async function boardOf($: EngineInterface): Promise<PlanBoard | undefined> {
  const answer = await read($, live)

  return answer !== null && 'board' in answer ? withWork(answer.board, await read($, working), await read($, stoppedAt)) : undefined
}

// ---------------------------------------------------------------- this session at work

/**
 * Changes what of this session is at work and redraws what reads it (the band too, with the pane closed); when that leaves nothing at
 * work, `stoppedAt` becomes now. A change that changes nothing writes nothing.
 */
async function changeWork($: EngineInterface, change: (work: Work) => Work) {
  const before = await read($, working)

  if (JSON.stringify(change(before)) === JSON.stringify(before)) {
    return
  }

  let was = before

  await update($, working, current => {
    was = current

    return change(current)
  })

  if (isWorking(was) && !isWorking(await read($, working))) {
    await update($, stoppedAt, () => localIso(Date.now()))
  }

  await syncAnimation($)
}

/** Ended agent states: `$.agent.list()` showing one of these, or not listing the agent at all, ends it here. */
const ENDED = ['completed', 'failed', 'killed']

/** Drops the background agents `$.agent.list()` shows ended or no longer lists. */
async function pruneAgents($: EngineInterface) {
  if ((await read($, working)).agents.length === 0) {
    return
  }

  const running = new Set((await $.agent.list()).flatMap(agent => (ENDED.includes(agent.status) ? [] : [agent.id])))

  await changeWork($, work => ({ ...work, agents: work.agents.filter(id => running.has(id)) }))
}

/** The plan picked (else the tracker's own choice). */
async function shownPlan($: EngineInterface): Promise<PlanEntry | undefined> {
  const board = await boardOf($)

  return board === undefined ? undefined : planOf(board, await read($, selected))
}

/** The most characters of the plan file the pane draws (one drawing holds 100000 in all). */
const FILE_CHARS = 90000

/** The plan file's text for the pane, or why it cannot be read. */
async function loadFile($: EngineInterface, plan: PlanEntry): Promise<FileView> {
  try {
    const text = await $.fs.read(plan.plan_file)

    return { text: text.length > FILE_CHARS ? `${text.slice(0, FILE_CHARS)}\n\n… (cut here; open the file for the rest)` : text }
  } catch (error) {
    return { error: `cannot read ${plan.plan_file}: ${messageOf(error)}` }
  }
}

// ---------------------------------------------------------------- the log, the toast and the chime

/** One line of ~/.claude/mods-logs/plan-tracker.jsonl; `error` is null for a notice that was shown. `extra` adds fields after the four. */
async function log($: EngineInterface, stage: string, error: string | null, extra: Record<string, unknown> = {}) {
  try {
    const home = await $.env.get('HOME')

    if (home === undefined) {
      return
    }

    const line = JSON.stringify({
      ts: new Date().toISOString(),
      session_id: await $.session.id().catch(() => ''),
      stage,
      error,
      ...extra,
    })

    await $.process.run(['/bin/sh', '-c', 'mkdir -p "$1" && cat >> "$1/plan-tracker.jsonl"', 'sh', `${home}/.claude/mods-logs`], {
      stdin: `${line}\n`,
    })
  } catch {
    // The log is best effort: it must not break the Bash call it reports on.
  }
}

/** Runs `work`; a throw is logged under `stage` and answers false. */
async function attempt($: EngineInterface, stage: string, work: () => unknown): Promise<boolean> {
  try {
    await work()

    return true
  } catch (error) {
    await log($, stage, messageOf(error))

    return false
  }
}

// ---------------------------------------------------------------- the usage ledger

/** The plans the board last answered (`refreshOnce`), as they came: whose work a request is, is read from them. */
let trackerPlans: readonly PlanEntry[] = []

/** The board files this session, or one of its agents, has changed with a file tool: with a plain PROGRESS.md, such a session works the plan the file holds. */
const edited = new Set<string>()

/**
 * The plans the owners read, each keyed as the ledgers key it (`planKey`: a plain PROGRESS.md's plan is `progress` in every project, so its
 * key is the file) and marked this session's by what the board says (`in_session` of a board command) or, for a plain PROGRESS.md, by the
 * session having changed the file. The band's In progress state keeps reading the plans as the board gave them.
 */
function ownerPlans(): PlanEntry[] {
  return trackerPlans.map(plan => ({ ...plan, anchor: planKey(plan), in_session: settings.boardCommand === '' ? edited.has(plan.plan_file) : plan.in_session === true }))
}

/** The requests recorded since the last interval closed. `turn.step` pushes here without an `await`; a `session.measure` that moves the cost books them. */
let pending: Request[] = []

/**
 * What is known of each subagent, by agent id: the rows it claimed (its brief's, each verified In Progress write of its own) and its
 * parent. Whose its requests are is worked out from this and the tracker's latest answer each time (`resolveAgent`), never fixed at the spawn.
 */
const agents = new Map<string, AgentClaims>()

/** The ledger as booked (closed intervals only); null until `ensureLedger` has read the file or started a new one. */
let ledger: LedgerFile | null = null

let loading: Promise<void> | undefined

/** The host's `cost.usd` at the end of the last interval, or at load; null when not known. */
let lastUsd: number | null = null

/** Whether the next interval is the first since this board loaded: its requests are not scaled. */
let isFirstInterval = true

/** Whether the host keeps a cost ledger; once a reading shows it does not, nothing waits for an interval to close. */
let hostHasCost = true

/** Whether the ledger or the open interval changed since the file was written. */
let isDirty = false

/** The surface the session last drew on, which the file records. */
let surfaceSeen = 'unknown'

/** Whether this session's `usage-shape` line has been logged. */
let isShapeLogged = false

/** Whether the session's ledger file exists (read at load, or written since). A session with no entry of its own makes none: a headless run would leave one file per run. */
let hasFile = false

/** The file `ledger` is written to, chosen with it at load (`ensureLedger`); null before, or when no free name could be found. The two are always used together. */
let ledgerFile: string | null = null

/** How many of `pending` the file already holds (at table price), and the count of intervals closed: a write only counts requests of the interval it saw. */
let writtenUpTo = 0
let intervalNo = 0

/** A write of the file that has not ended in this long is given up (logged), so the next write is not held behind it. */
const WRITE_TIMEOUT_MS = 10_000

/**
 * Reads the session's ledger file, or starts a new ledger when there is none: a board that reloads mid-session adds to what it wrote
 * before. A file that cannot be read as this session's ledger is left as it is (it may hold the session's earlier usage): the ledger is
 * written to the next name of `ledgerNames`. Once per session; never throws.
 */
function ensureLedger($: EngineInterface): Promise<void> {
  loading ??= (async () => {
    let held: LedgerFile | undefined
    let file: string | null = null
    let session = ''

    try {
      session = await $.session.id()

      const home = await $.env.get('HOME')
      const dir = home === undefined || home === '' ? undefined : ledgerDir(home)

      for (const name of dir === undefined || session === '' ? [] : ledgerNames(session)) {
        const path = `${dir}/${name}`

        if (!(await $.fs.exists(path))) {
          file = path

          break
        }

        try {
          held = parseLedger(await $.fs.read(path), session)
        } catch (error) {
          await log($, 'ledger', `${path} not read: ${messageOf(error)}`)

          continue
        }

        if (held !== undefined) {
          file = path

          break
        }

        await log($, 'ledger', `${path} not read: it is not a ledger of this session; it is left as it is and the ledger goes to another file`)
      }

      if (file === null && session !== '') {
        await log($, 'ledger', 'no file name is free for this session\'s ledger: its usage is not written')
      }
    } catch (error) {
      await log($, 'ledger', `ledger file not read: ${messageOf(error)}`)
    }

    if (session === '') {
      loading = undefined

      return
    }

    ledger = held ?? emptyLedger(session, surfaceSeen)
    ledgerFile = file
    hasFile = held !== undefined
  })()

  return loading
}

/** Loads the ledger, takes back what a reload left in the state, and reads the host's cost at this moment, which the first interval's change is counted from. */
async function startLedger($: EngineInterface) {
  await ensureLedger($)
  await restoreCarry($)

  const cost = (await $.session.usage()).cost?.usd

  lastUsd ??= cost ?? null
  hostHasCost = cost !== undefined
}

/** Forgets the session: the next one (after a `/clear` the same process goes on under a new id) starts a ledger of its own, with none of this one's plans. */
function resetLedger($: EngineInterface) {
  ledger = null
  ledgerFile = null
  loading = undefined
  pending = []
  writtenUpTo = 0
  intervalNo += 1
  trackerPlans = []
  agents.clear()
  edited.clear()
  lastUsd = null
  isFirstInterval = true
  isDirty = false
  isShapeLogged = false
  hasFile = false
  persistCarry($)
}

const isOwner = (value: unknown): value is Owner | null =>
  value === null || (typeof value === 'object' && typeof (value as Owner).plan === 'string' && ((value as Owner).row === null || typeof (value as Owner).row === 'string'))

const isCount = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value)

/** A request read back from the state: the shape `recordRequest` writes, else it is dropped. */
const isRequest = (value: unknown): value is Request => {
  const one = value as Request | null
  const tokens = one?.tokens

  return (
    typeof one === 'object' && one !== null && isOwner(one.owner) && (one.agentId === undefined || typeof one.agentId === 'string') && (one.wanted === undefined || isClaim(one.wanted)) &&
    (one.usd === null || isCount(one.usd)) && isCount(one.at) && typeof tokens === 'object' && tokens !== null &&
    [tokens.in, tokens.cached, tokens.cache_write, tokens.out].every(isCount)
  )
}

/** The write of the carry in flight, and whether another was asked meanwhile. */
let carrying: Promise<void> | undefined
let isCarryAgain = false

/**
 * Keeps what is known of each subagent, the requests the file does not hold yet and the board files this session has changed in
 * `usageCarry` (`$.state`), which a reload of the module outlives, so a worker still running keeps its row, its recent requests are not
 * lost and the session still works its plan. Not awaited; one write at a time; a failure is ignored.
 */
function persistCarry($: EngineInterface) {
  if (carrying !== undefined) {
    isCarryAgain = true

    return
  }

  carrying = (async () => {
    try {
      do {
        isCarryAgain = false

        const session = await $.session.id()

        await update($, carried, () => JSON.parse(JSON.stringify({ session, agents: Object.fromEntries(agents), unwritten: pending.slice(writtenUpTo), edited: [...edited] })))
      } while (isCarryAgain)
    } catch {
      // the carry is a convenience for a reload; the file is the record
    } finally {
      carrying = undefined
    }
  })()
}

const isClaim = (value: unknown): value is Claim => typeof value === 'object' && value !== null && typeof (value as Claim).task === 'string' && ((value as Claim).anchor === undefined || typeof (value as Claim).anchor === 'string')

/** Takes back, after a reload, what the carry holds for this session: what is known of each subagent, the unwritten requests and the board files it changed. */
async function restoreCarry($: EngineInterface) {
  const held = await read($, carried)

  if (held.session === '' || held.session !== (await $.session.id())) {
    return
  }

  for (const [id, known] of Object.entries(held.agents)) {
    const claims = Array.isArray(known?.claims) ? known.claims.filter(isClaim) : []

    if (!agents.has(id)) {
      agents.set(id, { claims, ...(typeof known?.parent === 'string' ? { parent: known.parent } : {}) })
    }
  }

  if (pending.length === 0 && writtenUpTo === 0) {
    pending = held.unwritten.filter(isRequest)
    isDirty = isDirty || pending.length > 0
  }

  for (const path of held.edited) {
    if (typeof path === 'string') {
      edited.add(path)
    }
  }
}

/**
 * Once per session, logs one `usage-shape` line with the key names of the first usage object `turn.step` reports, nested keys as dotted
 * paths: it shows whether the runtime carries the 1-hour/5-minute split of cache writes. Not awaited; no value is logged.
 */
function noteUsageShape($: EngineInterface, usage: unknown) {
  if (isShapeLogged || usage === null || usage === undefined) {
    return
  }

  isShapeLogged = true
  void log($, 'usage-shape', null, { kind: 'usage-shape', keys: keyPaths(usage) })
}

/** Whether `usage` holds the four counts and a model: a response that does not is not a request to count. */
const isCounted = (usage: TurnUsage): boolean =>
  typeof usage.model === 'string' &&
  usage.model !== '<synthetic>' &&
  [usage.input_tokens, usage.output_tokens, usage.cache_read_input_tokens, usage.cache_creation_input_tokens].every(count => typeof count === 'number' && Number.isFinite(count))

/** Counts one response. No `await`, nothing that can reach the disk: it runs in the request's chain, after the response is whole. */
function recordRequest($: EngineInterface, agentId: string | undefined, usage: TurnUsage | null) {
  if (usage === null || !isCounted(usage)) {
    return
  }

  const plans = ownerPlans()
  const { owner, wanted } = agentId === undefined ? { owner: mainOwner(plans), wanted: undefined } : resolveAgent(agents, plans, agentId)

  pending.push({ owner, agentId, ...(wanted === undefined ? {} : { wanted }), tokens: tokensOf(usage), usd: requestUsd(usage.model, usage, agentId === undefined), at: Date.now() })
  isDirty = true
  persistCarry($)
}

/** Looks up again, in the board's latest answer, the rows that the open interval's subagent requests claimed when the answer did not have them yet. */
function settleOwners() {
  pending = settle(pending, ownerPlans())
}

/**
 * A spawned subagent: its brief's first line, `Tracker row: "<exact row text>"`, is its claim on a row, and `parentAgentId` says which
 * subagent spawned it. Nothing is decided here: whose its requests are comes from these and the board's latest answer when they are
 * recorded and booked (`resolveAgent`), because the row may be one made seconds before, which the board's last answer lacks. One
 * `usage-owner` line says what was known and what it resolved to, so a live miss can be read from the log.
 */
function noteSpawn($: EngineInterface, agentId: string, prompt: string, parentAgentId: string | undefined) {
  const task = briefRow(prompt)

  const plans = ownerPlans()

  agents.set(agentId, { claims: task === undefined ? [] : [{ task }], ...(parentAgentId === undefined ? {} : { parent: parentAgentId }) })
  persistCarry($)
  void log($, 'usage-owner', null, {
    kind: 'usage-owner',
    agent_id: agentId,
    brief_row: task ?? null,
    brief_matched: task !== undefined && rowOwner(plans, task) !== null,
    parent: parentAgentId ?? null,
    owner: resolveAgent(agents, plans, agentId).owner,
    tracker_plans: plans.filter(one => one.in_session === true).length,
  })
}

/** A file tool changed `path`: when it is the board file, the session works the plan the file holds, and the file is read again. */
async function noteBoardChange($: EngineInterface, path: unknown) {
  if (typeof path !== 'string' || path !== boardFile(await projectRoot($))) {
    return
  }

  if (!edited.has(path)) {
    edited.add(path)
    persistCarry($)
  }

  refreshInBackground($)
}

/**
 * The end of an interval: `session.measure` says the host's cost moved. The requests since the last interval are scaled to the host's
 * change (`scaleInterval`) and booked into the ledger. Every measure, closing one or not, leaves one `usage-interval` line in the log:
 * whether the host had a cost, the host's change, the table's sums for the main thread and for subagents, the counts, the factor.
 */
async function closeInterval($: EngineInterface, e: { cost?: { usd: number }; changed: readonly string[] }) {
  await ensureLedger($)
  settleOwners()

  const usd = e.cost?.usd
  const isClosing = usd !== undefined && e.changed.includes('cost')
  const delta = usd === undefined || lastUsd === null ? null : usd - lastUsd
  const interval = scaleInterval(pending, delta, { includesSubagents: SCALE_INCLUDES_SUBAGENTS, isFirst: isFirstInterval })
  const probe = {
    kind: 'usage-interval',
    cost_present: usd !== undefined,
    changed: e.changed,
    is_first: isFirstInterval,
    host_delta_usd: delta,
    table_sum_main_usd: interval.tableMain,
    table_sum_sub_usd: interval.tableSub,
    requests_main: interval.requestsMain,
    requests_sub: interval.requestsSub,
    factor: interval.factor,
    is_scaled: isClosing && interval.isScaled,
  }

  hostHasCost = usd !== undefined

  if (isClosing && ledger !== null) {
    ledger = { ...bookInto(ledger, interval.booked), measured_usd: usd }
    pending = []
    writtenUpTo = 0
    intervalNo += 1
    lastUsd = usd
    isFirstInterval = false
    isDirty = true
    persistCarry($)
    requestWrite($)
  }

  // A measure that moved only the rate limits (a cost on the host, unchanged) has nothing to say about the cost.
  if (isClosing || usd === undefined) {
    void log($, 'usage-interval', null, probe)
  }
}

/** Writes the ledger file whole. False when nothing needed writing or the write failed (logged; the next write tries again). */
async function writeLedger($: EngineInterface): Promise<boolean> {
  if (!isDirty) {
    return false
  }

  await ensureLedger($)

  if (ledger === null || ledgerFile === null) {
    return false
  }

  settleOwners()

  // A host with no cost ledger never closes an interval: its requests are booked at the table price as they come.
  if (!hostHasCost && pending.length > 0) {
    ledger = bookInto(ledger, scaleInterval(pending, null, { includesSubagents: SCALE_INCLUDES_SUBAGENTS, isFirst: true }).booked)
    pending = []
    writtenUpTo = 0
    intervalNo += 1
    persistCarry($)
  }

  // No file for a session with no entry of its own (a headless run, a summarizer): it would only hold what nobody owns, and the tracker reads every file.
  if (!hasFile && !hasEntries(ledger, pending)) {
    return false
  }

  const surface = (await $.session.surfaces().catch(() => []))[0] ?? surfaceSeen

  // From here to the write nothing is awaited: the ledger and the file it belongs to are taken together, so a session that ended meanwhile
  // (a /clear) can never have its ledger written under the other session's name.
  const file = ledgerFile
  const held = ledger

  if (held === null || file === null) {
    return false
  }

  surfaceSeen = surface
  ledger = { ...held, surface }
  isDirty = false
  settleOwners()

  const seen = { upTo: pending.length, interval: intervalNo }
  const text = ledgerText(ledger, pending, localIso(Date.now()))

  try {
    await writeBounded($, file, text)

    if (ledgerFile === file) {
      hasFile = true

      // The file now holds the requests of the interval it was written from; what came after is still unwritten.
      if (seen.interval === intervalNo) {
        writtenUpTo = Math.max(writtenUpTo, seen.upTo)
        persistCarry($)
      }
    }

    return true
  } catch (error) {
    if (ledgerFile === file) {
      isDirty = true
    }

    await log($, 'ledger', `${file} not written: ${messageOf(error)}`)

    return false
  }
}

/** `$.fs.write`, given up (rejected) when it has not ended in `WRITE_TIMEOUT_MS`: a write that hangs must not hold the writer for good. */
function writeBounded($: EngineInterface, path: string, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = $.clock.after(WRITE_TIMEOUT_MS, () => reject(new Error(`the write did not end in ${WRITE_TIMEOUT_MS / 1000} s`)))

    $.fs.write(path, text).then(resolve, reject).finally(() => timer.cancel())
  })
}

/** The write in flight, and whether another was asked meanwhile. */
let writing: Promise<void> | undefined
let isWriteAgain = false

/**
 * Asks for the ledger to be written, without waiting for it: one write runs at a time, a request that comes meanwhile makes it write
 * once more. When something was written the tracker is read again, once, so the board draws the new figures.
 */
function requestWrite($: EngineInterface) {
  if (writing !== undefined) {
    isWriteAgain = true

    return
  }

  writing = (async () => {
    let wrote = false

    try {
      do {
        isWriteAgain = false
        wrote = (await writeLedger($)) || wrote
      } while (isWriteAgain)
    } catch (error) {
      await log($, 'ledger', messageOf(error))
    } finally {
      writing = undefined
    }

    if (wrote) {
      refreshInBackground($)
    }
  })()
}

/** Shows one PLAN-DONE block as a toast and a notice in the conversation; whatever fails is logged, never thrown. */
export async function announce($: EngineInterface, block: string) {
  const done = doneHeader(block)

  if (done === undefined) {
    await log($, 'parse', `unreadable header: ${block.split('\n')[0] ?? ''}`)

    return
  }

  await notify($, done.task, done.left, block)
}

/**
 * The toast `✅ <task> · <left> left` (the task cut to the toast) and the notice in the conversation: `notice` as given, else the
 * same line with the whole task. Whatever fails is logged, never thrown; a `sent` line says both were shown.
 */
async function notify($: EngineInterface, task: string, left: string, notice = `✅ ${task} · ${left} left`) {
  const isToasted = await attempt($, 'toast', () => $.ui.toast(`✅ ${truncate(task, TOAST_COLUMNS)} · ${left} left`))
  const isAppended = await attempt($, 'append', async () => {
    const appended = await $.session.append({ message: { type: 'system', content: [{ type: 'text', text: notice }] } })

    if (appended.deny !== undefined) {
      throw new Error(`append refused: ${appended.deny}`)
    }
  })

  if (isToasted && isAppended) {
    await log($, 'sent', null)
  }
}

/**
 * The chime, only where a person can hear it: a session with a terminal. A session with none (a `claude -p` run at night
 * loads mods too) stays silent, and a clip that cannot play never breaks anything.
 */
async function chime($: EngineInterface) {
  try {
    if ((await $.session.surfaces()).includes('terminal')) {
      await $.audio.play({ asset: DONE_SOUND }, { gain: DONE_GAIN })
    }
  } catch {
    // no screen to ask, or a clip that cannot play: the toast has been shown
  }
}

// ---------------------------------------------------------------- the board, the band and what moves

/**
 * Opens the board when it is not up, closes it when it is. While the pane lists the plans, the press leaves the list instead: the pane
 * shows the band's plan board, opened if it was closed, and the query becomes that plan's anchor.
 */
async function toggleBoard($: EngineInterface) {
  const isUp = (await $.ui.panes()).some(pane => pane.id === PANE_ID && pane.isPlaced)

  if (await read($, listing)) {
    const plan = await shownPlan($)

    await Promise.all([update($, listing, () => false), ...(plan === undefined ? [] : [update($, query, () => plan.anchor)])])
    await $.ui.open(OPEN)
  } else if (isUp) {
    await $.ui.close({ id: PANE_ID })
  } else {
    await $.ui.open(OPEN)
  }

  await syncAnimation($)
}

/**
 * Hands the keyboard to the pane if it is up. A click leaves the keys with the site it landed on (the band's Button holds
 * them), so a handler that changes what the pane shows asks again, which the pane takes; with the pane closed it opens nothing.
 * With `top`, the new view also starts at its first row (the window keeps its offset across views otherwise).
 */
async function refocus($: EngineInterface, top = false) {
  try {
    if ((await $.ui.panes()).some(pane => pane.id === PANE_ID && pane.isPlaced)) {
      await $.ui.open(OPEN)

      if (top) {
        await $.ui.scroll({ to: 'start', in: PANE_ID })
      }
    }
  } catch {
    // a surface that cannot move the keys leaves them where they are
  }
}

/** Opens the board (taking the keys) and shows the plan file in it. */
async function openFile($: EngineInterface) {
  await Promise.all([update($, file, () => true), update($, card, () => null), update($, menu, () => false), update($, bandMenu, () => false)])

  await $.ui.open(OPEN)
  await $.ui.scroll({ to: 'start', in: PANE_ID }).catch(() => undefined)
  await syncAnimation($)
}

/** Goes back to the board's lanes. The keys go to the pane. */
async function showBoard($: EngineInterface) {
  await Promise.all([update($, card, () => null), update($, file, () => false)])
  await syncAnimation($)
  await refocus($, true)
}

/**
 * Picks a plan for the band and the board together: both lists close and the board shows its lanes; the pane leaves the plan list, and
 * the query becomes the anchor (else the refreshes would go on asking for every plan).
 */
async function pickPlan($: EngineInterface, anchor: string) {
  await Promise.all([
    update($, listing, () => false),
    update($, query, () => anchor),
    update($, selected, () => anchor),
    update($, card, () => null),
    update($, file, () => false),
    update($, menu, () => false),
    update($, bandMenu, () => false),
  ])
  await syncAnimation($)
  await refocus($, true)
}

/**
 * Picks a plan of the pane's list: the plan may not be among the session's, so the query becomes its anchor (the tracker answers
 * with that plan's entry) as well as the plan shown. The pane leaves the list, lists close and the board shows its lanes, as in `pickPlan`.
 */
async function pickMatch($: EngineInterface, anchor: string) {
  await Promise.all([
    update($, listing, () => false),
    update($, query, () => anchor),
    update($, selected, () => anchor),
    update($, card, () => null),
    update($, file, () => false),
    update($, menu, () => false),
    update($, bandMenu, () => false),
  ])
  await refreshQuietly($)
  await syncAnimation($)
  await refocus($, true)
}

/**
 * Whether anything on screen moves: the band (the rainbow of a complete plan, the mascot while the plan is at work) or the open
 * pane (the mascots while the plan is at work).
 */
async function animates($: EngineInterface): Promise<boolean> {
  const plan = await shownPlan($)

  if (plan === undefined) {
    return false
  }

  // Only a terminal moves by redraw: the desktop reads no frame (its sprite animates itself), so a timer would only write one.
  const surfaces = await $.session.surfaces().catch(() => null)

  if (JSON.stringify(surfaces) !== loggedSurfaces) {
    loggedSurfaces = JSON.stringify(surfaces)
    void log($, 'timer', null, { surfaces })
  }

  if (surfaces !== null && !surfaces.includes('terminal')) {
    return false
  }

  const isPaneUp = (await $.ui.panes()).some(pane => pane.id === PANE_ID && pane.isPlaced && pane.isShown)
  const isBoard = detailOf(plan, await read($, card)) === null && !(await read($, file))
  const { band, pane } = movement(plan, { finished: await read($, finished), isPaneUp, isBoard })

  return band || pane
}

/** The state text the band last drew, by surface, as `<anchor> <text>`. */
const drawnStates = new Map<string, string>()

/** Logs the state the band draws on `surface` when it differs from the one it drew last there: once per change, not per frame. */
function noteState($: EngineInterface, surface: string, plan: PlanEntry, text: string) {
  const key = `${plan.anchor} ${text}`

  if (drawnStates.get(surface) !== key) {
    drawnStates.set(surface, key)
    void log($, 'state', null, { surface, plan: plan.anchor, state: planStateOf(plan), text })
  }
}

/** The rows the pane last said it shows (`scroll.bodyRows`): logged with a lane press, for the Show less rule. */
let paneRows: number | undefined

/** The surfaces last logged by `animates`, as text. */
let loggedSurfaces = ''

/** Opens row `index` of `plan` on its page: the plan list shuts and the pane is focused at its top. */
async function openRow($: EngineInterface, plan: PlanEntry, index: number) {
  await Promise.all([update($, menu, () => false), update($, card, () => ({ anchor: plan.anchor, index }))])
  await syncAnimation($)
  await refocus($, true)
}

/**
 * What a press on the Button (or answered link) keyed `element` does: the same actions as the drawings' `onPress` closures,
 * which call this too. It decides at once whether the key is the mod's (undefined if not) and returns the work, so a caller
 * can answer a press without waiting: the `ui.press` hook runs the work in the background, because opening a pane from
 * inside the press chain must not hold the chain.
 */
export function actionFor($: EngineInterface, element: string, surface: string): (() => Promise<unknown>) | undefined {
  const lane = /^lane:(.+):(?:more|less)$/.exec(element)?.[1]
  // A card: a line of the terminal's Buttons (`card:N`, `card:N:<line>`), or vscode's "Open ›" (`card:<anchor>:N`, ignored for another plan).
  const lineCard = /^card:(\d+)(?::\d+)?$/.exec(element)
  const linkCard = lineCard === null ? /^card:(.+):(\d+)$/.exec(element) : null
  const cardAt = lineCard?.[1] ?? linkCard?.[2]

  if (cardAt !== undefined) {
    return async () => {
      const plan = await shownPlan($)
      const index = Number(cardAt)

      if (plan !== undefined && (linkCard === null || linkCard[1] === plan.anchor) && plan.rows[index] !== undefined) {
        await openRow($, plan, index)
      }
    }
  }

  if (element === 'band:bar' || element === 'band:head') {
    return () => toggleBoard($)
  }

  if (element === 'band:plans') {
    return () => update($, bandMenu, isOpen => !isOpen)
  }

  if (element === 'band:file' || element === 'plan-file') {
    return () => openFile($)
  }

  if (element === 'band:board' || element === 'back') {
    return () => showBoard($)
  }

  if (element.startsWith('band:plan:')) {
    return () => pickPlan($, element.slice('band:plan:'.length))
  }

  if (element === 'menu:name' || element === 'menu:arrow') {
    return async () => {
      await update($, menu, isOpen => !isOpen)
      await refocus($)
    }
  }

  if (element.startsWith('plan:')) {
    return () => pickPlan($, element.slice('plan:'.length))
  }

  if (element.startsWith('match:')) {
    return () => pickMatch($, element.slice('match:'.length))
  }

  if (lane !== undefined) {
    return async () => {
      const plan = await shownPlan($)

      if (plan !== undefined) {
        const key = `${plan.anchor}:${lane}`

        // The desktop's rows may not be the terminal's: record what each surface says its pane shows.
        void log($, 'lane', null, { surface, bodyRows: paneRows })

        await update($, expanded, all => (all.includes(key) ? all.filter(one => one !== key) : [...all, key]))
        await refocus($)
      }
    }
  }

  return undefined
}

/** Runs the press of `element` in the background (a failure is logged, never thrown); false for a key the mod does not draw. */
function pressByKey($: EngineInterface, element: string, surface: string): boolean {
  const action = actionFor($, element, surface)

  if (action === undefined) {
    return false
  }

  void action().catch((error: unknown) => log($, 'press', messageOf(error), { element, surface }))

  return true
}

/** Enter in the search field: the text is kept and the first plan it leaves in the list opens; none left opens nothing. */
async function submitSearch($: EngineInterface, text: string) {
  await update($, search, () => text)

  const top = listedMatches((await read($, allPlans)) ?? [], text)[0]

  if (top !== undefined) {
    await pickMatch($, top.anchor)
  }
}

/**
 * Runs what typing in the Input keyed `element` does, by its key as a press is (a desktop redraw makes the drawn closures' handles stale), in
 * the background; false for a key the mod does not draw. A change keeps the text, which the list is filtered by when it is drawn.
 */
function typeByKey($: EngineInterface, element: string, kind: 'change' | 'submit', value: string, surface: string): boolean {
  if (element !== 'search') {
    return false
  }

  const work = kind === 'change' ? update($, search, () => value) : submitSearch($, value)

  void work.catch((error: unknown) => log($, 'input', messageOf(error), { element, surface, kind }))

  return true
}

/** Starts the frame timer when something moves and cancels it when nothing does. */
async function syncAnimation($: EngineInterface): Promise<boolean> {
  const moves = await animates($)

  if (moves) {
    animation ??= $.clock.every(FRAME_MS, () => void step($).catch(() => undefined))
  } else {
    animation?.cancel()
    animation = undefined
  }

  return moves
}

/** One period of the frame timer: the next frame while something moves, else the timer ends. */
async function step($: EngineInterface) {
  if (await syncAnimation($)) {
    await update($, frame, n => n + 1)
  }
}

let animation: Timer | undefined

/**
 * A PLAN-DONE with 0 left: the band shows that plan, finished, from the tracker's answer for it, until the person's next prompt. The query
 * is no longer `*`, so a pane listing the plans shows that plan's board instead (its list would be empty).
 */
async function markFinished($: EngineInterface, anchor: string) {
  await Promise.all([update($, finished, () => anchor), update($, query, () => anchor), update($, selected, () => anchor), update($, listing, () => false)])
  refreshInBackground($)
  await syncAnimation($)
}

/** The finished plan has tasks left again (reopened, or a task added) before the next prompt: the band draws it as it is. */
async function unmarkFinished($: EngineInterface, mark: string) {
  await Promise.all([update($, finished, () => null), update($, query, asked => (asked === mark ? '' : asked))])
  await syncAnimation($)
}

/**
 * The plan `/plan-tracker` opens once the list is read: the one plan the board command printed with no `matches` (the board of a command
 * that treats `*` as a word, and of a plain board file), else the plan the words are (`directPick`); undefined for none.
 */
async function planToOpen($: EngineInterface, text: string) {
  const board = await boardOf($)

  return board !== undefined && board.matches === undefined && board.plans.length === 1 ? board.plans[0] : directPick((await read($, allPlans)) ?? [], text)
}

/**
 * `/plan-tracker` opens the pane at once on the list of every plan, its search field holding the words after the command and the keys
 * (a focus move that does not take is logged), and answers no text. The list is the one the mod already holds (`Loading plans…` before
 * the first); the tracker is read for `*` behind it, and the answer redraws the list. Then the plan it names opens (`planToOpen`), unless the
 * person has typed or left the list meanwhile. A plain board file holds one plan: the list is skipped and its board is the pane. The pane
 * opens whatever `$.session.surfaces()` says: a Desktop client joins that list only once it attaches, and `/plan-tracker` can be a session's
 * first input. When the pane waits undrawn, a toast says why. One log line per run, once the answer is in: the surfaces seen, whether the pane
 * was placed, and the milliseconds from the command to the open pane (`openMs`) and to the fresh list (`listMs`).
 */
async function runCommand($: EngineInterface, e: { args: string }) {
  const startedAt = await $.clock.now()
  const text = e.args.trim()
  const hasList = settings.boardCommand !== ''

  if (hasList) {
    await Promise.all([update($, query, () => ALL_PLANS), update($, listing, () => true), update($, search, () => text)])
  }

  const surfaces = await $.session.surfaces().catch(() => null)
  const opened = await $.ui.open(OPEN).catch((error: unknown) => ({ isPlaced: false as const, reason: messageOf(error) }))
  const openMs = (await $.clock.now()) - startedAt

  if (!opened.isPlaced) {
    $.ui.toast(`Board waits: ${opened.reason}`)
  } else if (hasList) {
    const target = { requestId: PANE_ID, key: 'search' }

    void $.ui
      .focus(target)
      .then(moved => (moved.deny === undefined ? undefined : log($, 'focus', moved.deny, target)))
      .catch((error: unknown) => log($, 'focus', messageOf(error), target))
  }

  void (async () => {
    await refreshQuietly($)

    const listMs = (await $.clock.now()) - startedAt
    const plan = hasList ? await planToOpen($, text) : undefined

    if (plan !== undefined && (await read($, listing)) && (await read($, search)) === text) {
      await pickMatch($, plan.anchor)
    }

    await syncAnimation($)
    await log($, 'open', opened.isPlaced ? null : opened.reason, { surfaces, isPlaced: opened.isPlaced, openMs, listMs })
  })().catch(() => undefined)

  return {}
}

export const register: Register = (on, options) => {
  applyOptions(options)

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: COMMAND,
        description: 'Open the plan board; with a board command that lists several plans, pick one from the list, latest first; /plan-tracker <words> searches it',
        argumentHint: '[words to search plans, with a board command]',
      })
    } catch (error) {
      // The engine refuses a name another command already defines: the band and the board still work.
      await log($, 'command', messageOf(error))
    }

    await projectRoot($)
    // A turn or an agent whose end was missed does not stay at work past a restart.
    await changeWork($, () => ({ turn: false, agents: [] })).catch(() => undefined)
    refreshInBackground($)
    startWatch($)
    // The usage ledger of this session: its file read (a reload goes on from it) and the host's cost taken as the baseline.
    void startLedger($).catch(() => undefined)

    // A reload keeps the pane but drops the module's timers: start them again. A session with no screen (`claude -p`) has
    // no panes to ask, and that must not stop the mod loading.
    try {
      if ((await $.ui.panes()).some(pane => pane.id === PANE_ID)) {
        startRefresh($)
      }
    } catch {
      // no panes to ask
    }

    await syncAnimation($).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: COMMAND }, runCommand)

  // Every way the pane opens starts its 10 s refresh; closing it ends it.
  on('ui.open', { id: PANE_ID }, async ($, e, next) => {
    const result = await next(e)
    startRefresh($)

    return result
  })

  on('ui.close', { id: PANE_ID }, async ($, e, next) => {
    const result = await next(e)
    stopRefresh()

    return result
  })

  // The person's next prompt ends the rainbow; every prompt reads the tracker again. A failure here must not stop a prompt:
  // `.catch` lets it through.
  on('prompt.submit', async ($, e, next) => {
    const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    const mark = await read($, finished)

    if (isPerson && mark !== null) {
      await Promise.all([update($, finished, () => null), update($, query, asked => (asked === mark ? '' : asked))])
    }

    // The read does not hold the prompt; the rainbow has ended already, so the timer is told now and again when the answer lands.
    refreshInBackground($)
    await syncAnimation($)

    return next(e)
  }).catch(($, e, next) => next(e))

  // This session at work: a main turn runs from its turn.start to its turn.complete (a subagent's turn.complete carries `agentId` and
  // is not the main turn's end); a background agent from its spawn to its SubagentStop, or until `$.agent.list()` shows it ended or gone.
  // Each event reads the tracker again and redraws, the band too with the pane closed. A failure here must not hold a turn: `.catch`
  // lets it through.
  on('turn.start', async ($, e, next) => {
    await changeWork($, work => ({ ...work, turn: true }))
    await pruneAgents($)
    refreshInBackground($)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await changeWork($, work => ({ ...work, turn: false }))
    }

    await pruneAgents($)
    refreshInBackground($)

    // The main thread's turn is over: its requests go to the ledger file, which the board is then read again for. Not awaited.
    if (e.agentId === undefined) {
      requestWrite($)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)

    if (result.agentId !== undefined && result.deny === undefined) {
      try {
        noteSpawn($, result.agentId, e.prompt, e.parentAgentId)
      } catch {
        // an owner the plugin could not work out is the main thread's at the agent's first request
      }
    }

    // A Workflow's agents are not listed by `$.agent.list()` and are not counted; a foreground agent runs inside the main turn.
    if (e.background && e.workflow === undefined && result.deny === undefined && result.agentId !== undefined) {
      const id = result.agentId

      await changeWork($, work => ({ ...work, agents: work.agents.includes(id) ? work.agents : [...work.agents, id] }))
      refreshInBackground($)
    }

    return result
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStop', async ($, e, next) => {
    await changeWork($, work => ({ ...work, agents: work.agents.filter(id => id !== e.agent_id) }))
    await pruneAgents($)
    refreshInBackground($)
    // A subagent's end writes the ledger, so a background worker's requests show before the next main turn. Not awaited.
    requestWrite($)

    return next(e)
  }).catch(($, e, next) => next(e))

  // The usage ledger. A model request of the main thread or of a subagent is counted once its response is whole: the hook records after
  // `next(e)` with no `await` and no disk, and its own failure is kept to itself, so the request is answered as the engine gave it.
  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)

    try {
      recordRequest($, e.agentId, response.usage)
    } catch {
      // one request not counted
    }

    try {
      noteUsageShape($, response.usage)
    } catch {
      // no shape line
    }

    return response
  }).catch(async function* ($, e, next) {
    return yield* next(e)
  })

  // The host's cost moved: close the interval (scale its requests to the host's change, book them, write the file).
  on('session.measure', async ($, e, next) => {
    try {
      await closeInterval($, e)
    } catch (error) {
      await log($, 'ledger', messageOf(error))
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // The session ends (or a /clear gives the process a new id): its ledger is written before the end step, and the next session starts anew.
  on('session.end', async ($, e, next) => {
    try {
      await writeLedger($)
    } catch (error) {
      await log($, 'ledger', messageOf(error))
    }

    resetLedger($)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const picked = await shownPlan($)
    const below = await next(e)

    // No answer, an error, or no plan for this session: the band draws nothing of ours.
    if (picked === undefined) {
      return below
    }

    const mark = await read($, finished)
    const plan = bandPlanOf(picked, mark)
    const isRainbowUp = isRainbow(picked, mark)
    const moves = isRainbowUp || isActive(plan)
    // The desktop and vscode read no frame: a redraw issues new button handles, and a press arrives with the old one. Their sprite animates itself.
    const isProportional = isProportionalSurface(e.surface)
    const now = moves && !isProportional ? await read($, frame) : 0
    // "‹ Board" only while the pane is up and shows the plan file.
    const isFile = (await read($, file)) && (await $.ui.panes().catch(() => [])).some(pane => pane.id === PANE_ID && pane.isPlaced)

    const plans = (await boardOf($))?.plans ?? []
    const at = Date.now()
    const stateText = planStateText(plan, at)

    noteState($, e.surface, plan, stateText)

    // Everything the drawing is made of but its closures. It reads the session's other plans only through the plan list, the time only through
    // the plan's state text, and what the hooks below drew only when that holds something (their press handles are part of it).
    // `now` above is the animation frame; `at` is the time the state word's `since` is compared with.
    const view = {
      plan,
      plans: plans.map(one => listedOf(one, at)),
      stateText,
      columns: e.props.bodyColumns - BAND_MASCOT_SPACE,
      below: holdsSomething(below) ? below : null,
      maxRows: e.props.maxRows,
      isOpen: await read($, bandMenu),
      isFile,
      frame: isRainbowUp ? now : null,
      pose: bandPose(plan, now),
      spritePose: MASCOT[bandPoseIndex(plan, now)],
      isProportional,
      hasClient: e.surface === 'terminal' || e.surface === 'desktop',
      isMoving: isProportional && isActive(plan),
    }

    // Only a plan that moves (a rainbow, or a plan at work for the mascot) reads the frame, so only then is the band
    // redrawn at each one. The row gets what the mascot and its space leave. The same data draws the same tree, as the pane does.
    return steadily(`band:${e.surface}`, view, () =>
      drawBand($.ui.resolve(e), {
        ...view,
        plans,
        now: at,
        below,
        onBar: () => void pressByKey($, 'band:bar', e.surface),
        onMenu: () => void pressByKey($, 'band:plans', e.surface),
        onPick: anchor => void pressByKey($, `band:plan:${anchor}`, e.surface),
        onFile: () => void pressByKey($, 'band:file', e.surface),
        onBoard: () => void pressByKey($, 'band:board', e.surface),
      }),
    )
  })

  // A press on any button of the mod, run by its key with no closure: a press can arrive with a handle the host no longer holds.
  on('ui.press', { plugin: 'plan-tracker' }, async ($, e, next) => {
    // Answer at once: the work runs in the background, so nothing the press starts (opening the pane) can hold the chain.
    const isHandled = actionFor($, e.element, e.surface) !== undefined

    void log($, 'press', null, { element: e.element, surface: e.surface, handled: isHandled })

    if (!isHandled) {
      return next(e)
    }

    pressByKey($, e.element, e.surface)

    return { element: e.element }
  })

  // Typing in the mod's search field, run by its key with no closure, as a press is. One log line per change or Enter.
  on('ui.input', { plugin: 'plan-tracker' }, async ($, e, next) => {
    const isHandled = typeByKey($, e.element, e.kind, e.value, e.surface)

    void log($, 'input', null, { element: e.element, surface: e.surface, kind: e.kind, length: e.value.length, handled: isHandled })

    return isHandled ? { element: e.element, value: e.value } : next(e)
  })

  // The desktop band's overlay regions post `{ band: 'toggle' }`: pressing anywhere on the band toggles the board.
  on('ui.message', async ($, e, next) => {
    if ((e.data as { band?: unknown } | null)?.band === 'toggle') {
      void log($, 'press', null, { element: 'band:zone', surface: 'desktop' })
      await toggleBoard($)
    }

    return next(e)
  })

  // A card drawn as a Client posts `{ open: <row index> }` when it is clicked (or Enter is pressed on it): open its page.
  // The post is code's input, not a fact: anything but a row of the shown plan is ignored.
  on('ui.message', { requestId: PANE_ID }, async ($, e, next) => {
    const data = e.data as { open?: unknown } | null
    const plan = await shownPlan($)

    if (plan !== undefined && typeof data?.open === 'number' && plan.rows[data.open] !== undefined) {
      await openRow($, plan, data.open)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    paneRows = e.props.scroll.bodyRows

    const { Text } = $.ui.resolve(e)
    const answer = await read($, live)

    if (answer !== null && !('board' in answer)) {
      return <Text wrap="wrap">{answer.error}</Text>
    }

    // The plan list, while `/plan-tracker` has it on, whatever else the pane showed: the plans the search field's text leaves (with none, the
    // open ones), in the board command's order, from the last list read. The band and the plan dropdown still read the board's own `plans` and `selected`.
    if (await read($, listing)) {
      const all = await read($, allPlans)

      if (all === null) {
        return <Text dimColor>Loading plans…</Text>
      }

      const text = await read($, search)
      const now = Date.now()
      const rows = listedMatches(all, text).map(one => listedMatchOf(one, now))
      const view = { rows, search: text, empty: text.trim() === '' ? 'No open plans.' : `No plan matches "${text}"`, columns: e.props.bodyColumns, surface: e.surface }

      return steadily(`pane:${e.surface}`, view, () =>
        drawPicker($.ui.resolve(e), {
          ...view,
          onPick: anchor => void pressByKey($, `match:${anchor}`, e.surface),
          onInput: value => void typeByKey($, 'search', 'change', value, e.surface),
          onSubmit: value => void typeByKey($, 'search', 'submit', value, e.surface),
        }),
      )
    }

    if (answer === null) {
      return <Text dimColor>Reading the tracker…</Text>
    }

    const { board } = answer
    const plan = await shownPlan($)

    if (plan === undefined) {
      return <Text dimColor>{board.message ?? 'No plans in this session.'}</Text>
    }

    const open = await read($, card)
    const isFile = await read($, file)
    const detail = detailOf(plan, open)
    const now = Date.now()
    // Everything the drawing is made of but its closures (which depend on the plan's anchor and the surface, both here).
    const view = {
      plans: board.plans,
      plan,
      columns: e.props.bodyColumns,
      bodyRows: e.props.scroll.bodyRows,
      message: board.message,
      ledgerErrors: board.ledger_errors ?? [],
      detail: isFile ? null : detail,
      file: isFile ? await loadFile($, plan) : null,
      home: await $.env.get('HOME'),
      // Only a board of a plan at work reads the frame, so only that is redrawn at each one.
      frame: !isProportionalSurface(e.surface) && !isFile && detail === null && isActive(plan) ? await read($, frame) : 0,
      isOpen: await read($, menu),
      hasClient: e.surface === 'terminal' || e.surface === 'desktop',
      surface: e.surface,
      expanded: (await read($, expanded)).flatMap(key => (key.startsWith(`${plan.anchor}:`) ? [key.slice(plan.anchor.length + 1) as LaneKey] : [])),
    }

    // The drawing reads the session's other plans only through the plan list, and the time only to the minute (a relative age, today or a date).
    const data = { ...view, plans: board.plans.map(one => listedOf(one, now)), minute: Math.floor(now / 60_000) }

    return steadily(`pane:${e.surface}`, data, () => drawPane($.ui.resolve(e), {
      ...view,
      now,
      onLane: lane => void pressByKey($, `lane:${lane}:more`, e.surface),
      onMenu: () => void pressByKey($, 'menu:name', e.surface),
      onPick: anchor => void pressByKey($, `plan:${anchor}`, e.surface),
      onCard: index => void openRow($, plan, index),
      onBack: () => void pressByKey($, 'back', e.surface),
      onFile: () => void pressByKey($, 'plan-file', e.surface),
    }))
  })

  // A file tool that changes the board file makes this session (or one of its agents) work the plan the file holds: the usage ledger counts
  // its work for that plan. Only a plain PROGRESS.md needs it; a board command says `in_session` itself. The board file is read again at once,
  // so the next request already sees the row the change made In Progress.
  on('tool.call', { tool: /^(Edit|Write|MultiEdit)$/ }, async ($, e, next) => {
    const result = await next(e)

    if (settings.boardCommand === '' && result.deny === undefined && result.isError !== true) {
      try {
        await noteBoardChange($, (e as { file_path?: unknown }).file_path)
      } catch {
        // the mark is a convenience for the ledger; the change is already made
      }
    }

    return result
  }).catch(($, e, next) => next(e))

  // The script prints a PLAN-DONE block when a write makes a row Done; the Bash result is never changed. Each block is a toast
  // and a notice, once a chime, and one with `0 left` a rainbow; a Bash call that ran the script reads the tracker again.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const commandMark = commandMarkOf(boardArgv('', ''))
    const result = await next(e)
    const blocks = doneBlocks(result.text ?? '')

    for (const block of blocks) {
      await announce($, block)
    }

    try {
      if (blocks.length > 0) {
        await chime($)
      }

      const anchor = blocks.flatMap(block => finishedAnchor(block) ?? []).pop()

      const mark = await read($, finished)

      if (anchor !== undefined) {
        await markFinished($, anchor)
      } else if (mark !== null && blocks.some(block => block.startsWith(`PLAN-DONE ${mark} · `))) {
        await unmarkFinished($, mark)
        refreshInBackground($)
      } else if (blocks.length > 0 || commandMark !== '' && e.command.includes(commandMark)) {
        refreshInBackground($)
      }
    } catch {
      // The board catches up at the next refresh; the Bash call is already answered.
    }

    return result
  })
}
