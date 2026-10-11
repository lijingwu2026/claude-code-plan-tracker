/**
 * The plan board for a terminal: a one-row band above the prompt (`● <plan> ▾ <bar> n/m  Plan file ›`: "▾" opens the plan
 * list above the prompt, the bar opens or closes the board, "Plan file ›" opens the board on the plan file) and a pane with
 * the plan dropdown, the plan line, four lanes (Todo, In Progress, Verify, Done) of bordered cards (press one for its page) and the
 * plan's deliverables. Picking a plan in the band or in the pane switches both.
 *
 * The data is the board file (PROGRESS.md, read again every 1.5 s, so the board follows the file) or, with the setting
 * `board_command`, that command's JSON; read on session.start, on each prompt, after a Bash call that runs the command, and every
 * 10 s while the pane is open; one run is in flight at a time, and none holds a prompt or a Bash
 * result. `/plans [anchor or name]` opens the board on that plan, with no text, whatever the surface says (a Desktop client may
 * not have attached yet); when the board cannot be drawn a toast says why. On the desktop app a deliverable is a link a press
 * opens with `open`, if it is under the project or ~/.claude. A PLAN-DONE block in a Bash result becomes a toast, a chime and a
 * notice in the conversation, and one with `0 left` makes the band's bar a rainbow until the person's next prompt.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Live, PlanBoard, PlanEntry } from '../types'
import {
  BAND_MASCOT_SPACE,
  MASCOT,
  absolutePath,
  bandPlanOf,
  bandPose,
  bandPoseIndex,
  deliverableGroups,
  detailOf,
  FRAME_MS,
  doneBlocks,
  doneHeader,
  failureText,
  finishedAnchor,
  foldedPath,
  hasInProgress,
  isRainbow,
  messageOf,
  movement,
  openMode,
  openRefusal,
  noBoardFile,
  parseBoard,
  parseProgress,
  planOf,
  truncate,
  settings,
  applyOptions,
  usageArgv,
  boardArgv,
  commandMarkOf,
} from './board'
import type { LaneKey } from './board'
import type { FileView } from './draw'
import { drawBand, drawPane } from './draw'

const COMMAND = 'plans'
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
/** The `--query` the refreshes pass: the argument of the last `/plans`, or the plan that just finished. */
const query = atom({ plugin: 'plan-tracker', key: 'query' } as const, '')
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

  const isToasted = await attempt($, 'toast', () => $.ui.toast(`✅ ${truncate(done.task, TOAST_COLUMNS)} · ${done.left} left`))
  const isAppended = await attempt($, 'append', async () => {
    const appended = await $.session.append({ message: { type: 'system', content: [{ type: 'text', text: block }] } })

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
  await Promise.all([update($, file, () => true), update($, card, () => null), update($, menu, () => false), update($, bandMenu, () => false)])

  await $.ui.open(OPEN)
  await $.ui.scroll({ to: 'start', in: PANE_ID }).catch(() => undefined)
  await syncAnimation($)
}

/** Shows the board's lanes again and hands the keys to the pane. */
async function showBoard($: EngineInterface) {
  await Promise.all([update($, card, () => null), update($, file, () => false)])
  await syncAnimation($)
  await refocus($, true)
}

/** Picks a plan for the band and the board together: both lists close and the board shows its lanes. */
async function pickPlan($: EngineInterface, anchor: string) {
  await Promise.all([
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

/** What each hook's redraws look like: when the last one was logged and how many came since. */
const redraws = new Map<string, { at: number; n: number }>()

/** Counts a draw of `hook` on `surface` and logs the count at most once a second: what still redraws the desktop shows here. */
function noteRedraw($: EngineInterface, hook: string, surface: string) {
  const key = `${hook}:${surface}`
  const seen = redraws.get(key) ?? { at: 0, n: 0 }
  const now = Date.now()

  seen.n += 1

  if (now - seen.at >= 1000) {
    void log($, 'redraw', null, { hook, surface, count: seen.n })
    seen.at = now
    seen.n = 0
  }

  redraws.set(key, seen)
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

      if (path !== undefined) {
        await openDeliverable($, path).catch(() => undefined)
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
 * `/plans` opens the board on the plan the argument names and answers no text. It opens whatever `$.session.surfaces()`
 * says: a Desktop client joins that list only once it attaches, and `/plans` can be a session's first input. When the pane
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

/**
 * A press on a deliverable's link that reaches the plugin (the desktop opens these links itself, so none does today): the
 * file has to exist and, both as written (`..` folded) and as it really is (`realpath`, symlinks followed), sit under the
 * project root or ~/.claude, or be a regular file under the home directory outside hidden folders. Its real path is then opened with `open` when its
 * type is one that is only viewed and it is a regular file, and revealed in Finder with `open -R` for anything else. A refusal is logged and shown
 * as a toast.
 */
export async function openDeliverable($: EngineInterface, path: string) {
  const home = await $.env.get('HOME')
  const absolute = absolutePath(path, home)
  const root = await projectRoot($)
  const roots = [root, ...(home === undefined || home === '' ? [] : [`${home.replace(/\/+$/, '')}/.claude`])].filter(one => one !== '')
  const refusal = absolute === null ? 'cannot place that path' : openRefusal(absolute, roots, home)

  if (absolute === null || refusal !== null) {
    await log($, 'open-path', refusal, { path })
    $.ui.toast(`Not opened: ${refusal}`)

    return
  }

  const target = foldedPath(absolute)

  if (!(await $.fs.exists(target).catch(() => false))) {
    await log($, 'open-path', 'no such file', { path })
    $.ui.toast(`Not opened: no such file ${target}`)

    return
  }

  const real = await $.process.run(['/bin/realpath', target]).catch((error: unknown) => ({ exitCode: -1, stdout: '', stderr: messageOf(error) }))
  const resolved = real.stdout.trim()
  const resolvedRefusal = real.exitCode !== 0 || resolved === '' ? 'real path unknown' : openRefusal(resolved, roots, home)

  if (resolvedRefusal !== null) {
    await log($, 'open-path', resolvedRefusal, { path })
    $.ui.toast(`Not opened: ${resolvedRefusal}`)

    return
  }

  const isFile = (await $.fs.stat(resolved).catch(() => undefined))?.kind === 'file'

  // Only a regular file is opened from the home directory at large; a folder is shown only inside the project and ~/.claude.
  if (!isFile && openRefusal(resolved, roots) !== null) {
    await log($, 'open-path', 'not a regular file', { path })
    $.ui.toast('Not opened: not a regular file')

    return
  }

  const argv = isFile && openMode(resolved) === 'open' ? ['open', resolved] : ['open', '-R', resolved]
  const { exitCode, stderr } = await $.process.run(argv).catch((error: unknown) => ({ exitCode: -1, stderr: messageOf(error) }))

  if (exitCode !== 0) {
    await log($, 'open-path', `open exited ${exitCode}: ${stderr.trim().slice(0, 200)}`, { path })
    $.ui.toast(`Not opened: open exited ${exitCode}`)
  }
}

export const register: Register = (on, options) => {
  applyOptions(options)

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: COMMAND,
        description: "Show this session's plans; /plans <anchor or name> shows one plan",
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

    noteRedraw($, 'band', e.surface)

    const picked = await shownPlan($)
    const below = await next(e)

    // No answer, an error, or no plan for this session: the band draws nothing of ours.
    if (picked === undefined) {
      return below
    }

    const mark = await read($, finished)
    const plan = bandPlanOf(picked, mark)
    const isRainbowUp = isRainbow(picked, mark)
    const moves = isRainbowUp || hasInProgress(plan)
    // The desktop reads no frame: a redraw issues new button handles, and its press arrives with the old one. Its sprite animates itself.
    const isDesktop = e.surface === 'desktop'
    const now = moves && !isDesktop ? await read($, frame) : 0
    // "‹ Board" only while the pane is up and shows the plan file.
    const isFile = (await read($, file)) && (await $.ui.panes().catch(() => [])).some(pane => pane.id === PANE_ID && pane.isPlaced)

    // Only a plan that moves (a rainbow, or a row In Progress for the mascot) reads the frame, so only then is the band
    // redrawn at each one. The row gets what the mascot and its space leave.
    return drawBand($.ui.resolve(e), {
      plan,
      plans: (await boardOf($))?.plans ?? [],
      columns: e.props.bodyColumns - BAND_MASCOT_SPACE,
      below,
      maxRows: e.props.maxRows,
      isOpen: await read($, bandMenu),
      isFile,
      frame: isRainbowUp ? now : null,
      pose: bandPose(plan, now),
      spritePose: MASCOT[bandPoseIndex(plan, now)],
      isProportional: isDesktop,
      isMoving: isDesktop && hasInProgress(plan),
      onBar: () => void pressByKey($, 'band:bar', false, e.surface),
      onMenu: () => void pressByKey($, 'band:plans', false, e.surface),
      onPick: anchor => void pressByKey($, `band:plan:${anchor}`, false, e.surface),
      onFile: () => void pressByKey($, 'band:file', false, e.surface),
      onBoard: () => void pressByKey($, 'band:board', false, e.surface),
    })
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
    noteRedraw($, 'pane', e.surface)
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
      return <Text dimColor>{board.message ?? 'No plans in this session.'}</Text>
    }

    const open = await read($, card)
    const isFile = await read($, file)
    const detail = detailOf(plan, open)

    return drawPane($.ui.resolve(e), {
      plans: board.plans,
      plan,
      columns: e.props.bodyColumns,
      bodyRows: e.props.scroll.bodyRows,
      message: board.message,
      detail: isFile ? null : detail,
      now: Date.now(),
      file: isFile ? await loadFile($, plan) : null,
      home: await $.env.get('HOME'),
      // Only a board with an In Progress card reads the frame, so only that is redrawn at each one.
      frame: e.surface !== 'desktop' && !isFile && detail === null && hasInProgress(plan) ? await read($, frame) : 0,
      isOpen: await read($, menu),
      hasClient: e.surface === 'terminal' || e.surface === 'desktop',
      surface: e.surface,
      expanded: (await read($, expanded)).flatMap(key => (key.startsWith(`${plan.anchor}:`) ? [key.slice(plan.anchor.length + 1) as LaneKey] : [])),
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
    })
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
