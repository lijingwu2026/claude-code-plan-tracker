import { describe, expect, test } from './testing'
import type { Engine } from 'claude-code/testing'

import { parseBoard } from '../hooks/board'
import type { PlanBoard, PlanEntry, PlanMatch } from '../types'
import { PROGRESS_REAL } from './fixtures/progress-real'
import { BOARD, PANE_ID, ROOT, SESSION, bandProps, dayName, jsonArgv, kids, localTime, paneProps, plans, textOf, world } from './fixtures'

const SURFACES = ['terminal', 'desktop'] as const

const mountPane = ($: Engine, surface: (typeof SURFACES)[number] = 'terminal', columns = 120) =>
  $.ui.mount({
    plugin: 'plan-tracker',
    surface,
    component: 'Pane',
    requestId: PANE_ID,
    props: paneProps(columns),
    viewport: { columns: columns + 60, rows: 50, isFullscreen: true },
  })

const mountBand = ($: Engine, surface: (typeof SURFACES)[number] = 'terminal', columns = 120) =>
  $.ui.mount({
    plugin: 'plan-tracker',
    surface,
    component: 'AbovePrompt',
    requestId: 'band',
    props: bandProps(columns),
    viewport: { columns: columns + 5, rows: 40, isFullscreen: true },
  })

/** Lets what a command or a press started without awaiting it (a refresh, a log line) finish. */
const settle = async (clock: { advance: (ms: number) => Promise<void> }) => {
  for (let at = 0; at < 20; at += 1) {
    await clock.advance(10)
  }
}

/** Now, and two and three days ago: the times the list shows as `19:40` (today) and `Oct 9 20:08` (another day). */
const NOW = localTime(0, 19, 40)
const TWO_DAYS = localTime(2, 20, 8)
const THREE_DAYS = localTime(3, 9, 5)
const NOW_TEXT = '19:40'
const TWO_DAYS_TEXT = `${dayName(2)} 20:08`
const THREE_DAYS_TEXT = `${dayName(3)} 09:05`

/** Every plan of the tracker, latest `updated` first, as `--query '*'` prints them: the order is the tracker's, the list keeps it. */
const ALL: PlanMatch[] = [
  { anchor: 'rule-review-landing', name: 'rule review 落地', state: 'In progress', done: 2, total: 5, updated: NOW },
  { anchor: 'alpha', name: 'Alpha plan', state: 'In progress', done: 5, total: 13, updated: NOW },
  { anchor: 'rule-review-landing-2', name: 'rule review 落地 第二轮', state: 'Idle', done: 0, total: 3, updated: TWO_DAYS },
  { anchor: 'rule-corpus', name: 'Rule corpus 退休优先 review（21 份 4 问判词）', state: 'Done', done: 4, total: 4, updated: THREE_DAYS },
  { anchor: 'gamma', name: 'Gamma', state: 'Idle', done: 0, total: 2, updated: THREE_DAYS },
  { anchor: 'old-thing', name: 'Old abandoned', state: 'Canceled', done: 1, total: 3 },
]

const LISTED: PlanBoard = { ...BOARD, message: 'All plans', matches: ALL }

/** The entry the tracker adds for a plan named by its anchor, when it is not one of the session's. */
const entryOf = (match: PlanMatch): PlanEntry => ({
  anchor: match.anchor,
  name: match.name,
  goal: '',
  plan_file: `/plans/${match.anchor}.md`,
  rows: [{ task: `${match.anchor} task`, status: 'Todo', updated: null }],
})

/** What the tracker prints for each query: `*` the list; a plan's anchor the session's plans with that plan, selected. */
const QUERIES: Record<string, PlanBoard> = {
  '*': LISTED,
  ...Object.fromEntries(
    ALL.filter(one => !BOARD.plans.some(plan => plan.anchor === one.anchor)).map(one => [one.anchor, { selected: one.anchor, message: null, plans: [...BOARD.plans, entryOf(one)] }]),
  ),
}

const setup = (on: Parameters<typeof world>[0], surfaces: readonly ('terminal' | 'desktop')[] = ['terminal']) => world(on, [...surfaces], { queries: QUERIES })

type Pane = Awaited<ReturnType<typeof mountPane>>

/** The names the list shows, in order. */
const namesOf = async (pane: Pane): Promise<string[]> => kids(await pane.find({ key: 'matches:list' })).map(row => textOf(kids(row)[0]).trim())

