import { describe, expect, test } from './testing'
import type { Engine } from 'claude-code/testing'

import {
  chipCols,
  compactCount,
  deliverableGroups,
  displayWidth,
  durationText,
  laneWidth,
  parseBoard,
  progressOf,
  progressText,
  spanText,
  planStatsOf,
  notStartedText,
  statusWords,
  usageStatsOf,
  fitStats,
  typeOf,
  usageArgv,
  whoLineOf,
  assigneeOf,
  checkerOf,
  needsYou,
  cardView,
  BORDER_COLUMNS,
} from '../hooks/board'
import type { PlanBoard, PlanEntry, PlanRow, PlanUsage } from '../types'
import type { Node } from './fixtures'
import { PANE_ID, SESSION, SESSION_ID, bandProps, kids, openCard, paneProps, textOf, world, cardRowsIn } from './fixtures'

const USAGE: PlanUsage = {
  working_ms: 42 * 60_000,
  main_ms: 18 * 60_000,
  subagent_ms: 24 * 60_000,
  effort: { medium: 0.2, high: 0.8 },
  models: ['claude-opus-5-5'],
  tokens: { input: 100_000, cache_read: 1_100_000, cache_write: 0, output: 48_000 },
  cost_usd: 3.1,
  computed_at: '2026-10-11T14:05:00',
}

/** A node and everything under it. */
const flat = (node: Node | undefined): Node[] => (node === undefined || typeof node === 'string' ? [] : [node, ...kids(node).flatMap(flat)])

const row = (task: string, status: PlanRow['status'], extra: Partial<PlanRow> = {}): PlanRow => ({ task, status, updated: null, ...extra })

const ROWS: PlanRow[] = [
  row('Phase 2 plugin export', 'In Progress', { route: 'serial × inline · Opus — x', progress: '3/5', started: '2026-10-11T10:00:00+09:00', usage: USAGE }),
  row('Public push after her yes', 'Todo', { route: 'serial × Sam · — — y' }),
  row('README cover', 'Needs Verification', { route: 'serial × Sam · — — y', progress: '4/5' }),
  row('done a', 'Done', { deliverable: 'knowledge/a.md', deliverable_mtime: 100 }),
  row('done b', 'Done', { deliverable: 'automation/b.py', deliverable_mtime: 300 }),
  row('done c', 'Done', { deliverable: 'knowledge/c.md', deliverable_mtime: 200 }),
  row('done d', 'Done', { deliverable: 'plugin/' }),
  row('done e', 'Done', { deliverable: 'Makefile', deliverable_mtime: 50 }),
]

const PLAN: PlanEntry = { anchor: 'alpha', name: 'Alpha plan', goal: 'g', plan_file: '/plans/alpha-plan.md', rows: ROWS }
const WITH_ROWS: PlanBoard = { selected: 'alpha', message: null, plans: [PLAN] }

const mountPane = ($: Engine, surface: 'terminal' | 'desktop', columns = 140) =>
  $.ui.mount({
    plugin: 'plan-tracker',
    surface,
    component: 'Pane',
    requestId: PANE_ID,
    props: paneProps(columns),
    viewport: { columns: columns + 60, rows: 50, isFullscreen: true },
  })

describe('the card label chip', () => {
  const routed = (route: string) => row('x', 'Todo', { route })

  test('Sam is "you" on the card and in Who; the tiers are as they were', () => {
    expect(assigneeOf(routed('serial × Sam · — — a'))).toBe('you')
    expect(whoLineOf(routed('serial × Sam · — — a'))).toEqual({ executor: 'you' })
    expect(assigneeOf(routed('serial × inline · Opus — a'))).toBe('Opus')
    expect(assigneeOf(routed('serial × inline · Sonnet — a'))).toBe('Sonnet')
    expect(assigneeOf(routed('serial × inline · Haiku — a'))).toBe('Haiku')
    expect(assigneeOf(routed('serial × inline · default — a'))).toBeUndefined()
    expect(whoLineOf(routed('spawn × subagent · Sonnet — a'))).toEqual({ tier: 'Sonnet', executor: 'subagent' })
  })

  test('the chip is the word and a space each side, and counts in the tag columns', () => {
    expect(chipCols('you')).toBe(5)
    expect(chipCols('Sonnet')).toBe(8)
    expect(chipCols('')).toBe(0)
  })

  test('at every card width the text and the chip together stay inside the card', () => {
    for (const route of ['serial × Sam · — — a', 'serial × inline · Sonnet — a']) {
      for (const progress of [undefined, '3/5']) {
        for (let width = 8; width <= 60; width += 1) {
          const view = cardView(row('a long task name that wraps over lines', 'Todo', { route, ...(progress === undefined ? {} : { progress }) }), width)
          const room = Math.max(1, width - BORDER_COLUMNS)

          for (const [at, line] of view.lines.entries()) {
            const chip = at === view.tagAt ? chipCols(view.tag) : 0

            const used = displayWidth(line) + (chip === 0 ? 0 : view.pad + chip)

            if (used > room) {
              throw new Error(`${route} ${progress} width ${width} room ${room} line ${at} ${JSON.stringify(view)} used ${used}`)
            }
          }
        }
      }
    }
  })

  test('on a terminal card the chip is a Text on its background after the padding, at the right edge', async ($, on) => {
    world(on, { fixture: WITH_ROWS })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')
    const width = laneWidth(140)
    const rows = await cardRowsIn(pane, 1)
    const last = rows.at(-1)
    const chip = kids(last).at(-1)?.children.at(-1)

    expect(chip?.props).toMatchObject({ color: '#FFFFFF', backgroundColor: '#4B2FB8', bold: true })
    expect(textOf(chip)).toBe(' you ')
    expect(displayWidth(textOf(last))).toBe(width - BORDER_COLUMNS)
    await pane.unmount()
  })

  test('the Who row of a task page draws the same chip', async ($, on) => {
    world(on, { fixture: WITH_ROWS })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    await openCard(pane, 0)

    const opus = (await pane.findAll({ type: 'Text' })).find(node => textOf(node) === ' Opus ')

    expect(opus?.props).toMatchObject({ color: '#7A3410', backgroundColor: '#F6DCCB' })
    await pane.unmount()
  })
})

describe('a card with the mascot gives the title the width', () => {
  const doing = (progress?: string) =>
    row('A long task title that needs two lines on any lane card here', 'In Progress', { route: 'spawn × subagent · Sonnet — x', ...(progress === undefined ? {} : { progress }) })

  for (const [columns, titleMin] of [[170, 16], [140, 16], [100, 13]] as const) {
    for (const progress of [undefined, '3/5']) {
      test(`${columns} columns${progress === undefined ? '' : ', with progress'}: the Sonnet chip is below the title, which keeps ${titleMin} columns or the card's whole inside`, () => {
        const width = laneWidth(columns)
        const view = cardView(doing(progress), width)
        const titles = view.lines.slice(0, 2)

        expect(view.mascot).toBe(true)
        expect(view.tag).toBe('Sonnet')
        expect(view.tagAt).toBeGreaterThanOrEqual(2)
        expect(Math.max(...titles.map(displayWidth))).toBeGreaterThanOrEqual(titleMin)
        // the whole inside of the card besides the mascot: 7 columns, and its 4 of border and padding
        expect(Math.max(...titles.map(displayWidth))).toBe(width - BORDER_COLUMNS - 7)
      })
    }
  }
})

