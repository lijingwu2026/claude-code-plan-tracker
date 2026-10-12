import type { CommandRunInput, EngineInterface, On, PromptOrigin, PromptSubmitInput, RenderElement, RenderInput, RenderSurface, UiPane } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'

import { applyOptions, settings } from '../hooks/board'
import type { PlanBoard, PlanEntry, PlanRow, PlanStatus } from '../types'

export const SESSION = { surface: 'terminal' as const, isInteractive: true, cwd: '/work' }

export const SESSION_ID = 'sess-1234'

export const PANE_ID = 'plan-tracker'

/** The board command the suite runs under (a stand-in for a tracker script), and the project root of the test session. */
export const SCRIPT = '/tools/board.py'
export const ROOT = '/work'

/** The plugin's settings in the suite: a board command, a usage command and a name. */
export const OPTIONS = {
  board_command: `python3 ${SCRIPT} --view {session} [--query={query}] --json`,
  usage_command: `python3 ${SCRIPT} {anchor} --usage --task {task}`,
  your_name: 'Sam',
}

// Tests that call the pure functions directly run under the same settings.
applyOptions(OPTIONS)
settings.root = ROOT

/** The period of the mod's one animation timer. */
export const FRAME_MS = 120

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * An ISO time `daysAgo` days before today at `hour:minute`, written on this machine's clock with its offset as the tracker writes
 * it. The screen tests read the real clock, so a fixture that has to be "today" or "another day" is made relative to it.
 */
