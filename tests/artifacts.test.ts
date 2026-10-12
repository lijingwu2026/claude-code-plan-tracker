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
    expect(textOf(await pane.find({ key: 'artifacts' }))).toContain(NOTE)
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

describe('the Artifacts table on the terminal', () => {
  test('160 columns: a title, a dim header, one line a row: the title as a link (never the URL), the note dim', async ($, on) => {
    world(on, { fixture: TWO })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 160)
    const section = await pane.find({ key: 'artifacts' })
    const [title, header, one, two] = kids(section)

    expect(textOf(title)).toBe('Artifacts')
    expect(title?.props.bold).toBe(true)
    expect(textOf(header).trimEnd()).toMatch(/^ARTIFACT\s+ABOUT$/)
    expect(header?.props.dimColor).toBe(true)
    expect(flat(one)).toBe(`Plan board preview ${WEB_NOTE}`)
    expect(flat(two)).toBe('Q3 review deck slides for the review')
    expect(textOf(section)).not.toContain('claude.ai')
    expect(textOf(section)).not.toContain('/home/tester')
    expect(textOf(section)).not.toMatch(/[─│]/)
    expect(one?.type).toBe('Text')

    const links = (await pane.findAll({ type: 'Link' })).map(node => [node.props.label, node.props.href])

    expect(links).toEqual([
      ['Plan board preview', WEB],
      ['Q3 review deck', LOCAL_HREF],
    ])
    // the note is the dim part of the line, the title is not
    expect(kids(one).some(node => node.props?.dimColor === true && textOf(node).includes(WEB_NOTE))).toBe(true)
    expect(kids(one).some(node => node.props?.dimColor !== true && textOf(node).includes('Plan board preview'))).toBe(true)
    await pane.unmount()
  })

  test('a row with no note shows a dim "—"', async ($, on) => {
    world(on, { fixture: boardOf(art('a1', 'Plan board preview', WEB)) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 160)
    const [, , one] = kids(await pane.find({ key: 'artifacts' }))

    expect(flat(one)).toBe('Plan board preview —')
    expect(kids(one).some(node => node.props?.dimColor === true && textOf(node).includes('—'))).toBe(true)
    await pane.unmount()
  })

  test('drawn above the Deliverables, below the lanes', async ($, on) => {
    world(on, { fixture: boardOf(art('a1', 'Plan board preview', WEB, WEB_NOTE, 'Done', { deliverable: 'automation/plans/x.md' })) })
    await $.session.start(SESSION)

    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await mountPane($, surface, 160)
      const keys = kids(await pane.drawn()).map(node => String(node.props?.key ?? node.type))

      expect(keys.indexOf('artifacts')).toBeGreaterThan(keys.indexOf('kanban'))
      expect(keys.indexOf('artifacts')).toBeLessThan(keys.indexOf('deliverables'))
      expect(keys.indexOf('deliverables')).toBeGreaterThan(-1)
      await pane.unmount()
    }
  })

  test('with none recorded there is no table at all, not "Artifacts 0"', async ($, on) => {
    world(on)
    await $.session.start(SESSION)

    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await mountPane($, surface, 160)

      expect(await pane.find({ key: 'artifacts' })).toBeUndefined()
      expect(textOf(await pane.drawn())).not.toContain('Artifacts')
      await pane.unmount()
    }
  })

  test('~40 columns: each artifact is a block, the title then its note dim and wrapped under it; no column header; no line wider than the pane', async ($, on) => {
    const NOTE = 'one-screen mock of the new Artifacts table with its fold and its stacked layout'
    world(on, { fixture: boardOf(art('a1', 'Plan board preview', WEB, NOTE), art('a2', 'Q3 review deck', LOCAL)) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 40)
    const section = await pane.find({ key: 'artifacts' })
    const [title, first, second] = kids(section)

    expect(textOf(title)).toBe('Artifacts')
    expect(textOf(section)).not.toMatch(/ARTIFACT|ABOUT/)
    expect(String(first?.props.key)).toBe('artifact:0:item')

    const [head, ...under] = kids(first)

    expect(textOf(head).trim()).toBe('Plan board preview')
    expect(under.length).toBeGreaterThan(1)
    expect(under.map(line => textOf(line).trim()).join(' ')).toBe(NOTE)
    expect(under.every(isDim)).toBe(true)
    expect(isDim(head)).toBe(false)
    // a row with no note is its title alone
    expect(kids(second).map(line => textOf(line).trim())).toEqual(['Q3 review deck'])

    for (const line of kids(section).flatMap(block => (block.type === 'Box' ? kids(block) : [block]))) {
      expect(displayWidth(textOf(line))).toBeLessThanOrEqual(40)
    }

    expect(textOf(section)).not.toContain('claude.ai')
    await pane.unmount()
  })

  test('a CJK title and note keep within the width in both layouts', async ($, on) => {
    world(on, { fixture: boardOf(art('a1', '看板预览页面的第一个版本', WEB, '一屏之内看到新的产物表格和它的折叠行为，窄屏时上下排')) })
    await $.session.start(SESSION)

    for (const columns of [40, 60, 160]) {
      const pane = await mountPane($, 'terminal', columns)
      const section = await pane.find({ key: 'artifacts' })

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
    const [, , ...lines] = kids(await pane.find({ key: 'artifacts' }))

    expect(lines.map(flat)).toEqual([`Plan board preview ${WEB_NOTE}`])
    await pane.unmount()
  })
})

