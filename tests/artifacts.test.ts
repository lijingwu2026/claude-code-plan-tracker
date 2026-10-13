import { describe, expect, test } from './testing'
import type { Engine } from 'claude-code/testing'

import * as board from '../hooks/board'
import { displayWidth } from '../hooks/board'
import { actionFor } from '../hooks/register'
import type { PlanBoard, PlanEntry, PlanRow, PlanStatus } from '../types'
import type { Node } from './fixtures'
import { BOARD, HOME, PANE_ID, ROOT, SESSION, kids, openCard, paneProps, textOf, world } from './fixtures'

const mountPane = ($: Engine, surface: 'terminal' | 'desktop', columns = 160) =>
  $.ui.mount({
    plugin: 'plan-tracker',
    surface,
    component: 'Pane',
    requestId: PANE_ID,
    props: paneProps(columns),
    viewport: { columns: columns + 60, rows: 50, isFullscreen: true },
  })

/** A row that records an artifact as the tracker writes it: a markdown link, and the note beside it. */
const art = (task: string, title: string, target: string, note?: string, status: PlanStatus = 'Done', extra: Partial<PlanRow> = {}): PlanRow => ({
  task,
  status,
  updated: null,
  artifact: `[${title}](${target})`,
  ...(note === undefined ? {} : { artifact_note: note }),
  ...extra,
})

const boardOf = (...rows: PlanRow[]): PlanBoard => ({ ...BOARD, plans: [{ ...BOARD.plans[0]!, rows }] })

const WEB = 'https://claude.ai/artifact/abc123'
const WEB_NOTE = 'one-screen mock of the new table'
const LOCAL = '/home/tester/code/deck/index.html'
const LOCAL_HREF = 'file:///home/tester/code/deck/index.html'

const TWO = boardOf(art('a1', 'Plan board preview', WEB, WEB_NOTE), art('a2', 'Q3 review deck', LOCAL, 'slides for the review'))

/** Lets what a press started without being awaited (the `open` of an artifact) finish. */
const settle = async (clock: { advance: (ms: number) => Promise<void> }) => {
  for (let at = 0; at < 20; at += 1) {
    await clock.advance(10)
  }
}

const opens = (w: ReturnType<typeof world>) => w.logRuns.filter(run => run.argv[0] === 'open').map(run => run.argv)

const flat = (node: unknown) => textOf(node).replace(/\s+/g, ' ').trim()

const isDim = (node: Node | undefined): boolean => node?.props?.dimColor === true || kids(node).some(isDim)

describe('an artifact link as the tracker writes it', () => {
  test('a title and an https URL, or a title and a local path (absolute, ~/ or relative to the project root, spaces allowed)', () => {
    expect(board.parseArtifact(`[Plan board preview](${WEB})`)).toEqual({ title: 'Plan board preview', target: WEB })
    expect(board.parseArtifact('[Deck](/private/tmp/x/index.html)')).toEqual({ title: 'Deck', target: '/private/tmp/x/index.html' })
    expect(board.parseArtifact('[Deck](~/x.html)')).toEqual({ title: 'Deck', target: '~/x.html' })
    expect(board.parseArtifact('[Deck](knowledge/x.html)')).toEqual({ title: 'Deck', target: 'knowledge/x.html' })
    expect(board.parseArtifact('[Deck](/Users/a b/c.html)')).toEqual({ title: 'Deck', target: '/Users/a b/c.html' })
    expect(board.parseArtifact('  [产品 看板](https://claude.ai/artifact/x)  ')).toEqual({ title: '产品 看板', target: 'https://claude.ai/artifact/x' })
  })

  const MALFORMED: [string, string][] = [
    ['empty', ''],
    ['no link syntax', 'Plan board preview'],
    ['a bare URL', WEB],
    ['an empty title', `[](${WEB})`],
    ['an empty target', '[T]()'],
    ['http, not https', '[T](http://claude.ai/artifact/x)'],
    ['a script', '[T](javascript:alert(1))'],
    ['another scheme', '[T](ftp://host/x.html)'],
    ['a file: URL', '[T](file:///etc/x.html)'],
    ['an https URL with a space', '[T](https://claude.ai/a b)'],
  ]

  for (const [name, text] of MALFORMED) {
    test(`malformed, ignored: ${name}`, () => {
      expect(board.parseArtifact(text)).toBeUndefined()
    })
  }

  test('only an https target is the surface\'s to open', () => {
    expect(board.isWebTarget(WEB)).toBe(true)
    expect(board.isWebTarget('HTTPS://claude.ai/x')).toBe(true)
    expect(board.isWebTarget('/private/tmp/x.html')).toBe(false)
    expect(board.isWebTarget('~/x.html')).toBe(false)
  })

  test('the href of a web target is itself; of a local one the file: link of its absolute path', () => {
    expect(board.artifactHref({ title: 'T', target: WEB }, HOME)).toBe(WEB)
    expect(board.artifactHref({ title: 'T', target: LOCAL }, HOME)).toBe(LOCAL_HREF)
    expect(board.artifactHref({ title: 'T', target: '~/x y.html' }, HOME)).toBe('file:///home/tester/x%20y.html')
    expect(board.artifactHref({ title: 'T', target: '~/x.html' }, undefined)).toBeNull()
  })
})