describe('who did it and who checks it', () => {
  const NEW = 'serial × inline · Opus — a reason — check by main session · Sonnet: pytest -q → exits 0'
  const withRoute = (route: string, status: PlanRow['status'] = 'Needs Verification') => row('x', status, { route })

  test('checkerOf reads `check by <who>:` from the route: you for Sam, the text as written for others, none for an old route', () => {
    expect(checkerOf(withRoute(NEW))).toBe('main session · Sonnet')
    expect(checkerOf(withRoute('serial × inline · Opus — a — check by Sam: open it → looks right'))).toBe('you')
    expect(checkerOf(withRoute('spawn × subagent · Haiku — a — check by script: make test → exit 0'))).toBe('script')
    expect(checkerOf(withRoute('spawn × harness-author · Sonnet — a — check by harness-author · Opus: diff → clean'))).toBe('harness-author · Opus')
    expect(checkerOf(withRoute('serial × inline · Opus — a reason — check: pytest -q → exits 0'))).toBeUndefined()
    expect(checkerOf(row('x', 'Todo'))).toBeUndefined()
  })

  test('needsYou: Needs Verification and she checks it, or she did it', () => {
    expect(needsYou(withRoute('serial × inline · Opus — a — check by Sam: open it → ok'))).toBe(true)
    expect(needsYou(withRoute('serial × Sam · — — a — check by script: x → y'))).toBe(true)
    expect(needsYou(withRoute('serial × Sam · — — a'))).toBe(true)
    expect(needsYou(withRoute(NEW))).toBe(false)
    expect(needsYou(withRoute('serial × inline · Opus — a — check by Sam: open it → ok', 'Todo'))).toBe(false)
  })

  test('the Verify-lane tag is the checker: you, else its tier; elsewhere the doer', () => {
    expect(assigneeOf(withRoute(NEW))).toBe('Sonnet')
    expect(assigneeOf(withRoute('serial × inline · Opus — a — check by Sam: open it → ok'))).toBe('you')
    expect(assigneeOf(withRoute('serial × inline · Opus — a — check by script: x → y'))).toBeUndefined()
    expect(assigneeOf(withRoute(NEW, 'In Progress'))).toBe('Opus')
    expect(assigneeOf(withRoute('serial × inline · Opus — a reason — check: x → y'))).toBe('Opus')
  })

  test('inline is "main session" in who', () => {
    expect(whoLineOf(withRoute(NEW))).toEqual({ tier: 'Opus', executor: 'main session' })
    expect(whoLineOf(withRoute('spawn × subagent · Sonnet — a'))).toEqual({ tier: 'Sonnet', executor: 'subagent' })
  })

  test('statusWords: the status in words; Needs Verification says whose check it waits for', () => {
    expect(statusWords(row('x', 'Todo'))).toBe('To do')
    expect(statusWords(row('x', 'In Progress'))).toBe('In progress')
    expect(statusWords(row('x', 'Verifying'))).toBe('Being checked')
    expect(statusWords(row('x', 'Done'))).toBe('Done')
    expect(statusWords(row('x', 'Blocked'))).toBe('⚑ Blocked')
    expect(statusWords(withRoute('serial × inline · Opus — a — check by Sam: open it → ok'))).toBe('Waiting for your check')
    expect(statusWords(withRoute(NEW))).toBe('Waiting for a check')
  })

  test('the Status, Done by and Checked by rows: the status in words, the tier a chip and the executor or the you chip; the checker only once Done', async ($, on) => {
    const board: PlanBoard = {
      ...WITH_ROWS,
      plans: [
        {
          ...PLAN,
          rows: [
            row('waits on her', 'Needs Verification', { route: 'spawn × subagent · Sonnet — a — check by Sam: open it → ok' }),
            row('hers', 'Done', { route: 'serial × Sam · — — a' }),
            row('old route', 'Needs Verification', { route: 'serial × inline · Opus — a reason — check: x → y' }),
            row('checked', 'Done', { route: 'serial × inline · Opus — a — check by main session · Sonnet: x → y' }),
            row('not yet checked', 'Needs Verification', { route: 'serial × inline · Opus — a — check by Sam: x → y' }),
          ],
        },
      ],
    }

    world(on, { fixture: board })
    await $.session.start(SESSION)

    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await mountPane($, surface)
      const status = async (at: number) => {
        await openCard(pane, at)

        const words = async (key: string) => {
          const found = await pane.find({ key: `field:${key}` })

          return found === undefined ? undefined : textOf(found).replace(/[│╭╮╰╯├┤┬┴┼─]/g, ' ').replace(/\s+/g, ' ').trim()
        }
        const text = `${await words('status')} / ${await words('who')}`.replace(/\s+/g, '')
        const checked = (await words('checker'))?.replace(/\s+/g, '')

        await pane.press({ key: 'back' })

        return { text, checked }
      }

      // the desktop's cells have no space between label and value, the terminal's have: compare the words alone
      expect(await status(0)).toEqual({ text: 'StatusWaitingforyourcheck/DonebySonnetsubagent', checked: undefined })
      expect(await status(1)).toEqual({ text: 'StatusDone/Donebyyou', checked: undefined })
      expect(await status(2)).toEqual({ text: 'StatusWaitingforacheck/DonebyOpusmainsession', checked: undefined })
      expect(await status(3)).toEqual({ text: 'StatusDone/DonebyOpusmainsession', checked: 'Checkedbymainsession·Sonnet' })
      expect(await status(4)).toEqual({ text: 'StatusWaitingforyourcheck/DonebyOpusmainsession', checked: undefined })
      await pane.unmount()
    }
  })

  test('a Done row checked by her reads "Checked by you"', async ($, on) => {
    const route = 'serial × inline · Opus — a — check by Sam: open it → ok'
    const board: PlanBoard = { ...WITH_ROWS, plans: [{ ...PLAN, rows: [row('checked', 'Done', { route })] }] }

    world(on, { fixture: board })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    await openCard(pane, 0)
    expect(textOf(await pane.find({ key: 'field:checker' })).replace(/[│╭╮╰╯├┤┬┴┼─]/g, ' ').replace(/\s+/g, ' ').trim()).toBe('Checked by you')
    await pane.unmount()
  })
})

