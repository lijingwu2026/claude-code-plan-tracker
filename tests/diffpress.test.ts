import { describe, expect, test } from './testing'
import type { Engine } from 'claude-code/testing'

import { actionFor } from '../hooks/register'
import type { PlanBoard, PlanRow } from '../types'
import type { Node } from './fixtures'
import { BOARD, HOME, PANE_ID, SESSION, kids, openCard, paneProps, textOf, world } from './fixtures'

type Surface = 'terminal' | 'desktop'

const mountPane = ($: Engine, surface: Surface, columns = 160) =>
  $.ui.mount({ plugin: 'plan-tracker', surface, component: 'Pane', requestId: PANE_ID, props: paneProps(columns), viewport: { columns: columns + 60, rows: 50, isFullscreen: true } })

/** Lets what a press started without being awaited (the git runs) finish. */
const settle = async (clock: { advance: (ms: number) => Promise<void> }) => {
  for (let at = 0; at < 30; at += 1) {
    await clock.advance(10)
  }
}

const WRITTEN = '~/.claude/mods/plan-tracker/hooks/board.ts'
const FILE = `${HOME}/.claude/mods/plan-tracker/hooks/board.ts`
const HREF = `file://${FILE}`
const TOP = `${HOME}/.claude`
const REL = 'mods/plan-tracker/hooks/board.ts'
const CURSOR_BIN = '/Applications/Cursor.app/Contents/Resources/app/bin/cursor'
const CURSOR_ENV = { TERM_PROGRAM: 'vscode', __CFBundleIdentifier: 'com.todesktop.230313mzl4w4u92' }

const ROW: PlanRow = {
  task: 'r0 diff link',
  status: 'Done',
  started: '2026-10-12T18:00:00+09:00',
  updated: '2026-10-12T20:00:00+09:00',
  deliverable: WRITTEN,
  change: 'adds the diff link',
}

const boardOf = (...rows: PlanRow[]): PlanBoard => ({ ...BOARD, plans: [{ ...BOARD.plans[0]!, rows }] })

const sha = (letter: string) => letter.repeat(40)
const secs = (iso: string) => Date.parse(iso) / 1000
const logLine = (letter: string, iso: string, subject: string) => `${sha(letter)}\t${secs(iso)}\t${subject}`

/** before the row started, inside its window, and after its `updated` + 30 minutes: only `b` is the row's */
const LOG = [logLine('c', '2026-10-12T21:00:00+09:00', 'later work'), logLine('b', '2026-10-12T19:00:00+09:00', 'add the diff link'), logLine('a', '2026-10-12T09:00:00+09:00', 'earlier work')].join('\n')

const DIFF = [
  'diff --git a/mods/plan-tracker/hooks/board.ts b/mods/plan-tracker/hooks/board.ts',
  'index 1111111..2222222 100644',
  '--- a/mods/plan-tracker/hooks/board.ts',
  '+++ b/mods/plan-tracker/hooks/board.ts',
  '@@ -1,3 +1,4 @@',
  ' line one',
  '-line two',
  '+line two changed',
  '+line three added',
  ' line four',
  '',
].join('\n')

const HUNK = ['@@ -1,3 +1,4 @@', ' line one', '-line two', '+line two changed', '+line three added', ' line four'].join('\n')

type Repo = {
  top?: string | null
  log?: string
  diff?: string
  /** the file before and after the commit as `git show <sha>^:<path>` and `<sha>:<path>` print it; null is a git failure (an added or deleted file) */
  before?: string | null
  after?: string | null
  /** how the editor's `--diff` ends */
  editor?: { exitCode: number; stderr?: string }
  diffExit?: number
}

/** A git stub for the repo at `TOP`, and the editor's command. */
const repo = (r: Repo = {}) => (argv: readonly string[]) => {
  if (argv[0] === 'git') {
    const sub = argv[3]
    // a blob (`<sha>^:<path>` or `<sha>:<path>`) as against a commit's diff
    const target = argv.find(arg => /^[0-9a-f]{40}\^?:/.test(arg)) ?? ''

    if (sub === 'rev-parse') {
      return r.top === null ? { exitCode: 128, stderr: 'fatal: not a git repository' } : { stdout: `${r.top ?? TOP}\n` }
    }

    if (sub === 'log') {
      return { stdout: r.log ?? LOG }
    }

    if (sub === 'show' && target !== '') {
      const text = target.includes('^:') ? r.before : r.after

      return text === null ? { exitCode: 128, stderr: 'fatal: path does not exist' } : { stdout: text ?? 'content\n' }
    }

    if (sub === 'show') {
      return r.diffExit === undefined ? { stdout: r.diff ?? DIFF } : { exitCode: r.diffExit, stderr: 'fatal: bad object' }
    }
  }

  if (argv[0] === CURSOR_BIN || argv[0] === 'cursor' || argv[0] === 'code') {
    return r.editor
  }

  return undefined
}