describe('parseBoard keeps an artifact and its note', () => {
  const parse = (rows: object[]) => {
    const parsed = board.parseBoard(JSON.stringify({ selected: null, message: null, plans: [{ anchor: 'x', rows }] }))

    return 'board' in parsed ? parsed.board.plans[0]!.rows : []
  }

  test('both fields are read as written', () => {
    const [one] = parse([{ task: 't', status: 'Done', artifact: `[Plan board preview](${WEB})`, artifact_note: WEB_NOTE }])

    expect(one).toMatchObject({ artifact: `[Plan board preview](${WEB})`, artifact_note: WEB_NOTE })
  })

  test('a title and a path with `_`, `*` and backticks come through as written', () => {
    const text = '[my_plan *v2* `draft`](docs/my_plan_v2.html)'
    const [one] = parse([{ task: 't', status: 'Done', artifact: text, artifact_note: 'plan_tracker *board*' }])

    expect(one).toMatchObject({ artifact: text, artifact_note: 'plan_tracker *board*' })
  })

  test('a malformed artifact is dropped, a null one too; the row stays', () => {
    const rows = parse([
      { task: 'a', status: 'Done', artifact: 'not a link', artifact_note: 'x' },
      { task: 'b', status: 'Done', artifact: '[T](javascript:alert(1))' },
      { task: 'c', status: 'Done', artifact: null, artifact_note: null },
      { task: 'd', status: 'Done', artifact: 42 },
    ])

    expect(rows.map(one => one.task)).toEqual(['a', 'b', 'c', 'd'])
    expect(rows.map(one => 'artifact' in one)).toEqual([false, false, false, false])
    expect(rows.map(one => 'artifact_note' in one)).toEqual([true, false, false, false])
  })
})

describe('the board file: artifact and artifact_note columns', () => {
  const FILE = `${ROOT}/PROGRESS.md`
  const FILE_MODE = { options: { board_command: '', usage_command: '', your_name: '' } }
  const TITLE = 'my_plan *v2* `draft`'
  const PATH = 'docs/my_plan_v2_*final*.html'
  const ARTIFACT = `[${TITLE}](${PATH})`
  const NOTE = 'the plan_tracker board, one screen: *no* `raw` URL'

  const planOf = (text: string): PlanEntry => {
    const parsed = board.parseProgress(text, FILE, 'proj')

    if (!('board' in parsed)) {
      throw new Error(parsed.error)
    }

    return parsed.board.plans[0]!
  }

  const FILE_TEXT = `# Progress\n\n| task | status | artifact | artifact_note |\n|---|---|---|---|\n| one | Done | ${ARTIFACT} | ${NOTE} |\n| two | Todo | | |\n`

  test('both cells are read as written: `_`, `*` and backticks in the title and the path survive', () => {
    const [one, two] = planOf(FILE_TEXT).rows

    expect(one).toMatchObject({ artifact: ARTIFACT, artifact_note: NOTE })
    expect(board.parseArtifact(one?.artifact ?? '')).toEqual({ title: TITLE, target: PATH })
    expect(two && 'artifact' in two).toBe(false)
    expect(two && 'artifact_note' in two).toBe(false)
  })

  test('the columns are found by header, in any order and any case; an https artifact is read too', () => {
    const [one] = planOf(`| ARTIFACT_NOTE | Status | Artifact | Task |\n|---|---|---|---|\n| why | Done | [Deck](${WEB}) | build |\n`).rows

    expect(one).toMatchObject({ task: 'build', artifact: `[Deck](${WEB})`, artifact_note: 'why' })
  })

  test('a cell that is not a title and a target is dropped, the row and its note stay', () => {
    const rows = planOf(`| task | status | artifact | artifact_note |\n|---|---|---|---|\n| a | Done | not a link | n1 |\n| b | Done | [T](javascript:alert(1)) | n2 |\n| c | Done | [T](http://claude.ai/x) | n3 |\n`).rows

    expect(rows.map(one => one.task)).toEqual(['a', 'b', 'c'])
    expect(rows.map(one => 'artifact' in one)).toEqual([false, false, false])
    expect(rows.map(one => one.artifact_note)).toEqual(['n1', 'n2', 'n3'])
  })

  test('no artifact column: no artifact on any row', () => {
    const rows = planOf('| task | status |\n|---|---|\n| a | Done |\n').rows

    expect(rows.every(one => !('artifact' in one) && !('artifact_note' in one))).toBe(true)
  })

  test('the status cell is still read without emphasis: the raw cell is for the artifact only', () => {
    const [one] = planOf(`| task | status | artifact |\n|---|---|---|\n| a | **Done** | ${ARTIFACT} |\n`).rows

    expect(one).toMatchObject({ status: 'Done', artifact: ARTIFACT })
  })

  test('desktop: the table and the task page carry the title and the path with their `_`, `*` and backticks, escaped for Markdown', FILE_MODE, async ($, on) => {
    world(on, { surfaces: ['desktop'], files: { [FILE]: FILE_TEXT } })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 160)
    const href = `file://${ROOT}/${PATH.split('/').map(encodeURIComponent).join('/')}`

    expect((await pane.find({ type: 'Markdown', key: 'artifact:0' }))?.props.text).toBe(
      `[my\\_plan \\*v2\\* \\\`draft\\\`](${href})`,
    )
    expect(textOf(await pane.find({ key: 'deliverables' }))).toContain(NOTE)
    await pane.unmount()
  })

  test('terminal: the link keeps the title as written and points at the file under the project root', FILE_MODE, async ($, on) => {
    world(on, { surfaces: ['terminal'], files: { [FILE]: FILE_TEXT } })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 160)
    const href = `file://${ROOT}/${PATH.split('/').map(encodeURIComponent).join('/')}`

    expect((await pane.findAll({ type: 'Link' })).map(node => [node.props.label, node.props.href])).toEqual([[TITLE, href]])
    await pane.unmount()
  })

  test('a press on the local artifact opens the path as written, `_` and all', FILE_MODE, async ($, on) => {
    const path = `${ROOT}/docs/my_plan_v2.html`
    const w = world(on, {
      surfaces: ['desktop'],
      files: { [FILE]: '| task | status | artifact |\n|---|---|---|\n| a | Done | [my_plan](docs/my_plan_v2.html) |\n' },
      present: [path],
    })

    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 160)

    await pane.press({ key: 'artifact:0', link: { href: `file://${path}` } })
    await settle(w.clock)

    expect(opens(w)).toEqual([['open', path]])
    await pane.unmount()
  })
})