describe('the progress bar', () => {
  test('3/5 is three of five cells; no progress, no bar', () => {
    const bar = progressOf(row('x', 'In Progress', { progress: '3/5' }))

    expect(bar).toEqual({ filled: 3, empty: 2, count: '3/5', done: 3, total: 5 })
    expect(progressText(bar!)).toBe('▰▰▰▱▱ 3/5')
    expect(progressText(progressOf(row('x', 'Todo', { progress: '0/5' }))!)).toBe('▱▱▱▱▱ 0/5')
    expect(progressText(progressOf(row('x', 'Todo', { progress: '5/5' }))!)).toBe('▰▰▰▰▰ 5/5')
    expect(progressOf(row('x', 'Todo'))).toBeUndefined()
    expect(progressOf(row('x', 'Todo', { progress: '6/5' }))).toBeUndefined()
    expect(progressOf(row('x', 'Todo', { progress: 'half' }))).toBeUndefined()
    expect(cardView(row('x', 'Todo'), 40).bar).toBeUndefined()
  })

  test('the card has the bar line in the lane colour, the chip on it; a card without progress has no such line', async ($, on) => {
    world(on, { fixture: WITH_ROWS })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    const withBar = await cardRowsIn(pane, 0)
    const last = withBar.at(-1)

    expect(textOf(last)).toContain('▰▰▰▱▱ 3/5')
    expect(textOf(last)).toEndWith(' Opus ')
    expect(flat(last).some(node => node.props?.color === 'suggestion' && textOf(node) === '▰▰▰')).toBe(true)
    expect(flat(last).some(node => node.props?.dimColor === true && textOf(node) === '▱▱')).toBe(true)

    const without = await cardRowsIn(pane, 1)

    expect(without.map(textOf).join('')).not.toMatch(/[▰▱]/)
    await pane.unmount()
  })
})

describe('the deliverables table', () => {
  test('a type is the extension, "folder" for a trailing slash, "file" for none', () => {
    expect(typeOf('a/b/c.md')).toBe('.md')
    expect(typeOf('a/B.PY')).toBe('.py')
    expect(typeOf('a/plugin/')).toBe('folder')
    expect(typeOf('Makefile')).toBe('file')
    expect(typeOf('a.d/Makefile')).toBe('file')
    expect(typeOf('a/.gitignore')).toBe('file')
  })

  test('grouped by type, newest first inside a group, groups by their newest item, no mtime last', () => {
    expect(deliverableGroups(PLAN).map(group => [group.type, group.items.map(item => item.path)])).toEqual([
      ['.py', ['automation/b.py']],
      ['.md', ['knowledge/c.md', 'knowledge/a.md']],
      ['file', ['Makefile']],
      ['folder', ['plugin/']],
    ])
  })

  test('an item with no mtime sorts after the dated ones of its group', () => {
    const plan: PlanEntry = {
      ...PLAN,
      rows: [row('u', 'Done', { deliverable: 'u.md' }), row('v', 'Done', { deliverable: 'v.md', deliverable_mtime: 5 }), row('w', 'Done', { deliverable: 'w.md' })],
    }

    expect(deliverableGroups(plan)[0]?.items.map(item => item.path)).toEqual(['v.md', 'u.md', 'w.md'])
  })

  test('terminal: a dim header, the type chip on the first row of a group only, the task dim, the path a link', async ($, on) => {
    world(on, { fixture: WITH_ROWS })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')
    const section = await pane.find({ key: 'deliverables' })
    const [title, header, ...lines] = kids(section)

    expect(textOf(title)).toBe('Deliverables')
    expect(textOf(header)).toMatch(/^TYPE\s+DELIVERABLE\s+CHANGE$/)
    expect(header?.props.dimColor).toBe(true)
    expect(lines.map(line => textOf(line).replace(/\s+/g, ' ').trim())).toEqual([
      '.py automation/b.py —',
      '.md knowledge/c.md —',
      'knowledge/a.md —',
      'file Makefile —',
      'folder plugin/ —',
    ])
    expect(kids(lines[1]).some(node => node.props?.backgroundColor === '#E4E2D9')).toBe(true)
    expect(kids(lines[2]).some(node => node.props?.backgroundColor === '#E4E2D9')).toBe(false)
    expect(kids(lines[0]).some(node => node.props?.dimColor === true && textOf(node).includes('—'))).toBe(true)
    // the type chip and the path are in one line of text: nothing can push the chip off its path's line
    expect(lines.every(line => line.type === 'Text')).toBe(true)
    expect(await pane.findAll({ type: 'Link' })).toEqual([])
    expect(textOf(section)).not.toContain('file://')
    expect(textOf(section)).not.toMatch(/[─│]/)
    await pane.unmount()
  })

  test('terminal: a narrow pane cuts the path to its column, within the width', async ($, on) => {
    world(on, { fixture: { ...WITH_ROWS, plans: [{ ...PLAN, rows: [row('a very long task name indeed', 'Done', { deliverable: 'knowledge/a/very/long/path/to/some-file-name.md' })] }] } })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 50)
    const section = await pane.find({ key: 'deliverables' })

    for (const line of kids(section).slice(1)) {
      expect(displayWidth(textOf(line))).toBeLessThanOrEqual(50)
    }

    await pane.unmount()
  })

  test('desktop: the same three columns as Boxes; the chip is one unbreakable word in a Box wider than it', async ($, on) => {
    world(on, { fixture: WITH_ROWS })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop')
    const section = await pane.find({ key: 'deliverables' })
    const [, header, first] = kids(section)

    expect(kids(header).map(textOf)).toEqual(['TYPE', 'DELIVERABLE', 'CHANGE'])
    expect(kids(first).map(node => node.type)).toEqual(['Box', 'Box', 'Box'])
    // a proportional font makes ' .py ' wider than its cells: a breaking space lets the Text wrap and the word falls a line down
    expect(textOf(kids(first)[0])).toBe('\u00A0.py\u00A0')
    expect(kids(first)[0]?.props.width).toBeGreaterThan(5)
    expect(textOf(kids(first)[2])).toBe('—')
    await pane.unmount()
  })
})

describe('the board header', () => {
  test('a divider line sits between the plan stats and the lanes', async ($, on) => {
    world(on, { fixture: WITH_ROWS })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 100)
    const strip = kids(await pane.find({ key: 'strip' }))

    expect(strip.map(node => node.props.key ?? node.type)).toContain('plan-stats')
    expect(strip.at(-1)?.props.key).toBe('divider')
    expect(textOf(strip.at(-1))).toBe('─'.repeat(100))
    await pane.unmount()
  })
})

describe('card hover and the gap between cards', () => {
  test('on desktop a card Box lights its border on hover; the terminal keeps only its reveal box', async ($, on) => {
    world(on)
    await $.session.start(SESSION)

    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await mountPane($, surface)
      const todo = (await pane.find({ key: 'lane:Todo' }))!
      const cardOf = (nodes: Node[]): Node | undefined =>
        nodes.find(node => String(node.props?.key).startsWith('cardbox:')) ?? nodes.map(node => cardOf(kids(node))).find(one => one !== undefined)
      const card = cardOf(kids(todo))
      const hover = (card as unknown as { hover?: Record<string, unknown> }).hover

      if (surface === 'desktop') {
        expect(hover).toMatchObject({ borderStyle: 'bold', borderDimColor: false })
      } else {
        expect(hover?.borderStyle).toBeUndefined()
      }

      await pane.unmount()
    }
  })

  test('the desktop leaves a row between the cards of a lane; the terminal none', async ($, on) => {
    world(on)
    await $.session.start(SESSION)

    const desktop = await mountPane($, 'desktop')
    const terminal = await mountPane($, 'terminal')

    expect((await desktop.find({ key: 'lane:Todo' }))?.props.gap).toBe(1)
    expect((await terminal.find({ key: 'lane:Todo' }))?.props.gap).toBeUndefined()
    await desktop.unmount()
    await terminal.unmount()
  })

  test('a lane press logs the surface and the rows its pane says it shows', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop')

    await pane.press({ key: 'lane:Todo:more' })

    expect(w.logLines().find(line => line.stage === 'lane')).toMatchObject({ surface: 'desktop', bodyRows: 40, error: null })
    await pane.unmount()
  })
})

