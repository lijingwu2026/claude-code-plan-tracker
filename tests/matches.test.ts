import { describe, expect, test } from './testing'
import type { Engine } from 'claude-code/testing'

import { STATE_STYLE, displayWidth, parseBoard } from '../hooks/board'
import type { PlanBoard, PlanMatch } from '../types'
import type { Node } from './fixtures'
import { BOARD, PANE_ID, SESSION, bandProps, jsonArgv, kids, paneProps, plans, textOf, world } from './fixtures'

const SURFACES = ['terminal', 'desktop'] as const

const mountPane = ($: Engine, surface: (typeof SURFACES)[number], columns = 96) =>
  $.ui.mount({
    plugin: 'plan-tracker',
    surface,
    component: 'Pane',
    requestId: PANE_ID,
    props: paneProps(columns),
    viewport: { columns: columns + 60, rows: 50, isFullscreen: true },
  })

const mountBand = ($: Engine, surface: (typeof SURFACES)[number], columns = 120) =>
  $.ui.mount({
    plugin: 'plan-tracker',
    surface,
    component: 'AbovePrompt',
    requestId: 'band',
    props: bandProps(columns),
    viewport: { columns: columns + 5, rows: 40, isFullscreen: true },
  })

/** What the tracker answers to `board` when it finds several plans: the light list, and the plans of the session untouched. */
const MATCHES: PlanMatch[] = [
  { anchor: 'p-rewrite', name: 'Plan board rewrite', state: 'In progress', done: 4, total: 12 },
  { anchor: 'p-share', name: 'Share the board as a plugin', state: 'Done', done: 5, total: 5 },
  { anchor: 'p-old', name: 'Old board notes', state: 'Idle', done: 0, total: 3 },
]

const MESSAGE = '3 plans match "board" — pick one'

const SEVERAL: PlanBoard = { ...BOARD, message: MESSAGE, matches: MATCHES }

/** The tracker's answer once the person has picked `p-share`: that plan is the tracker's own pick and is among the plans. */
const PICKED: PlanBoard = {
  selected: 'alpha',
  message: null,
  plans: [...BOARD.plans, { anchor: 'p-share', name: 'Share the board as a plugin', goal: '', plan_file: '/plans/p-share.md', rows: [{ task: 's1', status: 'Done', updated: null }] }],
}

const flat = (node: unknown) => textOf(node).replace(/\s+/g, ' ').trim()

describe('parseBoard keeps the matches the tracker lists', () => {
  const parse = (matches: unknown) => {
    const parsed = parseBoard(JSON.stringify({ selected: 'alpha', message: MESSAGE, plans: [{ anchor: 'alpha', rows: [] }], ...(matches === undefined ? {} : { matches }) }))

    return 'board' in parsed ? parsed.board : undefined
  }

  test('anchor, name, state, done and total, as written', () => {
    expect(parse(MATCHES)?.matches).toEqual(MATCHES)
  })

  test('a malformed entry is dropped, the good ones stay', () => {
    const good = MATCHES[0]
    const bad = [
      { anchor: 'x', name: 'No state', done: 1, total: 2 },
      { anchor: 'y', name: 'Unknown state', state: 'Stuck', done: 1, total: 2 },
      { anchor: 'z', name: 'Words for numbers', state: 'Idle', done: 'one', total: 2 },
      { name: 'No anchor', state: 'Idle', done: 0, total: 1 },
      { anchor: 'w', state: 'Idle', done: 0, total: 1 },
      null,
      'text',
    ]

    expect(parse([bad[0], good, ...bad.slice(1)])?.matches).toEqual([good])
  })

  test('absent, empty or not a list: the board has no matches key at all', () => {
    for (const given of [undefined, [], 'none', { anchor: 'a' }, [{ junk: true }]]) {
      expect(parse(given) && 'matches' in (parse(given) as object)).toBe(false)
    }
  })

  test('the plans and the selected plan are what the tracker said, whatever the matches are', () => {
    const board = parse(MATCHES)

    expect(board?.selected).toBe('alpha')
    expect(board?.message).toBe(MESSAGE)
    expect(board?.plans.map(plan => plan.anchor)).toEqual(['alpha'])
  })
})

