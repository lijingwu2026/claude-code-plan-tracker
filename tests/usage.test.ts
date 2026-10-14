import { describe, expect, test } from './testing'
import type { Engine } from 'claude-code/testing'

import {
  chipCols,
  compactCount,
  displayWidth,
  durationText,
  laneWidth,
  parseBoard,
  progressOf,
  progressText,
  planStatsOf,
  notStartedText,
  statusWords,
  usageStatsOf,
  fitStats,
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
import { PANE_ID, SESSION, SESSION_ID, bandProps, kids, localTime, openCard, paneProps, textOf, world, cardRowsIn } from './fixtures'

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
    world(on, { fixture: { ...WITH_ROWS, plans: [{ ...PLAN, started: '2026-10-11T20:08:00+09:00', usage_totals: { working_ms: 0, tokens_in: 1_000, tokens_cached: 0, tokens_out: 0, cost: 0.5, measured: 1, total: 1 } }] } })
    await $.session.start(SESSION)
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

  test('a Done row checked by a subagent: Checked by, then the note', async ($, on) => {
    const route = 'serial × inline · Opus — a — check by main session · Sonnet: x → y'
    const board: PlanBoard = {
      ...WITH_ROWS,
      plans: [{ ...PLAN, rows: [row('summary page', 'Done', { route, started: '2026-10-11T10:00:00+09:00', usage: USAGE, note: 'installed' })] }],
    }

    world(on, { fixture: board })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    await openCard(pane, 0)
    expect(kids(await pane.find({ key: 'detail' })).map(node => String(node.props?.key ?? node.type))).toEqual(['back', 'detail:title', 'detail:usage', 'detail:fields'])

    const words = (node: unknown) => textOf(node as Node).replace(/[│╭╮╰╯├┤┬┴┼─]/g, ' ').replace(/\s+/g, ' ').trim()

    expect(kids(await pane.find({ key: 'detail:fields' })).filter(node => String(node.props?.key ?? '').startsWith('field:')).map(node => String(node.props?.key))).toEqual([
      'field:status', 'field:who', 'field:checker', 'field:note',
    ])
    expect(words(await pane.find({ key: 'field:checker' }))).toBe('Checked by main session · Sonnet')
    await pane.unmount()
  })
})

