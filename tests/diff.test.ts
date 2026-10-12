import { describe, expect, test } from './testing'

import { DIFF_HUNK_CHARS, DIFF_TOTAL_CHARS, COMMIT_WINDOW_MS, commitFor, commitsOf, deliverablesOf, diffTitleLines, diffViewOf, displayWidth, parseBoard } from '../hooks/board'
import type { Commit } from '../hooks/board'
import type { PlanEntry, PlanRow } from '../types'

const secs = (iso: string) => Date.parse(iso) / 1000

const commit = (sha: string, iso: string, subject = `subject of ${sha}`): Commit => ({ sha, time: secs(iso), subject })

describe('the commits git log prints', () => {
  test('one commit per line: the full sha, the commit time in seconds and the subject, newest first as git prints them', () => {
    const out = ['aaaa1111\t1760270000\tfix the board', 'bbbb2222\t1760260000\tadd a thing with\ttab in it', '', 'not a commit line'].join('\n')

    expect(commitsOf(out)).toEqual([
      { sha: 'aaaa1111', time: 1760270000, subject: 'fix the board' },
      { sha: 'bbbb2222', time: 1760260000, subject: 'add a thing with\ttab in it' },
    ])
    expect(commitsOf('')).toEqual([])
  })
})

describe('which commit a deliverable is about', () => {
  const STARTED = '2026-10-12T10:00:00+09:00'
  const UPDATED = '2026-10-12T12:00:00+09:00'
  const before = commit('before', '2026-10-12T09:00:00+09:00')
  const inside = commit('inside', '2026-10-12T11:00:00+09:00')
  const insideLater = commit('later', '2026-10-12T11:30:00+09:00')
  const grace = commit('grace', '2026-10-12T12:20:00+09:00')
  const after = commit('after', '2026-10-12T13:00:00+09:00')

  test('the newest commit after the row started and before its updated time plus 30 minutes', () => {
    expect(COMMIT_WINDOW_MS).toBe(30 * 60_000)
    expect(commitFor([after, insideLater, inside, before], { started: STARTED, updated: UPDATED })?.sha).toBe('later')
    // the 30 minutes after `updated` still count: a commit made after the status write
    expect(commitFor([after, grace, insideLater, before], { started: STARTED, updated: UPDATED })?.sha).toBe('grace')
  })

  test('the window\'s edges count: a commit made at `started` and one at `updated` + 30 minutes', () => {
    expect(commitFor([commit('edge', STARTED)], { started: STARTED, updated: UPDATED })?.sha).toBe('edge')
    expect(commitFor([commit('edge', '2026-10-12T12:30:00+09:00'), before], { started: STARTED, updated: UPDATED })?.sha).toBe('edge')
  })

  test('no commit in the window: the newest commit that touched the file', () => {
    expect(commitFor([after, before], { started: STARTED, updated: UPDATED })?.sha).toBe('after')
  })

  test('no times (a plain PROGRESS.md): the newest commit; only one of the two times bounds on its side', () => {
    expect(commitFor([after, inside, before], {})?.sha).toBe('after')
    expect(commitFor([after, inside, before], { updated: UPDATED })?.sha).toBe('inside')
    expect(commitFor([after, inside, before], { started: STARTED })?.sha).toBe('after')
    expect(commitFor([after, inside, before], { started: null, updated: null })?.sha).toBe('after')
  })

  test('several commits in the window show the newest; none at all is none', () => {
    expect(commitFor([insideLater, inside], { started: STARTED, updated: UPDATED })?.sha).toBe('later')
    expect(commitFor([], { started: STARTED, updated: UPDATED })).toBeUndefined()
  })

  test('changed_at (when the deliverable or change was written) bounds the window, not updated: a later status write does not reach later commits', () => {
    // row 76 of plan zany-herding-spring: started 22:44, checked and marked Done at 00:28; its own commit d7c487e at 23:13, row 79's at 23:53
    const started = '2026-10-12T22:44:00+09:00'
    const updated = '2026-10-13T00:28:00+09:00'
    const changed = '2026-10-12T23:20:00+09:00'
    const own = commit('d7c487e', '2026-10-12T23:13:00+09:00', 'row 76 work')
    const next = commit('0ca7b74', '2026-10-12T23:53:00+09:00', 'row 79 work')

    // before: the window ran to updated + 30 minutes and took the later task's commit
    expect(commitFor([next, own], { started, updated })?.sha).toBe('0ca7b74')
    // now: it ends 30 minutes after the change was written
    expect(commitFor([next, own], { started, updated, changed_at: changed })?.sha).toBe('d7c487e')
  })

  test('changed_at ends the window 30 minutes after it, edge included; with none in it the newest commit still shows', () => {
    const changed = '2026-10-12T12:00:00+09:00'

    expect(commitFor([commit('edge', '2026-10-12T12:30:00+09:00'), before], { started: STARTED, updated: '2026-10-14T00:00:00+09:00', changed_at: changed })?.sha).toBe('edge')
    expect(commitFor([commit('past', '2026-10-12T12:31:00+09:00'), before], { started: STARTED, updated: '2026-10-14T00:00:00+09:00', changed_at: changed })?.sha).toBe('past')
    expect(commitFor([after, inside], { changed_at: changed })?.sha).toBe('inside')
  })

  test('a row without changed_at keeps the rule: updated + 30 minutes', () => {
    expect(commitFor([after, grace, insideLater, before], { started: STARTED, updated: UPDATED, changed_at: null })?.sha).toBe('grace')
    expect(commitFor([after, grace, insideLater, before], { started: STARTED, updated: UPDATED, changed_at: undefined })?.sha).toBe('grace')
  })

  test('a deliverable carries the times of the first row that names it, changed_at included', () => {
    const named: PlanRow = { task: 'n', status: 'Done', updated: UPDATED, deliverable: 'z.ts', started: STARTED, changed_at: '2026-10-12T11:00:00+09:00' }
    const plain: PlanEntry = { anchor: 'a', name: 'A', goal: 'g', plan_file: '/plans/a.md', rows: [named] }

    expect(deliverablesOf(plain)[0]).toMatchObject({ path: 'z.ts', started: STARTED, updated: UPDATED, changed_at: '2026-10-12T11:00:00+09:00' })
  })

  test('the board data reads a row\'s changed_at as a time and drops null, empty or text that is not a time', () => {
    const row = (changed: unknown) => parseBoard(JSON.stringify({ plans: [{ anchor: 'a', rows: [{ task: 't', status: 'Done', changed_at: changed }] }] }))
    const read = (changed: unknown) => ('board' in row(changed) ? (row(changed) as { board: { plans: PlanEntry[] } }).board.plans[0]!.rows[0]! : undefined)

    expect(read('2026-10-12T23:20:00+09:00')?.changed_at).toBe('2026-10-12T23:20:00+09:00')
    expect(read(null)).not.toHaveProperty('changed_at')
    expect(read('')).not.toHaveProperty('changed_at')
    expect(read('not a time')).not.toHaveProperty('changed_at')
  })

  test('a deliverable carries the times of the first row that names it', () => {
    const row = (task: string, extra: Partial<PlanRow>): PlanRow => ({ task, status: 'Done', updated: null, ...extra })
    const plan: PlanEntry = {
      anchor: 'a',
      name: 'A',
      goal: 'g',
      plan_file: '/plans/a.md',
      rows: [
        row('first', { deliverable: 'x.ts', started: STARTED, updated: UPDATED }),
        row('second', { deliverable: 'x.ts', started: '2026-10-13T10:00:00+09:00', updated: '2026-10-13T12:00:00+09:00' }),
        row('no times', { deliverable: 'y.ts' }),
      ],
    }

    expect(deliverablesOf(plan)).toMatchObject([
      { path: 'x.ts', started: STARTED, updated: UPDATED },
      { path: 'y.ts' },
    ])
    expect(deliverablesOf(plan)[1]).not.toHaveProperty('started')
    expect(deliverablesOf(plan)[1]).not.toHaveProperty('updated')
  })
})

