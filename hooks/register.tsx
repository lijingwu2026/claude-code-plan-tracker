/**
 * The plan board for a terminal: a one-row band above the prompt (`● <plan> ▾ <bar> n/m  Plan file ›`: "▾" opens the plan
 * list above the prompt, the bar opens or closes the board, "Plan file ›" opens the board on the plan file) and a pane with
 * the plan dropdown, the plan line and four lanes (Todo, In Progress, Verify, Done) of bordered cards (press one for its page).
 * Picking a plan in the band or in the pane switches both.
 *
 * The data is the board file (PROGRESS.md, read again every 1.5 s, so the board follows the file) or, with the setting
 * `board_command`, that command's JSON; read on session.start, on each prompt, after a Bash call that runs the command, and every
 * 10 s while the pane is open; one run is in flight at a time, and none holds a prompt or a Bash
 * result. With a `board_command`, `/plan-tracker` opens the pane at once on the list of the plans not Done or Canceled, latest updated first, under a
 * search field that has the keys, with no text, whatever the surface says (a Desktop client may not have attached yet), and reads the list again
 * behind it; `/plan-tracker <words>` puts the words in the field, and opens the plan when the answer is in if they are its name or anchor or leave
 * one row. Typing filters every plan in the mod; Enter or a press on a row opens that plan, as do the band and the plan menus. A command that lists
 * no `matches` but two or more `plans` has them listed; one that prints a single plan, and a plain board file, open that plan's board. When the
 * board cannot be drawn a toast says why. A PLAN-DONE block in a Bash result becomes a toast, a chime
 * and a notice in the conversation, and one with `0 left` makes the band's bar a rainbow until the person's next prompt. With no
 * `board_command`, a row of the board file that goes Done does the same, with no block: the file is the only source.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

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
  hasWorking,
  isComplete,
  isOpen,
  isRainbow,
  listOf,
  listedMatches,
  messageOf,
  movement,
  noBoardFile,
  parseBoard,
  parseProgress,
  planOf,
  planStateText,
  truncate,
  settings,
  applyOptions,
  usageArgv,
  boardArgv,
  commandMarkOf,
} from './board'
import type { LaneKey } from './board'
import type { FileView } from './draw'
import { drawBand, drawPane, drawPicker, holdsSomething, isProportionalSurface, listedMatchOf, listedOf } from './draw'

const COMMAND = 'plan-tracker'
const PANE_ID = 'plan-tracker'
const PANE_TITLE = 'Plans'
const REFRESH_MS = 10_000
const SCRIPT_TIMEOUT_MS = 30_000
/** `--usage` reads session transcripts, which reach 50 MB. */
const USAGE_TIMEOUT_MS = 120_000
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

/** The run of the script under way, and the one rerun waiting behind it. */
let inFlight: Promise<void> | undefined
let queued: Promise<void> | undefined

/** Runs the script once for the current query and stores its answer (an answer to `*` also as the list); the state write redraws the band and the pane. */
async function refreshOnce($: EngineInterface) {
  const asked = await read($, query)
  const answer = await fetchBoard($, asked)
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

/** The rows whose usage run is under way, as `<anchor>:<index>`: a page opened twice meanwhile starts one run. */
const usageRuns = new Set<string>()

/**
 * A task page opened for a row that started and has not finished: the tracker works out its usage (reading transcripts,
 * which is slow, so never in the 10 s refresh) and the board is read again to show it. A failure leaves the page as it is.
 */
async function loadUsage($: EngineInterface, plan: PlanEntry, index: number) {
  const row = plan.rows[index]
  const key = `${plan.anchor}:${index}`

  if (settings.usageCommand === '' || row === undefined || row.started === undefined || row.finished !== undefined || usageRuns.has(key)) {
    return
  }

  usageRuns.add(key)

  try {
    const { exitCode, stderr } = await $.process.run(
      usageArgv(plan.anchor, index, row.task, await $.session.id()),
      await commandInit($, USAGE_TIMEOUT_MS),
    )

    if (exitCode !== 0) {
      await log($, 'usage', `the usage command exited ${exitCode}: ${stderr.trim().split('\n').at(-1)?.slice(0, 200) ?? ''}`)

      return
    }

    await refreshQuietly($)
  } catch (error) {
    await log($, 'usage', messageOf(error))
  } finally {
    usageRuns.delete(key)
  }
}

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

/** The board the tracker last answered, or undefined while there is none (no answer yet, or an error line). */
async function boardOf($: EngineInterface): Promise<PlanBoard | undefined> {
  const answer = await read($, live)

  return answer !== null && 'board' in answer ? answer.board : undefined
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
 * Whether anything on screen moves: the band (the rainbow of a complete plan, the mascot while the plan has a row In
 * Progress) or the open pane (the mascot of an In Progress card).
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

/** The rows the pane last said it shows (`scroll.bodyRows`): logged with a lane press, for the Show less rule. */
let paneRows: number | undefined

/** The surfaces last logged by `animates`, as text. */
let loggedSurfaces = ''

/** Opens row `index` of `plan` on its page: the plan list shuts, the row's usage is read in the background, and the pane is focused at its top. */
async function openRow($: EngineInterface, plan: PlanEntry, index: number) {
  await Promise.all([update($, menu, () => false), update($, card, () => ({ anchor: plan.anchor, index }))])
  void loadUsage($, plan, index)
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
    refreshInBackground($)
    startWatch($)

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
    const moves = isRainbowUp || hasWorking(plan)
    // The desktop and vscode read no frame: a redraw issues new button handles, and a press arrives with the old one. Their sprite animates itself.
    const isProportional = isProportionalSurface(e.surface)
    const now = moves && !isProportional ? await read($, frame) : 0
    // "‹ Board" only while the pane is up and shows the plan file.
    const isFile = (await read($, file)) && (await $.ui.panes().catch(() => [])).some(pane => pane.id === PANE_ID && pane.isPlaced)

    const plans = (await boardOf($))?.plans ?? []
    const at = Date.now()
    // Everything the drawing is made of but its closures. It reads the session's other plans only through the plan list, the time only through
    // the plan's state text, and what the hooks below drew only when that holds something (their press handles are part of it).
    // `now` above is the animation frame; `at` is the time the state word's `since` is compared with.
    const view = {
      plan,
      plans: plans.map(one => listedOf(one, at)),
      stateText: planStateText(plan, at),
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
      isMoving: isProportional && hasWorking(plan),
    }

    // Only a plan that moves (a rainbow, or a row In Progress for the mascot) reads the frame, so only then is the band
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
      detail: isFile ? null : detail,
      file: isFile ? await loadFile($, plan) : null,
      home: await $.env.get('HOME'),
      // Only a board with an In Progress card reads the frame, so only that is redrawn at each one.
      frame: !isProportionalSurface(e.surface) && !isFile && detail === null && hasWorking(plan) ? await read($, frame) : 0,
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