describe('artifactsOf', () => {
  const plan = (...rows: PlanRow[]): PlanEntry => boardOf(...rows).plans[0]!

  test('the plan\'s artifacts in row order, with the title, the target, the note and the first task that names each', () => {
    expect(board.artifactsOf(plan(art('a1', 'One', WEB, 'first'), { task: 'plain', status: 'Done', updated: null }, art('a2', 'Two', LOCAL)))).toEqual([
      { title: 'One', target: WEB, task: 'a1', note: 'first' },
      { title: 'Two', target: LOCAL, task: 'a2' },
    ])
  })

  test('rows that name the same target are one artifact: the first live row\'s title and note', () => {
    expect(board.artifactsOf(plan(art('a1', 'One', WEB, 'first'), art('a2', 'Other title', WEB, 'second'), art('a3', 'Two', LOCAL)))).toEqual([
      { title: 'One', target: WEB, task: 'a1', note: 'first' },
      { title: 'Two', target: LOCAL, task: 'a3' },
    ])
  })

  test('a Canceled row names none; a target a live row shares still shows, with that row\'s title', () => {
    expect(
      board.artifactsOf(plan(art('dropped', 'Dropped', '/tmp/dropped.html', 'x', 'Canceled'), art('gone', 'Gone', WEB, 'gone note', 'Canceled'), art('kept', 'Kept', WEB, 'kept note'))),
    ).toEqual([{ title: 'Kept', target: WEB, task: 'kept', note: 'kept note' }])
  })

  test('none recorded: an empty list', () => {
    expect(board.artifactsOf(BOARD.plans[1] as PlanEntry)).toEqual([])
  })
})

/** A row that names a file as its deliverable, with the change written beside it. */
const FILE_ROW: PlanRow = { task: 'f1', status: 'Done', updated: null, deliverable: 'automation/plans/x.md', change: 'adds the thing' }

const WITH_FILE = boardOf(art('a1', 'Plan board preview', WEB, WEB_NOTE), art('a2', 'Q3 review deck', LOCAL, 'slides for the review'), FILE_ROW)

/** Rows of the table (below its title and header): the Text lines of the terminal, the Boxes of the desktop. */
const entriesOf = async (pane: Awaited<ReturnType<typeof mountPane>>, header = 1) => kids(await pane.find({ key: 'deliverables' })).slice(1 + header)

describe('the Deliverables table lists the artifacts first, on the terminal', () => {
  test('160 columns: one table, the artifacts first (the type `artifact` on the first), the title as a link (never the URL), the note under SUMMARY; then the files', async ($, on) => {
    world(on, { fixture: WITH_FILE })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 160)
    const section = await pane.find({ key: 'deliverables' })
    const [title, header, one, two, three] = kids(section)

    expect(textOf(title)).toBe('Deliverables')
    expect(textOf(header).trimEnd()).toMatch(/^TYPE\s+DELIVERABLE\s+SUMMARY$/)
    expect(header?.props.dimColor).toBe(true)
    expect(flat(one)).toBe(`artifact Plan board preview ${WEB_NOTE}`)
    expect(flat(two)).toBe('Q3 review deck slides for the review')
    expect(flat(three)).toBe('.md automation/plans/x.md adds the thing')
    expect(kids(section)).toHaveLength(5)
    expect(textOf(section)).not.toContain('claude.ai')
    expect(textOf(section)).not.toContain('/home/tester')
    expect(textOf(section)).not.toMatch(/[─│]/)
    expect(one?.type).toBe('Text')

    const links = (await pane.findAll({ type: 'Link' })).map(node => [node.props.label, node.props.href])

    expect(links.slice(0, 2)).toEqual([
      ['Plan board preview', WEB],
      ['Q3 review deck', LOCAL_HREF],
    ])
    // a file path is plain coloured text on the terminal (a terminal without OSC 8 would draw a Link as the path and then the URL): only the artifacts' titles are Links
    expect(links).toHaveLength(2)
    // the note is the dim part of the line, the title is not
    expect(kids(one).some(node => node.props?.dimColor === true && textOf(node).includes(WEB_NOTE))).toBe(true)
    expect(kids(one).some(node => node.props?.dimColor !== true && textOf(node).includes('Plan board preview'))).toBe(true)
    await pane.unmount()
  })

  test('an artifact has no Diff: the terminal table is plain text for every row', async ($, on) => {
    world(on, { fixture: WITH_FILE })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 160)

    expect(textOf(await pane.find({ key: 'deliverables' }))).not.toContain('Diff')
    expect(await pane.find({ key: 'diff:0' })).toBeUndefined()
    await pane.unmount()
  })

  test('a row with no note shows a dim "—"', async ($, on) => {
    world(on, { fixture: boardOf(art('a1', 'Plan board preview', WEB)) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 160)
    const [one] = await entriesOf(pane)

    expect(flat(one)).toBe('artifact Plan board preview —')
    expect(kids(one).some(node => node.props?.dimColor === true && textOf(node).includes('—'))).toBe(true)
    await pane.unmount()
  })

  test('there is no table of artifacts of its own: one Deliverables table, below the lanes', async ($, on) => {
    world(on, { fixture: WITH_FILE })
    await $.session.start(SESSION)

    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await mountPane($, surface, 160)
      const keys = kids(await pane.drawn()).map(node => String(node.props?.key ?? node.type))

      expect(keys.indexOf('deliverables')).toBeGreaterThan(keys.indexOf('kanban'))
      expect(keys).not.toContain('artifacts')
      expect(textOf(await pane.drawn())).not.toContain('Artifacts')
      await pane.unmount()
    }
  })

  test('with none recorded there is no artifact entry: no `artifact` type in the table', async ($, on) => {
    world(on)
    await $.session.start(SESSION)

    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await mountPane($, surface, 160)

      expect(await pane.find({ key: 'deliverables' })).toBeDefined()
      expect(textOf(await pane.find({ key: 'deliverables' }))).not.toContain('artifact')
      await pane.unmount()
    }
  })

  test('~30 columns: each entry is a block, the title then its note dim and wrapped under it; no column header; no line wider than the pane', async ($, on) => {
    const NOTE = 'one-screen mock of the new table with its fold and its stacked layout'
    world(on, { fixture: boardOf(art('a1', 'Plan board preview', WEB, NOTE), art('a2', 'Q3 review deck', LOCAL)) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 30)
    const section = await pane.find({ key: 'deliverables' })
    const [title, first, second] = kids(section)

    expect(textOf(title)).toBe('Deliverables')
    expect(textOf(section)).not.toMatch(/TYPE|DELIVERABLE |SUMMARY/)
    expect(String(first?.props.key)).toBe('artifact:0:item')

    const [head, ...under] = kids(first)

    expect(flat(head)).toBe('artifact Plan board preview')
    expect(under.length).toBeGreaterThan(1)
    expect(under.map(line => textOf(line).trim()).join(' ')).toBe(NOTE)
    expect(under.every(isDim)).toBe(true)
    // a row with no note is its title alone
    expect(kids(second).map(line => flat(line))).toEqual(['Q3 review deck'])

    for (const line of kids(section).flatMap(block => (block.type === 'Box' ? kids(block) : [block]))) {
      expect(displayWidth(textOf(line))).toBeLessThanOrEqual(30)
    }

    expect(textOf(section)).not.toContain('claude.ai')
    await pane.unmount()
  })

  test('a CJK title and note keep within the width in both layouts', async ($, on) => {
    world(on, { fixture: boardOf(art('a1', '看板预览页面的第一个版本', WEB, '一屏之内看到新的产物表格和它的折叠行为，窄屏时上下排')) })
    await $.session.start(SESSION)

    for (const columns of [40, 60, 160]) {
      const pane = await mountPane($, 'terminal', columns)
      const section = await pane.find({ key: 'deliverables' })

      for (const line of kids(section).flatMap(block => (block.type === 'Box' ? kids(block) : [block]))) {
        expect(displayWidth(textOf(line))).toBeLessThanOrEqual(columns)
      }

      await pane.unmount()
    }
  })

  test('a Canceled row names none and two rows with one target are one line', async ($, on) => {
    world(
      on,
      {
        fixture: boardOf(
          art('gone', 'Gone', '/home/tester/gone.html', 'x', 'Canceled'),
          art('a1', 'Plan board preview', WEB, WEB_NOTE),
          art('a2', 'Plan board preview again', WEB, 'later row'),
        ),
      },
    )
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 160)

    expect((await entriesOf(pane)).map(flat)).toEqual([`artifact Plan board preview ${WEB_NOTE}`])
    await pane.unmount()
  })
})