/** The plans the list shows with no text in the field: every plan but the Done and the Canceled ones, in the tracker's order. */
const OPEN = ALL.filter(one => one.state !== 'Done' && one.state !== 'Canceled')
const OPEN_NAMES = OPEN.map(one => one.name)
const named = (...anchors: string[]) => anchors.map(anchor => ALL.find(one => one.anchor === anchor)?.name)

describe('/plan-tracker opens the list of every plan', () => {
  for (const surface of SURFACES) {
    test(`${surface}: no words: query *, a search field with the placeholder "Search plans" and no text above every plan in the tracker's order, and the keys asked for the field`, async ($, on) => {
      const w = setup(on, [surface])
      await $.session.start(SESSION)
      await $.command.run(plans())
      const pane = await mountPane($, surface)
      await settle(w.clock)

      expect(w.jsonRuns.map(one => one.argv).at(-1)).toEqual(jsonArgv('*'))
      expect(await pane.find({ key: 'search' })).toMatchObject({ type: 'Input', props: { placeholder: 'Search plans', value: '' } })
      expect(await namesOf(pane)).toEqual(OPEN_NAMES)
      // the field is drawn above the rows
      const drawn = JSON.stringify(await pane.drawn())

      expect(drawn.indexOf('"search"')).toBeLessThan(drawn.indexOf('matches:list'))
      expect(await pane.find({ key: 'kanban' })).toBeUndefined()
      expect(w.diagnostics().filter(line => line.stage === 'focus')).toMatchObject([{ requestId: PANE_ID, key: 'search' }])
      await pane.unmount()
    })
  }

  test('each row shows the state word, done/total and when the plan was last updated; Canceled is drawn, dim gray', async ($, on) => {
    const w = setup(on)
    await $.session.start(SESSION)
    await $.command.run(plans())
    const pane = await mountPane($)
    await settle(w.clock)

    const partsOf = async () => kids(await pane.find({ key: 'matches:list' })).map(row => kids(row).map(part => textOf(part).trim()))

    expect(await partsOf()).toEqual([
      ['rule review 落地', 'In progress', '2/5', NOW_TEXT],
      ['Alpha plan', 'In progress', '5/13', NOW_TEXT],
      ['rule review 落地 第二轮', 'Idle', '0/3', TWO_DAYS_TEXT],
      ['Gamma', 'Idle', '0/2', THREE_DAYS_TEXT],
    ])
    // Done and Canceled plans are found by typing
    await pane.input({ key: 'search', text: 'corpus', kind: 'change' })
    expect(await partsOf()).toEqual([['Rule corpus 退休优先 review（21 份 4 问判词）', 'Done', '4/4', THREE_DAYS_TEXT]])
    await pane.input({ key: 'search', text: 'old abandoned', kind: 'change' })
    expect(await partsOf()).toEqual([['Old abandoned', 'Canceled', '1/3']])
    expect(kids(kids(await pane.find({ key: 'matches:list' }))[0])[1]?.props).toMatchObject({ color: 'inactive', dimColor: true })
    await pane.unmount()
  })

  test('the rows keep their match:<anchor> keys', async ($, on) => {
    const w = setup(on)
    await $.session.start(SESSION)
    await $.command.run(plans())
    const pane = await mountPane($)
    await settle(w.clock)

    expect(kids(await pane.find({ key: 'matches:list' })).map(row => kids(row)[0]?.props.key)).toEqual(OPEN.map(one => `match:${one.anchor}`))
    await pane.unmount()
  })
})