describe('the pane draws the list under the message', () => {
  for (const surface of SURFACES) {
    test(`${surface}: the message, then one pressable row per plan: name, state word, done/total; no ▶ mark`, async ($, on) => {
      world(on, { fixture: SEVERAL })
      await $.session.start(SESSION)
      const pane = await mountPane($, surface, 120)
      const drawn = (await pane.drawn()) as Node
      const [message, list] = kids(drawn)

      expect(textOf(message)).toBe(MESSAGE)
      expect(message?.props.dimColor).toBe(true)
      expect(String(list?.props.key)).toBe('matches')
      expect(kids(list).map(flat)).toEqual(['Plan board rewrite In progress 4/12', 'Share the board as a plugin Done 5/5', 'Old board notes Idle 0/3'])
      expect(textOf(list)).not.toContain('▶')

      const buttons = await pane.findAll({ type: 'Button' })

      expect(buttons.map(one => String(one.props.key)).filter(key => key.startsWith('match:'))).toEqual(['match:p-rewrite', 'match:p-share', 'match:p-old'])
      await pane.unmount()
    })
  }

  test('the state words keep their colours and the count is in the accent colour, as in the plan list', async ($, on) => {
    world(on, { fixture: SEVERAL })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 120)
    const rows = kids(await pane.find({ key: 'matches' }))
    const colorOf = (row: Node | undefined, word: string) => kids(row).find(part => textOf(part).trim() === word)?.props.color

    expect(colorOf(rows[0], 'In progress')).toBe(STATE_STYLE['In progress'].color)
    expect(colorOf(rows[1], 'Done')).toBe(STATE_STYLE.Done.color)
    expect(colorOf(rows[2], 'Idle')).toBe(STATE_STYLE.Idle.color)
    expect(colorOf(rows[0], '4/12')).toBe('suggestion')
    await pane.unmount()
  })

  test('a narrow pane cuts the name, never the row: no line is wider than the pane', async ($, on) => {
    world(on, {
      fixture: { ...SEVERAL, matches: [{ anchor: 'long', name: 'A very long plan name that cannot fit in a narrow pane at all', state: 'In progress', done: 10, total: 12 }, ...MATCHES] },
    })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 40)

    for (const row of kids(await pane.find({ key: 'matches' }))) {
      expect(displayWidth(textOf(row))).toBeLessThanOrEqual(40)
    }

    await pane.unmount()
  })

  test('no matches in the answer: no list, the board is drawn as before', async ($, on) => {
    world(on, { fixture: { ...BOARD, message: 'No plan matches "zzz".' } })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal', 120)

    expect(await pane.find({ key: 'matches' })).toBeUndefined()
    expect(textOf((await pane.drawn()) as Node)).toContain('No plan matches "zzz".')
    await pane.unmount()
  })
})

describe('a pick', () => {
  for (const surface of SURFACES) {
    test(`${surface}: sets both the query and the selected plan: the tracker is asked for that plan and the pane shows it, the list gone`, async ($, on) => {
      const w = world(on, { fixture: SEVERAL })
      await $.session.start(SESSION)
      const pane = await mountPane($, surface, 120)

      // The tracker answers a query for the picked plan with its own pick (alpha) and the plan among the plans: only the
      // plugin's own `selected` can put the picked plan on the screen.
      w.fixture = PICKED
      await pane.press({ key: 'match:p-share' })

      expect(w.jsonRuns.at(-1)?.argv).toEqual(jsonArgv('p-share'))
      expect(await pane.find({ key: 'matches' })).toBeUndefined()
      expect(flat(await pane.find({ key: 'menu' }))).toContain('Share the board as a plugin')
      expect(textOf((await pane.drawn()) as Node)).not.toContain('pick one')
      await pane.unmount()
    })
  }

  test('the refreshes after it keep the picked plan as their query', async ($, on) => {
    const w = world(on, { fixture: SEVERAL })
    await $.session.start(SESSION)
    await $.command.run(plans('board'))
    const pane = await mountPane($, 'terminal', 120)

    expect(w.jsonRuns.at(-1)?.argv).toEqual(jsonArgv('board'))
    w.fixture = PICKED
    await pane.press({ key: 'match:p-share' })
    await w.clock.advance(10_000)

    expect(w.jsonRuns.at(-1)?.argv).toEqual(jsonArgv('p-share'))
    await pane.unmount()
  })
})

describe('with several matches the rest of the board is the no-query board', () => {
  for (const surface of SURFACES) {
    test(`${surface}: the band and the plan dropdown are drawn as without the matches`, async ($, on) => {
      const w = world(on, { fixture: BOARD })
      await $.session.start(SESSION)

      const draw = async () => {
        const band = await mountBand($, surface)
        const pane = await mountPane($, surface, 120)

        await band.press({ key: 'band:plans' })
        await pane.press({ key: 'menu:name' })

        // Every drawing hands its buttons new press handles: they are not part of what is drawn.
        const shape = (node: unknown) => JSON.stringify(node).replace(/"handle":\d+/g, '"handle":0')
        const out = { band: shape(await band.drawn()), bandList: shape(await band.find({ key: 'band:list' })), menu: shape(await pane.find({ key: 'menu:list' })), header: shape(await pane.find({ key: 'menu' })) }

        await band.press({ key: 'band:plans' })
        await pane.press({ key: 'menu:name' })
        await pane.unmount()
        await band.unmount()

        return out
      }

      const without = await draw()

      w.fixture = SEVERAL
      await $.command.run(plans('board'))

      const withMatches = await draw()

      expect(withMatches).toEqual(without)
      expect(without.menu).toContain('Alpha plan')
      expect(without.menu).not.toContain('Plan board rewrite')
    })
  }
})