const HEAD = ['diff --git a/hooks/board.ts b/hooks/board.ts', 'index 1111111..2222222 100644', '--- a/hooks/board.ts', '+++ b/hooks/board.ts']

const SMALL = [
  ...HEAD,
  '@@ -1,3 +1,4 @@',
  ' line one',
  '-line two',
  '+line two changed',
  '+line three added',
  ' line four',
  '@@ -20,2 +21,2 @@ function x() {',
  ' context',
  '-old',
  '+new',
  '',
].join('\n')

/** A hunk of `count` added lines of `width` characters each, as git prints a new file. */
const added = (count: number, width = 40, first = 1) => [
  `@@ -0,0 +${first},${count} @@`,
  ...Array.from({ length: count }, (_, at) => `+${String(at).padStart(width - 1, 'x')}`),
]

const TITLE = 'hooks/board.ts · 3b26241 · fix the board'

/** A hunk's lines past its `@@` header. */
const bodyOf = (source: string) => source.split('\n').slice(1)

describe('the diff the pane draws', () => {
  test('one source per hunk of the file, each starting at its @@ line; git\'s file header is left out', () => {
    const view = diffViewOf(SMALL, TITLE)

    expect(view.title).toBe(TITLE)
    expect(view.hunks).toEqual([
      ['@@ -1,3 +1,4 @@', ' line one', '-line two', '+line two changed', '+line three added', ' line four'].join('\n'),
      ['@@ -20,2 +21,2 @@ function x() {', ' context', '-old', '+new'].join('\n'),
    ])
    expect(view).not.toHaveProperty('note')
  })

  test('a no-newline marker stays with its hunk; control characters other than tab and newline are cleaned; CRLF line ends are dropped', () => {
    const raw = [...HEAD, '@@ -1,2 +1,2 @@', ' keep\r', '-old\u0007bell', '+new\ttabbed', '\\ No newline at end of file', ''].join('\n')

    expect(diffViewOf(raw, TITLE).hunks).toEqual([['@@ -1,2 +1,2 @@', ' keep', '-old�bell', '+new\ttabbed', '\\ No newline at end of file'].join('\n')])
  })

  test('a commit with no hunks (binary, rename or mode only) is one plain line saying so', () => {
    for (const raw of [`${HEAD.slice(0, 2).join('\n')}\nBinary files a/x.png and b/x.png differ\n`, 'diff --git a/a.ts b/b.ts\nsimilarity index 100%\nrename from a.ts\nrename to b.ts\n', 'diff --git a/x.sh b/x.sh\nold mode 100644\nnew mode 100755\n', '']) {
      const view = diffViewOf(raw, TITLE)

      expect(view.hunks).toEqual([])
      expect(view.note).toBe('No text changes to show (binary file, rename or mode change only)')
    }
  })

  test('a hunk over 10000 characters is split into hunks of their own, each valid, none over the limit, and no line lost', () => {
    const lines = added(600)
    const raw = [...HEAD, ...lines, ''].join('\n')
    const view = diffViewOf(raw, TITLE)

    expect(DIFF_HUNK_CHARS).toBe(10_000)
    expect(view.hunks.length).toBeGreaterThan(1)
    expect(view.hunks.every(source => source.length <= DIFF_HUNK_CHARS)).toBe(true)
    expect(view.hunks.every(source => /^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/.test(source))).toBe(true)
    expect(view.hunks.flatMap(bodyOf)).toEqual(lines.slice(1))
    expect(view).not.toHaveProperty('note')

    // every header's counts match its own lines, and the new-side starts follow one another
    let next = 1

    for (const source of view.hunks) {
      const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(source) as RegExpExecArray
      const body = bodyOf(source)

      expect(Number(header[4])).toBe(body.filter(line => line.startsWith('+') || line.startsWith(' ')).length)
      expect(Number(header[2])).toBe(body.filter(line => line.startsWith('-') || line.startsWith(' ')).length)
      expect(Number(header[3])).toBe(next)
      next += body.length
    }
  })

  test('a line that alone is over the limit is cut so its hunk fits', () => {
    const raw = [...HEAD, '@@ -0,0 +1,2 @@', `+${'y'.repeat(30_000)}`, '+short', ''].join('\n')
    const view = diffViewOf(raw, TITLE)

    expect(view.hunks.every(source => source.length <= DIFF_HUNK_CHARS)).toBe(true)
    expect(view.hunks.flatMap(bodyOf).at(-1)).toBe('+short')
  })

  test('after 60000 characters in all the rest is not shown, and a line says how many lines that is', () => {
    const lines = added(3000)
    const view = diffViewOf([...HEAD, ...lines, ''].join('\n'), TITLE)
    const shown = view.hunks.reduce((all, source) => all + source.length, 0)
    const shownLines = view.hunks.flatMap(bodyOf).length

    expect(DIFF_TOTAL_CHARS).toBe(60_000)
    expect(shown).toBeLessThanOrEqual(DIFF_TOTAL_CHARS)
    expect(shown).toBeGreaterThan(DIFF_TOTAL_CHARS - DIFF_HUNK_CHARS)
    expect(view.note).toBe(`Rest of the diff not shown (${3000 - shownLines} more lines)`)
    expect(view.hunks.flatMap(bodyOf)).toEqual(lines.slice(1, 1 + shownLines))
  })

  test('hunks past the 60000 characters count their lines too', () => {
    const first = added(1600)
    const second = ['@@ -50,2 +1500,2 @@', ' a', '-b', '+c']
    const view = diffViewOf([...HEAD, ...first, ...second, ''].join('\n'), TITLE)
    const shownLines = view.hunks.flatMap(bodyOf).length

    expect(view.note).toBe(`Rest of the diff not shown (${1600 + 3 - shownLines} more lines)`)
  })
})