describe('typing in the search field filters the list', () => {
  for (const surface of SURFACES) {
    test(`${surface}: several changes with redraws between them: the list and the field follow the typed text`, { timeoutMs: 15_000 }, async ($, on) => {
      // the board's own plan is beta (all Done): nothing moves, so the 10 s advances run no animation frames on the terminal
      const w = world(on, [surface], { queries: { ...QUERIES, '*': { ...LISTED, selected: 'beta' } } })
      await $.session.start(SESSION)
      await $.command.run(plans())
      const pane = await mountPane($, surface)
      const steps: [string, string[]][] = [
        ['g', named('rule-review-landing', 'rule-review-landing-2', 'gamma', 'old-thing') as string[]],
        ['ga', ['Gamma']],
        ['gam x', []],
        ['', OPEN_NAMES],
      ]

      for (const [text, names] of steps) {
        await pane.input({ key: 'search', text, kind: 'change' })
        await pane.redraw()
        await w.clock.advance(10_000)
        await pane.redraw()

        expect(await namesOf(pane), text).toEqual(names)
        expect((await pane.find({ key: 'search' }))?.props.value, text).toBe(text)
      }

      // typing ran no script: only the refreshes did, with the query *
      expect(w.jsonRuns.slice(2).map(one => one.argv)).toEqual(steps.map(() => jsonArgv('*')))
      await pane.unmount()
    })
  }

  test('every word in the name or the anchor, in any order, ignoring case and - _ → : · /', async ($, on) => {
    const w = setup(on)
    await $.session.start(SESSION)
    await $.command.run(plans())
    const pane = await mountPane($)
    const RULE_REVIEW = named('rule-review-landing', 'rule-review-landing-2', 'rule-corpus')

    for (const text of ['review rule', 'REVIEW Rule', 'rule_review', 'rule→review', 'rule:review·', '/rule/ review']) {
      await pane.input({ key: 'search', text, kind: 'change' })
      expect(await namesOf(pane), text).toEqual(RULE_REVIEW)
    }

    await pane.input({ key: 'search', text: 'rule-review 落地', kind: 'change' })
    expect(await namesOf(pane)).toEqual(named('rule-review-landing', 'rule-review-landing-2'))
    await settle(w.clock)
    await pane.unmount()
  })

  test('an anchor finds its plan', async ($, on) => {
    const w = setup(on)
    await $.session.start(SESSION)
    await $.command.run(plans())
    const pane = await mountPane($)

    await pane.input({ key: 'search', text: 'old-thing', kind: 'change' })

    expect(await namesOf(pane)).toEqual(['Old abandoned'])
    await settle(w.clock)
    await pane.unmount()
  })

  test('no row left: No plan matches "<text>"', async ($, on) => {
    const w = setup(on)
    await $.session.start(SESSION)
    await $.command.run(plans())
    const pane = await mountPane($)

    await pane.input({ key: 'search', text: 'zzz', kind: 'change' })

    expect(await pane.find({ key: 'matches:list' })).toBeUndefined()
    expect(textOf(await pane.drawn())).toContain('No plan matches "zzz"')
    expect(await pane.find({ key: 'search' })).toBeDefined()
    await settle(w.clock)
    await pane.unmount()
  })

  test('Enter opens the top row: the query and the selected plan become its anchor, and the pane shows its board', async ($, on) => {
    const w = setup(on)
    await $.session.start(SESSION)
    await $.command.run(plans())
    const pane = await mountPane($)
    const band = await mountBand($)

    await pane.input({ key: 'search', text: 'review rule', kind: 'change' })
    await pane.input({ key: 'search', text: 'review rule' })
    await settle(w.clock)
    await pane.redraw()

    expect(w.jsonRuns.map(one => one.argv).at(-1)).toEqual(jsonArgv('rule-review-landing'))
    expect(await pane.find({ key: 'matches:list' })).toBeUndefined()
    expect(textOf(await pane.find({ key: 'menu' }))).toStartWith('● rule review 落地')
    expect(textOf(await band.find({ key: 'bar' }))).toContain('rule review 落地')
    await band.unmount()
    await pane.unmount()
  })

  test('Enter with no row left opens nothing', async ($, on) => {
    const w = setup(on)
    await $.session.start(SESSION)
    await $.command.run(plans())
    const pane = await mountPane($)
    const runs = w.jsonRuns.length

    await pane.input({ key: 'search', text: 'zzz' })
    await settle(w.clock)

    expect(w.jsonRuns.length).toBe(runs)
    expect(textOf(await pane.drawn())).toContain('No plan matches "zzz"')
    await pane.unmount()
  })

  test('each input event writes one log line: its kind, the length of the text, and whether it was handled', async ($, on) => {
    const w = setup(on, ['desktop'])
    await $.session.start(SESSION)
    await $.command.run(plans())
    const pane = await mountPane($, 'desktop')

    await pane.input({ key: 'search', text: 'g', kind: 'change' })
    await pane.input({ key: 'search', text: 'ga', kind: 'change' })
    await pane.input({ key: 'search', text: 'ga' })
    await settle(w.clock)

    expect(w.diagnostics().filter(line => line.stage === 'input')).toEqual([
      expect.objectContaining({ stage: 'input', error: null, element: 'search', surface: 'desktop', kind: 'change', length: 1, handled: true }),
      expect.objectContaining({ stage: 'input', error: null, element: 'search', surface: 'desktop', kind: 'change', length: 2, handled: true }),
      expect.objectContaining({ stage: 'input', error: null, element: 'search', surface: 'desktop', kind: 'submit', length: 2, handled: true }),
    ])
    await pane.unmount()
  })
})