describe('the Deliverables table lists the artifacts first, on the desktop', () => {
  test('160 columns: a blank-headed Diff column; an artifact row is a title Markdown link (the title, not the URL), an empty Diff cell and the dim note', async ($, on) => {
    world(on, { fixture: WITH_FILE })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 160)
    const section = await pane.find({ key: 'deliverables' })
    const [title, header, one, two, three] = kids(section)

    expect(textOf(title)).toBe('Deliverables')
    expect(kids(header).map(textOf)).toEqual(['TYPE', 'DELIVERABLE', '', 'SUMMARY'])
    expect(String(one?.props.key)).toBe('artifact:0:item')
    expect(one?.props.flexDirection).toBe('row')

    const [typeCell, titleCell, diffCell, noteCell] = kids(one)

    expect(textOf(typeCell)).toBe(' artifact ')
    expect(kids(titleCell)[0]).toMatchObject({ type: 'Markdown', props: { key: 'artifact:0', text: `[Plan board preview](${WEB})` } })
    // no Diff for an artifact: the cell is there, empty, so the cells of the other rows line up
    expect(kids(diffCell)).toEqual([])
    expect(diffCell?.props.width).toBe(kids(header)[2]?.props.width)
    expect(textOf(noteCell)).toBe(WEB_NOTE)
    expect(isDim(kids(noteCell)[0])).toBe(true)
    // the type is on the first row of its group only
    expect(textOf(kids(two)[0])).toBe('')
    expect(kids(kids(two)[1])[0]?.props.text).toBe(`[Q3 review deck](${LOCAL_HREF})`)
    expect(String(three?.props.key)).toBe('deliverable:0:item')
    expect(textOf(kids(three)[0])).toBe(' .md ')
    expect(textOf(kids(three)[2])).toBe('Diff')
    expect(await pane.find({ type: 'Link' })).toBeUndefined()
    await pane.unmount()
  })

  test('~40 columns: stacked, the title link in its row, the note dim under it; no header', async ($, on) => {
    world(on, { fixture: TWO })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 40)
    const section = await pane.find({ key: 'deliverables' })
    const [title, one, two] = kids(section)

    expect(textOf(title)).toBe('Deliverables')
    expect(textOf(section)).not.toMatch(/SUMMARY/)
    expect(String(one?.props.key)).toBe('artifact:0:item')
    expect(one?.props.flexDirection).toBe('column')

    const [pathRow, note] = kids(one)

    expect(kids(kids(pathRow)[1])[0]).toMatchObject({ type: 'Markdown', props: { key: 'artifact:0', text: `[Plan board preview](${WEB})` } })
    expect(textOf(note)).toBe(WEB_NOTE)
    expect(isDim(note)).toBe(true)
    expect(kids(two)).toHaveLength(2)
    await pane.unmount()
  })

  test('markdown characters in a title are escaped and parentheses in the href are encoded', async ($, on) => {
    world(on, { fixture: boardOf(art('a1', 'a_b [1] *x*', 'https://claude.ai/artifact/a_(1)', 'n')) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 160)

    expect((await pane.find({ type: 'Markdown', key: 'artifact:0' }))?.props.text).toBe('[a\\_b \\[1\\] \\*x\\*](https://claude.ai/artifact/a_%281%29)')
    await pane.unmount()
  })

  test('the Diff numbers count the files: diff:0 is the first file with the artifacts above it, and an artifact row has none', async ($, on) => {
    world(on, { fixture: WITH_FILE })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 160)

    expect(await pane.find({ key: 'diff:0' })).toMatchObject({ type: 'Button' })
    expect(await pane.find({ key: 'diff:1' })).toBeUndefined()
    expect(kids(await pane.find({ key: 'deliverable:0:item' })).map(cell => String(cell.props.key ?? cell.type))).toContain('deliverable:0:diff')
    expect(board.deliverableGroups(WITH_FILE.plans[0]!).flatMap(group => group.items.map(item => item.path))).toEqual(['automation/plans/x.md'])
    await pane.unmount()
  })
})