export function localTime(daysAgo: number, hour: number, minute: number): string {
  const today = new Date()
  const at = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo, hour, minute, 30)
  const pad = (n: number) => String(n).padStart(2, '0')
  const offset = -at.getTimezoneOffset()
  const zone = `${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`

  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(hour)}:${pad(minute)}:30${zone}`
}

/** `Oct 9` for the day `daysAgo` days before today. */
export function dayName(daysAgo: number): string {
  const today = new Date()
  const at = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo)

  return `${MONTH_NAMES[at.getMonth()]} ${at.getDate()}`
}

const row = (task: string, status: PlanStatus, updated: string | null = '2026-10-08T01:00:00+09:00', route?: string, note = ''): PlanRow => ({
  task,
  status,
  note,
  updated,
  ...(route === undefined ? {} : { route }),
})

/**
 * One row per case of the board: 4 Done (one with a deliverable), 1 Canceled, 1 Needs Verification routed to Sam, 1 In
 * Progress (Sonnet), 1 Blocked (Opus, with its reason as the note), 5 Todo (the first routed to Sam, the second to
 * Haiku), and a Done row whose route is Sam's (it must not read "needs you").
 */
export const ALPHA_ROWS: PlanRow[] = [
  row('d1 oldest', 'Done', '2026-10-08T01:00:00+09:00'),
  row('d2 newest but one', 'Done', '2026-10-08T03:00:00+09:00'),
  row('d3 middle', 'Done', '2026-10-08T02:00:00+09:00', undefined, 'only the session id abc12345 here'),
  { ...row('d4 newest', 'Done', '2026-10-08T04:00:00+09:00', undefined, 'built the suite; 9 tests ok'), deliverable: 'automation/plans/alpha-plan.md' },
  row('c1 dropped', 'Canceled'),
  row('v1 look at the prototype', 'Needs Verification', undefined, 'serial × Sam · — — only she can judge the look', 'built; waits for her eyes'),
  row('Build the eval suite (official claude plugin eval) and run it', 'In Progress', undefined, 'spawn × subagent · Sonnet — a mechanical change'),
  row('b1 hook fix waits for settings', 'Blocked', undefined, 'serial × inline · Opus — settings are hers', 'waiting on a ruling about the hook'),
  row('t1 first todo', 'Todo', undefined, 'serial × Sam · — — she decides'),
  row('t2 second todo', 'Todo', undefined, 'spawn × subagent · Haiku — cheap'),
  row('t3 third todo', 'Todo'),
  row('t4 fourth todo', 'Todo'),
  row('t5 fifth todo', 'Todo'),
  row('d5 done by her', 'Done', '2026-10-08T00:30:00+09:00', 'serial × Sam · — — she judged it'),
]

export const ALPHA_FILE = '/plans/alpha-plan.md'

const plan = (anchor: string, name: string, rows: PlanRow[], goal = `${name} goal`): PlanEntry => ({
  anchor,
  name,
  goal,
  plan_file: `/plans/${anchor}.md`,
  rows,
})

export const BOARD: PlanBoard = {
  selected: 'alpha',
  message: null,
  plans: [
    { ...plan('alpha', 'Alpha plan', ALPHA_ROWS, 'Show every plan, then its deliverables'), plan_file: ALPHA_FILE },
    plan('beta', 'Beta', [row('only done 1', 'Done'), row('only done 2', 'Done')]),
    plan('gamma', 'Gamma', [row('g1', 'In Progress'), row('g2', 'Todo')]),
  ],
}

/** What the plan files hold in the test world, by path. */
export const FILES: Record<string, string> = {
  [ALPHA_FILE]: '# Alpha plan\n\nStep 1 builds it.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n',
  '/plans/beta.md': '# Beta\n',
}

export const HOME = '/home/tester'

export const VIEW_TEXT = ['Plans of this session', '', 'Alpha plan  1/5 Done', '  next: §2 wire the CLI'].join('\n')

export const DONE_BLOCK = ['PLAN-DONE alpha · §2 wire the CLI · 3 left', '  §3 docs · Todo · opus', '  §4 tests · Todo · unrouted'].join('\n')

/** The run of the board command that a test changes as it goes: its exit code and stderr, or a refusal to start. */
export type Run = { exitCode: number; stdout: string; stderr: string; doesThrow: boolean }

/** What the engine beneath the plugin does; a test changes it as it goes. */
export type World = {
  /** the board command's plain text (`--view`, what /plan-tracker answers) */
  script: Run
  /** what `--view --json` prints: a board, or raw text */
  fixture: PlanBoard | string
  /** how the `--json` runs end: their exit code and stderr, or a refusal to start (their stdout is `fixture`) */
  tracker: Omit<Run, 'stdout'>
  /** what the Bash tool answers (stdout, and the text the model reads) */
  bash: string
  /** what the plan files hold, by path; a path not here cannot be read */
  files: Record<string, string>
  /** every path read, in order */
  reads: string[]
  /** what the engine (or another mod) draws under the band */
  below: RenderElement
  /** the panes this plugin has open */
  panes: UiPane[]
  opened: { id: string; title: string | undefined; focus: true | undefined; rows: number | undefined }[]
  /** every run of the plain-text script, in order */
  scriptRuns: { argv: readonly string[]; init: unknown }[]
  /** every `--json` run of the script, in order */
  jsonRuns: { argv: readonly string[]; init: unknown }[]
  /** what a `--json` run waits for after it started (a test makes it late, or never) */
  jsonGate: () => Promise<void>
  /** Awaited by every `ui.open`: a test holds it to show that a press does not wait for the pane to open. */
  openGate: () => Promise<void>
  /** every other process the mod ran: the log writer */
  logRuns: { argv: readonly string[]; stdin: string | undefined }[]
  /** every `command.register`, in order */
  registered: { name: string; argumentHint: string | undefined }[]
  /** a reason `command.register` refuses /plan-tracker (a command of that name exists), or null */
  registerDenial: string | null
  /** a reason `ui.open` answers `{ isPlaced: false }` (the pane waits undrawn), or null */
  openDenial: string | null
  /** a reason `ui.open` itself fails (an error, not an answer), or null */
  openFailure: string | null
  /** paths that exist besides the plan files (`fs.exists` answers true for them) */
  present: string[]
  /** present paths that are folders (`fs.stat` answers kind `dir`; any other present path is a file) */
  dirs: string[]
  /** what `realpath` answers by path: the real path (a symlink's target), or null for a failure; a present path not here is its own real path */
  realpaths: Record<string, string | null>
  /** every `realpath` run, in order */
  realpathRuns: (readonly string[])[]
  /** how `open <path>` ends, or null for a clean exit */
  openRun: { exitCode: number; stderr: string } | null
  /** a reason `session.append` refuses, or null (the kit stores the row) */
  appendDenial: string | null
  /** every message the mod appended to the conversation, in order, as JSON */
  appended: string[]
  /** the surfaces the session draws on: `$.session.surfaces()` answers this (empty in a plain `claude -p` run) */
  surfaces: RenderSurface[]
  /** every toast shown, in order */
  toasts: string[]
  /** every clip played, in order */
  played: { clip: unknown; shouldLoop: boolean; gain: number | undefined }[]
  /** a reason the toast or the clip cannot be shown or played, or null */
  toastDenial: string | null
  audioDenial: string | null
  /** a reason `$.session.surfaces()` fails, or null */
  surfacesDenial: string | null
  clock: MockClock
  /** How many times the band was drawn: counted here, where the draw reaches the world beneath the plugin, in memory, with no file. */
  bandDraws: number
  /** The lines the mod appended to its log file, parsed. */
  logLines: () => Record<string, unknown>[]
  diagnostics: () => Record<string, unknown>[]
}

export const SURVEY: RenderElement = { type: 'Text', children: ['SURVEY'] }

/** The log stages that only measure (what the timer saw, which key was pressed). */
export const DIAGNOSTIC_STAGES = ['timer', 'press']

const FINISHED_RUN = { isStdoutTruncated: false, isStderrTruncated: false }

/**
 * The world beneath the plugin: the surfaces the session draws on, the clock, the board command (its text and its `--json`),
 * the Bash tool, the plan files, the toast stack, the speakers and the log file. Everything the plugin does to them is
 * recorded. The kit has nothing that answers a plugin's `session.append`, so `fakeEngine` stands in for it.
 * `world(on)`, `world(on, setup)` and `world(on, surfaces, setup)` are the three ways to call it.
 */
export function world(
  on: On,
  ...args: [] | [Partial<World>] | [readonly RenderSurface[], Partial<World>?]
): World {
  const [first, second] = args
  const given = Array.isArray(first) ? (first as readonly RenderSurface[]) : undefined
  const setup: Partial<World> = (given === undefined ? (first as Partial<World> | undefined) : second) ?? {}
  const surfaces: RenderSurface[] = given === undefined ? (setup.surfaces ?? ['terminal']) : [...given]
  const w: World = {
    script: { exitCode: 0, stdout: VIEW_TEXT, stderr: '', doesThrow: false },
    fixture: BOARD,
    tracker: { exitCode: 0, stderr: '', doesThrow: false },
    bash: '',
    files: FILES,
    reads: [],
    below: { type: 'Box', children: [] },
    panes: [],
    opened: [],
    scriptRuns: [],
    jsonRuns: [],
    logRuns: [],
    jsonGate: async () => undefined,
    openGate: async () => undefined,
    registered: [],
    registerDenial: null,
    openDenial: null,
    openFailure: null,
    present: [],
    dirs: [],
    realpaths: {},
    realpathRuns: [],
    openRun: null,
    appendDenial: null,
    appended: [],
    toasts: [],
    played: [],
    toastDenial: null,
    audioDenial: null,
    surfacesDenial: null,
    clock: mock.clock(on, { now: 0 }),
    bandDraws: 0,
    /** The log lines of the mod's events; the diagnostics (`timer`, `press`) are in `diagnostics`. */
    logLines: () => w.diagnostics().filter(l => !DIAGNOSTIC_STAGES.includes(String(l.stage))),
    diagnostics: () => w.logRuns.flatMap(r => (r.stdin ?? '').split('\n').filter(Boolean)).map(l => JSON.parse(l) as Record<string, unknown>),
    ...setup,
    surfaces,
  }

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: SESSION_ID }))
  on('session.root', () => ({ value: ROOT }))
  on('command.register', ($, e) => {
    w.registered.push({ name: e.name, argumentHint: e.argumentHint })

    return w.registerDenial === null || e.name !== 'plan-tracker' ? { value: { command: e.name } } : { deny: w.registerDenial }
  })
  on('session.append', ($, e, next) => {
    if (w.appendDenial !== null) {
      return { deny: w.appendDenial }
    }

    w.appended.push(JSON.stringify(e.message))

    return next(e)
  })
  on('ui.open', async ($, e) => {
    await w.openGate()
    w.opened.push({ id: e.id, title: e.title, focus: e.focus, rows: e.rows })

    if (w.openFailure !== null) {
      return { deny: w.openFailure }
    }

    if (w.openDenial !== null) {
      return { value: { isPlaced: false as const, reason: w.openDenial } }
    }

    w.panes = [...w.panes.filter(pane => pane.id !== e.id), { id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false, isPlaced: true }]

    return { value: { isPlaced: true as const } }
  })
  on('ui.close', ($, e) => {
    w.panes = w.panes.filter(pane => pane.id !== e.id)

    return { value: undefined }
  })
  on('ui.panes', () => ({ value: w.panes }))
  on('fs.read', ($, e) => {
    w.reads.push(e.path)

    const text = w.files[e.path]

    return text === undefined ? { deny: `ENOENT: no such file ${e.path}` } : { value: text }
  })
  on('fs.exists', ($, e) => ({ value: w.present.includes(e.path) || w.files[e.path] !== undefined }))
  on('fs.stat', ($, e) => ({ value: { kind: w.dirs.includes(e.path) ? ('dir' as const) : ('file' as const), size: 0, mtimeMs: 0, isLink: false } }))
  on('ui.render', () => {
    w.bandDraws += 1

    return w.below
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('process.run', async ($, e) => {
    if (e.argv[0] === 'python3') {
      const isJson = e.argv.includes('--json')

      ;(isJson ? w.jsonRuns : w.scriptRuns).push({ argv: e.argv, init: e.init })

      if (isJson) {
        await w.jsonGate()
      }

      const run = isJson ? { ...w.tracker, stdout: typeof w.fixture === 'string' ? w.fixture : JSON.stringify(w.fixture) } : w.script

      if (run.doesThrow) {
        return { deny: 'spawn python3 ENOENT' }
      }

      const { exitCode, stdout, stderr } = run

      return { value: { exitCode, stdout, stderr, ...FINISHED_RUN } }
    }

    if (e.argv[0] === '/bin/realpath') {
      const path = e.argv[1] ?? ''
      const real = path in w.realpaths ? w.realpaths[path] : w.present.includes(path) || w.files[path] !== undefined ? path : null

      w.realpathRuns.push(e.argv)

      return real === null || real === undefined
        ? { value: { exitCode: 1, stdout: '', stderr: `realpath: ${path}: No such file or directory`, ...FINISHED_RUN } }
        : { value: { exitCode: 0, stdout: `${real}\n`, stderr: '', ...FINISHED_RUN } }
    }

    w.logRuns.push({ argv: e.argv, stdin: e.init?.stdin })

    if (e.argv[0] === 'open' && w.openRun !== null) {
      return { value: { exitCode: w.openRun.exitCode, stdout: '', stderr: w.openRun.stderr, ...FINISHED_RUN } }
    }

    return { value: { exitCode: 0, stdout: '', stderr: '', ...FINISHED_RUN } }
  })
  on('session.surfaces', () => (w.surfacesDenial === null ? { value: w.surfaces } : { deny: w.surfacesDenial }))
  on('ui.toast', ($, e) => {
    if (w.toastDenial !== null) {
      return { deny: w.toastDenial }
    }

    w.toasts.push(e.text)

    return { value: undefined }
  })
  on('audio.play', ($, e) => {
    if (w.audioDenial !== null) {
      return { deny: w.audioDenial }
    }

    w.played.push({ clip: e.clip, shouldLoop: e.shouldLoop, gain: e.gain })

    return { value: undefined }
  })
  on('tool.call', () => ({ result: { stdout: w.bash, stderr: '', interrupted: false }, text: w.bash }) as never)
  mock.env(on, { HOME })

  return w
}

/** The argv the plugin must run for the plain text of this session, with the query if any. */
export const viewArgv = (query?: string) => ['python3', SCRIPT, '--view', SESSION_ID, ...(query === undefined ? [] : [`--query=${query}`])]

/** The argv of the `--json` run, with the query if any. */
export const jsonArgv = (query?: string) => [...viewArgv(query), '--json']


/** How the script must be started. */
export const VIEW_INIT = { cwd: ROOT, env: { CLAUDE_PROJECT_DIR: ROOT }, timeoutMs: 30_000 }

/**
 * Just enough of `$` for `announce`, recording what it does: the toasts, the
 * rows appended and the log lines. `toast` and `append` may be made to fail.
 */
export function fakeEngine(fail: { toast?: Error; append?: Error | 'denied' } = {}) {
  const toasts: string[] = []
  const appends: unknown[] = []
  const logs: Record<string, unknown>[] = []
  const engine = {
    env: { get: async () => HOME },
    session: {
      id: async () => SESSION_ID,
      append: async (args: unknown) => {
        appends.push(args)

        if (fail.append instanceof Error) {
          throw fail.append
        }

        return fail.append === 'denied' ? { deny: 'a hook refused it' } : { message: {}, uuid: 'u1' }
      },
    },
    ui: {
      toast: (text: string) => {
        if (fail.toast) {
          throw fail.toast
        }

        toasts.push(text)
      },
    },
    process: {
      run: async (argv: readonly string[], init?: { stdin?: string }) => {
        if (argv[0] === '/bin/sh') {
          logs.push(...(init?.stdin ?? '').split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>))
        }

        return { exitCode: 0, stdout: '', stderr: '', ...FINISHED_RUN }
      },
    },
  } as unknown as EngineInterface

  return { engine, toasts, appends, logs }
}

export const bandProps = (bodyColumns: number, hasSurvey = false): RenderInput<'AbovePrompt'>['props'] => ({
  hasSurvey,
  isWorking: false,
  maxRows: 10,
  bodyColumns,
  scroll: { offset: 0, bodyRows: 9 },
  view: {},
})

export const paneProps = (bodyColumns: number): RenderInput<'Pane'>['props'] => ({
  title: 'Plans',
  isFocused: true,
  bodyColumns,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
})

export const plans = (args = ''): CommandRunInput => ({
  command: 'plan-tracker',
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
})

/** What a person does to pick a plan in the pane: open the dropdown, then press the plan's row. */
export async function pickPlan(ui: { press: (target: { key: string }) => Promise<unknown> }, anchor: string) {
  await ui.press({ key: 'menu:name' })
  await ui.press({ key: `plan:${anchor}` })
}

/** A prompt as the engine raises it when the person presses Enter (or another origin). */
export const promptSubmit = (origin: PromptOrigin = { kind: 'composer' }): PromptSubmitInput => ({ text: 'next prompt', wait: false, origin })

/** The text a tree shows, in document order (a Button shows its label, a Link its label). */
export function textOf(node: unknown): string {
  if (typeof node === 'string') {
    return node
  }

  const element = node as { type?: string; props?: { label?: string; text?: string }; children?: unknown[] } | null

  if (element?.type === 'Button' || (element?.type === 'Link' && element.children === undefined)) {
    return element.props?.label ?? ''
  }

  if (element?.type === 'Markdown') {
    return element.props?.text ?? ''
  }

  return (element?.children ?? []).map(textOf).join('')
}

/** A drawn element as the tests read it. */
export type Node = { type: string; props: Record<string, unknown>; children: Node[] }

/** The children of a drawn element, typed. */
export const kids = (node: unknown): Node[] => (node as Node | undefined)?.children ?? []

/** What a person does to open a card: press the left button down and up on its Client region. */
export async function openCard(
  ui: { pointer: (event: { type: 'down' | 'up'; x: number; y: number; button: 'left'; in: string }) => Promise<void> },
  index: number,
) {
  await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: `card:${index}` })
  await ui.pointer({ type: 'up', x: 1, y: 0, button: 'left', in: `card:${index}` })
}

type Finder = { find: (query: { type?: string; key?: string; in?: string }) => Promise<unknown> }

/**
 * The text a tree shows with the cards in it: a card is a `Client`, whose rows its module draws, so each is read from its own
 * region (`in` the Client's key). Everything else reads as `textOf`.
 */
export async function textIn(ui: Finder, node: unknown): Promise<string> {
  const element = node as Node | string | null | undefined

  if (typeof element === 'string') {
    return element
  }

  if (element === null || element === undefined) {
    return ''
  }

  if (element.type === 'Client') {
    return textOf(await ui.find({ type: 'Box', in: String(element.props.key) }))
  }

  if (element.type === 'Button' || element.type === 'Link' || element.type === 'Markdown') {
    return textOf(element)
  }

  return (await Promise.all((element.children ?? []).map(child => textIn(ui, child)))).join('')
}

/** The rows a card's Client drew (its module's root Box, then its children), by the row index of the card. */
export const cardRowsIn = async (ui: Finder, index: number): Promise<Node[]> => kids(await ui.find({ type: 'Box', in: `card:${index}` }))