describe('/plan-tracker <words>', () => {
  test('the words equal one plan\'s name: that plan opens, although a longer name contains them', async ($, on) => {
    const w = setup(on)
    await $.session.start(SESSION)
    await $.command.run(plans('rule review 落地'))
    const pane = await mountPane($)
    await settle(w.clock)

    expect(w.jsonRuns.map(one => one.argv).slice(1)).toEqual([jsonArgv('*'), jsonArgv('rule-review-landing')])
    expect(await pane.find({ key: 'matches:list' })).toBeUndefined()
    expect(textOf(await pane.find({ key: 'menu' }))).toStartWith('● rule review 落地')
    // the pane opens on the list before the answer, so the field is asked for the keys first
    expect(w.diagnostics().filter(line => line.stage === 'focus')).toMatchObject([{ requestId: PANE_ID, key: 'search' }])
    await pane.unmount()
  })

  test('the words equal a plan\'s anchor, normalised: that plan opens', async ($, on) => {
    const w = setup(on)
    await $.session.start(SESSION)
    await $.command.run(plans('Rule Corpus'))
    const pane = await mountPane($)
    await settle(w.clock)

    expect(w.jsonRuns.map(one => one.argv).at(-1)).toEqual(jsonArgv('rule-corpus'))
    expect(textOf(await pane.find({ key: 'menu' }))).toStartWith('● Rule corpus')
    await pane.unmount()
  })

  test('words that leave exactly one row open that plan', async ($, on) => {
    const w = setup(on)
    await $.session.start(SESSION)
    await $.command.run(plans('gam'))
    const pane = await mountPane($)
    await settle(w.clock)

    expect(w.jsonRuns.map(one => one.argv).at(-1)).toEqual(jsonArgv('gamma'))
    expect(textOf(await pane.find({ key: 'menu' }))).toStartWith('● Gamma')
    await pane.unmount()
  })

  test('several hits: the list, with the words in the field, and the keys asked for the field', async ($, on) => {
    const w = setup(on)
    await $.session.start(SESSION)
    await $.command.run(plans('rule review'))
    const pane = await mountPane($)
    await settle(w.clock)

    expect(w.jsonRuns.map(one => one.argv).at(-1)).toEqual(jsonArgv('*'))
    expect((await pane.find({ key: 'search' }))?.props.value).toBe('rule review')
    expect(await namesOf(pane)).toEqual(named('rule-review-landing', 'rule-review-landing-2', 'rule-corpus'))
    expect(w.diagnostics().filter(line => line.stage === 'focus')).toMatchObject([{ requestId: PANE_ID, key: 'search' }])
    await pane.unmount()
  })

  test('none: the list says No plan matches "<words>"', async ($, on) => {
    const w = setup(on)
    await $.session.start(SESSION)
    await $.command.run(plans('zzz'))
    const pane = await mountPane($)
    await settle(w.clock)

    expect(textOf(await pane.drawn())).toContain('No plan matches "zzz"')
    expect((await pane.find({ key: 'search' }))?.props.value).toBe('zzz')
    await pane.unmount()
  })

  test('/plan-tracker with no words after a plan was opened brings the list back, its field empty', async ($, on) => {
    const w = setup(on)
    await $.session.start(SESSION)
    await $.command.run(plans('gam'))
    await settle(w.clock)
    await $.command.run(plans())
    await settle(w.clock)
    const pane = await mountPane($)

    expect(await namesOf(pane)).toEqual(OPEN_NAMES)
    expect((await pane.find({ key: 'search' }))?.props.value).toBe('')
    await pane.unmount()
  })
})