describe('a web link that is an artifact and a deliverable shows once, as the artifact', () => {
  const plan = (...rows: PlanRow[]): PlanEntry => boardOf(...rows).plans[0]!
  const BOTH = [art('a1', 'Plan board preview', WEB, WEB_NOTE, 'Done', { deliverable: WEB, change: 'a change nobody sees' }), { task: 'b', status: 'Done' as const, updated: null, deliverable: WEB }]

  test('the data: the deliverables leave the link out, the table lists it as an artifact', () => {
    expect(board.deliverablesOf(plan(...BOTH))).toEqual([])
    expect(board.tableGroupsOf(plan(...BOTH)).map(group => [group.type, group.items.map(item => item.path)])).toEqual([['artifact', [WEB]]])
  })

  test('a different link, or the same one in a Canceled artifact row, stays a deliverable', () => {
    expect(board.deliverablesOf(plan(art('a1', 'One', WEB, 'n', 'Done', { deliverable: 'https://example.com/other' }))).map(item => item.path)).toEqual(['https://example.com/other'])
    expect(board.deliverablesOf(plan(art('gone', 'Gone', WEB, 'n', 'Canceled'), { task: 'b', status: 'Done', updated: null, deliverable: WEB })).map(item => item.path)).toEqual([WEB])
  })

  test('terminal: one entry in the table, the artifact: no `link` entry for the same URL, no change text of the deliverable', async ($, on) => {
    world(on, { fixture: boardOf(...BOTH) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 160)
    const section = await pane.find({ key: 'deliverables' })
    const entries = await entriesOf(pane)

    expect(entries.map(flat)).toEqual([`artifact Plan board preview ${WEB_NOTE}`])
    expect(textOf(section)).not.toContain('a change nobody sees')
    expect(textOf(section)).not.toContain('claude.ai')
    await pane.unmount()
  })

  test('desktop: one entry in the table, the artifact (artifact:0), and no deliverable:0 for the same URL', async ($, on) => {
    world(on, { fixture: boardOf(...BOTH) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 160)
    const entries = await entriesOf(pane)

    expect(entries.map(node => String(node.props.key))).toEqual(['artifact:0:item'])
    expect(await pane.find({ type: 'Markdown', key: 'artifact:0' })).toBeDefined()
    expect(await pane.find({ key: 'deliverable:0' })).toBeUndefined()
    expect(await pane.find({ key: 'diff:0' })).toBeUndefined()
    expect(textOf(await pane.find({ key: 'deliverables' }))).not.toContain('a change nobody sees')
    await pane.unmount()
  })

  test('a Canceled artifact row leaves the URL a deliverable of its own: a `link` entry, no artifact', async ($, on) => {
    world(on, { fixture: boardOf(art('gone', 'Gone', WEB, 'n', 'Canceled'), { task: 'b', status: 'Done', updated: null, deliverable: WEB }) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 160)
    const [one] = await entriesOf(pane)

    expect(await entriesOf(pane)).toHaveLength(1)
    expect(flat(one)).toBe(`link ${WEB} —`)
    await pane.unmount()
  })
})

describe('the Deliverables table folds after five rows, the artifacts counted with the files', () => {
  const file = (at: number): PlanRow => ({ task: `file ${at}`, status: 'Done', updated: null, deliverable: `docs/d${at}.md` })
  const artifact = (at: number): PlanRow => art(`task ${at}`, `Artifact ${at}`, `https://claude.ai/artifact/n${at}`, `note ${at}`)
  /** `artifacts` artifacts, then `files` files. */
  const mixed = (artifacts: number, files: number) => boardOf(...Array.from({ length: artifacts }, (_, at) => artifact(at)), ...Array.from({ length: files }, (_, at) => file(at)))

  const shownIn = (text: string, artifacts: number, files: number) =>
    [...Array.from({ length: artifacts }, (_, at) => `Artifact ${at}`), ...Array.from({ length: files }, (_, at) => `docs/d${at}.md`)].filter(name => text.includes(name))

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${surface}: 4 artifacts and 4 files show 5 (the 4 artifacts, then the first file), then a pressable "+3 more ▾"; pressing shows all 8 and "Show less ▴"; pressing again folds`, async ($, on) => {
      world(on, { fixture: mixed(4, 4) })
      await $.session.start(SESSION)
      const pane = await mountPane($, surface, 160)
      const text = async () => textOf(await pane.find({ key: 'deliverables' }))
      const more = async () => String((await pane.find({ key: 'lane:Deliverables:more' }))?.props.label)

      expect(shownIn(await text(), 4, 4)).toEqual(['Artifact 0', 'Artifact 1', 'Artifact 2', 'Artifact 3', 'docs/d0.md'])
      expect(await more()).toBe('+3 more ▾')

      await pane.press({ key: 'lane:Deliverables:more' })
      expect(shownIn(await text(), 4, 4)).toHaveLength(8)
      expect(await more()).toBe('Show less ▴')

      await pane.press({ key: 'lane:Deliverables:more' })
      expect(shownIn(await text(), 4, 4)).toHaveLength(5)
      expect(await more()).toBe('+3 more ▾')
      await pane.unmount()
    })
  }

  test('the count is the combined list: 6 artifacts and 6 files hide 7', async ($, on) => {
    world(on, { fixture: mixed(6, 6) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 160)

    expect(await pane.find({ key: 'lane:Deliverables:more' })).toMatchObject({ props: { label: '+7 more ▾' } })
    await pane.unmount()
  })

  test('five or fewer together: no overflow button', async ($, on) => {
    world(on, { fixture: mixed(3, 2) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 160)

    expect(shownIn(textOf(await pane.find({ key: 'deliverables' })), 3, 2)).toHaveLength(5)
    expect(await pane.find({ key: 'lane:Deliverables:more' })).toBeUndefined()
    expect(await pane.find({ key: 'lane:Artifacts:more' })).toBeUndefined()
    await pane.unmount()
  })

  test('the keys of a desktop row count from the first artifact and from the first file, whether or not the table is folded', async ($, on) => {
    world(on, { fixture: mixed(4, 4) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 160)

    // The divider under the plan details is a keyless Markdown rule on the desktop; only the table's rows are counted here.
    const keys = async (prefix: string) =>
      (await pane.findAll({ type: 'Markdown' })).map(node => node.props.key).filter(key => typeof key === 'string' && key.startsWith(prefix))

    expect(await keys('artifact:')).toEqual(['artifact:0', 'artifact:1', 'artifact:2', 'artifact:3'])
    expect(await keys('deliverable:')).toEqual(['deliverable:0'])
    await pane.press({ key: 'lane:Deliverables:more' })
    expect(await keys('artifact:')).toHaveLength(4)
    expect(await keys('deliverable:')).toEqual(['deliverable:0', 'deliverable:1', 'deliverable:2', 'deliverable:3'])
    await pane.unmount()
  })
})

describe('the Deliverable row of a task page holds the artifact first, then the file', () => {
  const rows = [art('a1', 'Plan board preview', WEB, WEB_NOTE), art('a2', 'Q3 review deck', LOCAL), { task: 'plain', status: 'Done' as const, updated: null }]
  const BOTH_ROW = art('a1', 'Plan board preview', WEB, WEB_NOTE, 'Done', { deliverable: 'automation/plans/x.md', change: 'adds the thing' })
  const SAME_ROW = art('a1', 'Plan board preview', WEB, WEB_NOTE, 'Done', { deliverable: WEB, change: 'a change nobody sees' })

  const fieldText = async (pane: Awaited<ReturnType<typeof mountPane>>, key: string) => {
    const found = await pane.find({ key: `field:${key}` })

    return found === undefined ? undefined : textOf(found).replace(/[│╭╮╰╯├┤┬┴┼─]/g, ' ').replace(/\s+/g, ' ').trim()
  }

  const fieldKeys = async (pane: Awaited<ReturnType<typeof mountPane>>) => kids(await pane.find({ key: 'detail:fields' })).map(node => String(node.props?.key ?? ''))

  test('terminal, both: one row labelled Deliverable: the title as a link, the note dim, the path, the change, Diff ›; no Artifact row', async ($, on) => {
    world(on, { fixture: boardOf(BOTH_ROW) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 96)

    await openCard(pane, 0)

    const field = await pane.find({ key: 'field:deliverable' })

    expect(await fieldText(pane, 'deliverable')).toBe(`Deliverable Plan board preview ${WEB_NOTE} automation/plans/x.md adds the thing Diff ›`)
    expect((await pane.findAll({ type: 'Link' })).map(node => [node.props.label, node.props.href])).toContainEqual(['Plan board preview', WEB])
    expect(textOf(field)).not.toContain('claude.ai')
    expect(kids(field).some(line => kids(line).some(node => node.props?.dimColor === true && textOf(node).includes(WEB_NOTE)))).toBe(true)
    expect(await pane.find({ key: 'field:artifact' })).toBeUndefined()
    expect((await fieldKeys(pane)).filter(key => key === 'field:deliverable' || key === 'field:artifact')).toEqual(['field:deliverable'])
    await pane.unmount()
  })

  test('terminal, only an artifact: its title and note, no path and no Diff ›', async ($, on) => {
    world(on, { fixture: boardOf(...rows) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 96)

    await openCard(pane, 0)
    expect(await fieldText(pane, 'deliverable')).toBe(`Deliverable Plan board preview ${WEB_NOTE}`)
    expect(await pane.find({ key: 'field:artifact' })).toBeUndefined()
    await pane.unmount()
  })

  test('terminal, only a file: its path, the change, Diff ›, as before', async ($, on) => {
    world(on, { fixture: boardOf(FILE_ROW) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 96)

    await openCard(pane, 0)
    expect(await fieldText(pane, 'deliverable')).toBe('Deliverable automation/plans/x.md adds the thing Diff ›')
    await pane.unmount()
  })

  test('terminal, the same web link in both fields: shown once, as the artifact', async ($, on) => {
    world(on, { fixture: boardOf(SAME_ROW) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 96)

    await openCard(pane, 0)

    const field = await pane.find({ key: 'field:deliverable' })

    expect(await fieldText(pane, 'deliverable')).toBe(`Deliverable Plan board preview ${WEB_NOTE}`)
    expect((await pane.findAll({ type: 'Link' })).filter(node => node.props.href === WEB)).toHaveLength(1)
    expect(textOf(field)).not.toContain('claude.ai')
    expect(textOf(field)).not.toContain('Diff')
    await pane.unmount()
  })

  test('terminal: a long note wraps inside the cell, every line within the pane', async ($, on) => {
    world(on, { fixture: boardOf(art('a1', 'Plan board preview', WEB, `${'word '.repeat(30)}end`)) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 50)

    await openCard(pane, 0)

    for (const node of kids(await pane.find({ key: 'detail:fields' }))) {
      for (const line of node.type === 'Box' ? kids(node) : [node]) {
        expect(displayWidth(textOf(line))).toBeLessThanOrEqual(50)
      }
    }

    await pane.unmount()
  })

  test('no row at all when the task has neither', async ($, on) => {
    world(on, { fixture: boardOf(...rows) })
    await $.session.start(SESSION)

    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await mountPane($, surface, 96)

      await openCard(pane, 2)
      expect(await pane.find({ key: 'field:deliverable' })).toBeUndefined()
      expect(await pane.find({ key: 'field:artifact' })).toBeUndefined()
      expect(textOf(await pane.find({ key: 'detail' }))).not.toMatch(/Artifact|Deliverable/)
      // the open page is session state: back to the board before the next surface mounts
      await pane.press({ key: 'back' })
      await pane.unmount()
    }
  })

  test('desktop, both: a round-bordered row; the title link keyed detail:artifact, its note dim, then the path link with Diff, then the change', async ($, on) => {
    world(on, { fixture: boardOf(BOTH_ROW) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 96)

    await openCard(pane, 0)

    const field = await pane.find({ key: 'field:deliverable' })
    const [label, value] = kids(field)

    expect(field?.props.borderStyle).toBe('round')
    expect(textOf(label)).toBe('Deliverable')
    expect(kids(value).map(node => node.type)).toEqual(['Markdown', 'Box', 'Box', 'Box'])
    expect(kids(value)[0]).toMatchObject({ props: { key: 'detail:artifact', text: `[Plan board preview](${WEB})` } })
    expect(textOf(kids(value)[1])).toBe(WEB_NOTE)
    expect(isDim(kids(value)[1])).toBe(true)
    expect(kids(kids(value)[2]).map(node => String(node.props.key))).toEqual(['detail:deliverable', 'detail:diff'])
    expect(textOf(kids(value)[3])).toBe('adds the thing')
    expect(await pane.find({ key: 'field:artifact' })).toBeUndefined()
    await pane.unmount()
  })

  test('desktop, only an artifact: the title link and its note, no path link and no Diff', async ($, on) => {
    world(on, { fixture: boardOf(...rows) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 96)

    await openCard(pane, 0)
    expect(await pane.find({ type: 'Markdown', key: 'detail:artifact' })).toMatchObject({ props: { text: `[Plan board preview](${WEB})` } })
    expect(await pane.find({ key: 'detail:deliverable' })).toBeUndefined()
    expect(await pane.find({ key: 'detail:diff' })).toBeUndefined()
    expect(textOf(await pane.find({ key: 'field:deliverable' }))).toContain(WEB_NOTE)
    await pane.unmount()
  })

  test('desktop, the same web link in both fields: the artifact link alone', async ($, on) => {
    world(on, { fixture: boardOf(SAME_ROW) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 96)

    await openCard(pane, 0)
    expect(await pane.find({ type: 'Markdown', key: 'detail:artifact' })).toBeDefined()
    expect(await pane.find({ key: 'detail:deliverable' })).toBeUndefined()
    expect(await pane.find({ key: 'detail:diff' })).toBeUndefined()
    expect(textOf(await pane.find({ key: 'field:deliverable' }))).not.toContain('a change nobody sees')
    await pane.unmount()
  })

  test('desktop: an https artifact has no press of the plugin; a local one has', async ($, on) => {
    world(on, { fixture: boardOf(...rows) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 96)

    await openCard(pane, 0)
    await expect(pane.press({ key: 'detail:artifact', link: { href: WEB } })).rejects.toThrow()
    await pane.press({ key: 'back' })
    await openCard(pane, 1)
    await expect(pane.press({ key: 'detail:artifact', link: { href: LOCAL_HREF } })).resolves.toBeDefined()
    await pane.unmount()
  })
})

describe('a local artifact under /tmp or /private/tmp opens; a deliverable there does not', () => {
  const PRIVATE = '/private/tmp/x/index.html'
  const SHORT = '/tmp/x/index.html'

  test('a /private/tmp page opens with plain `open <path>`', async ($, on) => {
    const w = world(on, { fixture: boardOf(art('a1', 'Page', PRIVATE, 'n')), present: [PRIVATE] })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 160)

    await pane.press({ key: 'artifact:0', link: { href: `file://${PRIVATE}` } })
    await settle(w.clock)

    expect(opens(w)).toEqual([['open', PRIVATE]])
    expect(w.toasts).toEqual([])
    await pane.unmount()
  })

  test('a /tmp page opens through its real path under /private/tmp', async ($, on) => {
    const w = world(on, { fixture: boardOf(art('a1', 'Page', SHORT, 'n')), present: [SHORT], realpaths: { [SHORT]: PRIVATE } })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 160)

    await pane.press({ key: 'artifact:0', link: { href: `file://${SHORT}` } })
    await settle(w.clock)

    expect(opens(w)).toEqual([['open', PRIVATE]])
    await pane.unmount()
  })

  test('a /tmp page whose real path leaves /tmp is refused', async ($, on) => {
    const w = world(on, { fixture: boardOf(art('a1', 'Page', SHORT, 'n')), present: [SHORT], realpaths: { [SHORT]: '/srv/elsewhere/index.html' } })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 160)

    await pane.press({ key: 'artifact:0', link: { href: `file://${SHORT}` } })
    await settle(w.clock)

    expect(opens(w)).toEqual([])
    expect(w.toasts).toHaveLength(1)
    await pane.unmount()
  })

  test('the task page opens a /private/tmp artifact too', async ($, on) => {
    const w = world(on, { fixture: boardOf(art('a1', 'Page', PRIVATE, 'n')), present: [PRIVATE] })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 96)

    await openCard(pane, 0)
    await pane.press({ key: 'detail:artifact', link: { href: `file://${PRIVATE}` } })
    await settle(w.clock)

    expect(opens(w)).toEqual([['open', PRIVATE]])
    await pane.unmount()
  })

  test('a folder under /tmp is not an artifact page: refused, not revealed', async ($, on) => {
    const w = world(on, { fixture: boardOf(art('a1', 'Folder', '/private/tmp/x', 'n')), present: ['/private/tmp/x'], dirs: ['/private/tmp/x'] })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 160)

    await pane.press({ key: 'artifact:0', link: { href: 'file:///private/tmp/x' } })
    await settle(w.clock)

    expect(opens(w)).toEqual([])
    expect(w.toasts).toEqual(['Not opened: not a regular file'])
    await pane.unmount()
  })

  for (const path of ['/tmpfoo/x.html', '/private/tmpfoo/x.html']) {
    test(`a name that only starts with tmp is outside it: ${path} is refused`, async ($, on) => {
      const w = world(on, { fixture: boardOf(art('a1', 'Page', path, 'n')), present: [path] })
      await $.session.start(SESSION)
      const pane = await mountPane($, 'desktop', 160)

      await pane.press({ key: 'artifact:0', link: { href: `file://${path}` } })
      await settle(w.clock)

      expect(opens(w)).toEqual([])
      expect(w.toasts).toHaveLength(1)
      await pane.unmount()
    })
  }

  for (const path of [PRIVATE, SHORT]) {
    test(`a deliverable at ${path} is still refused with a toast and no \`open\``, async ($, on) => {
      const w = world(on, { fixture: boardOf({ task: 'r0', status: 'Done', updated: null, deliverable: path }), present: [path] })
      await $.session.start(SESSION)
      const pane = await mountPane($, 'desktop', 160)

      await pane.press({ key: 'deliverable:0', link: { href: `file://${path}` } })
      await settle(w.clock)

      expect(opens(w)).toEqual([])
      expect(w.toasts).toHaveLength(1)
      expect(w.toasts[0]).toStartWith('Not opened: ')
      await pane.unmount()
    })
  }
})