describe('the Artifacts table on the desktop', () => {
  test('160 columns: a dim header row, then a row a title Markdown link (the title, not the URL) and the dim note', async ($, on) => {
    world(on, { fixture: TWO })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 160)
    const section = await pane.find({ key: 'artifacts' })
    const [title, header, one, two] = kids(section)

    expect(textOf(title)).toBe('Artifacts')
    expect(kids(header).map(textOf)).toEqual(['ARTIFACT', 'ABOUT'])
    expect(kids(header).every(isDim)).toBe(true)
    expect(String(one?.props.key)).toBe('artifact:0:item')
    expect(one?.props.flexDirection).toBe('row')

    const [titleCell, noteCell] = kids(one)

    expect(titleCell?.props.width).toBe(kids(header)[0]?.props.width)
    expect(kids(titleCell)[0]).toMatchObject({ type: 'Markdown', props: { key: 'artifact:0', text: `[Plan board preview](${WEB})` } })
    expect(textOf(noteCell)).toBe(WEB_NOTE)
    expect(isDim(kids(noteCell)[0])).toBe(true)
    expect(kids(kids(two)[0])[0]?.props.text).toBe(`[Q3 review deck](${LOCAL_HREF})`)
    expect(await pane.find({ type: 'Link' })).toBeUndefined()
    await pane.unmount()
  })

  test('~40 columns: stacked, the title link then its note dim under it; no header', async ($, on) => {
    world(on, { fixture: TWO })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 40)
    const section = await pane.find({ key: 'artifacts' })
    const [title, one, two] = kids(section)

    expect(textOf(title)).toBe('Artifacts')
    expect(textOf(section)).not.toMatch(/ARTIFACT|ABOUT/)
    expect(String(one?.props.key)).toBe('artifact:0:item')
    expect(one?.props.flexDirection).toBe('column')

    const [link, note] = kids(one)

    expect(link).toMatchObject({ type: 'Markdown', props: { key: 'artifact:0', text: `[Plan board preview](${WEB})` } })
    expect(textOf(note)).toBe(WEB_NOTE)
    expect(isDim(note)).toBe(true)
    expect(kids(two).map(node => node.type)).toEqual(['Markdown', 'Text'])
    await pane.unmount()
  })

  test('markdown characters in a title are escaped and parentheses in the href are encoded', async ($, on) => {
    world(on, { fixture: boardOf(art('a1', 'a_b [1] *x*', 'https://claude.ai/artifact/a_(1)', 'n')) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 160)

    expect((await pane.find({ type: 'Markdown', key: 'artifact:0' }))?.props.text).toBe('[a\\_b \\[1\\] \\*x\\*](https://claude.ai/artifact/a_%281%29)')
    await pane.unmount()
  })
})