describe('the band is one target, and presses are handled by key', () => {
  const mountBand = ($: Engine, surface: 'terminal' | 'desktop') =>
    $.ui.mount({ plugin: 'plan-tracker', surface, component: 'AbovePrompt', requestId: 'band', props: bandProps(120), viewport: { columns: 125, rows: 40, isFullscreen: true } })

  test('terminal: the mascot and dot, the bar and the gap to "Plan file ›" each toggle the board; the menu and Plan file keep their own', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    const band = await mountBand($, 'terminal')

    for (const key of ['band:head', 'band:bar', 'band:head']) {
      const before = w.panes.length

      await band.press({ key })
      expect(w.panes.length).not.toBe(before)
    }

    await band.press({ key: 'band:file' })
    expect(w.panes.some(pane => pane.id === PANE_ID)).toBe(true)
    await band.unmount()
  })

  test('terminal: the bar button holds the gap up to "Plan file ›": the whole row is pressable but for the menu', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const band = await mountBand($, 'terminal')
    const row = kids(await band.find({ key: 'bar' }))

    expect(row.map(node => String(node.props?.key))).toEqual(['band:head', 'band:plans', 'band:bar', 'undefined', 'band:file'])
    expect(String(row[2]?.props.label)).toMatch(/ 5\/13 +$/)
    await band.unmount()
  })

  test('desktop: a region over the mascot, the dot, the gap, the bar and the rest posts a toggle; the count button and Plan file stay buttons', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    const band = await mountBand($, 'desktop')
    const regions = (await band.findAll({ type: 'Client' })).map(node => String(node.props.key))

    expect(regions).toEqual(['mascot', 'dot', 'gap', 'bar', 'rest'].map(name => `band:zone:${name}:region`))

    for (const key of regions) {
      const before = w.panes.length

      await band.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: key })
      await band.pointer({ type: 'up', x: 1, y: 0, button: 'left', in: key })
      await w.clock.advance(20)
      expect(w.panes.length).not.toBe(before)
    }

    await band.unmount()
  })

  test('every Button the band and the pane draw is run by key by the ui.press hook, which answers it without the closure', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)

    const pressed: string[] = []
    const buttonsOf = async (site: Awaited<ReturnType<typeof mountBand>>) => (await site.findAll({ type: 'Button' })).map(node => String(node.props.key))

    for (const surface of ['terminal', 'desktop'] as const) {
      const band = await mountBand($, surface)

      await band.press({ key: 'band:plans' })

      for (const key of (await buttonsOf(band)).filter(one => one !== 'band:plans' && one !== 'band:file' && one !== 'band:board')) {
        await band.press({ key })
        pressed.push(key)
        // a pick closes the list: open it again for the next key
        if ((await buttonsOf(band)).every(one => !one.startsWith('band:plan:'))) {
          await band.press({ key: 'band:plans' })
        }
      }

      await band.press({ key: 'band:file' })
      await band.press({ key: 'band:board' })
      pressed.push('band:plans', 'band:file', 'band:board')
      await band.unmount()

      const pane = await mountPane($, surface)

      await pane.press({ key: 'menu:name' })
      pressed.push('menu:name')
      await pane.press({ key: 'plan:alpha' })
      pressed.push('plan:alpha')
      await pane.press({ key: (await pane.find({ key: 'lane:Todo:more' })) === undefined ? 'lane:Todo:less' : 'lane:Todo:more' })
      pressed.push('lane:Todo:more')
      await openCard(pane, Number(String((await pane.findAll({ type: 'Client' }))[0]?.props.key).split(':')[1]))
      await pane.press({ key: 'back' })
      pressed.push('back')
      await pane.unmount()
    }

    const seen = w.diagnostics().filter(line => line.stage === 'press')

    expect(seen.length).toBeGreaterThanOrEqual(pressed.length)
    expect(seen.every(line => line.handled === true)).toBe(true)

    for (const key of ['band:plans', 'band:head', 'band:bar', 'band:file', 'menu:name', 'plan:alpha', 'back']) {
      expect(seen.some(line => line.element === key)).toBe(true)
    }
  })

  test('a draw of the band or the pane is logged with its surface and a count, at most once a second per hook', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop')
    const band = await mountBand($, 'desktop')

    await pane.drawn()
    await band.drawn()

    const redraws = w.diagnostics().filter(line => line.stage === 'redraw')

    expect(redraws.map(line => `${line.hook}:${line.surface}`).sort()).toEqual(['band:desktop', 'pane:desktop'])
    expect(redraws.every(line => typeof line.count === 'number')).toBe(true)
    await pane.unmount()
    await band.unmount()
  })

  test('a press is answered at once: the work it starts (opening the pane) is not awaited inside the ui.press chain', async ($, on) => {
    // The kit settles a press only once its chain has, so a hook that awaited `$.ui.open` would never return while open is held.
    const w = world(on, { openGate: () => new Promise<void>(() => undefined) })
    await $.session.start(SESSION)

    for (const surface of ['terminal', 'desktop'] as const) {
      const band = await mountBand($, surface)

      await band.press({ key: surface === 'terminal' ? 'band:bar' : 'band:file' })
      await band.unmount()
    }

    expect(w.diagnostics().filter(line => line.stage === 'press').map(line => line.handled)).toEqual([true, true])
  })

  test('the press hook logs each press with its key and surface and answers it; Plan file still opens the file', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    const band = await mountBand($, 'terminal')

    await band.press({ key: 'band:file' })

    expect(w.diagnostics().find(line => line.stage === 'press')).toMatchObject({ element: 'band:file', surface: 'terminal' })
    expect(w.panes.some(pane => pane.id === PANE_ID)).toBe(true)

    const pane = await mountPane($, 'terminal')

    expect(textOf(await pane.drawn())).toContain('# Alpha plan')
    await band.unmount()
    await pane.unmount()
  })
})