describe('pressing an artifact link', () => {
  const OUT = `${HOME}/code/x/page.html`
  const OUT_HREF = 'file:///home/tester/code/x/page.html'
  const INSIDE = `${ROOT}/automation/x/index.html`
  const INSIDE_HREF = `file://${INSIDE.split('/').map(encodeURIComponent).join('/')}`

  test('an https artifact has no onLinkPress on the desktop: the surface opens it, the plugin never does', async ($, on) => {
    const w = world(on, { fixture: TWO })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 160)

    expect(await pane.find({ type: 'Markdown', key: 'artifact:0' })).toBeDefined()
    await expect(pane.press({ key: 'artifact:0', link: { href: WEB } })).rejects.toThrow()
    await settle(w.clock)
    expect(opens(w)).toEqual([])
    await pane.unmount()
  })

  test('a local .html outside the project root opens with plain `open <path>`', async ($, on) => {
    const w = world(on, { fixture: boardOf(art('a1', 'Page', '~/code/x/page.html', 'n')), present: [OUT] })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 160)

    await pane.press({ key: 'artifact:0', link: { href: OUT_HREF } })
    await settle(w.clock)

    expect(opens(w)).toEqual([['open', OUT]])
    expect(w.toasts).toEqual([])
    await pane.unmount()
  })

  test('a local .html inside the project root is the plugin\'s too (the surface would not open it in the browser): plain `open <path>`', async ($, on) => {
    const w = world(on, { fixture: boardOf(art('a1', 'Page', 'automation/x/index.html', 'n')), present: [INSIDE] })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 160)

    await pane.press({ key: 'artifact:0', link: { href: INSIDE_HREF } })
    await settle(w.clock)

    expect(opens(w)).toEqual([['open', INSIDE]])
    expect(w.toasts).toEqual([])
    await pane.unmount()
  })

  test('the key counts rows of the table: artifact:1 opens the second artifact', async ($, on) => {
    const w = world(on, { fixture: boardOf(art('a1', 'One', WEB, 'n'), art('a2', 'Two', '~/code/x/page.html', 'n')), present: [OUT] })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 160)

    await pane.press({ key: 'artifact:1', link: { href: OUT_HREF } })
    await settle(w.clock)

    expect(opens(w)).toEqual([['open', OUT]])
    await pane.unmount()
  })

  test('the task page: detail:artifact opens the shown task\'s artifact the same way', async ($, on) => {
    const w = world(on, { fixture: boardOf(art('a1', 'Page', '~/code/x/page.html', 'n')), present: [OUT] })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 96)

    await openCard(pane, 0)
    await pane.press({ key: 'detail:artifact', link: { href: OUT_HREF } })
    await settle(w.clock)

    expect(opens(w)).toEqual([['open', OUT]])
    await pane.unmount()
  })

  test('the allowlist stands: a path outside the project, home and ~/.claude is refused with a toast and no `open`', async ($, on) => {
    const w = world(on, { fixture: boardOf(art('a1', 'Page', '/srv/x/index.html', 'n')), present: ['/srv/x/index.html'] })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 160)

    await pane.press({ key: 'artifact:0', link: { href: 'file:///srv/x/index.html' } })
    await settle(w.clock)

    expect(opens(w)).toEqual([])
    expect(w.toasts).toHaveLength(1)
    expect(w.toasts[0]).toStartWith('Not opened: ')
    await pane.unmount()
  })

  test('a file that does not exist is not opened: a toast says so', async ($, on) => {
    const w = world(on, { fixture: boardOf(art('a1', 'Page', '~/code/x/page.html', 'n')) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 160)

    await pane.press({ key: 'artifact:0', link: { href: OUT_HREF } })
    await settle(w.clock)

    expect(opens(w)).toEqual([])
    expect(w.toasts).toEqual([`Not opened: no such file ${OUT}`])
    await pane.unmount()
  })

  test('a file `open` would run, not show, is still revealed in Finder and never launched', async ($, on) => {
    const app = `${HOME}/code/x/Tool.app`
    const w = world(on, { fixture: boardOf(art('a1', 'Page', '~/code/x/Tool.app', 'n')), present: [app] })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 160)

    await pane.press({ key: 'artifact:0', link: { href: `file://${app}` } })
    await settle(w.clock)

    expect(opens(w)).toEqual([['open', '-R', app]])
    await pane.unmount()
  })

  test('a deliverable .html outside the project root still opens with plain `open <path>`', async ($, on) => {
    const w = world(on, { fixture: boardOf({ task: 'r0', status: 'Done', updated: null, deliverable: '~/code/x/page.html' }), present: [OUT] })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 160)

    await pane.press({ key: 'deliverable:0', link: { href: OUT_HREF } })
    await settle(w.clock)

    expect(opens(w)).toEqual([['open', OUT]])
    await pane.unmount()
  })

  test('the keys are the plugin\'s only on a link press: a Button keyed artifact:0 is not answered', () => {
    expect(actionFor({} as never, 'artifact:0', true, 'desktop')).toBeDefined()
    expect(actionFor({} as never, 'detail:artifact', true, 'desktop')).toBeDefined()
    expect(actionFor({} as never, 'artifact:0', false, 'desktop')).toBeUndefined()
    expect(actionFor({} as never, 'detail:artifact', false, 'desktop')).toBeUndefined()
  })
})