describe('the title of the diff page', () => {
  const HEAD = 'mods/plan-tracker/hooks/board.ts · a7019c7'
  const LONG = 'plan-tracker 0.5.34: every lane lists its latest updated task first (Todo, In Progress, Verify; Done as before); the groups stay and each is sorted inside'

  test('the subject shares the line with the path and sha, cut with … to the room that is left; the path and sha stay whole', () => {
    const [line, ...more] = diffTitleLines(HEAD, LONG, 60)

    expect(more).toEqual([])
    expect(displayWidth(line as string)).toBeLessThanOrEqual(60)
    expect(line).toStartWith(`${HEAD} · plan-tracker`)
    expect(line).toEndWith('…')
  })

  test('a subject that fits is whole, and a wide pane shows it all', () => {
    expect(diffTitleLines(HEAD, 'fix the board', 60)).toEqual([`${HEAD} · fix the board`])
    expect(diffTitleLines(HEAD, LONG, 400)).toEqual([`${HEAD} · ${LONG}`])
  })

  test('with little room left the subject takes a line of its own, cut to the width; the path and sha are not cut', () => {
    const lines = diffTitleLines(HEAD, LONG, 44)

    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe(HEAD)
    expect(displayWidth(lines[1] as string)).toBeLessThanOrEqual(44)
    expect(lines[1]).toEndWith('…')
    // a pane narrower than the path and sha: they stay whole (the Text wraps them), the subject is one cut line
    const narrow = diffTitleLines(HEAD, LONG, 20)

    expect(narrow[0]).toBe(HEAD)
    expect(narrow).toHaveLength(2)
    expect(displayWidth(narrow[1] as string)).toBeLessThanOrEqual(20)
  })

  test('no subject: the path and sha alone; a CJK subject is cut by width', () => {
    expect(diffTitleLines(HEAD, '', 60)).toEqual([HEAD])

    const [line] = diffTitleLines(HEAD, '让每个计划都能按名字找到而不是靠编码这样一眼就能分清它们各自是做什么的', 60)

    expect(displayWidth(line as string)).toBeLessThanOrEqual(60)
    expect(line).toEndWith('…')
  })
})
