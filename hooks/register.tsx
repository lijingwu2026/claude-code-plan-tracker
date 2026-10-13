/**
 * The plan board for a terminal: a one-row band above the prompt (`● <plan> ▾ <bar> n/m  Plan file ›`: "▾" opens the plan
 * list above the prompt, the bar opens or closes the board, "Plan file ›" opens the board on the plan file) and a pane with
 * the plan dropdown, the plan line, four lanes (Todo, In Progress, Verify, Done) of bordered cards (press one for its page) and the
 * plan's deliverables, the artifacts listed first among them. Picking a plan in the band or in the pane switches both.
 *
 * The data is the board file (PROGRESS.md, read again every 1.5 s, so the board follows the file) or, with the setting
 * `board_command`, that command's JSON; read on session.start, on each prompt, after a Bash call that runs the command, and every
 * 10 s while the pane is open; one run is in flight at a time, and none holds a prompt or a Bash
 * result. `/plan-tracker [words from a plan name]` opens the board on that plan, with no text, whatever the surface says (a Desktop client may
 * not have attached yet); when the board cannot be drawn a toast says why. On the desktop app a deliverable is a link a press
 * opens with `open`, if it is under the project or ~/.claude; an artifact is a link too: an https one the app opens itself, a local
 * page the plugin opens with `open` (the same allowlist). A PLAN-DONE block in a Bash result becomes a toast, a chime and a
 * notice in the conversation, and one with `0 left` makes the band's bar a rainbow until the person's next prompt. With no
 * `board_command`, a row of the board file that goes Done does the same, with no block: the file is the only source. A deliverable's
 * Diff button opens the diff of the commit that made the change (git runs only on that press, after the same path check): in the
 * diff view of Cursor or VS Code when the session runs inside them, else as a page of the board with a `Code` element per hunk.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Live, PlanBoard, PlanEntry, PlanStatus } from '../types'
import {
  BAND_MASCOT_SPACE,
  MASCOT,
  ARTIFACT_EXTRA_ROOTS,
  absolutePath,
  artifactsOf,
  bandPlanOf,
  bandPose,
  bandPoseIndex,
  commitFor,
  commitsOf,
  deliverableGroups,
  detailOf,
  diffViewOf,
  FRAME_MS,
  doneBlocks,
  doneHeader,
  failureText,
  finishedAnchor,
  foldedPath,
  hasWorking,
  isComplete,
  isOpen,
  isRainbow,
  isDiffable,
  isWebLink,
  isWebTarget,
  messageOf,
  movement,
  openMode,
  openRefusal,
  noBoardFile,
  parseArtifact,
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
import { drawBand, drawMatches, drawPane, holdsSomething, listedOf } from './draw'

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
/** The `--query` the refreshes pass: the argument of the last `/plan-tracker`, or the plan that just finished. */
const query = atom({ plugin: 'plan-tracker', key: 'query' } as const, '')
/** The anchor picked in the band or the pane; null until one is picked, when the tracker's own `selected` stands. */
const selected = atom({ plugin: 'plan-tracker', key: 'selected' } as const, null)
const card = atom({ plugin: 'plan-tracker', key: 'card' } as const, null)
/** Whether the pane shows the plan file instead of the board. */
const file = atom({ plugin: 'plan-tracker', key: 'file' } as const, false)
/** The diff page the pane shows in place of the board or a task page; null for none. */
const diff = atom({ plugin: 'plan-tracker', key: 'diff' } as const, null)
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

/** The session's project root: where the board file and a relative deliverable are looked up and what a press may open. */
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