// On the desktop alone: no animation frames run, so the 10 s advance redraws nothing but the refresh's answer.
describe('leaving the list opens a board, and the refresh keeps it', () => {
  const DESK = ['desktop'] as const

  /** After the leave: the pane shows `name`'s board, not the list, and still does after the next 10 s refresh, which asks for `anchor`. */
  const expectBoard = async (w: ReturnType<typeof setup>, pane: Pane, name: string, anchor: string) => {
    await settle(w.clock)
    await pane.redraw()
    expect(await pane.find({ key: 'matches:list' })).toBeUndefined()
    expect(textOf(await pane.find({ key: 'menu' }))).toStartWith(`● ${name}`)

    await w.clock.advance(10_000)
    await pane.redraw()
    expect(w.jsonRuns.map(one => one.argv).at(-1)).toEqual(jsonArgv(anchor))
    expect(await pane.find({ key: 'matches:list' })).toBeUndefined()
    expect(await pane.find({ key: 'search' })).toBeUndefined()
    expect(textOf(await pane.find({ key: 'menu' }))).toStartWith(`● ${name}`)
  }

  test('a pick of a row sets the query and the selected plan to its anchor', async ($, on) => {
    const w = setup(on, DESK)
    await $.session.start(SESSION)
    await $.command.run(plans())
    const pane = await mountPane($, 'desktop')
    const band = await mountBand($, 'desktop')

    await pane.press({ key: 'match:gamma' })
    await expectBoard(w, pane, 'Gamma', 'gamma')
    expect(textOf(await band.find({ key: 'bar' }))).toContain('Gamma')
    await band.unmount()
    await pane.unmount()
  })

  test('a press on the band shows the band\'s plan board in the open pane, not the list', async ($, on) => {
    const w = setup(on, DESK)
    await $.session.start(SESSION)
    await $.command.run(plans())
    const pane = await mountPane($, 'desktop')
    const band = await mountBand($, 'desktop')

    expect(await pane.find({ key: 'matches:list' })).toBeDefined()
    await band.press({ key: 'band:bar' })

    expect(w.panes.map(one => one.id)).toEqual([PANE_ID])
    await expectBoard(w, pane, 'Alpha plan', 'alpha')
    await band.unmount()
    await pane.unmount()
  })

  test('a pick from the band\'s plan list shows that plan\'s board, not the list', async ($, on) => {
    const w = setup(on, DESK)
    await $.session.start(SESSION)
    await $.command.run(plans())
    const pane = await mountPane($, 'desktop')
    const band = await mountBand($, 'desktop')

    await band.press({ key: 'band:plans' })
    await band.press({ key: 'band:plan:gamma' })
    await expectBoard(w, pane, 'Gamma', 'gamma')
    await band.unmount()
    await pane.unmount()
  })

  test('a pick from the board\'s plan menu shows that plan\'s board, not the list', async ($, on) => {
    const w = setup(on, DESK)
    await $.session.start(SESSION)
    await $.command.run(plans())
    const pane = await mountPane($, 'desktop')

    await pane.press({ key: 'match:alpha' })
    await settle(w.clock)
    await pane.press({ key: 'menu:name' })
    await pane.press({ key: 'plan:gamma' })
    await expectBoard(w, pane, 'Gamma', 'gamma')
    await pane.unmount()
  })
})

describe('with no text the list leaves out Done and Canceled plans; typing searches every plan', () => {
  test('the list with an empty field has no Done or Canceled plan', async ($, on) => {
    const w = setup(on)
    await $.session.start(SESSION)
    await $.command.run(plans())
    await settle(w.clock)
    const pane = await mountPane($)

    expect(await namesOf(pane)).toEqual(OPEN_NAMES)
    expect(await pane.find({ key: 'match:rule-corpus' })).toBeUndefined()
    expect(await pane.find({ key: 'match:old-thing' })).toBeUndefined()
    await pane.unmount()
  })

  test('typing a Done plan\'s name finds it, and a Canceled one\'s too', async ($, on) => {
    const w = setup(on)
    await $.session.start(SESSION)
    await $.command.run(plans())
    await settle(w.clock)
    const pane = await mountPane($)

    await pane.input({ key: 'search', text: 'Rule corpus', kind: 'change' })
    expect(await namesOf(pane)).toEqual(named('rule-corpus'))
    await pane.input({ key: 'search', text: 'old abandoned', kind: 'change' })
    expect(await namesOf(pane)).toEqual(['Old abandoned'])
    await pane.unmount()
  })
})

