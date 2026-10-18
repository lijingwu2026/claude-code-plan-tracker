import { describe, expect, test } from './testing'
import type { Engine } from 'claude-code/testing'

import {
  chipCols,
  compactCount,
  costText,
  displayWidth,
  ledgerErrorText,
  laneWidth,
  parseBoard,
  planOwnText,
  progressOf,
  progressText,
  planStatsOf,
  notStartedText,
  sessionLineOf,
  statusWords,
  usageStatsOf,
  fitStats,
  whoLineOf,
  assigneeOf,
  checkerOf,
  needsYou,
  cardView,
  BORDER_COLUMNS,
} from '../hooks/board'
import type { PlanBoard, PlanEntry, PlanRow, PlanTotals, RowUsage, SessionUsage } from '../types'
import type { Node } from './fixtures'
import { PANE_ID, ROOT, SESSION, bandProps, isoAt, kids, ledgerFile, ledgerPath, openCard, paneProps, textOf, world, cardRowsIn } from './fixtures'

/** What the plugin sums for a row from the ledgers below: 1 248 000 tokens in all (the three sessions) and $3.10. */
const USAGE: RowUsage = { tokens_in: 100_000, tokens_cached: 1_100_000, tokens_cache_write: 0, tokens_out: 48_000, cost_usd: 3.1, requests: 40 }

/** What it sums over the plan: the row's and the plan's own share, 1.7M tokens and $3.90, of which $0.80 is the plan's own. */
const TOTALS: PlanTotals = {
  tokens_in: 120_000,
  tokens_cached: 1_500_000,
  tokens_cache_write: 0,
  tokens_out: 53_000,
  cost_usd: 3.9,
  requests: 52,
  plan_own: { tokens_in: 20_000, tokens_cached: 400_000, tokens_cache_write: 0, tokens_out: 5_000, cost_usd: 0.8, requests: 12 },
}

/** The row's three sessions: a terminal that ran across two hours, a Desktop one inside a minute, and a VS Code one that crossed midnight. */
const SESSIONS: SessionUsage[] = [
  { session: 's-vsc', surface: 'vscode', first: '2026-10-17T23:50:00+09:00', last: '2026-10-18T00:10:00+09:00', tokens: { in: 10_000, cached: 100_000, cache_write: 0, out: 3_000 }, cost_usd: 0.3 },
  { session: 's-term', surface: 'terminal', first: '2026-10-18T09:30:12+09:00', last: '2026-10-18T11:02:40+09:00', tokens: { in: 60_000, cached: 700_000, cache_write: 0, out: 30_000 }, cost_usd: 1.9 },
  { session: 's-desk', surface: 'desktop', first: '2026-10-18T14:05:00+09:00', last: '2026-10-18T14:05:40+09:00', tokens: { in: 30_000, cached: 300_000, cache_write: 0, out: 15_000 }, cost_usd: 0.9 },
]

/** The lines of the Sessions row: the sessions by the time they first worked on the row. */
const SESSION_LINES = [
  'Oct 17 23:50–Oct 18 00:10 · VS Code extension · 113k tokens · $0.30',
  'Oct 18 09:30–11:02 · terminal · 790k tokens · $1.90',
  'Oct 18 14:05 · Desktop · 345k tokens · $0.90',
]

/** A node and everything under it. */
const flat = (node: Node | undefined): Node[] => (node === undefined || typeof node === 'string' ? [] : [node, ...kids(node).flatMap(flat)])

const row = (task: string, status: PlanRow['status'], extra: Partial<PlanRow> = {}): PlanRow => ({ task, status, updated: null, ...extra })