describe('Show less on an expanded lane', () => {
  const mountWith = ($: Engine, scroll: object) =>
    $.ui.mount({
      plugin: 'plan-tracker',
      surface: 'terminal',
      component: 'Pane',
      requestId: PANE_ID,
      props: { ...paneProps(140), scroll } as never,
      viewport: { columns: 200, rows: 50, isFullscreen: true },
    })

  test('a lane that fits the pane has the one button, on its header', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountWith($, { offset: 0, bodyRows: 40 })

    await pane.press({ key: 'lane:Todo:more' })

    expect(await pane.find({ key: 'lane:Todo:less' })).toMatchObject({ props: { label: 'Show less ▴' } })
    expect(await pane.find({ key: 'lane:Todo:more' })).toBeUndefined()
    await pane.unmount()
  })

  test('a lane taller than the rows the pane shows keeps the header button and the one at the bottom', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountWith($, { offset: 0, bodyRows: 6 })

    await pane.press({ key: 'lane:Todo:more' })

    expect(await pane.find({ key: 'lane:Todo:less' })).toMatchObject({ props: { label: 'Show less ▴' } })
    expect(await pane.find({ key: 'lane:Todo:more' })).toMatchObject({ props: { label: 'Show less ▴' } })
    await pane.unmount()
  })

  test('a pane that does not say its rows keeps both; a folded lane keeps its "+N more" button', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pane = await mountWith($, { offset: 0 })

    expect(await pane.find({ key: 'lane:Todo:more' })).toMatchObject({ props: { label: '+2 more ▾' } })
    await pane.press({ key: 'lane:Todo:more' })
    expect(await pane.find({ key: 'lane:Todo:more' })).toMatchObject({ props: { label: 'Show less ▴' } })
    await pane.unmount()
  })
})

describe('the formatting of usage', () => {
  test('time', () => {
    expect(durationText(42 * 60_000)).toBe('42m')
    expect(durationText(65 * 60_000)).toBe('1h 5m')
    expect(durationText(20_000)).toBe('<1m')
    expect(durationText(0)).toBe('0m')
  })

  test('tokens: a count in at most four characters', () => {
    expect(compactCount(1_200_000)).toBe('1.2M')
    expect(compactCount(48_000)).toBe('48k')
    expect(compactCount(1_234)).toBe('1.2k')
    expect(compactCount(900)).toBe('900')
  })

  test('usageStatsOf: working time, one token total (in + out, cached included), the cost, and a single effort; each a value over a label', () => {
    expect(usageStatsOf(USAGE)?.map(stat => [stat.value, stat.label])).toEqual([['42m', 'working time'], ['1.2M', 'tokens'], ['~$3.10', 'est. cost']])
    expect(usageStatsOf({ ...USAGE, effort: { high: 1 } })?.map(stat => [stat.value, stat.label])).toEqual([['42m', 'working time'], ['1.2M', 'tokens'], ['~$3.10', 'est. cost'], ['high', 'effort']])
    expect(usageStatsOf({ ...USAGE, cost_usd: null })?.map(stat => stat.label)).toEqual(['working time', 'tokens'])
    expect(usageStatsOf({ ...USAGE, tokens: { input: 10, cache_read: 5, cache_write: 5, output: 3 } })?.[1]?.value).toBe('23')
    expect(usageStatsOf(undefined)).toBeUndefined()
  })
})

/** What a stats row shows, as [value, label] pairs: the terminal's two aligned rows of text, the desktop's one Box per stat. */
const statsShown = (node: Parameters<typeof kids>[0], surface: 'terminal' | 'desktop'): string[][] => {
  if (node === undefined) {
    return []
  }

  if (surface === 'desktop') {
    return kids(node).map(stat => kids(stat).map(textOf))
  }

  const [values = '', labels = ''] = kids(node).map(textOf)
  const split = (text: string) => text.trim().split(/\s{2,}/)

  return split(values).map((value, at) => [value, split(labels)[at] ?? ''])
}