// On the desktop alone: no animation frames run while the clock is moved through the slow runs.
describe('/plan-tracker opens the pane at once and reads the tracker behind it', () => {
  const SLOW_MS = 5_000
  /** The `--json` runs take 5 s to answer, on the test clock. */
  const slow = (w: ReturnType<typeof setup>) => {
    w.jsonGate = () => w.clock.sleep(SLOW_MS)
  }

  test('a script that takes 5 s: the pane is open on the list the mod already holds before the script returns, then on the new one', async ($, on) => {
    const w = setup(on, ['desktop'])
    await $.session.start(SESSION)
    await $.command.run(plans())
    await settle(w.clock)
    const pane = await mountPane($, 'desktop')

    // a plan opened from the list: the answers since then (for gamma) carry no list
    await pane.press({ key: 'match:gamma' })
    await settle(w.clock)
    slow(w)
    w.queries = { ...w.queries, '*': { ...LISTED, matches: ALL.filter(one => one.anchor !== 'alpha') } }
    const opened = w.opened.length

    const run = $.command.run(plans())

    await w.clock.settle()
    await pane.redraw()
    expect(w.opened.length, 'the pane opens before the script answers').toBe(opened + 1)
    expect(await namesOf(pane)).toEqual(OPEN_NAMES)

    await w.clock.advance(SLOW_MS)
    await run
    await settle(w.clock)
    await pane.redraw()
    expect(await namesOf(pane)).toEqual(OPEN_NAMES.filter(name => name !== 'Alpha plan'))

    const line = w.logLines().filter(one => one.stage === 'open').at(-1)

    expect(line).toMatchObject({ stage: 'open', error: null, isPlaced: true, openMs: 0 })
    expect(line?.listMs).toBeGreaterThanOrEqual(SLOW_MS)
    await pane.unmount()
  })

  test('no list held yet: a dim Loading plans…, then the list', async ($, on) => {
    const w = setup(on, ['desktop'])
    slow(w)
    void $.session.start(SESSION)
    await w.clock.settle()

    const run = $.command.run(plans())

    await w.clock.settle()
    expect(w.opened, 'the pane opens before the script answers').toHaveLength(1)
    const pane = await mountPane($, 'desktop')

    expect(textOf(await pane.drawn())).toBe('Loading plans…')
    expect((await pane.drawn()) as unknown).toMatchObject({ type: 'Text', props: { dimColor: true } })

    // the session start's run, then the list's
    await w.clock.advance(SLOW_MS)
    await w.clock.advance(SLOW_MS)
    await run
    await settle(w.clock)
    await pane.redraw()
    expect(await namesOf(pane)).toEqual(OPEN_NAMES)
    await pane.unmount()
  })

  test('/plan-tracker <exact name> with a slow script: the list first, the words in the field, then that plan opens once the answer arrives', async ($, on) => {
    const w = setup(on, ['desktop'])
    await $.session.start(SESSION)
    await $.command.run(plans())
    await settle(w.clock)
    slow(w)
    const pane = await mountPane($, 'desktop')
    const opened = w.opened.length

    const run = $.command.run(plans('rule review 落地'))

    await w.clock.settle()
    await pane.redraw()
    expect(w.opened.length, 'the pane opens before the script answers').toBe(opened + 1)
    expect((await pane.find({ key: 'search' }))?.props.value).toBe('rule review 落地')

    await w.clock.advance(SLOW_MS)
    await run
    await settle(w.clock)
    await w.clock.advance(SLOW_MS)
    await settle(w.clock)
    await pane.redraw()
    expect(w.jsonRuns.map(one => one.argv).at(-1)).toEqual(jsonArgv('rule-review-landing'))
    expect(await pane.find({ key: 'matches:list' })).toBeUndefined()
    expect(textOf(await pane.find({ key: 'menu' }))).toStartWith('● rule review 落地')
    await pane.unmount()
  })
})

describe('parseBoard reads what --query * adds to each match', () => {
  const printed = (matches: unknown[]) => JSON.stringify({ selected: 'alpha', message: 'All plans', plans: BOARD.plans, matches })

  test('updated is read; a null one is absent', () => {
    const parsed = parseBoard(printed([{ ...ALL[0], updated: '2026-10-14T19:40:00+09:00' }, { ...ALL[5], updated: null }]))

    expect('board' in parsed && parsed.board.matches).toEqual([
      { ...ALL[0], updated: '2026-10-14T19:40:00+09:00' },
      { anchor: 'old-thing', name: 'Old abandoned', state: 'Canceled', done: 1, total: 3 },
    ])
  })

  test('the state Canceled is kept, not dropped', () => {
    const parsed = parseBoard(printed(ALL))

    expect('board' in parsed && parsed.board.matches?.map(one => one.state)).toEqual(['In progress', 'In progress', 'Idle', 'Done', 'Idle', 'Canceled'])
  })
})