const ROWS: PlanRow[] = [
  row('Phase 2 plugin export', 'In Progress', { route: 'serial × inline · Opus — x', progress: '3/5' }),
  row('Public push after her yes', 'Todo', { route: 'serial × Sam · — — y' }),
  row('README cover', 'Needs Verification', { route: 'serial × Sam · — — y', progress: '4/5' }),
  row('done a', 'Done'),
  row('done b', 'Done'),
  row('done c', 'Done'),
  row('done d', 'Done'),
  row('done e', 'Done'),
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

/** The pane on vscode, which has no `Client`: a card is a link keyed `card:<anchor>:<index>`. */
const mountVscode = ($: Engine, columns = 140) =>
  $.ui.mount({ plugin: 'plan-tracker', surface: 'vscode', component: 'Pane', requestId: PANE_ID, props: paneProps(columns), viewport: { columns: columns + 60, rows: 50, isFullscreen: true } })

/** The pane on any of the three surfaces, for the tests that read the tree and press by key. */
const mountOn = ($: Engine, surface: 'terminal' | 'desktop' | 'vscode', columns = 140) => (surface === 'vscode' ? mountVscode($, columns) : mountPane($, surface, columns))

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
  const TITLE = 'A long task title that needs two lines on any lane card here'
  const doing = (progress?: string, route = 'spawn × subagent · Sonnet — x') => row(TITLE, 'In Progress', { route, ...(progress === undefined ? {} : { progress }) })
  /** The lines of the title: those before the bar, or before the tag's line when there is no bar. */
  const titleOf = (view: ReturnType<typeof cardView>) => view.lines.slice(0, view.barAt === -1 ? (view.tag === '' ? view.lines.length : view.tagAt) : view.barAt)

  for (const columns of [170, 140, 100]) {
    for (const progress of [undefined, '3/5']) {
      test(`${columns} columns${progress === undefined ? '' : ', with progress'}: the Sonnet chip is below the title, which wraps as it does without a chip, to the card's whole inside`, () => {
        const width = laneWidth(columns)
        const view = cardView(doing(progress), width)
        const bare = cardView(doing(progress, ''), width)

        expect(view.mascot).toBe(true)
        expect(view.tag).toBe('Sonnet')
        expect(view.tagAt).toBeGreaterThanOrEqual(2)
        expect(bare.tag).toBe('')
        expect(titleOf(view)).toEqual(titleOf(bare))
        // the whole inside of the card besides the mascot: 7 columns, and its 4 of border and padding
        expect(Math.max(...titleOf(view).map(displayWidth))).toBeLessThanOrEqual(width - BORDER_COLUMNS - 7)
        expect(titleOf(view).join(' ')).toBe(TITLE)
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

describe('the board header', () => {
  test('a divider line sits between the plan stats and the lanes', async ($, on) => {
    const w = world(on, { fixture: { ...WITH_ROWS, plans: [{ ...PLAN, started: '2026-10-11T20:08:00+09:00' }] }, ledgers: LEDGERS })
    await $.session.start(SESSION)
    await w.clock.settle()
    const pane = await mountPane($, 'terminal', 100)
    const strip = kids(await pane.find({ key: 'strip' }))

    expect(strip.map(node => node.props.key ?? node.type)).toContain('plan-stats')
    expect(strip.at(-1)?.props.key).toBe('divider')
    expect(textOf(strip.at(-1))).toBe('─'.repeat(100))
    await pane.unmount()
  })

  test('the terminal divider stays one dim Text of ─ cells, one per column of the pane, at every width', async ($, on) => {
    world(on, { fixture: { ...WITH_ROWS, plans: [{ ...PLAN, started: '2026-10-11T20:08:00+09:00' }] } })
    await $.session.start(SESSION)

    for (const columns of [40, 100]) {
      const pane = await mountPane($, 'terminal', columns)
      const line = '─'.repeat(columns)

      expect(await pane.find({ key: 'divider' })).toEqual({
        type: 'Box',
        key: 'divider',
        props: { key: 'divider', marginTop: 1 },
        text: line,
        children: [{ type: 'Text', props: { dimColor: true, wrap: 'truncate' }, children: [line] }],
      })
      await pane.unmount()
    }
  })

  test('the desktop divider is a rule the surface draws across the pane: no ─ text for a proportional font to cut to "…", the same at every width', async ($, on) => {
    world(on, { fixture: { ...WITH_ROWS, plans: [{ ...PLAN, started: '2026-10-11T20:08:00+09:00' }] } })
    await $.session.start(SESSION)
    const drawn: string[] = []

    for (const columns of [40, 140]) {
      const pane = await mountPane($, 'desktop', columns)
      const strip = kids(await pane.find({ key: 'strip' }))
      const divider = strip.at(-1)

      expect(divider?.props.key).toBe('divider')
      expect(JSON.stringify(divider)).not.toContain('─')
      expect(flat(divider).filter(node => node.type === 'Text')).toEqual([])
      expect(flat(divider).filter(node => node.props.wrap === 'truncate')).toEqual([])
      expect(kids(divider).map(node => [node.type, node.props.text, node.props.dimColor])).toEqual([['Markdown', '---', true]])
      expect(divider?.props).toMatchObject({ marginTop: 1, flexDirection: 'column', width: '100%' })
      drawn.push(JSON.stringify(divider))
      await pane.unmount()
    }

    expect(drawn[0]).toBe(drawn[1])
  })
})

describe('card hover and the gap between cards', () => {
  test('on desktop a card Box lights its border on hover; the terminal card has no hover at all', async ($, on) => {
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
        expect(hover).toBeUndefined()
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

  test('a draw of the band is counted in memory, on each surface', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)

    for (const surface of ['terminal', 'desktop'] as const) {
      const before = w.bandDraws
      const band = await mountBand($, surface)

      await band.drawn()
      expect(w.bandDraws).toBeGreaterThan(before)
      await band.unmount()
    }
  })

  test('a draw of the band or the pane writes no line to the log file', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop')
    const band = await mountBand($, 'desktop')

    await pane.drawn()
    await band.drawn()
    await w.clock.advance(3_000)
    await pane.drawn()
    await band.drawn()

    expect(w.diagnostics().filter(line => line.stage === 'redraw')).toEqual([])
    expect(w.bandDraws).toBeGreaterThan(0)
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

/** The key a board command's plan `alpha` is counted under in the ledgers. */
const KEY = `${ROOT}#alpha`
const ROW0 = 'Phase 2 plugin export'

const entryOf = (row: string | null, session: SessionUsage, plan = KEY) => ({ plan, row, first: session.first, last: session.last, tokens: session.tokens, cost_usd: session.cost_usd, requests: 0 })

/** The ledger files of the three sessions: each worked on row 0, the terminal one also on the plan itself ($0.80, 12 requests). */
const LEDGERS: Record<string, string> = {
  [ledgerPath('s-term')]: ledgerFile('s-term', 'terminal', [
    { ...entryOf(ROW0, SESSIONS[1]!), requests: 20 },
    { plan: KEY, row: null, first: '2026-10-18T09:00:00+09:00', last: '2026-10-18T11:00:00+09:00', tokens: { in: 20_000, cached: 400_000, cache_write: 0, out: 5_000 }, cost_usd: 0.8, requests: 12 },
  ]),
  [ledgerPath('s-desk')]: ledgerFile('s-desk', 'desktop', [{ ...entryOf(ROW0, SESSIONS[2]!), requests: 12 }]),
  [ledgerPath('s-vsc')]: ledgerFile('s-vsc', 'vscode', [{ ...entryOf(ROW0, SESSIONS[0]!), requests: 8 }]),
}

describe('the formatting of usage', () => {
  test('tokens: a count in at most four characters', () => {
    expect(compactCount(1_200_000)).toBe('1.2M')
    expect(compactCount(48_000)).toBe('48k')
    expect(compactCount(1_234)).toBe('1.2k')
    expect(compactCount(900)).toBe('900')
  })

  test('cost: dollars and cents; under a cent it says so rather than $0.00', () => {
    expect(costText(3.1)).toBe('$3.10')
    expect(costText(0.8)).toBe('$0.80')
    expect(costText(12.345)).toBe('$12.35')
    expect(costText(0.004)).toBe('<$0.01')
    expect(costText(0)).toBe('$0.00')
  })

  test('usageStatsOf: one token total (input, cache reads, cache writes and output), then the cost; no time and no effort; each a value over a label', () => {
    expect(usageStatsOf(USAGE)?.map(stat => [stat.value, stat.label])).toEqual([['1.2M', 'tokens'], ['$3.10', 'cost']])
    expect(usageStatsOf({ ...USAGE, tokens_in: 10, tokens_cached: 5, tokens_cache_write: 5, tokens_out: 3 })?.[0]?.value).toBe('23')
    // requests whose model had no price: tokens, and no cost to state
    expect(usageStatsOf({ ...USAGE, cost_usd: 0 })?.map(stat => stat.label)).toEqual(['tokens'])
    expect(usageStatsOf({ ...USAGE, requests: 0 })).toBeUndefined()
    expect(usageStatsOf(undefined)).toBeUndefined()
  })

  test('sessionLineOf: first–last time as Oct 18 09:30–11:02, the place, the tokens, the cost; no time of work and no effort', () => {
    expect(SESSIONS.map(one => sessionLineOf(one))).toEqual(SESSION_LINES)
  })

  test('sessionLineOf: a session in the same minute is one time; another day names its date; a place there is no word for, and a cost of nothing, are left out', () => {
    const one = SESSIONS[1] as SessionUsage

    expect(sessionLineOf({ ...one, first: '2026-10-18T09:30:00+09:00', last: '2026-10-18T09:30:59+09:00' })).toBe('Oct 18 09:30 · terminal · 790k tokens · $1.90')
    expect(sessionLineOf({ ...one, last: '2026-10-19T01:02:00+09:00' })).toBe('Oct 18 09:30–Oct 19 01:02 · terminal · 790k tokens · $1.90')
    expect(sessionLineOf({ ...one, surface: 'mobile' })).toBe('Oct 18 09:30–11:02 · 790k tokens · $1.90')
    expect(sessionLineOf({ ...one, surface: 'unknown' })).toBe('Oct 18 09:30–11:02 · 790k tokens · $1.90')
    expect(sessionLineOf({ ...one, cost_usd: 0 })).toBe('Oct 18 09:30–11:02 · terminal · 790k tokens')
  })

  test('planOwnText: the plan\'s own share in the details line, as dollars, else as tokens, else nothing', () => {
    expect(planOwnText(TOTALS)).toBe('incl. $0.80 on the plan, not one task')
    expect(planOwnText({ ...TOTALS, plan_own: { ...(TOTALS.plan_own as RowUsage), cost_usd: 0 } })).toBe('incl. 425k tokens on the plan, not one task')
    expect(planOwnText({ ...TOTALS, plan_own: { ...(TOTALS.plan_own as RowUsage), cost_usd: 0, tokens_in: 0, tokens_cached: 0, tokens_out: 0 } })).toBe('')
    expect(planOwnText({ ...TOTALS, plan_own: undefined })).toBe('')
    expect(planOwnText(undefined)).toBe('')
  })

  test('ledgerErrorText: how many sessions\' usage could not be read; nothing when every one was', () => {
    expect(ledgerErrorText(['s1'])).toBe('Usage of 1 session could not be read')
    expect(ledgerErrorText(['s1', 's2'])).toBe('Usage of 2 sessions could not be read')
    expect(ledgerErrorText([])).toBe('')
    expect(ledgerErrorText(undefined)).toBe('')
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
  const BASE = '1.2M tokens | $3.10 cost'

  test('a row with usage: a row of big stats (bold value, dim label under it) of tokens and cost; the progress bar under it; no time, no effort, no split of tokens', async ($, on) => {
    const w = world(on, { fixture: WITH_ROWS, ledgers: LEDGERS })
    await $.session.start(SESSION)
    await w.clock.settle()
    const pane = await mountPane($, 'terminal')

    await openCard(pane, 0)

    expect(await lineText(pane)).toBe(BASE)
    const [values, labels] = kids(await pane.find({ key: 'detail:usage' }))

    expect(values?.props.bold).toBe(true)
    expect(values?.props.dimColor).toBeUndefined()
    expect(labels?.props.dimColor).toBe(true)
    // the columns line up: each label starts under its value
    expect(textOf(values).indexOf('1.2M')).toBe(textOf(labels).indexOf('tokens'))
    expect(textOf(values).indexOf('$3.10')).toBe(textOf(labels).indexOf('cost'))
    expect(textOf(await pane.find({ key: 'field:progress' }))).toContain('▰▰▰▱▱ 3/5')
    expect(textOf(await pane.find({ key: 'detail' }))).not.toMatch(/ in \(| cached|subagents|[Ww]orking time|[Ee]ffort|Tokens|Est\. cost|est\. cost/)
    expect(await pane.find({ key: 'detail:fields' })).toBeDefined()
    await pane.unmount()
  })

  test('a row no request was counted to has no figures: no usage line and no Sessions row, started or not (and no progress bar when it has no progress)', async ($, on) => {
    const board: PlanBoard = {
      ...WITH_ROWS,
      plans: [{ ...PLAN, rows: [row('old', 'Done'), row('running', 'In Progress', { started: '2026-10-11T10:00:00+09:00' }), row('done and started', 'Done', { started: '2026-10-11T10:00:00+09:00', finished: '2026-10-11T11:00:00+09:00' })] }],
    }

    const w = world(on, { fixture: board, ledgers: LEDGERS })
    await $.session.start(SESSION)
    await w.clock.settle()
    const pane = await mountPane($, 'terminal')

    for (const at of [0, 1, 2]) {
      await openCard(pane, at)
      expect(await lineText(pane)).toBeUndefined()
      expect(await pane.find({ key: 'field:sessions' })).toBeUndefined()
      expect(await pane.find({ key: 'field:progress' })).toBeUndefined()
      await pane.press({ key: 'back' })
    }

    await pane.unmount()
  })

  test('a row that was never started draws its figures: no `started` is needed (a plain PROGRESS.md row has none)', async ($, on) => {
    const w = world(on, { fixture: WITH_ROWS, ledgers: LEDGERS })
    await $.session.start(SESSION)
    await w.clock.settle()
    const pane = await mountPane($, 'terminal')

    expect(ROWS[0]?.started).toBeUndefined()
    await openCard(pane, 0)
    expect(await lineText(pane)).toBe(BASE)
    await pane.unmount()
  })

  test('figures the board command carries itself are not read: a row with an old-shape `usage`, and a plan with old `usage_totals`, draw nothing', async ($, on) => {
    const old = { main_ms: 1, subagent_ms: 2, effort: { high: 1 }, models: ['claude-opus-5-5'], tokens: { input: 1, cache_read: 2, cache_write: 3, output: 4 }, cost_usd: 3.1, computed_at: 'x' }
    const oldTotals = { tokens_in: 38_150_000, tokens_cached: 0, tokens_out: 50_000, cost: 9.3, measured: 1, total: 1 }
    const printed = JSON.stringify({ selected: 'alpha', plans: [{ anchor: 'alpha', name: 'Alpha plan', usage_totals: oldTotals, rows: [{ task: 'old row', status: 'In Progress', started: '2026-10-11T10:00:00+09:00', usage: old }] }] })
    const parsed = parseBoard(printed)

    expect('board' in parsed && parsed.board.plans[0]?.rows[0]).not.toHaveProperty('usage')
    expect('board' in parsed && parsed.board.plans[0]).not.toHaveProperty('usage_totals')

    // and the new shape is not read either: the plugin counts by itself, so there is one source
    const asNew = parseBoard(JSON.stringify({ plans: [{ anchor: 'alpha', usage_totals: TOTALS, rows: [{ task: 'r', status: 'Done', usage: USAGE, sessions_usage: SESSIONS }] }], ledger_errors: ['s1'] }))

    expect('board' in asNew && asNew.board.plans[0]?.rows[0]).not.toHaveProperty('usage')
    expect('board' in asNew && asNew.board.plans[0]?.rows[0]).not.toHaveProperty('sessions_usage')
    expect('board' in asNew && asNew.board.plans[0]).not.toHaveProperty('usage_totals')
    expect('board' in asNew && asNew.board).not.toHaveProperty('ledger_errors')

    world(on, { fixture: printed })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    expect(await pane.find({ key: 'plan-stats' })).toBeUndefined()
    await openCard(pane, 0)
    expect(await lineText(pane)).toBeUndefined()
    await pane.unmount()
  })

  test('her own row shows no usage line and no Sessions row; a subagent row still does', async ($, on) => {
    const board: PlanBoard = {
      ...WITH_ROWS,
      plans: [{ ...PLAN, rows: [row('hers', 'Done', { route: 'serial × Sam · — — y' }), row('theirs', 'Done', { route: 'spawn × subagent(harness-author) · Sonnet — y' })] }],
    }
    const entry = (task: string) => ({ ...entryOf(task, SESSIONS[1]!), requests: 3 })

    const w = world(on, { fixture: board, ledgers: { [ledgerPath('s-term')]: ledgerFile('s-term', 'terminal', [entry('hers'), entry('theirs')]) } })
    await $.session.start(SESSION)
    await w.clock.settle()
    const pane = await mountPane($, 'terminal')

    await openCard(pane, 0)
    expect(await lineText(pane)).toBeUndefined()
    expect(await pane.find({ key: 'field:sessions' })).toBeUndefined()
    await pane.press({ key: 'back' })
    await openCard(pane, 1)
    expect(await lineText(pane)).toBe('790k tokens | $1.90 cost')
    expect(await pane.find({ key: 'field:sessions' })).toBeDefined()
    await pane.unmount()
  })

  test('a cost of nothing (requests whose model had no price) is left out while the tokens still show', async ($, on) => {
    const free = { ...entryOf(ROW0, SESSIONS[1]!), cost_usd: 0, requests: 20 }

    const w = world(on, { fixture: WITH_ROWS, ledgers: { [ledgerPath('s-term')]: ledgerFile('s-term', 'terminal', [free]) } })
    await $.session.start(SESSION)
    await w.clock.settle()
    const pane = await mountPane($, 'terminal')

    await openCard(pane, 0)
    expect(await lineText(pane)).toBe('790k tokens')
    await pane.unmount()
  })

  test('desktop: one Box per stat, the value bold and normal colour (the surface has no font size), the label dim; a solid progress bar', async ($, on) => {
    const w = world(on, { fixture: WITH_ROWS, ledgers: LEDGERS })
    await $.session.start(SESSION)
    await w.clock.settle()
    SURFACE.current = 'desktop'
    const pane = await mountPane($, 'desktop')

    await openCard(pane, 0)
    expect(await lineText(pane)).toBe(BASE)
    expect(kids(await pane.find({ key: 'detail:usage' })).map(stat => kids(stat).map(node => [node.props.bold === true, node.props.dimColor === true]))).toEqual([
      [[true, false], [false, true]],
      [[true, false], [false, true]],
    ])
    SURFACE.current = 'terminal'
    expect(textOf(await pane.find({ key: 'field:progress' }))).toContain('3/5')
    expect(textOf(await pane.find({ key: 'field:progress' }))).not.toMatch(/[▰▱]/)
    await pane.unmount()
  })

  test('a Done row checked by a subagent: Checked by, then the note', async ($, on) => {
    const route = 'serial × inline · Opus — a — check by main session · Sonnet: x → y'
    const board: PlanBoard = {
      ...WITH_ROWS,
      plans: [{ ...PLAN, rows: [row('summary page', 'Done', { route, started: '2026-10-11T10:00:00+09:00', note: 'installed' })] }],
    }

    const w = world(on, { fixture: board, ledgers: { [ledgerPath('s-term')]: ledgerFile('s-term', 'terminal', [{ ...entryOf('summary page', SESSIONS[1]!), requests: 3 }]) } })
    await $.session.start(SESSION)
    await w.clock.settle()
    const pane = await mountPane($, 'terminal')

    await openCard(pane, 0)
    expect(kids(await pane.find({ key: 'detail' })).map(node => String(node.props?.key ?? node.type))).toEqual(['back', 'detail:title', 'detail:usage', 'detail:fields'])

    const words = (node: unknown) => textOf(node as Node).replace(/[│╭╮╰╯├┤┬┴┼─]/g, ' ').replace(/\s+/g, ' ').trim()

    expect(kids(await pane.find({ key: 'detail:fields' })).filter(node => String(node.props?.key ?? '').startsWith('field:')).map(node => String(node.props?.key))).toEqual([
      'field:status', 'field:who', 'field:checker', 'field:sessions', 'field:note',
    ])
    expect(words(await pane.find({ key: 'field:checker' }))).toBe('Checked by main session · Sonnet')
    await pane.unmount()
  })
})

describe('the board data accepts the new fields', () => {
  test('progress, started, finished and goal come through; the old usage keys are not read', () => {
    const json = JSON.stringify({
      plans: [
        {
          anchor: 'a',
          rows: [
            { task: 't', status: 'Done', progress: '3/5', started: 's', finished: 'f', usage: USAGE, goal: 'why x' },
            { task: 'u', status: 'Todo', usage: { tokens_in: 'x' } },
          ],
        },
      ],
    })
    const parsed = parseBoard(json)
    const rows = 'board' in parsed ? parsed.board.plans[0]?.rows : []

    expect(rows?.[0]).toMatchObject({ progress: '3/5', started: 's', finished: 'f', goal: 'why x' })
    expect(rows?.[0]).not.toHaveProperty('usage')
    expect(rows?.[1]).not.toHaveProperty('usage')
  })
})

describe('the Sessions row of the task page', () => {
  const openRow = async (pane: Awaited<ReturnType<typeof mountOn>>, surface: 'terminal' | 'desktop' | 'vscode') => {
    if (surface === 'vscode') {
      await pane.press({ key: 'card:alpha:0' })
    } else {
      await openCard(pane as Awaited<ReturnType<typeof mountPane>>, 0)
    }
  }

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    test(`${surface}: one line per session after Progress: first–last time, the place, tokens and cost; no time of work and no effort`, async ($, on) => {
      const w = world(on, [surface], { fixture: WITH_ROWS, ledgers: LEDGERS })
      await $.session.start({ ...SESSION, surface })
      await w.clock.settle()
      const pane = await mountOn($, surface)

      await openRow(pane, surface)

      const fields = kids(await pane.find({ key: 'detail:fields' })).map(node => String(node.props?.key)).filter(key => key.startsWith('field:'))
      const sessions = await pane.find({ key: 'field:sessions' })
      const text = textOf(sessions)

      expect(fields).toEqual(['field:status', 'field:who', 'field:progress', 'field:sessions'])
      expect(text).toContain('Sessions')

      // every line whole, the sessions by the time they first worked on the row
      const at = SESSION_LINES.map(line => text.indexOf(line))

      expect(at.every(place => place >= 0), text).toBe(true)
      expect([...at].sort((a, b) => a - b)).toEqual(at)

      if (surface !== 'terminal') {
        // a Box per line in the value column, so each wraps on its own
        const column = kids(sessions).at(-1)

        expect(kids(column).map(textOf)).toEqual(SESSION_LINES)
      }

      expect(textOf(await pane.find({ key: 'detail' }))).not.toMatch(/[Ww]orking time|[Ee]ffort/)
      await pane.unmount()
    })
  }

  for (const surface of ['desktop', 'vscode'] as const) {
    test(`${surface}: a row no request was counted to has no usage line and no Sessions row`, async ($, on) => {
      const w = world(on, [surface], { fixture: { ...WITH_ROWS, plans: [{ ...PLAN, rows: [row('uncounted', 'In Progress', { started: '2026-10-11T10:00:00+09:00' })] }] }, ledgers: LEDGERS })
      await $.session.start({ ...SESSION, surface })
      await w.clock.settle()
      const pane = await mountOn($, surface)

      await openRow(pane, surface)
      expect(await pane.find({ key: 'detail' })).toBeDefined()
      expect(await pane.find({ key: 'detail:usage' })).toBeUndefined()
      expect(await pane.find({ key: 'field:sessions' })).toBeUndefined()
      await pane.unmount()
    })
  }
})

describe('the plan stats under the plan name', () => {
  const open: PlanEntry = { ...PLAN, started: '2026-10-11T20:08:00+09:00', updated: '2026-10-11T20:52:00+09:00', usage_totals: TOTALS }
  const WIDE = 200
  const pairs = (plan: PlanEntry, width = WIDE) => planStatsOf(plan, width).map(stat => [stat.value, stat.label])

  test('an open plan: one token total (input, cache reads, cache writes, output) and the cost; no time figure, whether the plan has `updated` or not', () => {
    const { updated: _updated, ...unwritten } = open

    expect(pairs(open)).toEqual([['1.7M', 'tokens'], ['$3.90', 'cost']])
    expect(pairs(unwritten)).toEqual(pairs(open))
  })

  test('no time of any kind in the figures: not `updated`, not `since`, not `total time`, not a duration, open or closed', () => {
    const labels = (plan: PlanEntry) => planStatsOf(plan, WIDE).map(stat => stat.label)

    expect(labels(open)).toEqual(['tokens', 'cost'])
    expect(labels({ ...open, finished: '2026-10-11T23:13:00+09:00' })).toEqual(['tokens', 'cost'])
    expect(JSON.stringify(planStatsOf({ ...open, finished: '2026-10-11T23:13:00+09:00' }, WIDE))).not.toMatch(/updated|since|total time|\d+h \d+m|\d+m"/)
  })

  test('the plan\'s own share is inside the total, not added to it: the figures are usage_totals as they are', () => {
    const noOwn = { ...open, usage_totals: { ...TOTALS, plan_own: undefined } }

    expect(pairs(open)).toEqual(pairs(noOwn))
    expect(JSON.stringify(planStatsOf(open, WIDE))).not.toMatch(/tasks|\bof\b|incl/)
  })

  test('no cost: the cost stat is left out; no request counted or no totals: no figures, so no details line', () => {
    expect(pairs({ ...open, usage_totals: { ...TOTALS, cost_usd: 0 } })).toEqual([['1.7M', 'tokens']])
    expect(pairs({ ...open, usage_totals: { ...TOTALS, tokens_in: 0, tokens_cached: 0, tokens_out: 0, cost_usd: 0, requests: 0, plan_own: undefined } })).toEqual([])

    const { usage_totals: _totals, ...older } = open

    expect(pairs(older)).toEqual([])
  })

  test('a plan no row has left Todo has no stats and reads Not started yet, however much is known', () => {
    const idle = { ...PLAN, rows: ROWS.filter(one => one.status === 'Todo'), usage_totals: TOTALS }

    expect(planStatsOf(idle, WIDE)).toEqual([])
    expect(notStartedText(idle)).toBe('Not started yet')
    expect(notStartedText(open)).toBe('')
  })

  test('work under way with no start time draws the figures it has: the tokens and the cost', () => {
    const { started: _started, ...unstarted } = open

    expect(pairs(unstarted)).toEqual([['1.7M', 'tokens'], ['$3.90', 'cost']])
    expect(notStartedText(unstarted)).toBe('')

    // a row that is Verifying, Blocked or Done has left Todo too
    for (const status of ['Verifying', 'Needs Verification', 'Blocked', 'Done'] as const) {
      const rows = [row('one', 'Todo'), row('two', status)]

      expect(pairs({ ...unstarted, rows })).toEqual([['1.7M', 'tokens'], ['$3.90', 'cost']])
    }
  })

  test('work under way with no start time and nothing counted says nothing: no figures, no "Not started yet"', () => {
    const { started: _started, updated: _updated, usage_totals: _totals, ...bare } = open

    expect(planStatsOf(bare, WIDE)).toEqual([])
    expect(notStartedText(bare)).toBe('')
  })

  test('a plan whose every row is Todo or Canceled is not started, whatever else is sent: "Not started yet" and no figures', () => {
    const { started: _started, ...unstarted } = open
    const todo = { ...unstarted, rows: [row('one', 'Todo'), row('two', 'Canceled')] }

    expect(planStatsOf(todo, WIDE)).toEqual([])
    expect(notStartedText(todo)).toBe('Not started yet')
    expect(planStatsOf({ ...todo, rows: [] }, WIDE)).toEqual([])
    expect(notStartedText({ ...todo, rows: [] })).toBe('Not started yet')
  })

  test('a narrow pane drops the tokens first; the cost stays', () => {
    // columns: tokens = 6, cost = 5, and 3 between the two
    expect(pairs(open, 14).map(pair => pair[1])).toEqual(['tokens', 'cost'])
    expect(pairs(open, 13).map(pair => pair[1])).toEqual(['cost'])
    expect(pairs(open, 4).map(pair => pair[1])).toEqual(['cost'])
  })

  test('the task page row drops the tokens before the cost on a narrow pane', () => {
    const labels = (width: number) => fitStats(usageStatsOf(USAGE) ?? [], width).map(stat => stat.label)

    expect(labels(200)).toEqual(['tokens', 'cost'])
    expect(labels(6 + 5 + 3)).toEqual(['tokens', 'cost'])
    expect(labels(6 + 5 + 2)).toEqual(['cost'])
    expect(labels(5)).toEqual(['cost'])
  })

  test('the board data reads the plan fields; usage_totals is not read from the answer', () => {
    const json = (totals: unknown) => JSON.stringify({ plans: [{ anchor: 'a', created: '2026-10-11', created_at: '2026-10-11T08:15:00+09:00', started: 's', finished: null, usage_totals: totals, rows: [] }] })
    const good = parseBoard(json(TOTALS))

    expect('board' in good && good.board.plans[0]).toMatchObject({ created: '2026-10-11', created_at: '2026-10-11T08:15:00+09:00', started: 's' })
    expect('board' in good && good.board.plans[0]).not.toHaveProperty('finished')
    expect('board' in good && good.board.plans[0]).not.toHaveProperty('usage_totals')
  })

  test('the board data reads updated and idle_since per plan as written; null, empty and absent are dropped', () => {
    const json = (...plans: Record<string, unknown>[]) => JSON.stringify({ plans: plans.map(plan => ({ rows: [], ...plan })) })
    const parsed = parseBoard(
      json(
        { anchor: 'a', updated: '2026-10-12T19:40:00+09:00', idle_since: '2026-10-12T19:10:00+09:00' },
        { anchor: 'b', updated: null, idle_since: null },
        { anchor: 'c', updated: '', idle_since: '' },
        { anchor: 'd' },
      ),
    )
    const plans = 'board' in parsed ? parsed.board.plans : []

    expect(plans[0]).toMatchObject({ updated: '2026-10-12T19:40:00+09:00', idle_since: '2026-10-12T19:10:00+09:00' })

    for (const plan of plans.slice(1)) {
      expect(plan).not.toHaveProperty('updated')
      expect(plan).not.toHaveProperty('idle_since')
    }
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    // A mounted board reads the real `Date.now()`, which a test cannot set: the plan was updated and closed just now, so its times are today's.
    const justNow = Date.now()
    const closed: PlanEntry = { ...PLAN, started: '2026-10-11T20:08:00+09:00', updated: isoAt(justNow), finished: isoAt(justNow) }

    test(`${surface}: the stats sit directly under the header, the value bold over a dim label, then the plan's own share; no Summary button and no goal`, async ($, on) => {
      const w = world(on, { fixture: { ...WITH_ROWS, plans: [closed] }, ledgers: LEDGERS })
      await $.session.start(SESSION)
      await w.clock.settle()
      const pane = await mountPane($, surface)

      const strip = kids(await pane.find({ key: 'strip' })).map(node => String(node.props?.key))
      const stats = await pane.find({ key: 'plan-stats' })

      expect(strip).toEqual(['menu', 'plan-stats', 'plan-own', 'divider'])
      expect(statsShown(stats, surface)).toEqual([['1.7M', 'tokens'], ['$3.90', 'cost']])
      expect(textOf(await pane.find({ key: 'plan-own' }))).toBe('incl. $0.80 on the plan, not one task')
      expect(kids(await pane.find({ key: 'plan-own' }))[0]?.props.dimColor).toBe(true)

      const valueNodes = surface === 'desktop' ? kids(stats).map(stat => kids(stat)[0]) : [kids(stats)[0]]
      const labelNodes = surface === 'desktop' ? kids(stats).map(stat => kids(stat)[1]) : [kids(stats)[1]]

      expect(valueNodes.every(node => node?.props.bold === true && node.props.dimColor === undefined)).toBe(true)
      expect(labelNodes.every(node => node?.props.dimColor === true)).toBe(true)
      expect(await pane.find({ key: 'summary' })).toBeUndefined()
      // the header carries the plan's only time
      expect(textOf(await pane.find({ key: 'menu' }))).toContain('Done at')
      await pane.unmount()
    })

    test(`${surface}: a plan with a time and nothing counted has no details line`, async ($, on) => {
      world(on, { fixture: { ...WITH_ROWS, plans: [{ ...open, usage_totals: undefined, updated: isoAt(Date.now()) }] } })
      await $.session.start(SESSION)
      const pane = await mountPane($, surface)

      expect(kids(await pane.find({ key: 'strip' })).map(node => String(node.props?.key))).toEqual(['menu', 'divider'])
      await pane.unmount()
    })
  }

  test('terminal: the label sits under its value, column for column', async ($, on) => {
    const w = world(on, { fixture: { ...WITH_ROWS, plans: [open] }, ledgers: LEDGERS })
    await $.session.start(SESSION)
    await w.clock.settle()
    const pane = await mountPane($, 'terminal', 100)
    const [values, labels] = kids(await pane.find({ key: 'plan-stats' })).map(textOf)

    expect(values?.indexOf('1.7M')).toBe(labels?.indexOf('tokens'))
    expect(values?.indexOf('$3.90')).toBe(labels?.indexOf('cost'))
    await pane.unmount()
  })

  test('terminal: on a narrow pane the tokens go first and no row is wider than the pane', async ($, on) => {
    const w = world(on, { fixture: { ...WITH_ROWS, plans: [open] }, ledgers: LEDGERS })
    await $.session.start(SESSION)
    await w.clock.settle()
    const pane = await mountPane($, 'terminal', 11)
    const stats = await pane.find({ key: 'plan-stats' })

    expect(statsShown(stats, 'terminal').map(pair => pair[1])).toEqual(['cost'])

    for (const line of kids(stats)) {
      expect(displayWidth(textOf(line))).toBeLessThanOrEqual(11)
    }

    await pane.unmount()
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${surface}: a plan with a row under way and no start time draws its tokens and cost, not "Not started yet"`, async ($, on) => {
      const { started: _started, ...unstarted } = open

      const w = world(on, { fixture: { ...WITH_ROWS, plans: [unstarted] }, ledgers: LEDGERS })
      await $.session.start(SESSION)
      await w.clock.settle()
      const pane = await mountPane($, surface)

      expect(statsShown(await pane.find({ key: 'plan-stats' }), surface)).toEqual([['1.7M', 'tokens'], ['$3.90', 'cost']])
      expect(textOf(await pane.drawn())).not.toContain('Not started yet')
      await pane.unmount()
    })
  }

  test('a plan not started: one dim "Not started yet", no stats', async ($, on) => {
    world(on, { fixture: { ...WITH_ROWS, plans: [{ ...PLAN, rows: ROWS.filter(one => one.status === 'Todo') }] } })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')
    const note = await pane.find({ key: 'plan-stats' })

    expect(textOf(note)).toBe('Not started yet')
    expect(kids(note)[0]?.props.dimColor).toBe(true)
    await pane.unmount()
  })

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    test(`${surface}: the plan's own share is one dim line under the stats`, async ($, on) => {
      const w = world(on, [surface], { fixture: { ...WITH_ROWS, plans: [open] }, ledgers: LEDGERS })
      await $.session.start({ ...SESSION, surface })
      await w.clock.settle()
      const pane = await mountOn($, surface)

      expect(textOf(await pane.find({ key: 'plan-own' }))).toBe('incl. $0.80 on the plan, not one task')
      expect(kids(await pane.find({ key: 'plan-own' }))[0]?.props.dimColor).toBe(true)
      await pane.unmount()
    })

    test(`${surface}: a plan with no share of its own has no such line, and its stats stay`, async ($, on) => {
      const noOwn = { [ledgerPath('s-desk')]: LEDGERS[ledgerPath('s-desk')] as string }

      const w = world(on, [surface], { fixture: { ...WITH_ROWS, plans: [open] }, ledgers: noOwn })
      await $.session.start({ ...SESSION, surface })
      await w.clock.settle()
      const pane = await mountOn($, surface)

      expect(await pane.find({ key: 'plan-own' })).toBeUndefined()
      expect(await pane.find({ key: 'plan-stats' })).toBeDefined()
      await pane.unmount()
    })

    for (const [names, text] of [[['one'], 'Usage of 1 session could not be read'], [['one', 'two'], 'Usage of 2 sessions could not be read']] as const) {
      test(`${surface}: ${names.length} session${names.length === 1 ? '' : 's'} whose usage could not be read: one line under the details, "${text}"`, async ($, on) => {
        const unreadable = Object.fromEntries(names.map(name => [ledgerPath(name), '{"version":1,']))
        const w = world(on, [surface], { fixture: { ...WITH_ROWS, plans: [open] }, ledgers: { ...LEDGERS, ...unreadable } })

        await $.session.start({ ...SESSION, surface })
        // a file that will not parse is read once more after 200 ms before it counts as unreadable
        await w.clock.advance(200)

        const pane = await mountOn($, surface)

        expect(kids(await pane.find({ key: 'strip' })).map(node => String(node.props?.key))).toEqual(['menu', 'plan-stats', 'plan-own', 'ledger-errors', 'divider'])
        expect(textOf(await pane.find({ key: 'ledger-errors' }))).toBe(text)
        await pane.unmount()
      })
    }
  }

  test('no unreadable session: no ledger-errors line', async ($, on) => {
    const w = world(on, { fixture: { ...WITH_ROWS, plans: [open] }, ledgers: LEDGERS })
    await $.session.start(SESSION)
    await w.clock.settle()
    const pane = await mountPane($, 'terminal')

    expect(await pane.find({ key: 'ledger-errors' })).toBeUndefined()
    await pane.unmount()
  })

  test('the unreadable-usage line stands without stats: under a plan that shows none', async ($, on) => {
    const w = world(on, { fixture: WITH_ROWS, ledgers: { [ledgerPath('one')]: 'not json' } })

    await $.session.start(SESSION)
    await w.clock.advance(200)
    const pane = await mountPane($, 'terminal')

    expect(await pane.find({ key: 'plan-stats' })).toBeUndefined()
    expect(kids(await pane.find({ key: 'strip' })).map(node => String(node.props?.key))).toEqual(['menu', 'ledger-errors', 'divider'])
    await pane.unmount()
  })

  test('vscode: the usage line, the Sessions row and the plan lines keep vscode\'s rules: every row Box told not to wrap, no trailing space in a wrapping Text', async ($, on) => {
    const w = world(on, ['vscode'], { fixture: { ...WITH_ROWS, plans: [{ ...open, rows: [ROWS[0]!] }] }, ledgers: { ...LEDGERS, [ledgerPath('bad')]: 'not json' } })

    await $.session.start({ ...SESSION, surface: 'vscode' })
    await w.clock.advance(200)
    const pane = await mountVscode($)
    const walk = (node: Node | string | undefined): Node[] => (node === undefined || typeof node === 'string' ? [] : [node, ...(node.children ?? []).flatMap(walk)])
    // The Texts not inside another Text: each is its own box, where vscode drops a trailing space.
    const outerTexts = (node: Node | string | undefined): Node[] => (node === undefined || typeof node === 'string' ? [] : node.type === 'Text' ? [node] : (node.children ?? []).flatMap(outerTexts))
    const breaches = async () => {
      const tree = (await pane.drawn()) as unknown as Node

      return {
        wrappingRows: walk(tree).filter(node => node.type === 'Box' && (node.props?.flexDirection ?? 'row') === 'row' && node.props?.flexWrap !== 'nowrap').map(node => String(node.props?.key ?? '')),
        trailingSpaces: outerTexts(tree).filter(node => node.props?.wrap !== 'truncate' && textOf(node).endsWith(' ')).map(node => textOf(node)),
      }
    }

    expect(await breaches()).toEqual({ wrappingRows: [], trailingSpaces: [] })
    await pane.press({ key: 'card:alpha:0' })
    expect(await pane.find({ key: 'detail:usage' })).toBeDefined()
    expect(await pane.find({ key: 'field:sessions' })).toBeDefined()
    expect(await breaches()).toEqual({ wrappingRows: [], trailingSpaces: [] })
    await pane.unmount()
  })
})