describe('the Artifacts table folds after five rows', () => {
  const eight = (withDeliverables = false) =>
    boardOf(...Array.from({ length: 8 }, (_, at) => art(`task ${at}`, `Artifact ${at}`, `https://claude.ai/artifact/n${at}`, `note ${at}`, 'Done', withDeliverables ? { deliverable: `docs/d${at}.md` } : {})))

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${surface}: 8 artifacts show 5, then a pressable "+3 more ▾"; pressing shows all 8 and "Show less ▴"; pressing again folds`, async ($, on) => {
      world(on, { fixture: eight() })
      await $.session.start(SESSION)
      const pane = await mountPane($, surface, 160)
      const text = async () => textOf(await pane.find({ key: 'artifacts' }))
      const more = async () => String((await pane.find({ key: 'lane:Artifacts:more' }))?.props.label)
      const count = async () => {
        const shown = await text()

        return Array.from({ length: 8 }, (_, at) => `Artifact ${at}`).filter(name => shown.includes(name)).length
      }

      expect(await count()).toBe(5)
      expect(await text()).not.toContain('Artifact 5')
      expect(await more()).toBe('+3 more ▾')

      await pane.press({ key: 'lane:Artifacts:more' })
      expect(await count()).toBe(8)
      expect(await more()).toBe('Show less ▴')

      await pane.press({ key: 'lane:Artifacts:more' })
      expect(await count()).toBe(5)
      expect(await more()).toBe('+3 more ▾')
      await pane.unmount()
    })
  }

  test('five or fewer: no overflow button', async ($, on) => {
    world(on, { fixture: boardOf(...Array.from({ length: 5 }, (_, at) => art(`task ${at}`, `Artifact ${at}`, `https://claude.ai/artifact/n${at}`, 'n'))) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 160)

    expect(await pane.find({ key: 'lane:Artifacts:more' })).toBeUndefined()
    await pane.unmount()
  })

  test('its fold is its own: unfolding the Artifacts leaves the Deliverables folded, and the other way round', async ($, on) => {
    world(on, { fixture: eight(true) })
    await $.session.start(SESSION)

    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await mountPane($, surface, 160)
      const label = async (key: string) => String((await pane.find({ key }))?.props.label)

      await pane.press({ key: 'lane:Artifacts:more' })
      expect(await label('lane:Artifacts:more')).toBe('Show less ▴')
      expect(await label('lane:Deliverables:more')).toBe('+3 more ▾')

      await pane.press({ key: 'lane:Artifacts:more' })
      await pane.press({ key: 'lane:Deliverables:more' })
      expect(await label('lane:Artifacts:more')).toBe('+3 more ▾')
      expect(await label('lane:Deliverables:more')).toBe('Show less ▴')
      await pane.press({ key: 'lane:Deliverables:more' })
      await pane.unmount()
    }
  })

  test('the Markdown keys of a desktop row count from the first artifact whether or not the table is folded', async ($, on) => {
    world(on, { fixture: eight() })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 160)

    expect((await pane.findAll({ type: 'Markdown' })).map(node => node.props.key)).toEqual(['artifact:0', 'artifact:1', 'artifact:2', 'artifact:3', 'artifact:4'])
    await pane.press({ key: 'lane:Artifacts:more' })
    expect((await pane.findAll({ type: 'Markdown' })).map(node => node.props.key)).toHaveLength(8)
    await pane.unmount()
  })
})

describe('the Artifact row of a task page', () => {
  const rows = [art('a1', 'Plan board preview', WEB, WEB_NOTE), art('a2', 'Q3 review deck', LOCAL), { task: 'plain', status: 'Done' as const, updated: null }]

  const fieldText = async (pane: Awaited<ReturnType<typeof mountPane>>, key: string) => {
    const found = await pane.find({ key: `field:${key}` })

    return found === undefined ? undefined : textOf(found).replace(/[│╭╮╰╯├┤┬┴┼─]/g, ' ').replace(/\s+/g, ' ').trim()
  }

  test('terminal: the label Artifact, the title as a link, the note dim under it; next to the Deliverable row', async ($, on) => {
    world(on, { fixture: boardOf(art('a1', 'Plan board preview', WEB, WEB_NOTE, 'Done', { deliverable: 'automation/plans/x.md' })) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 96)

    await openCard(pane, 0)

    const field = await pane.find({ key: 'field:artifact' })
    const keys = kids(await pane.find({ key: 'detail:fields' })).map(node => String(node.props?.key ?? ''))

    expect(await fieldText(pane, 'artifact')).toBe(`Artifact Plan board preview ${WEB_NOTE}`)
    expect((await pane.findAll({ type: 'Link' })).map(node => [node.props.label, node.props.href])).toContainEqual(['Plan board preview', WEB])
    expect(textOf(field)).not.toContain('claude.ai')
    expect(kids(field).some(line => kids(line).some(node => node.props?.dimColor === true && textOf(node).includes(WEB_NOTE)))).toBe(true)
    expect(keys.filter(key => key === 'field:deliverable' || key === 'field:artifact')).toHaveLength(2)
    expect(Math.abs(keys.indexOf('field:artifact') - keys.indexOf('field:deliverable'))).toBeLessThanOrEqual(2)
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

  test('no row at all when the task has no artifact', async ($, on) => {
    world(on, { fixture: boardOf(...rows) })
    await $.session.start(SESSION)

    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await mountPane($, surface, 96)

      await openCard(pane, 2)
      expect(await pane.find({ key: 'field:artifact' })).toBeUndefined()
      expect(textOf(await pane.find({ key: 'detail' }))).not.toContain('Artifact')
      // the open page is session state: back to the board before the next surface mounts
      await pane.press({ key: 'back' })
      await pane.unmount()
    }
  })

  test('desktop: a round-bordered row, the label, the title as a Markdown link keyed detail:artifact, the note dim under it', async ($, on) => {
    world(on, { fixture: boardOf(...rows) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop', 96)

    await openCard(pane, 0)

    const field = await pane.find({ key: 'field:artifact' })

    expect(field?.props.borderStyle).toBe('round')
    expect(textOf(kids(field)[0])).toBe('Artifact')
    expect(await pane.find({ type: 'Markdown', key: 'detail:artifact' })).toMatchObject({ props: { text: `[Plan board preview](${WEB})` } })
    expect(textOf(field)).toContain(WEB_NOTE)
    expect(isDim(kids(kids(field)[1]).find(node => textOf(node) === WEB_NOTE))).toBe(true)
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