const gitRuns = (w: ReturnType<typeof world>) => w.logRuns.filter(run => run.argv[0] === 'git').map(run => run.argv)
const editorRuns = (w: ReturnType<typeof world>) => w.logRuns.filter(run => run.argv[0] === CURSOR_BIN || run.argv[0] === 'cursor' || run.argv[0] === 'code').map(run => run.argv)

const flat = (node: unknown) => textOf(node).replace(/\s+/g, ' ').trim()

/** The `source` of every Code element the pane draws. */
const codes = async (pane: Awaited<ReturnType<typeof mountPane>>) => (await pane.findAll({ type: 'Code' })).map(node => node.props as { source: string; format?: string; path?: string })

const start = async ($: Engine, on: Parameters<typeof world>[0], surface: Surface, setup: Partial<ReturnType<typeof world>> & { rows?: PlanRow[]; columns?: number } = {}) => {
  const { rows = [ROW], columns = 160, ...rest } = setup
  const w = world(on, { fixture: boardOf(...rows), present: [FILE], answer: repo(), ...rest })

  await $.session.start(SESSION)

  return { w, pane: await mountPane($, surface, columns) }
}

describe('the WHAT CHANGED text is the diff link', () => {
  test('desktop table, wide: the change text is a Markdown link keyed change:0 that the plugin answers', async ($, on) => {
    const { w, pane } = await start($, on, 'desktop')
    const link = (await pane.find({ key: 'change:0' })) as Node

    expect(link.type).toBe('Markdown')
    expect(String(link.props.text)).toContain('[adds the diff link](file://')
    // a Markdown with no `onLinkPress` has nothing a press can reach; this one takes the press
    await expect(pane.press({ key: 'change:0', link: { href: HREF } })).resolves.toBeDefined()
    await settle(w.clock)
    await pane.unmount()
  })

  test('desktop table, narrow (the change under the path): the same link', async ($, on) => {
    const { pane } = await start($, on, 'desktop', { columns: 96 })

    expect(((await pane.find({ key: 'change:0' })) as Node | undefined)?.type).toBe('Markdown')
    await pane.unmount()
  })

  test('the link is on the deliverable that has a change: one without keeps its dash and has none', async ($, on) => {
    const { pane } = await start($, on, 'desktop', { rows: [{ ...ROW, change: undefined } as PlanRow] })

    expect(await pane.find({ key: 'change:0' })).toBeUndefined()
    await pane.unmount()
  })

  test('terminal table: the text stays plain, with no link and no button', async ($, on) => {
    const { pane } = await start($, on, 'terminal')

    expect(await pane.find({ key: 'change:0' })).toBeUndefined()
    expect(flat(await pane.find({ key: 'deliverables' }))).toContain('adds the diff link')
    await pane.unmount()
  })

  test('desktop task page: the change line is a Markdown link keyed detail:change', async ($, on) => {
    const { w, pane } = await start($, on, 'desktop', { columns: 96 })

    await openCard(pane, 0)

    const link = (await pane.find({ key: 'detail:change' })) as Node

    expect(link.type).toBe('Markdown')
    expect(String(link.props.text)).toContain('[adds the diff link](file://')
    await expect(pane.press({ key: 'detail:change', link: { href: HREF } })).resolves.toBeDefined()
    await settle(w.clock)
    await pane.unmount()
  })

  test('terminal task page: a `Diff ›` button keyed detail:change on the Deliverable row, and no Markdown link', async ($, on) => {
    const { pane } = await start($, on, 'terminal', { columns: 96 })

    await openCard(pane, 0)

    const button = (await pane.find({ key: 'detail:change' })) as Node

    expect(button.type).toBe('Button')
    expect(button.props.label).toBe('Diff ›')
    expect((await pane.findAll({ type: 'Markdown' })).some(node => String(node.props.text).includes('adds the diff link'))).toBe(false)
    await pane.unmount()
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${surface}: a task page without a change text has no link and no button`, async ($, on) => {
      const { pane } = await start($, on, surface, { rows: [{ ...ROW, change: undefined } as PlanRow], columns: 96 })

      await openCard(pane, 0)
      expect(await pane.find({ key: 'detail:change' })).toBeUndefined()
      await pane.unmount()
    })
  }
})

describe('git runs on a press only', () => {
  test('the board redraws and refreshes for a minute without one git run', async ($, on) => {
    const { w, pane } = await start($, on, 'desktop')

    await w.clock.advance(65_000)
    await openCard(pane, 0)
    await w.clock.advance(65_000)

    expect(gitRuns(w)).toEqual([])
    expect(w.written).toEqual([])
    await pane.unmount()
  })
})

describe('the path is checked before any git call', () => {
  const pressWith = async ($: Engine, on: Parameters<typeof world>[0], deliverable: string, setup: Partial<ReturnType<typeof world>> = {}) => {
    const { w, pane } = await start($, on, 'desktop', { rows: [{ ...ROW, deliverable }], ...setup })

    await pane.press({ key: 'change:0', link: { href: 'file:///x' } })
    await settle(w.clock)
    await pane.unmount()

    return w
  }

  test('a file under /tmp is refused: a toast, and git is never run', async ($, on) => {
    const w = await pressWith($, on, '/tmp/x.ts', { present: ['/tmp/x.ts'], realpaths: { '/tmp/x.ts': '/private/tmp/x.ts' } })

    expect(gitRuns(w)).toEqual([])
    expect(w.toasts).toHaveLength(1)
    expect(w.toasts[0]).toStartWith('No diff: ')
  })

  test('a path whose real path is refused (a link into /private/tmp) never reaches git', async ($, on) => {
    const link = `${HOME}/code/link.ts`
    const w = await pressWith($, on, link, { present: [link], realpaths: { [link]: '/private/tmp/target.ts' } })

    expect(gitRuns(w)).toEqual([])
    expect(w.toasts[0]).toStartWith('No diff: ')
  })

  for (const path of ['/etc/hosts', `${HOME}/.ssh/config`]) {
    test(`${path} (outside the home folder, or in a hidden folder under it) is refused`, async ($, on) => {
      const w = await pressWith($, on, path, { present: [path] })

      expect(gitRuns(w)).toEqual([])
      expect(w.toasts[0]).toStartWith('No diff: ')
    })
  }

  test('a file that is not there says so and runs no git', async ($, on) => {
    const w = await pressWith($, on, `${HOME}/.claude/gone.ts`, { present: [] })

    expect(gitRuns(w)).toEqual([])
    expect(w.toasts[0]).toStartWith('No diff: no such file')
  })

  test('a folder is not a file: a toast, and no git', async ($, on) => {
    const w = await pressWith($, on, `${HOME}/.claude/mods/plan-tracker`, { present: [`${HOME}/.claude/mods/plan-tracker`], dirs: [`${HOME}/.claude/mods/plan-tracker`] })

    expect(gitRuns(w)).toEqual([])
    expect(w.toasts).toEqual(['No diff: not a file'])
  })
})

describe('which commit and what the toasts say', () => {
  test('the commit inside the row\'s window is the one shown, found with git -C <toplevel> and a repo-relative path', async ($, on) => {
    const { w, pane } = await start($, on, 'desktop', { answer: repo() })

    await pane.press({ key: 'change:0', link: { href: HREF } })
    await settle(w.clock)

    expect(gitRuns(w)).toEqual([
      ['git', '-C', `${HOME}/.claude/mods/plan-tracker/hooks`, 'rev-parse', '--show-toplevel'],
      ['git', '-C', TOP, 'log', '-n', '200', '--format=%H%x09%ct%x09%s', '--', REL],
      ['git', '-C', TOP, 'show', '--no-ext-diff', '--no-textconv', sha('b'), '--format=', '--', REL],
    ])
    await pane.unmount()
  })

  test('no commit touched the file: a toast, and no show', async ($, on) => {
    const { w, pane } = await start($, on, 'desktop', { answer: repo({ log: '' }) })

    await pane.press({ key: 'change:0', link: { href: HREF } })
    await settle(w.clock)

    expect(w.toasts).toEqual(['No commit found for board.ts'])
    expect(gitRuns(w).some(argv => argv[3] === 'show')).toBe(false)
    expect(await codes(pane)).toEqual([])
    await pane.unmount()
  })

  test('the file is not in a git repo: a toast, and nothing after rev-parse', async ($, on) => {
    const { w, pane } = await start($, on, 'desktop', { answer: repo({ top: null }) })

    await pane.press({ key: 'change:0', link: { href: HREF } })
    await settle(w.clock)

    expect(w.toasts).toEqual(['Not in a git repo'])
    expect(gitRuns(w).map(argv => argv[3])).toEqual(['rev-parse'])
    await pane.unmount()
  })

  test('git show failing is a toast too, and the board stays', async ($, on) => {
    const { w, pane } = await start($, on, 'desktop', { answer: repo({ diffExit: 128 }) })

    await pane.press({ key: 'change:0', link: { href: HREF } })
    await settle(w.clock)

    expect(w.toasts).toEqual(['No diff: git show exited 128'])
    expect(await pane.find({ key: 'lane:Done' })).toBeDefined()
    await pane.unmount()
  })
})

describe('outside Cursor the diff is a page of the board', () => {
  test('desktop table press: ‹ Back, the path · short sha · subject, then one diff Code per hunk', async ($, on) => {
    const { w, pane } = await start($, on, 'desktop')

    await pane.press({ key: 'change:0', link: { href: HREF } })
    await settle(w.clock)

    expect(await pane.find({ key: 'lane:Done' })).toBeUndefined()
    expect(((await pane.find({ key: 'back' })) as Node).props.label).toBe('‹ Back')
    expect(flat(await pane.find({ key: 'diff' }))).toContain(`${WRITTEN} · ${sha('b').slice(0, 7)} · add the diff link`)
    expect(await codes(pane)).toEqual([{ source: HUNK, format: 'diff', path: WRITTEN }])
    expect(w.opened.at(-1)).toMatchObject({ id: 'plan-tracker', focus: true })
    await pane.unmount()
  })

  test('terminal task page: pressing Diff › shows the same page, and Back returns to the task page', async ($, on) => {
    const { w, pane } = await start($, on, 'terminal', { columns: 96 })

    await openCard(pane, 0)
    await pane.press({ key: 'detail:change' })
    await settle(w.clock)

    expect((await codes(pane)).map(one => one.source)).toEqual([HUNK])
    expect(await pane.find({ key: 'field:deliverable' })).toBeUndefined()

    await pane.press({ key: 'back' })
    await settle(w.clock)

    expect(await codes(pane)).toEqual([])
    expect(await pane.find({ key: 'field:deliverable' })).toBeDefined()
    await pane.unmount()
  })

  test('desktop task page: the detail link opens it, and Back from a page opened on the table returns to the board', async ($, on) => {
    const { w, pane } = await start($, on, 'desktop', { columns: 96 })

    await pane.press({ key: 'change:0', link: { href: HREF } })
    await settle(w.clock)
    await pane.press({ key: 'back' })
    await settle(w.clock)

    expect(await codes(pane)).toEqual([])
    expect(await pane.find({ key: 'lane:Done' })).toBeDefined()

    await openCard(pane, 0)
    await pane.press({ key: 'detail:change', link: { href: HREF } })
    await settle(w.clock)

    expect((await codes(pane)).length).toBe(1)
    await pane.unmount()
  })

  test('a diff over 10000 characters is split: every source within the limit and no line lost', async ($, on) => {
    const lines = Array.from({ length: 600 }, (_, at) => `+${String(at).padStart(39, 'x')}`)
    const diff = ['diff --git a/x b/x', '--- /dev/null', '+++ b/x', '@@ -0,0 +1,600 @@', ...lines, ''].join('\n')
    const { w, pane } = await start($, on, 'desktop', { answer: repo({ diff }) })

    await pane.press({ key: 'change:0', link: { href: HREF } })
    await settle(w.clock)

    const sources = (await codes(pane)).map(one => one.source)

    expect(sources.length).toBeGreaterThan(1)
    expect(sources.every(source => source.length <= 10_000)).toBe(true)
    expect(sources.flatMap(source => source.split('\n').slice(1))).toEqual(lines)
    await pane.unmount()
  })

  test('past 60000 characters a line says how much is not shown', async ($, on) => {
    const lines = Array.from({ length: 3000 }, (_, at) => `+${String(at).padStart(39, 'x')}`)
    const diff = ['@@ -0,0 +1,3000 @@', ...lines, ''].join('\n')
    const { w, pane } = await start($, on, 'desktop', { answer: repo({ diff }) })

    await pane.press({ key: 'change:0', link: { href: HREF } })
    await settle(w.clock)

    const shown = (await codes(pane)).flatMap(one => one.source.split('\n').slice(1)).length

    expect(flat(await pane.find({ key: 'diff' }))).toContain(`Rest of the diff not shown (${3000 - shown} more lines)`)
    await pane.unmount()
  })

  test('a binary commit shows one plain line and no Code', async ($, on) => {
    const diff = 'diff --git a/x.png b/x.png\nindex 1111111..2222222 100644\nBinary files a/x.png and b/x.png differ\n'
    const { w, pane } = await start($, on, 'desktop', { answer: repo({ diff }) })

    await pane.press({ key: 'change:0', link: { href: HREF } })
    await settle(w.clock)

    expect(await codes(pane)).toEqual([])
    expect(flat(await pane.find({ key: 'diff' }))).toContain('No text changes to show (binary file, rename or mode change only)')
    await pane.unmount()
  })

  // the row was checked and marked Done long after its work: `updated` is late, but its deliverable was written (`changed_at`) at 19:20
  const CHECKED_LATE: PlanRow = { ...ROW, updated: '2026-10-13T01:00:00+09:00', changed_at: '2026-10-12T19:20:00+09:00' }
  const shownSha = (w: ReturnType<typeof world>) => gitRuns(w).filter(argv => argv[3] === 'show' && argv.includes('--no-ext-diff')).map(argv => argv[6])

  test('desktop table: the commit comes from changed_at + 30 minutes, not from a later updated: the later task\'s commit is not shown', async ($, on) => {
    const { w, pane } = await start($, on, 'desktop', { rows: [CHECKED_LATE] })

    await pane.press({ key: 'change:0', link: { href: HREF } })
    await settle(w.clock)

    expect(shownSha(w)).toEqual([sha('b')])
    await pane.unmount()
  })

  test('terminal task page: the same, from the row\'s own changed_at', async ($, on) => {
    const { w, pane } = await start($, on, 'terminal', { rows: [CHECKED_LATE], columns: 96 })

    await openCard(pane, 0)
    await pane.press({ key: 'detail:change' })
    await settle(w.clock)

    expect(shownSha(w)).toEqual([sha('b')])
    await pane.unmount()
  })

  test('a row without changed_at (old rows are not backfilled) keeps updated + 30 minutes: the later commit', async ($, on) => {
    const { w, pane } = await start($, on, 'desktop', { rows: [{ ...CHECKED_LATE, changed_at: undefined } as PlanRow] })

    await pane.press({ key: 'change:0', link: { href: HREF } })
    await settle(w.clock)

    expect(shownSha(w)).toEqual([sha('c')])
    await pane.unmount()
  })

  const LONG_SUBJECT = 'plan-tracker 0.5.34: every lane lists its latest updated task first (Todo, In Progress, Verify; Done as before); the groups stay and each is sorted inside'

  const titleAt = async ($: Engine, on: Parameters<typeof world>[0], columns: number) => {
    const { w, pane } = await start($, on, 'terminal', { answer: repo({ log: logLine('b', '2026-10-12T19:00:00+09:00', LONG_SUBJECT) }), columns })

    await openCard(pane, 0)
    await pane.press({ key: 'detail:change' })
    await settle(w.clock)

    const box = (await pane.find({ key: 'diff' })) as Node

    await pane.unmount()

    return { box, title: kids(box).filter(node => node.type === 'Text').map(textOf) }
  }

  test('a long commit subject is one line cut with …: the title is one row, the path and sha whole', async ($, on) => {
    const { box, title } = await titleAt($, on, 80)

    expect(title).toHaveLength(1)
    expect(title[0]).toStartWith(`${WRITTEN} · ${sha('b').slice(0, 7)} · plan-tracker`)
    expect(title[0]).toEndWith('…')
    expect(title[0]!.length).toBeLessThanOrEqual(80)
    expect(flat(box)).not.toContain(LONG_SUBJECT)
  })

  test('with little room beside the path and sha the subject is a row of its own, still one line cut with …', async ($, on) => {
    const { title } = await titleAt($, on, 60)

    expect(title).toHaveLength(2)
    expect(title[0]).toBe(`${WRITTEN} · ${sha('b').slice(0, 7)}`)
    expect(title[1]!.length).toBeLessThanOrEqual(60)
    expect(title[1]).toEndWith('…')
  })

  const NOT_AN_EDITOR: Record<string, string>[] = [{ __CFBundleIdentifier: CURSOR_ENV.__CFBundleIdentifier }, { TERM_PROGRAM: 'iTerm.app', __CFBundleIdentifier: CURSOR_ENV.__CFBundleIdentifier }, { TERM_PROGRAM: 'Apple_Terminal' }]

  for (const env of NOT_AN_EDITOR) {
    test(`${JSON.stringify(env)} is not Cursor or VS Code: the page, no editor command`, async ($, on) => {
      const { w, pane } = await start($, on, 'terminal', { env, columns: 96 })

      await openCard(pane, 0)
      await pane.press({ key: 'detail:change' })
      await settle(w.clock)

      expect(editorRuns(w)).toEqual([])
      expect(w.written).toEqual([])
      expect((await codes(pane)).length).toBe(1)
      await pane.unmount()
    })
  }
})

describe('inside Cursor the diff opens in its own diff view', () => {
  const press = async ($: Engine, on: Parameters<typeof world>[0], setup: Partial<ReturnType<typeof world>> & { repo?: Repo; rows?: PlanRow[] } = {}) => {
    const { repo: given, ...rest } = setup
    const { w, pane } = await start($, on, 'terminal', { env: CURSOR_ENV, answer: repo({ before: 'old text\n', after: 'new text\n', editor: { exitCode: 0 }, ...given }), columns: 96, ...rest })

    await openCard(pane, 0)
    await pane.press({ key: 'detail:change' })
    await settle(w.clock)

    return { w, pane }
  }

  test('the file before and after the commit go into one new temp folder, and the editor is run on the two', async ($, on) => {
    const { w, pane } = await press($, on, { present: [FILE, CURSOR_BIN] })
    const [before, after] = w.written

    expect(w.written).toHaveLength(2)
    expect(before?.path).toMatch(/^\/tmp\/plan-tracker-diff-[a-z0-9]+\/before\/board\.ts$/)
    expect(after?.path).toMatch(/^\/tmp\/plan-tracker-diff-[a-z0-9]+\/after\/board\.ts$/)
    expect(before?.path.split('/before/')[0]).toBe(after?.path.split('/after/')[0])
    expect([before?.text, after?.text]).toEqual(['old text\n', 'new text\n'])
    expect(editorRuns(w)).toEqual([[CURSOR_BIN, '--diff', before?.path, after?.path]])
    expect(gitRuns(w).map(argv => argv.slice(3))).toContainEqual(['show', '--no-textconv', `${sha('b')}^:${REL}`])
    expect(gitRuns(w).map(argv => argv.slice(3))).toContainEqual(['show', '--no-textconv', `${sha('b')}:${REL}`])
    // the editor shows it: the board stays as it was
    expect(await codes(pane)).toEqual([])
    expect(await pane.find({ key: 'field:deliverable' })).toBeDefined()
    await pane.unmount()
  })

  test('without the app\'s own path, `cursor` on PATH is run; the temp folder is under TMPDIR when it is set', async ($, on) => {
    const { w, pane } = await press($, on, { env: { ...CURSOR_ENV, TMPDIR: '/var/folders/xx/T/' } })

    expect(w.written[0]?.path).toMatch(/^\/var\/folders\/xx\/T\/plan-tracker-diff-[a-z0-9]+\/before\/board\.ts$/)
    expect(editorRuns(w)[0]?.[0]).toBe('cursor')
    await pane.unmount()
  })

  test('a file the commit added has an empty "before"', async ($, on) => {
    const { w, pane } = await press($, on, { repo: { before: null, after: 'brand new\n' } })

    expect(w.written.map(one => one.text)).toEqual(['', 'brand new\n'])
    expect(editorRuns(w)).toHaveLength(1)
    await pane.unmount()
  })

  test('the editor failing falls back to the page in the pane', async ($, on) => {
    const { w, pane } = await press($, on, { repo: { editor: { exitCode: 1, stderr: 'cursor: command failed' } } })

    expect(editorRuns(w)).toHaveLength(1)
    expect((await codes(pane)).map(one => one.source)).toEqual([HUNK])
    await pane.unmount()
  })

  test('a binary file (a NUL in its text) is not sent to the editor: the page says there is no text to show', async ($, on) => {
    const { w, pane } = await press($, on, { repo: { before: 'a\u0000b', after: 'a\u0000c', diff: 'diff --git a/x b/x\nBinary files a/x and b/x differ\n' } })

    expect(editorRuns(w)).toEqual([])
    expect(w.written).toEqual([])
    expect(flat(await pane.find({ key: 'diff' }))).toContain('No text changes to show')
    await pane.unmount()
  })

  test('the path check still comes first: a refused file runs neither git nor the editor', async ($, on) => {
    const { w, pane } = await press($, on, { rows: [{ ...ROW, deliverable: '/tmp/x.ts' }], present: ['/tmp/x.ts', CURSOR_BIN] })

    expect(gitRuns(w)).toEqual([])
    expect(editorRuns(w)).toEqual([])
    expect(w.written).toEqual([])
    expect(w.toasts[0]).toStartWith('No diff: ')
    await pane.unmount()
  })
})

describe('the keys', () => {
  test('change:N is answered only as a link; detail:change as a link (desktop) and as a button (terminal)', async () => {
    expect(actionFor({} as never, 'change:0', true, 'desktop')).toBeDefined()
    expect(actionFor({} as never, 'change:0', false, 'desktop')).toBeUndefined()
    expect(actionFor({} as never, 'detail:change', true, 'desktop')).toBeDefined()
    expect(actionFor({} as never, 'detail:change', false, 'terminal')).toBeDefined()
  })
})

describe('inside VS Code (TERM_PROGRAM is vscode, the app is not Cursor) the diff opens in `code --diff`', () => {
  const VSCODE_ENV = { TERM_PROGRAM: 'vscode', __CFBundleIdentifier: 'com.microsoft.VSCode' }

  const press = async ($: Engine, on: Parameters<typeof world>[0], editor: { exitCode: number; stderr?: string }, env: Record<string, string> = VSCODE_ENV) => {
    const { w, pane } = await start($, on, 'terminal', { env, answer: repo({ before: 'old text\n', after: 'new text\n', editor }), columns: 96 })

    await openCard(pane, 0)
    await pane.press({ key: 'detail:change' })
    await settle(w.clock)

    return { w, pane }
  }

  test('the file before and after the commit go into one temp folder and `code --diff <before> <after>` is run; no Cursor command, and the board stays', async ($, on) => {
    const { w, pane } = await press($, on, { exitCode: 0 })
    const [before, after] = w.written

    expect(w.written).toHaveLength(2)
    expect(before?.path).toMatch(/^\/tmp\/plan-tracker-diff-[a-z0-9]+\/before\/board\.ts$/)
    expect([before?.text, after?.text]).toEqual(['old text\n', 'new text\n'])
    expect(editorRuns(w)).toEqual([['code', '--diff', before?.path, after?.path]])
    expect(await codes(pane)).toEqual([])
    expect(await pane.find({ key: 'field:deliverable' })).toBeDefined()
    await pane.unmount()
  })

  test('with TERM_PROGRAM=vscode and no bundle id at all it is still VS Code', async ($, on) => {
    const { w, pane } = await press($, on, { exitCode: 0 }, { TERM_PROGRAM: 'vscode' })

    expect(editorRuns(w).map(argv => argv[0])).toEqual(['code'])
    await pane.unmount()
  })

  test('`code` failing falls back to the page in the pane', async ($, on) => {
    const { w, pane } = await press($, on, { exitCode: 127, stderr: 'code: command not found' })

    expect(editorRuns(w)).toHaveLength(1)
    expect((await codes(pane)).map(one => one.source)).toEqual([HUNK])
    await pane.unmount()
  })

  test('Cursor is still Cursor: its bundle id runs the cursor command, never `code`', async ($, on) => {
    const { w, pane } = await press($, on, { exitCode: 0 }, CURSOR_ENV)

    expect(editorRuns(w).map(argv => argv[0])).toEqual(['cursor'])
    await pane.unmount()
  })
})