// A board command that is not hers: it may know nothing of `*`, and a plain PROGRESS.md has no command at all.
describe('a board command that does not list plans, and a plain PROGRESS.md', () => {
  /** The session's three plans, each with an `updated`: Gamma the latest, Beta (all Done) next, Alpha the oldest. */
  const STAMPED: PlanBoard = {
    ...BOARD,
    plans: [
      { ...BOARD.plans[0]!, updated: TWO_DAYS },
      { ...BOARD.plans[1]!, updated: NOW },
      { ...BOARD.plans[2]!, updated: localTime(0, 21, 5) },
    ],
  }

  test('three plans and no matches: the list is drawn from the plans, latest updated first, Done left out until searched', async ($, on) => {
    const w = world(on, ['terminal'], { fixture: STAMPED })
    await $.session.start(SESSION)
    await $.command.run(plans())
    await settle(w.clock)
    const pane = await mountPane($)
    const partsOf = async () => kids(await pane.find({ key: 'matches:list' })).map(row => kids(row).map(part => textOf(part).trim()))

    expect(w.jsonRuns.map(one => one.argv)).toEqual([jsonArgv(), jsonArgv('*')])
    expect(await pane.find({ key: 'search' })).toMatchObject({ type: 'Input', props: { placeholder: 'Search plans' } })
    expect(await pane.find({ key: 'kanban' })).toBeUndefined()
    expect(await partsOf()).toEqual([
      ['Gamma', 'In progress', '0/2', '21:05'],
      ['Alpha plan', 'In progress', '5/13', TWO_DAYS_TEXT],
    ])

    await pane.input({ key: 'search', text: 'beta', kind: 'change' })
    expect(await partsOf()).toEqual([['Beta', 'Done', '2/2', NOW_TEXT]])
    await pane.unmount()
  })

  test('three plans and no matches: words that are one plan\'s name open its board', async ($, on) => {
    const w = world(on, ['terminal'], { fixture: STAMPED })
    await $.session.start(SESSION)
    await $.command.run(plans('gamma'))
    await settle(w.clock)
    const pane = await mountPane($)

    expect(w.jsonRuns.map(one => one.argv).at(-1)).toEqual(jsonArgv('gamma'))
    expect(await pane.find({ key: 'matches:list' })).toBeUndefined()
    expect(textOf(await pane.find({ key: 'menu' }))).toStartWith('● Gamma')
    await pane.unmount()
  })

  test('exactly one plan for *, as a command that takes it for a word prints: that plan\'s board opens, no list', async ($, on) => {
    const ONE: PlanBoard = { selected: 'gamma', message: 'No plan matches "*".', plans: [BOARD.plans[2]!] }
    const w = world(on, ['terminal'], { queries: { '*': ONE } })
    await $.session.start(SESSION)
    await $.command.run(plans())
    await settle(w.clock)
    const pane = await mountPane($)

    expect(w.jsonRuns.map(one => one.argv)).toEqual([jsonArgv(), jsonArgv('*'), jsonArgv('gamma')])
    expect(await pane.find({ key: 'matches:list' })).toBeUndefined()
    expect(await pane.find({ key: 'search' })).toBeUndefined()
    expect(await pane.find({ key: 'kanban' })).toBeDefined()
    expect(textOf(await pane.find({ key: 'menu' }))).toStartWith('● Gamma')
    await pane.unmount()
  })

  test('a plain PROGRESS.md has one plan: /plan-tracker opens its board, with no list and no command run', { options: { board_command: '', usage_command: '', your_name: '' } }, async ($, on) => {
    const w = world(on, ['terminal'], { files: { [`${ROOT}/PROGRESS.md`]: PROGRESS_REAL } })
    await $.session.start(SESSION)
    await $.command.run(plans('some words'))
    await settle(w.clock)
    const pane = await mountPane($)

    expect(w.opened).toEqual([{ id: PANE_ID, title: 'Plans', focus: true, rows: 60 }])
    expect(await pane.find({ key: 'search' })).toBeUndefined()
    expect(await pane.find({ key: 'matches:list' })).toBeUndefined()
    expect(await pane.find({ key: 'kanban' })).toBeDefined()
    expect(w.jsonRuns).toEqual([])
    expect(w.diagnostics().filter(line => line.stage === 'focus')).toEqual([])
    await pane.unmount()
  })
})