describe('the task page stats row', () => {
  const SURFACE = { current: 'terminal' as 'terminal' | 'desktop' }
  const lineText = async (pane: Awaited<ReturnType<typeof mountPane>>) => {
    const found = await pane.find({ key: 'detail:usage' })

    return found === undefined ? undefined : statsShown(found, SURFACE.current).map(([value, label]) => `${value} ${label}`).join(' | ')
  }
  const BASE = '42m working time | 1.2M tokens | ~$3.10 est. cost'

  test('a started row with usage: a row of big stats (bold value, dim label under it) of time, tokens and cost; the progress bar under it; no split of tokens, no main/subagent split', async ($, on) => {
    world(on, { fixture: WITH_ROWS })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    await openCard(pane, 0)

    expect(await lineText(pane)).toBe(BASE)
    const [values, labels] = kids(await pane.find({ key: 'detail:usage' }))

    expect(values?.props.bold).toBe(true)
    expect(values?.props.dimColor).toBeUndefined()
    expect(labels?.props.dimColor).toBe(true)
    // the columns line up: each label starts under its value
    expect(textOf(values).indexOf('1.2M')).toBe(textOf(labels).indexOf('tokens'))
    expect(textOf(values).indexOf('~$3.10')).toBe(textOf(labels).indexOf('est. cost'))
    expect(textOf(await pane.find({ key: 'field:progress' }))).toContain('▰▰▰▱▱ 3/5')
    expect(textOf(await pane.find({ key: 'detail' }))).not.toMatch(/ in \(| cached|main 18m|subagents|Working time|Effort|Tokens|Est\. cost/)
    expect(await pane.find({ key: 'detail:fields' })).toBeDefined()
    await pane.unmount()
  })

  test('a row with no started, or started with no usage, has no usage line (and no progress bar when it has no progress)', async ($, on) => {
    const board: PlanBoard = {
      ...WITH_ROWS,
      plans: [{ ...PLAN, rows: [row('old', 'Done'), row('running', 'In Progress', { started: '2026-10-11T10:00:00+09:00' }), row('has usage but no started', 'Done', { usage: USAGE })] }],
    }

    world(on, { fixture: board })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    for (const at of [0, 1, 2]) {
      await openCard(pane, at)
      expect(await lineText(pane)).toBeUndefined()
      expect(await pane.find({ key: 'field:progress' })).toBeUndefined()
      await pane.press({ key: 'back' })
    }

    await pane.unmount()
  })

  test('her own row shows no usage line; a subagent row still does', async ($, on) => {
    const started = '2026-10-11T10:00:00+09:00'
    const board: PlanBoard = {
      ...WITH_ROWS,
      plans: [{ ...PLAN, rows: [row('hers', 'Done', { route: 'serial × Sam · — — y', started, usage: USAGE }), row('theirs', 'Done', { route: 'spawn × subagent(harness-author) · Sonnet — y', started, usage: USAGE })] }],
    }

    world(on, { fixture: board })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    await openCard(pane, 0)
    expect(await lineText(pane)).toBeUndefined()
    await pane.press({ key: 'back' })
    await openCard(pane, 1)
    expect(await lineText(pane)).toBe(BASE)
    await pane.unmount()
  })

  test('a cost the tracker could not price is left out while the tokens still show', async ($, on) => {
    const board: PlanBoard = { ...WITH_ROWS, plans: [{ ...PLAN, rows: [{ ...ROWS[0]!, usage: { ...USAGE, cost_usd: null } }] }] }

    world(on, { fixture: board })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    await openCard(pane, 0)
    expect(await lineText(pane)).toBe('42m working time | 1.2M tokens')
    await pane.unmount()
  })

  test('effort rides on the line only when the work ran at one; a mix is dropped', async ($, on) => {
    const board: PlanBoard = { ...WITH_ROWS, plans: [{ ...PLAN, rows: [{ ...ROWS[0]!, usage: { ...USAGE, effort: { high: 1 } } }, ROWS[0]!] }] }

    world(on, { fixture: board })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    await openCard(pane, 0)
    expect(await lineText(pane)).toBe(`${BASE} | high effort`)
    await pane.press({ key: 'back' })
    await openCard(pane, 1)
    expect(await lineText(pane)).toBe(BASE)
    await pane.unmount()
  })

  test('desktop: one Box per stat, the value bold and normal colour (the surface has no font size), the label dim; a solid progress bar', async ($, on) => {
    world(on, { fixture: WITH_ROWS })
    await $.session.start(SESSION)
    SURFACE.current = 'desktop'
    const pane = await mountPane($, 'desktop')

    await openCard(pane, 0)
    expect(await lineText(pane)).toBe(BASE)
    expect(kids(await pane.find({ key: 'detail:usage' })).map(stat => kids(stat).map(node => [node.props.bold === true, node.props.dimColor === true]))).toEqual([
      [[true, false], [false, true]],
      [[true, false], [false, true]],
      [[true, false], [false, true]],
    ])
    SURFACE.current = 'terminal'
    expect(textOf(await pane.find({ key: 'field:progress' }))).toContain('3/5')
    expect(textOf(await pane.find({ key: 'field:progress' }))).not.toMatch(/[▰▱]/)
    await pane.unmount()
  })

  test('a Done row with a deliverable: the link and the change, then Checked by', async ($, on) => {
    const route = 'serial × inline · Opus — a — check by main session · Sonnet: x → y'
    const board: PlanBoard = {
      ...WITH_ROWS,
      plans: [{ ...PLAN, rows: [row('summary page', 'Done', { route, started: '2026-10-11T10:00:00+09:00', usage: USAGE, note: 'installed', deliverable: 'hooks/draw.tsx', change: 'plan line under the name' })] }],
    }

    world(on, { fixture: board })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    await openCard(pane, 0)
    expect(kids(await pane.find({ key: 'detail' })).map(node => String(node.props?.key ?? node.type))).toEqual(['back', 'detail:title', 'detail:usage', 'detail:fields'])

    const words = (node: unknown) => textOf(node as Node).replace(/[│╭╮╰╯├┤┬┴┼─]/g, ' ').replace(/\s+/g, ' ').trim()

    expect(kids(await pane.find({ key: 'detail:fields' })).filter(node => String(node.props?.key ?? '').startsWith('field:')).map(node => String(node.props?.key))).toEqual([
      'field:status', 'field:who', 'field:checker', 'field:note', 'field:deliverable',
    ])
    expect(words(await pane.find({ key: 'field:deliverable' }))).toBe('Deliverable hooks/draw.tsx plan line under the name')
    expect(words(await pane.find({ key: 'field:checker' }))).toBe('Checked by main session · Sonnet')
    await pane.unmount()
  })
})

describe('the board data accepts the new fields', () => {
  test('progress, started, finished, usage and deliverable_mtime come through; a damaged usage is dropped', () => {
    const json = JSON.stringify({
      plans: [
        {
          anchor: 'a',
          rows: [
            { task: 't', status: 'Done', progress: '3/5', started: 's', finished: 'f', usage: USAGE, deliverable: 'x.md', change: 'adds x', goal: 'why x', deliverable_mtime: 7 },
            { task: 'u', status: 'Todo', usage: { working_ms: 'x' }, deliverable_mtime: null },
          ],
        },
      ],
    })
    const parsed = parseBoard(json)
    const rows = 'board' in parsed ? parsed.board.plans[0]?.rows : []

    expect(rows?.[0]).toMatchObject({ progress: '3/5', started: 's', finished: 'f', usage: USAGE, change: 'adds x', goal: 'why x', deliverable_mtime: 7 })
    expect(rows?.[1]).not.toHaveProperty('usage')
    expect(rows?.[1]).not.toHaveProperty('deliverable_mtime')
    expect(rows?.[1]).not.toHaveProperty('change')
  })
})

describe('opening a task page asks the tracker for its usage', () => {
  const usageRuns = (w: ReturnType<typeof world>) => w.scriptRuns.filter(run => run.argv.includes('--usage'))

  test('a started, unfinished row runs the usage command once, then the board is read again', async ($, on) => {
    const w = world(on, { fixture: WITH_ROWS })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')
    const before = w.jsonRuns.length

    await openCard(pane, 0)
    await w.clock.advance(50)

    expect(usageRuns(w).map(run => run.argv)).toEqual([usageArgv('alpha', 0, 'Phase 2 plugin export', SESSION_ID)])
    expect(w.jsonRuns.length).toBeGreaterThan(before)
    await pane.unmount()
  })

  test('a row not started, or already finished, runs nothing; the 10 s refresh never runs it', async ($, on) => {
    const w = world(on, { fixture: { ...WITH_ROWS, plans: [{ ...PLAN, rows: [row('todo', 'Todo'), row('done', 'Done', { started: 's', finished: 'f' }), ROWS[0]!] }] } })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    await openCard(pane, 0)
    await w.clock.advance(50)
    await pane.press({ key: 'back' })
    await openCard(pane, 1)
    await w.clock.advance(50)
    await pane.press({ key: 'back' })

    expect(usageRuns(w)).toEqual([])

    await w.clock.advance(30_000)

    expect(usageRuns(w)).toEqual([])
    await pane.unmount()
  })

  test('the command is one named place', () => {
    expect(usageArgv('a', 3, 'my task', 's').slice(2)).toEqual(['a', '--usage', '--task', 'my task'])
  })
})

describe('the deliverables table: the CHANGE column', () => {
  const CHANGE = 'adds the CHANGE column to the table'
  const board = (change: string | undefined): PlanBoard => ({
    ...WITH_ROWS,
    plans: [{ ...PLAN, rows: [row('done a', 'Done', { deliverable: 'knowledge/a.md', ...(change === undefined ? {} : { change }) }), row('done b', 'Done', { deliverable: 'knowledge/b.md' })] }],
  })

  test('terminal: the change sits after the deliverable, "—" when the row has none', async ($, on) => {
    world(on, { fixture: board(CHANGE) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')
    const [, header, ...lines] = kids(await pane.find({ key: 'deliverables' }))

    expect(textOf(header).trimEnd()).toMatch(/^TYPE\s+DELIVERABLE\s+CHANGE$/)
    expect(lines.map(line => textOf(line).replace(/\s+/g, ' ').trim())).toEqual([`.md knowledge/a.md ${CHANGE}`, 'knowledge/b.md —'])
    await pane.unmount()
  })

  test('terminal: a pane too narrow for three columns stacks each deliverable: chip and whole path, then its change dim and wrapped under it; no column header', async ($, on) => {
    world(on, { fixture: board(CHANGE) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 30)
    const section = await pane.find({ key: 'deliverables' })
    const [title, first, second] = kids(section)

    expect(textOf(title)).toBe('Deliverables')
    expect(textOf(section)).not.toMatch(/TYPE|DELIVERABLE|TASK/)
    expect(kids(first).map(textOf)[0]?.replace(/\s+/g, ' ').trim()).toBe('.md knowledge/a.md')
    // the change wraps in the room under the path, every line dim and inside the pane
    const under = kids(first).slice(1)

    expect(under.length).toBeGreaterThan(1)
    expect(under.map(line => textOf(line).trim()).join(' ')).toBe(CHANGE)
    expect(under.every(line => kids(line).every(node => node.props?.dimColor === true) || line.props?.dimColor === true)).toBe(true)

    for (const line of kids(section).flatMap(block => kids(block))) {
      expect(displayWidth(textOf(line))).toBeLessThanOrEqual(30)
    }

    // a deliverable with no change is its one line, no "—" line
    expect(kids(second).map(line => textOf(line).replace(/\s+/g, ' ').trim())).toEqual(['knowledge/b.md'])
    await pane.unmount()
  })

  test('terminal: wide enough, the three columns stay (header and a CHANGE cell on every row)', async ($, on) => {
    world(on, { fixture: board(CHANGE) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 100)
    const [, header, ...lines] = kids(await pane.find({ key: 'deliverables' }))

    expect(textOf(header)).toMatch(/^TYPE\s+DELIVERABLE\s+CHANGE/)
    expect(lines.every(line => line.type === 'Text')).toBe(true)
    await pane.unmount()
  })

  test('desktop: a CHANGE Box after the deliverable, "—" when none; a narrow pane stacks instead: path row, then the change dim under it', async ($, on) => {
    world(on, { fixture: board(CHANGE) })
    await $.session.start(SESSION)

    const wide = await mountPane($, 'desktop', 140)
    const [, header, first, second] = kids(await wide.find({ key: 'deliverables' }))

    expect(kids(header).map(textOf)).toEqual(['TYPE', 'DELIVERABLE', 'CHANGE'])
    expect(textOf(kids(first)[2])).toBe(CHANGE)
    expect(textOf(kids(second)[2])).toBe('—')
    await wide.unmount()

    const narrow = await mountPane($, 'desktop', 50)
    const section = await narrow.find({ key: 'deliverables' })
    const [title, one, two] = kids(section)

    expect(textOf(title)).toBe('Deliverables')
    expect(textOf(section)).not.toMatch(/TYPE|DELIVERABLE/)
    expect(String(one?.props.key)).toBe('deliverable:0:item')
    expect(textOf(one)).toContain('knowledge/a.md')

    const [pathRow, changeText] = kids(one)

    expect(textOf(pathRow)).toContain('knowledge/a.md')
    expect(textOf(changeText)).toBe(CHANGE)
    expect(changeText?.props.dimColor === true || kids(changeText).every(node => node.props?.dimColor === true)).toBe(true)
    expect(kids(two).length).toBe(1)
    await narrow.unmount()
  })
})

describe('the deliverables table: rows that do not fit are counted, not dropped', () => {
  const PATHS = ['src/csv.ts', 'src/cli/export.ts', 'src/stream.ts', 'web/ExportButton.tsx', 'docs/export.md', 'docs/cli.md', 'README.md', 'CHANGELOG.md']
  const eight: PlanBoard = {
    ...WITH_ROWS,
    plans: [{ ...PLAN, rows: PATHS.map((path, at) => row(`task ${at}`, 'Done', { deliverable: path, deliverable_mtime: 1000 - at })) }],
  }

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${surface}: 8 deliverables show 5, then a pressable "+3 more ▾"; pressing shows all 8 and "Show less ▴"; pressing again folds`, async ($, on) => {
      world(on, { fixture: eight })
      await $.session.start(SESSION)
      const pane = await mountPane($, surface, 140)
      const text = async () => textOf(await pane.find({ key: 'deliverables' }))
      const more = async () => String((await pane.find({ key: 'lane:Deliverables:more' }))?.props.label)
      const count = (all: string) => PATHS.filter(path => all.includes(path)).length

      expect(count(await text())).toBe(5)
      expect(await text()).not.toContain('CHANGELOG.md')
      expect(await more()).toBe('+3 more ▾')

      await pane.press({ key: 'lane:Deliverables:more' })
      expect(count(await text())).toBe(8)
      expect(await more()).toBe('Show less ▴')

      await pane.press({ key: 'lane:Deliverables:more' })
      expect(count(await text())).toBe(5)
      expect(await more()).toBe('+3 more ▾')
      await pane.unmount()
    })
  }

  test('five or fewer deliverables: no overflow button', async ($, on) => {
    world(on, { fixture: { ...WITH_ROWS, plans: [{ ...PLAN, rows: PATHS.slice(0, 5).map((path, at) => row(`task ${at}`, 'Done', { deliverable: path })) }] } })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 140)

    expect(await pane.find({ key: 'lane:Deliverables:more' })).toBeUndefined()
    await pane.unmount()
  })
})

describe('the plan stats under the plan name', () => {
  const TOTALS = { working_ms: 150 * 60_000, tokens_in: 38_150_000, tokens_cached: 37_500_000, tokens_out: 50_000, cost: 9.3, measured: 3, total: 3 }
  const open: PlanEntry = { ...PLAN, started: '2026-10-11T20:08:00+09:00', usage_totals: TOTALS }
  const NOW = Date.parse('2026-10-11T21:04:00+09:00')
  const WIDE = 200
  const pairs = (plan: PlanEntry, width = WIDE, now = NOW) => planStatsOf(plan, now, width).map(stat => [stat.value, stat.label])

  test('spanText: minutes, hours with two-digit minutes, days with hours', () => {
    expect(spanText(0)).toBe('0m')
    expect(spanText(20_000)).toBe('<1m')
    expect(spanText(42 * 60_000)).toBe('42m')
    expect(spanText(65 * 60_000)).toBe('1h 05m')
    expect(spanText((2 * 24 + 3) * 3_600_000 + 20 * 60_000)).toBe('2d 3h')
  })

  test('an open plan started today: the time so far over "since HH:MM", one token total (in + out), the cost', () => {
    expect(pairs(open)).toEqual([['56m', 'since 20:08'], ['38.2M', 'tokens'], ['~$9.30', 'est. cost']])
  })

  test('started on another day the label reads since Mon D HH:MM', () => {
    expect(pairs({ ...open, started: '2026-10-09T20:08:00+09:00' })[0]).toEqual(['2d 0h', 'since Oct 9 20:08'])
  })

  test('"today" is the day on the clock the time was written in, not this machine\'s', () => {
    const started = '2026-10-11T23:30:00-05:00'

    // 04:40Z is 23:40 on the 11th at -05:00; 05:40Z is 00:40 on the 12th there
    expect(pairs({ ...open, started }, WIDE, Date.parse('2026-10-12T04:40:00Z'))[0]).toEqual(['10m', 'since 23:30'])
    expect(pairs({ ...open, started }, WIDE, Date.parse('2026-10-12T05:40:00Z'))[0]).toEqual(['1h 10m', 'since Oct 11 23:30'])
  })

  test('not every task measured: nothing says "of" or "tasks" (the header already shows n/m)', () => {
    const partial = { ...open, usage_totals: { ...TOTALS, measured: 3, total: 12 } }

    expect(pairs(partial)).toEqual(pairs(open))
    expect(JSON.stringify(planStatsOf(partial, NOW, WIDE))).not.toMatch(/tasks|\bof\b/)
  })

  test('no price: the cost stat is left out; none measured or no totals: the tokens and the cost are left out', () => {
    expect(pairs({ ...open, usage_totals: { ...TOTALS, cost: null, measured: 2, total: 4 } }).map(pair => pair[1])).toEqual(['since 20:08', 'tokens'])
    expect(pairs({ ...open, usage_totals: { ...TOTALS, tokens_in: 0, tokens_out: 0, cost: null, measured: 0, total: 4 } })).toEqual([['56m', 'since 20:08']])

    const { usage_totals: _totals, ...older } = open

    expect(pairs(older)).toEqual([['56m', 'since 20:08']])
  })

  test('a closed plan: its total time, counted to its last finish, labelled "total time"', () => {
    expect(pairs({ ...open, finished: '2026-10-11T23:13:00+09:00' }, WIDE, Date.parse('2030-01-01T00:00:00Z'))).toEqual([['3h 05m', 'total time'], ['38.2M', 'tokens'], ['~$9.30', 'est. cost']])
  })

  test('a plan no row has started has no stats and reads Not started yet, however much is known', () => {
    expect(planStatsOf({ ...PLAN, usage_totals: TOTALS }, NOW, WIDE)).toEqual([])
    expect(notStartedText({ ...PLAN, usage_totals: TOTALS })).toBe('Not started yet')
    expect(notStartedText(open)).toBe('')
  })

  test('a narrow pane drops the time stat first, then the tokens; the cost stays', () => {
    // columns: since 20:08 = 11, tokens = 6, est. cost = 9, and 3 between two
    expect(pairs(open, 32).length).toBe(3)
    expect(pairs(open, 31).map(pair => pair[1])).toEqual(['tokens', 'est. cost'])
    expect(pairs(open, 18).map(pair => pair[1])).toEqual(['tokens', 'est. cost'])
    expect(pairs(open, 17).map(pair => pair[1])).toEqual(['est. cost'])
    expect(pairs(open, 5).map(pair => pair[1])).toEqual(['est. cost'])
  })

  test('the task page row drops effort, then the time, then the tokens on a narrow pane', () => {
    const labels = (width: number) => fitStats(usageStatsOf({ ...USAGE, effort: { medium: 1 } }) ?? [], width).map(stat => stat.label)

    expect(labels(200)).toEqual(['working time', 'tokens', 'est. cost', 'effort'])
    expect(labels(42)).toEqual(['working time', 'tokens', 'est. cost', 'effort'])
    expect(labels(41)).toEqual(['working time', 'tokens', 'est. cost'])
    expect(labels(6 + 9 + 3)).toEqual(['tokens', 'est. cost'])
    expect(labels(9)).toEqual(['est. cost'])
  })

  test('the board data reads the plan fields; damaged totals are dropped', () => {
    const json = (totals: unknown) => JSON.stringify({ plans: [{ anchor: 'a', created: '2026-10-11', created_at: '2026-10-11T08:15:00+09:00', started: 's', finished: null, usage_totals: totals, rows: [] }] })
    const good = parseBoard(json(TOTALS))
    const bad = parseBoard(json({ working_ms: 'x' }))

    expect('board' in good && good.board.plans[0]).toMatchObject({ created: '2026-10-11', created_at: '2026-10-11T08:15:00+09:00', started: 's', usage_totals: TOTALS })
    expect('board' in good && good.board.plans[0]).not.toHaveProperty('finished')
    expect('board' in bad && bad.board.plans[0]).not.toHaveProperty('usage_totals')
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const closed: PlanEntry = { ...PLAN, started: '2026-10-11T20:08:00+09:00', finished: '2026-10-11T21:04:00+09:00', usage_totals: { ...TOTALS, measured: 3, total: 12 } }

    test(`${surface}: the stats sit directly under the header, the value bold over a dim label; no Summary button and no goal`, async ($, on) => {
      world(on, { fixture: { ...WITH_ROWS, plans: [closed] } })
      await $.session.start(SESSION)
      const pane = await mountPane($, surface)

      const strip = kids(await pane.find({ key: 'strip' })).map(node => String(node.props?.key))
      const stats = await pane.find({ key: 'plan-stats' })

      expect(strip).toEqual(['menu', 'plan-stats', 'divider'])
      expect(statsShown(stats, surface)).toEqual([['56m', 'total time'], ['38.2M', 'tokens'], ['~$9.30', 'est. cost']])

      const valueNodes = surface === 'desktop' ? kids(stats).map(stat => kids(stat)[0]) : [kids(stats)[0]]
      const labelNodes = surface === 'desktop' ? kids(stats).map(stat => kids(stat)[1]) : [kids(stats)[1]]

      expect(valueNodes.every(node => node?.props.bold === true && node.props.dimColor === undefined)).toBe(true)
      expect(labelNodes.every(node => node?.props.dimColor === true)).toBe(true)
      expect(await pane.find({ key: 'summary' })).toBeUndefined()
      expect(textOf(await pane.find({ key: 'menu' }))).toBe('● Alpha plan  Done  5/8Plan file ›')
      await pane.unmount()
    })
  }

  test('terminal: the label sits under its value, column for column', async ($, on) => {
    world(on, { fixture: { ...WITH_ROWS, plans: [open] } })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 100)
    const [values, labels] = kids(await pane.find({ key: 'plan-stats' })).map(textOf)

    expect(values?.indexOf('38.2M')).toBe(labels?.indexOf('tokens'))
    expect(values?.indexOf('~$9.30')).toBe(labels?.indexOf('est. cost'))
    await pane.unmount()
  })

  test('terminal: on a narrow pane the time goes first and no row is wider than the pane', async ($, on) => {
    world(on, { fixture: { ...WITH_ROWS, plans: [open] } })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 20)
    const stats = await pane.find({ key: 'plan-stats' })

    expect(statsShown(stats, 'terminal').map(pair => pair[1])).toEqual(['tokens', 'est. cost'])

    for (const line of kids(stats)) {
      expect(displayWidth(textOf(line))).toBeLessThanOrEqual(20)
    }

    await pane.unmount()
  })

  test('a plan not started: one dim "Not started yet", no stats', async ($, on) => {
    world(on, { fixture: WITH_ROWS })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')
    const note = await pane.find({ key: 'plan-stats' })

    expect(textOf(note)).toBe('Not started yet')
    expect(kids(note)[0]?.props.dimColor).toBe(true)
    await pane.unmount()
  })
})