/** Runs the script once for the current query and stores its answer; the state write redraws the band and the pane. */
async function refreshOnce($: EngineInterface) {
  const answer = await fetchBoard($, await read($, query))
  const text = JSON.stringify(answer)

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

/** Opens the board when it is not up, closes it when it is. */
async function toggleBoard($: EngineInterface) {
  const isUp = (await $.ui.panes()).some(pane => pane.id === PANE_ID && pane.isPlaced)

  if (isUp) {
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
  await Promise.all([update($, file, () => true), update($, diff, () => null), update($, card, () => null), update($, menu, () => false), update($, bandMenu, () => false)])

  await $.ui.open(OPEN)
  await $.ui.scroll({ to: 'start', in: PANE_ID }).catch(() => undefined)
  await syncAnimation($)
}

/**
 * Goes back: from a diff page to what it was opened from (the board, or a task page); otherwise shows the board's lanes again. The keys
 * go to the pane.
 */
async function showBoard($: EngineInterface) {
  if ((await read($, diff)) !== null) {
    await update($, diff, () => null)
    await syncAnimation($)
    await refocus($, true)

    return
  }

  await Promise.all([update($, card, () => null), update($, file, () => false)])
  await syncAnimation($)
  await refocus($, true)
}

/** Picks a plan for the band and the board together: both lists close and the board shows its lanes. */
async function pickPlan($: EngineInterface, anchor: string) {
  await Promise.all([
    update($, selected, () => anchor),
    update($, diff, () => null),
    update($, card, () => null),
    update($, file, () => false),
    update($, menu, () => false),
    update($, bandMenu, () => false),
  ])
  await syncAnimation($)
  await refocus($, true)
}

/**
 * Picks one of the plans a query found: the plan becomes both the query (every refresh asks the tracker for it, which brings its
 * entry) and the plan shown, and the board is read again at once so that the message and the list go.
 */
async function pickMatch($: EngineInterface, anchor: string) {
  await Promise.all([
    update($, query, () => anchor),
    update($, selected, () => anchor),
    update($, diff, () => null),
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
  const isBoard = detailOf(plan, await read($, card)) === null && !(await read($, file)) && (await read($, diff)) === null
  const { band, pane } = movement(plan, { finished: await read($, finished), isPaneUp, isBoard })

  return band || pane
}

/** The rows the pane last said it shows (`scroll.bodyRows`): logged with a lane press, for the Show less rule. */
let paneRows: number | undefined

/** The surfaces last logged by `animates`, as text. */
let loggedSurfaces = ''

/**
 * What a press on the Button (or answered link) keyed `element` does: the same actions as the drawings' `onPress` closures,
 * which call this too. It decides at once whether the key is the mod's (undefined if not) and returns the work, so a caller
 * can answer a press without waiting: the `ui.press` hook runs the work in the background, because opening a pane from
 * inside the press chain must not hold the chain.
 */
export function actionFor($: EngineInterface, element: string, isLink: boolean, surface: string): (() => Promise<unknown>) | undefined {
  const lane = /^lane:(.+):(?:more|less)$/.exec(element)?.[1]
  const at = /^deliverable:(\d+)$/.exec(element)?.[1]
  const artifactAt = /^artifact:(\d+)$/.exec(element)?.[1]
  const diffAt = /^diff:(\d+)$/.exec(element)?.[1]

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

  if (isLink && (at !== undefined || element === 'detail:deliverable')) {
    return async () => {
      const plan = await shownPlan($)
      const path =
        at === undefined
          ? plan?.rows[detailOf(plan, await read($, card)) ?? -1]?.deliverable
          : plan === undefined
            ? undefined
            : deliverableGroups(plan).flatMap(group => group.items)[Number(at)]?.path

      // A web link is the surface's to open; it never reaches here as a link press, and a path lookup of it would only fail.
      if (path !== undefined && !isWebLink(path)) {
        await openDeliverable($, path).catch(() => undefined)
      }
    }
  }

  // The Diff of a deliverable: a Button in the desktop table's row (`diff:N`), on the desktop's task page and on the terminal's (`detail:diff`).
  // One key means "open the diff" everywhere. A press, as a Button's or a link's, is answered the same way.
  if (diffAt !== undefined) {
    return async () => {
      const plan = await shownPlan($)
      const item = plan === undefined ? undefined : deliverableGroups(plan).flatMap(group => group.items)[Number(diffAt)]

      if (item !== undefined && isDiffable(item.path)) {
        await showDiff($, item)
      }
    }
  }

  if (element === 'detail:diff') {
    return async () => {
      const plan = await shownPlan($)
      const row = plan?.rows[detailOf(plan, await read($, card)) ?? -1]

      if (row?.deliverable !== undefined && isDiffable(row.deliverable)) {
        await showDiff($, { path: row.deliverable, started: row.started, updated: row.updated, changed_at: row.changed_at })
      }
    }
  }

  // An artifact's link that reaches the plugin is a local page (an https one is the surface's own): `open` shows it in the browser.
  if (isLink && (artifactAt !== undefined || element === 'detail:artifact')) {
    return async () => {
      const plan = await shownPlan($)
      let target: string | undefined

      if (plan !== undefined && artifactAt !== undefined) {
        target = artifactsOf(plan)[Number(artifactAt)]?.target
      } else if (plan !== undefined) {
        const text = plan.rows[detailOf(plan, await read($, card)) ?? -1]?.artifact

        target = text === undefined ? undefined : parseArtifact(text)?.target
      }

      if (target !== undefined && !isWebTarget(target)) {
        await openDeliverable($, target, true).catch(() => undefined)
      }
    }
  }

  return undefined
}

/** Runs the press of `element` in the background (a failure is logged, never thrown); false for a key the mod does not draw. */
function pressByKey($: EngineInterface, element: string, isLink: boolean, surface: string): boolean {
  const action = actionFor($, element, isLink, surface)

  if (action === undefined) {
    return false
  }

  void action().catch((error: unknown) => log($, 'press', messageOf(error), { element, surface }))

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

/** A PLAN-DONE with 0 left: the band shows that plan, finished, from the tracker's answer for it, until the person's next prompt. */
async function markFinished($: EngineInterface, anchor: string) {
  await Promise.all([update($, finished, () => anchor), update($, query, () => anchor), update($, selected, () => anchor)])
  refreshInBackground($)
  await syncAnimation($)
}

/**
 * `/plan-tracker` opens the board on the plan the argument names and answers no text. It opens whatever `$.session.surfaces()`
 * says: a Desktop client joins that list only once it attaches, and `/plan-tracker` can be a session's first input. When the pane
 * waits undrawn, a toast says why. One log line per run records the surfaces seen and whether the pane was placed.
 */
async function runCommand($: EngineInterface, e: { args: string }) {
  const text = e.args.trim()

  await Promise.all([update($, query, () => text), ...(text === '' ? [] : [update($, selected, () => null)])])
  await refreshQuietly($)

  const surfaces = await $.session.surfaces().catch(() => null)
  const opened = await $.ui.open(OPEN).catch((error: unknown) => ({ isPlaced: false as const, reason: messageOf(error) }))

  await syncAnimation($).catch(() => undefined)
  await log($, 'open', opened.isPlaced ? null : opened.reason, { surfaces, isPlaced: opened.isPlaced })

  if (!opened.isPlaced) {
    $.ui.toast(`Board waits: ${opened.reason}`)
  }

  return {}
}

/** What `vetPath` found: the real path of a file or folder that may be opened, or why it may not (`shown` is the reason as a toast says it). */
type Vetted = { resolved: string; isFile: boolean } | { reason: string; shown: string }

/**
 * Whether `path` (a deliverable's, as the tracker wrote it) may be opened or read by git, and its real path. It has to exist and, both
 * as written (`..` folded) and as it really is (`realpath`, symlinks followed), sit under the project root or ~/.claude, or be a regular
 * file under the home directory outside hidden folders; an artifact (`isArtifact`) is a page for the browser that a session leaves in a
 * scratch folder, so `/tmp` and `/private/tmp` also count, for a regular file only. A folder is shown only inside the project root and
 * ~/.claude. Nothing is opened, logged or toasted here, and no git runs.
 */
async function vetPath($: EngineInterface, path: string, isArtifact: boolean): Promise<Vetted> {
  const home = await $.env.get('HOME')
  const absolute = absolutePath(path, home)
  const root = await projectRoot($)
  const projectRoots = [root, ...(home === undefined || home === '' ? [] : [`${home.replace(/\/+$/, '')}/.claude`])].filter(one => one !== '')
  const roots = isArtifact ? [...projectRoots, ...ARTIFACT_EXTRA_ROOTS] : projectRoots
  const refusal = absolute === null ? 'cannot place that path' : openRefusal(absolute, roots, home)

  if (absolute === null || refusal !== null) {
    return { reason: refusal ?? 'no home directory', shown: refusal ?? 'no home directory' }
  }

  const target = foldedPath(absolute)

  if (!(await $.fs.exists(target).catch(() => false))) {
    return { reason: 'no such file', shown: `no such file ${target}` }
  }

  const real = await $.process.run(['/bin/realpath', target]).catch((error: unknown) => ({ exitCode: -1, stdout: '', stderr: messageOf(error) }))
  const resolved = real.stdout.trim()
  const resolvedRefusal = real.exitCode !== 0 || resolved === '' ? 'real path unknown' : openRefusal(resolved, roots, home)

  if (resolvedRefusal !== null) {
    return { reason: resolvedRefusal, shown: resolvedRefusal }
  }

  const isFile = (await $.fs.stat(resolved).catch(() => undefined))?.kind === 'file'

  // Only a regular file is opened from the home directory at large; a folder is shown only inside the project and ~/.claude.
  if (!isFile && openRefusal(resolved, projectRoots) !== null) {
    return { reason: 'not a regular file', shown: 'not a regular file' }
  }

  return { resolved, isFile }
}

/**
 * A press on a deliverable's link that reaches the plugin (the desktop opens the links inside the project root itself; one outside it reaches here): the
 * file has to pass `vetPath`. Its real path is then opened with `open` when its
 * type is one that is only viewed and it is a regular file, and revealed in Finder with `open -R` for anything else. A refusal is logged and shown
 * as a toast. An artifact (`isArtifact`) is a page for the browser that a session leaves in a scratch folder: `/tmp` and `/private/tmp`
 * also count, for a regular file only.
 */
export async function openDeliverable($: EngineInterface, path: string, isArtifact = false) {
  const vetted = await vetPath($, path, isArtifact)

  if ('reason' in vetted) {
    await log($, 'open-path', vetted.reason, { path })
    $.ui.toast(`Not opened: ${vetted.shown}`)

    return
  }

  const { resolved, isFile } = vetted
  const argv = isFile && openMode(resolved) === 'open' ? ['open', resolved] : ['open', '-R', resolved]
  const { exitCode, stderr } = await $.process.run(argv).catch((error: unknown) => ({ exitCode: -1, stderr: messageOf(error) }))

  if (exitCode !== 0) {
    await log($, 'open-path', `open exited ${exitCode}: ${stderr.trim().slice(0, 200)}`, { path })
    $.ui.toast(`Not opened: open exited ${exitCode}`)
  }
}

// ---------------------------------------------------------------- the diff of a deliverable

/** Cursor's own bundle id (`__CFBundleIdentifier` in a process it spawned): with `TERM_PROGRAM=vscode`, the session runs inside Cursor, else in VS Code. */
const CURSOR_BUNDLE = 'com.todesktop.230313mzl4w4u92'
/** Cursor's command line; it is not on PATH, so `cursor` is the fallback. */
const CURSOR_BIN = '/Applications/Cursor.app/Contents/Resources/app/bin/cursor'
const GIT_TIMEOUT_MS = 20_000

/** The editor whose terminal the session runs in: `cursor` when `TERM_PROGRAM` is `vscode` and the app is Cursor, `vscode` for `vscode` in any other app, else undefined. */
async function editorOf($: EngineInterface): Promise<'cursor' | 'vscode' | undefined> {
  if ((await $.env.get('TERM_PROGRAM')) !== 'vscode') {
    return undefined
  }

  return (await $.env.get('__CFBundleIdentifier')) === CURSOR_BUNDLE ? 'cursor' : 'vscode'
}

type GitRun = { exitCode: number; stdout: string; stderr: string; isStdoutTruncated: boolean }

/** `git <args>` as one run; a failure to start is an exit code of -1. */
const runGit = ($: EngineInterface, args: readonly string[]): Promise<GitRun> =>
  $.process.run(['git', ...args], { timeoutMs: GIT_TIMEOUT_MS }).catch(
    (error: unknown): GitRun => ({ exitCode: -1, stdout: '', stderr: messageOf(error), isStdoutTruncated: false }),
  )

/**
 * Opens the commit's change to `rel` in the editor's own diff view: the file as it was before the commit and after it go into one new
 * folder under the system temp folder (`plan-tracker-diff-<random>`, never cleaned up here) and `cursor --diff <before> <after>` (inside
 * Cursor) or `code --diff <before> <after>` (inside VS Code) is run. A file the commit added has an empty "before"; one it deleted, an
 * empty "after". False when it cannot: git or the editor fails, or the file is binary or too long to hold as text.
 */
async function openInEditor($: EngineInterface, editor: 'cursor' | 'vscode', top: string, rel: string, sha: string, path: string): Promise<boolean> {
  try {
    const before = await runGit($, ['-C', top, 'show', '--no-textconv', `${sha}^:${rel}`])
    const after = await runGit($, ['-C', top, 'show', '--no-textconv', `${sha}:${rel}`])
    const isText = (run: GitRun) => !run.isStdoutTruncated && !run.stdout.includes('\u0000')

    if ((before.exitCode !== 0 && after.exitCode !== 0) || !isText(before) || !isText(after)) {
      return false
    }

    const tmp = ((await $.env.get('TMPDIR')) ?? '').replace(/\/+$/, '')
    const folder = `${tmp === '' ? '/tmp' : tmp}/plan-tracker-diff-${(`${Math.random().toString(36)}00000000`).slice(2, 10)}`
    const name = rel.split('/').pop() ?? rel
    const left = `${folder}/before/${name}`
    const right = `${folder}/after/${name}`

    await $.fs.write(left, before.exitCode === 0 ? before.stdout : '')
    await $.fs.write(right, after.exitCode === 0 ? after.stdout : '')

    const bin = editor === 'vscode' ? 'code' : (await $.fs.exists(CURSOR_BIN).catch(() => false)) ? CURSOR_BIN : 'cursor'
    const run = await $.process.run([bin, '--diff', left, right])

    if (run.exitCode !== 0) {
      await log($, 'diff', `${editor === 'vscode' ? 'code' : 'cursor'} --diff exited ${run.exitCode}: ${run.stderr.trim().slice(0, 200)}`, { path })

      return false
    }

    return true
  } catch (error) {
    await log($, 'diff', `${editor === 'vscode' ? 'code' : 'cursor'} --diff not run: ${messageOf(error)}`, { path })

    return false
  }
}

/**
 * A press on a deliverable's Diff (the table's `diff:N` Button, the task page's `detail:diff` Button): the diff of the commit that made the change. It runs only here, never on a redraw. The path has to pass `vetPath` before
 * any git call, and be a file; `git -C <toplevel>` then finds the commit (`commitFor`: the newest after the row started and before its
 * `changed_at` (else `updated`) plus 30 minutes, else the newest that touched the file) and the diff of that file in it. Inside Cursor or VS Code the editor's
 * diff view opens (`openInEditor`); anywhere else, or when that fails, the diff is a page of the board (`diffViewOf`). A toast says
 * why when there is nothing to show.
 */
async function showDiff($: EngineInterface, target: { path: string; started?: string | null; updated?: string | null; changed_at?: string | null }) {
  const fail = async (text: string, why: string) => {
    await log($, 'diff', why, { path: target.path })
    $.ui.toast(text)
  }
  const vetted = await vetPath($, target.path, false)

  if ('reason' in vetted) {
    return fail(`No diff: ${vetted.shown}`, vetted.reason)
  }

  if (!vetted.isFile) {
    return fail('No diff: not a file', 'not a file')
  }

  const { resolved } = vetted
  const name = resolved.split('/').pop() ?? resolved
  const top = await runGit($, ['-C', resolved.slice(0, resolved.lastIndexOf('/')) || '/', 'rev-parse', '--show-toplevel'])
  const root = top.stdout.trim()

  if (top.exitCode !== 0 || root === '' || !resolved.startsWith(`${root}/`)) {
    return fail('Not in a git repo', top.stderr.trim().slice(0, 200) || 'not under the repository')
  }

  const rel = resolved.slice(root.length + 1)
  const history = await runGit($, ['-C', root, 'log', '-n', '200', '--format=%H%x09%ct%x09%s', '--', rel])

  if (history.exitCode !== 0) {
    return fail(`No diff: git log exited ${history.exitCode}`, history.stderr.trim().slice(0, 200))
  }

  const commit = commitFor(commitsOf(history.stdout), target)

  if (commit === undefined) {
    return fail(`No commit found for ${name}`, 'no commit touched the file')
  }

  const editor = await editorOf($)

  if (editor !== undefined && (await openInEditor($, editor, root, rel, commit.sha, target.path))) {
    return
  }

  // No external diff program and no text conversion: a repository under the home folder is not one the plugin trusts to run commands.
  const shown = await runGit($, ['-C', root, 'show', '--no-ext-diff', '--no-textconv', commit.sha, '--format=', '--', rel])

  if (shown.exitCode !== 0) {
    return fail(`No diff: git show exited ${shown.exitCode}`, shown.stderr.trim().slice(0, 200))
  }

  await update($, diff, () => diffViewOf(shown.stdout, `${target.path} · ${commit.sha.slice(0, 7)}`, target.path, commit.subject))
  await $.ui.open(OPEN)
  await $.ui.scroll({ to: 'start', in: PANE_ID }).catch(() => undefined)
  await syncAnimation($)
}

export const register: Register = (on, options) => {
  applyOptions(options)

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: COMMAND,
        description: 'Open the plan board; when your board command lists several plans, add words from a plan name to open that one',
        argumentHint: '[words from a plan name, with a board command]',
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
    // The desktop reads no frame: a redraw issues new button handles, and its press arrives with the old one. Its sprite animates itself.
    const isDesktop = e.surface === 'desktop'
    const now = moves && !isDesktop ? await read($, frame) : 0
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
      isProportional: isDesktop,
      isMoving: isDesktop && hasWorking(plan),
    }

    // Only a plan that moves (a rainbow, or a row In Progress for the mascot) reads the frame, so only then is the band
    // redrawn at each one. The row gets what the mascot and its space leave. The same data draws the same tree, as the pane does.
    return steadily(`band:${e.surface}`, view, () =>
      drawBand($.ui.resolve(e), {
        ...view,
        plans,
        now: at,
        below,
        onBar: () => void pressByKey($, 'band:bar', false, e.surface),
        onMenu: () => void pressByKey($, 'band:plans', false, e.surface),
        onPick: anchor => void pressByKey($, `band:plan:${anchor}`, false, e.surface),
        onFile: () => void pressByKey($, 'band:file', false, e.surface),
        onBoard: () => void pressByKey($, 'band:board', false, e.surface),
      }),
    )
  })

  // A press on any button of the mod, run by its key with no closure: a press can arrive with a handle the host no longer holds.
  on('ui.press', { plugin: 'plan-tracker' }, async ($, e, next) => {
    // Answer at once: the work runs in the background, so nothing the press starts (opening the pane) can hold the chain.
    const isHandled = actionFor($, e.element, e.link !== undefined, e.surface) !== undefined

    void log($, 'press', null, { element: e.element, surface: e.surface, handled: isHandled })

    if (!isHandled) {
      return next(e)
    }

    pressByKey($, e.element, e.link !== undefined, e.surface)

    return { element: e.element }
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
      const index = data.open

      await Promise.all([update($, menu, () => false), update($, card, () => ({ anchor: plan.anchor, index }))])
      void loadUsage($, plan, index)
      await syncAnimation($)
      await refocus($, true)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    paneRows = e.props.scroll.bodyRows

    const { Text } = $.ui.resolve(e)
    const answer = await read($, live)

    if (answer === null) {
      return <Text dimColor>Reading the tracker…</Text>
    }

    if (!('board' in answer)) {
      return <Text wrap="wrap">{answer.error}</Text>
    }

    const { board } = answer
    const plan = await shownPlan($)

    if (plan === undefined) {
      const { Box } = $.ui.resolve(e)

      // Several plans match a query in a session with no plan of its own: the message still comes with its list.
      return board.matches === undefined ? (
        <Text dimColor>{board.message ?? 'No plans in this session.'}</Text>
      ) : (
        <Box flexDirection="column">
          <Text dimColor>{board.message ?? 'No plans in this session.'}</Text>
          {drawMatches($.ui.resolve(e), { matches: board.matches, columns: e.props.bodyColumns, onPick: anchor => void pressByKey($, `match:${anchor}`, false, e.surface) })}
        </Box>
      )
    }

    const open = await read($, card)
    const isFile = await read($, file)
    const detail = detailOf(plan, open)
    const shownDiff = await read($, diff)
    const now = Date.now()
    // Everything the drawing is made of but its closures (which depend on the plan's anchor and the surface, both here).
    const view = {
      plans: board.plans,
      plan,
      columns: e.props.bodyColumns,
      bodyRows: e.props.scroll.bodyRows,
      message: board.message,
      matches: board.matches ?? [],
      detail: isFile ? null : detail,
      diff: isFile ? null : shownDiff,
      file: isFile ? await loadFile($, plan) : null,
      home: await $.env.get('HOME'),
      // Only a board with an In Progress card reads the frame, so only that is redrawn at each one.
      frame: e.surface !== 'desktop' && !isFile && detail === null && hasWorking(plan) ? await read($, frame) : 0,
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
      onMatch: anchor => void pressByKey($, `match:${anchor}`, false, e.surface),
      onLane: lane => void pressByKey($, `lane:${lane}:more`, false, e.surface),
      onMenu: () => void pressByKey($, 'menu:name', false, e.surface),
      onPick: anchor => void pressByKey($, `plan:${anchor}`, false, e.surface),
      onCard: index =>
        void Promise.all([update($, menu, () => false), update($, card, () => ({ anchor: plan.anchor, index }))])
          .then(() => void loadUsage($, plan, index))
          .then(() => syncAnimation($))
          .then(() => refocus($, true)),
      onBack: () => void pressByKey($, 'back', false, e.surface),
      onFile: () => void pressByKey($, 'plan-file', false, e.surface),
      onDiff: () => void pressByKey($, 'detail:diff', false, e.surface),
      onDiffAt: index => void pressByKey($, `diff:${index}`, false, e.surface),
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

      if (anchor !== undefined) {
        await markFinished($, anchor)
      } else if (blocks.length > 0 || commandMark !== '' && e.command.includes(commandMark)) {
        refreshInBackground($)
      }
    } catch {
      // The board catches up at the next refresh; the Bash call is already answered.
    }

    return result
  })
}