describe('the board data accepts the new fields', () => {
  test('progress, started, finished, usage and goal come through; a damaged usage is dropped', () => {
    const json = JSON.stringify({
      plans: [
        {
          anchor: 'a',
          rows: [
            { task: 't', status: 'Done', progress: '3/5', started: 's', finished: 'f', usage: USAGE, goal: 'why x' },
            { task: 'u', status: 'Todo', usage: { working_ms: 'x' } },
          ],
        },
      ],
    })
    const parsed = parseBoard(json)
    const rows = 'board' in parsed ? parsed.board.plans[0]?.rows : []

    expect(rows?.[0]).toMatchObject({ progress: '3/5', started: 's', finished: 'f', usage: USAGE, goal: 'why x' })
    expect(rows?.[1]).not.toHaveProperty('usage')
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

describe('the plan stats under the plan name', () => {
  const TOTALS = { working_ms: 150 * 60_000, tokens_in: 38_150_000, tokens_cached: 37_500_000, tokens_out: 50_000, cost: 9.3, measured: 3, total: 3 }
  const open: PlanEntry = { ...PLAN, started: '2026-10-11T20:08:00+09:00', updated: '2026-10-11T20:40:00+09:00', usage_totals: TOTALS }
  const WIDE = 200
  const pairs = (plan: PlanEntry, width = WIDE) => planStatsOf(plan, width).map(stat => [stat.value, stat.label])

  test('an open plan: one token total (in + out) over "tokens" and the cost over "est. cost"; no time figure, whether or not the plan has an updated time', () => {
    expect(pairs(open)).toEqual([['38.2M', 'tokens'], ['~$9.30', 'est. cost']])
    expect(pairs({ ...open, updated: '2026-10-09T20:08:00+09:00' })).toEqual(pairs(open))

    const { updated: _updated, ...unsent } = open

    expect(pairs(unsent)).toEqual(pairs(open))
    expect(JSON.stringify(planStatsOf(open, WIDE))).not.toMatch(/updated|since|total time|56m|20:40/)
  })

  test('not every task measured: nothing says "of" or "tasks" (the header already shows n/m)', () => {
    const partial = { ...open, usage_totals: { ...TOTALS, measured: 3, total: 12 } }

    expect(pairs(partial)).toEqual(pairs(open))
    expect(JSON.stringify(planStatsOf(partial, WIDE))).not.toMatch(/tasks|\bof\b/)
  })

  test('no price: the cost stat is left out; none measured or no totals: there is no details line', () => {
    expect(pairs({ ...open, usage_totals: { ...TOTALS, cost: null, measured: 2, total: 4 } })).toEqual([['38.2M', 'tokens']])
    expect(pairs({ ...open, usage_totals: { ...TOTALS, tokens_in: 0, tokens_out: 0, cost: null, measured: 0, total: 4 } })).toEqual([])

    const { usage_totals: _totals, ...older } = open

    expect(pairs(older)).toEqual([])
  })

  test('a closed plan reads the same: its tokens and cost, no total time and no finish time', () => {
    const closed = { ...open, finished: '2026-10-11T23:13:00+09:00', updated: '2026-10-11T23:13:00+09:00' }

    expect(pairs(closed)).toEqual([['38.2M', 'tokens'], ['~$9.30', 'est. cost']])
  })

  test('a plan no row has started has no stats and reads Not started yet, however much is known', () => {
    const idle = { ...PLAN, rows: ROWS.filter(one => one.status === 'Todo'), usage_totals: TOTALS }

    expect(planStatsOf(idle, WIDE)).toEqual([])
    expect(notStartedText(idle)).toBe('Not started yet')
    expect(notStartedText(open)).toBe('')
  })

  test('work under way with no start time (older tracker data) draws the figures it has: the tokens and the cost', () => {
    const { started: _started, ...unstarted } = open

    expect(pairs(unstarted)).toEqual([['38.2M', 'tokens'], ['~$9.30', 'est. cost']])
    expect(notStartedText(unstarted)).toBe('')

    // a row that is Verifying, Blocked or Done has left Todo too
    for (const status of ['Verifying', 'Needs Verification', 'Blocked', 'Done'] as const) {
      const rows = [row('one', 'Todo'), row('two', status)]

      expect(pairs({ ...unstarted, rows })).toEqual([['38.2M', 'tokens'], ['~$9.30', 'est. cost']])
    }
  })

  test('work under way with no start time and nothing else sent says nothing: no figures, no "Not started yet"', () => {
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
    // columns: tokens = 6, est. cost = 9, and 3 between the two
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
    const closed: PlanEntry = { ...PLAN, started: '2026-10-11T20:08:00+09:00', finished: '2026-10-11T21:04:00+09:00', updated: '2026-10-11T21:04:00+09:00', usage_totals: { ...TOTALS, measured: 3, total: 12 } }

    test(`${surface}: the details line has no time figure, whatever time the plan carries: only the tokens and the cost`, async ($, on) => {
      world(on, { fixture: { ...WITH_ROWS, plans: [{ ...open, updated: localTime(0, 19, 40) }] } })
      await $.session.start(SESSION)
      const pane = await mountPane($, surface)

      expect(statsShown(await pane.find({ key: 'plan-stats' }), surface)).toEqual([['38.2M', 'tokens'], ['~$9.30', 'est. cost']])
      expect(textOf(await pane.find({ key: 'strip' }))).not.toContain('19:40')
      expect(textOf(await pane.find({ key: 'strip' }))).not.toContain('updated')
      await pane.unmount()
    })

    test(`${surface}: a plan with a time and no tokens or cost has no details line`, async ($, on) => {
      const { usage_totals: _totals, ...timeOnly } = open

      world(on, { fixture: { ...WITH_ROWS, plans: [{ ...timeOnly, updated: localTime(0, 19, 40) }] } })
      await $.session.start(SESSION)
      const pane = await mountPane($, surface)

      expect(kids(await pane.find({ key: 'strip' })).map(node => String(node.props?.key))).toEqual(['menu', 'divider'])
      await pane.unmount()
    })

    test(`${surface}: the stats sit directly under the header, the value bold over a dim label; no Summary button and no goal`, async ($, on) => {
      world(on, { fixture: { ...WITH_ROWS, plans: [closed] } })
      await $.session.start(SESSION)
      const pane = await mountPane($, surface)

      const strip = kids(await pane.find({ key: 'strip' })).map(node => String(node.props?.key))
      const stats = await pane.find({ key: 'plan-stats' })

      expect(strip).toEqual(['menu', 'plan-stats', 'divider'])
      expect(statsShown(stats, surface)).toEqual([['38.2M', 'tokens'], ['~$9.30', 'est. cost']])

      const valueNodes = surface === 'desktop' ? kids(stats).map(stat => kids(stat)[0]) : [kids(stats)[0]]
      const labelNodes = surface === 'desktop' ? kids(stats).map(stat => kids(stat)[1]) : [kids(stats)[1]]

      expect(valueNodes.every(node => node?.props.bold === true && node.props.dimColor === undefined)).toBe(true)
      expect(labelNodes.every(node => node?.props.dimColor === true)).toBe(true)
      expect(await pane.find({ key: 'summary' })).toBeUndefined()
      expect(textOf(await pane.find({ key: 'menu' }))).toBe('● Alpha plan  Done at Oct 11 21:04  5/8Plan file ›')
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

  test('terminal: on a narrow pane the tokens go first and no row is wider than the pane', async ($, on) => {
    world(on, { fixture: { ...WITH_ROWS, plans: [open] } })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 15)
    const stats = await pane.find({ key: 'plan-stats' })

    expect(statsShown(stats, 'terminal').map(pair => pair[1])).toEqual(['est. cost'])

    for (const line of kids(stats)) {
      expect(displayWidth(textOf(line))).toBeLessThanOrEqual(15)
    }

    await pane.unmount()
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${surface}: a plan with a row under way and no start time draws its tokens and cost, not "Not started yet"`, async ($, on) => {
      const { started: _started, ...unstarted } = open

      world(on, { fixture: { ...WITH_ROWS, plans: [unstarted] } })
      await $.session.start(SESSION)
      const pane = await mountPane($, surface)

      expect(statsShown(await pane.find({ key: 'plan-stats' }), surface)).toEqual([['38.2M', 'tokens'], ['~$9.30', 'est. cost']])
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
})
