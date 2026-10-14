import { describe, expect, test } from './testing'
import type { Engine } from 'claude-code/testing'

import { RAINBOW, assigneeOf, checkerOf, executorOf, isYou, lanesOf, markerOf, needsYou, parseProgress, notStartedText, planStateOf, planStatsOf, settings, whoLineOf } from '../hooks/board'
import type { PlanEntry, PlanRow } from '../types'
import { PROGRESS_REAL } from './fixtures/progress-real'
import { PROGRESS_REAL_EXECUTOR } from './fixtures/progress-real-executor'
import { BOARD, PANE_ID, ROOT, SESSION, bandProps, openCard, paneProps, promptSubmit, textIn, textOf, world } from './fixtures'

/** PROGRESS.md as plan-orchestrator's route skill wrote it in a real run (a 3-step plan, `claude -p`). */
const REAL = PROGRESS_REAL
const FILE = `${ROOT}/PROGRESS.md`

/** The suite's settings with no board command: the board is read from the file. */
const FILE_MODE = { options: { board_command: '', usage_command: '', your_name: '' } }

const mountBand = ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({ plugin: 'plan-tracker', surface, component: 'AbovePrompt', requestId: 'band', props: bandProps(120), viewport: { columns: 125, rows: 40, isFullscreen: true } })

const mountPane = ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({ plugin: 'plan-tracker', surface, component: 'Pane', requestId: PANE_ID, props: paneProps(96), viewport: { columns: 156, rows: 50, isFullscreen: true } })

const planOf = (text: string): PlanEntry => {
  const parsed = parseProgress(text, FILE, 'proj')

  if (!('board' in parsed)) {
    throw new Error(parsed.error)
  }

  return parsed.board.plans[0]!
}

const withStatus = (status: string) => `# Progress\n\n| task | status | evidence |\n|---|---|---|\n| one | ${status} | seen |\n`

describe('the board file: a real PROGRESS.md', () => {
  test('the route skill\'s table is one plan with its rows, statuses and evidence', () => {
    const plan = planOf(REAL)

    expect(plan.name).toBe('Progress')
    expect(plan.plan_file).toBe(FILE)
    expect(plan.rows.map(row => row.status)).toEqual(['Done', 'Done', 'Done'])
    expect(plan.rows[0]?.task).toBe('1. Create greet.py with greet(name)')
    expect(plan.rows[1]?.note).toContain('Ran 1 test')
    expect(lanesOf(plan).map(lane => lane.header)).toEqual(['Todo 0', 'In Progress 0', 'Verify 0', 'Done 3'])
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${surface}: the band counts the rows and the pane draws the lanes and the cards`, FILE_MODE, async ($, on) => {
      world(on, { surfaces: [surface], files: { [FILE]: REAL } })
      await $.session.start(SESSION)
      const band = await mountBand($, surface)
      const pane = await mountPane($, surface)

      expect(textOf(await band.drawn())).toContain('3/3')

      const text = await textIn(pane, await pane.drawn())

      expect(text).toContain('Done 3')
      expect(text).toContain('Todo 0')
      expect(text).toContain('Create greet.py')
      await band.unmount()
      await pane.unmount()
    })
  }

  test('columns are found by the header row, in any order and any case; optional ones are read when present', () => {
    const plan = planOf(
      '| Evidence | STATUS | Task | Executor | Goal |\n|---|---|---|---|---|\n| ok | **In Progress** | build it | subagent | prove it |\n',
    )
    const row = plan.rows[0]!

    expect(row).toMatchObject({ task: 'build it', status: 'In Progress', note: 'ok', goal: 'prove it' })
    expect(executorOf(row)).toBe('subagent')
  })

  test('an optional goal column is read, wherever it stands in the header', () => {
    const plan = planOf('| goal | task | status |\n|---|---|---|\n| Prove the export works | build it | Done |\n| | plain | Todo |\n')

    expect(plan.rows[0]).toMatchObject({ task: 'build it', goal: 'Prove the export works' })
    expect(plan.rows[1]).not.toHaveProperty('goal')
  })

  test('an executor equal to your_name is you; with no name set nobody is', () => {
    const row = planOf('| task | status | executor |\n|---|---|---|\n| t | Todo | Sam |\n').rows[0]!

    expect(settings.yourName).toBe('Sam')
    expect(executorOf(row)).toBe('Sam')
  })

  test('a plain PROGRESS.md has no updated and no idle_since, even with such columns, so no time figure', () => {
    const plan = planOf('| task | status | updated | idle_since |\n|---|---|---|---|\n| a | Todo | 2026-10-12T14:02:00+09:00 | 2026-10-12T14:02:00+09:00 |\n')

    expect(plan).not.toHaveProperty('updated')
    expect(plan).not.toHaveProperty('idle_since')
    expect(planStatsOf(plan, 100)).toEqual([])
  })
})

describe('the board file: a row under way and no figures', () => {
  test('a plain PROGRESS.md with a row under way has no figures and does not read "Not started yet"', FILE_MODE, async ($, on) => {
    const plan = planOf(withStatus('In Progress'))

    expect(planStatsOf(plan, 100)).toEqual([])
    expect(notStartedText(plan)).toBe('')

    world(on, { files: { [FILE]: withStatus('In Progress') } })
    await $.session.start(SESSION)

    const pane = await mountPane($)

    expect(await pane.find({ key: 'plan-stats' })).toBeUndefined()
    expect(textOf(await pane.drawn())).not.toContain('Not started yet')
    await pane.unmount()
  })
})

describe('the board file: the kit\'s executor and check columns', () => {
  const plan = () => planOf(PROGRESS_REAL_EXECUTOR)

  test('executor and check are read into the row: who-chip from the model, Done by and Checked by from the cells', () => {
    const [done, verify] = plan().rows as [PlanRow, PlanRow]

    expect(done.check).toBe('script (grep)')
    expect(whoLineOf(done)).toEqual({ tier: 'Sonnet', executor: 'main session' })
    // a Done card has no tag: the page says who did it
    expect(assigneeOf(done)).toBeUndefined()
    expect(checkerOf(done)).toBe('script (grep)')
    expect(checkerOf(verify)).toBe('you')
    expect(lanesOf(plan()).map(lane => lane.header)).toEqual(['Todo 0', 'In Progress 0', 'Verify 1', 'Done 1'])
  })

  test('a Needs Verification row whose check is you shows the marker and the you chip; the Done row shows neither', () => {
    const [done, verify] = plan().rows as [PlanRow, PlanRow]

    expect(needsYou(verify)).toBe(true)
    expect(markerOf(verify)).toBe('◆ needs you · ')
    expect(assigneeOf(verify)).toBe('you')
    expect(needsYou(done)).toBe(false)
  })

  test('an executor of you is the user without your_name: you chip and Done by on a Todo row, needs you once it waits for verification', () => {
    const [todo, verify] = planOf('| task | status | executor | check |\n|---|---|---|---|\n| a | Todo | you | script |\n| b | Needs Verification | you | script |\n').rows as [PlanRow, PlanRow]

    expect(whoLineOf(todo)).toEqual({ executor: 'you' })
    expect(assigneeOf(todo)).toBe('you')
    expect(needsYou(todo)).toBe(false)
    expect(needsYou(verify)).toBe(true)
  })

  test('`you` counts as the user in any case, with or without your_name; other names only through your_name', () => {
    expect(isYou('You')).toBe(true)
    expect(isYou('YOU')).toBe(true)
    expect(isYou('Sam')).toBe(true)
    expect(isYou('someone')).toBe(false)
    expect(isYou(undefined)).toBe(false)

    const name = settings.yourName

    settings.yourName = ''
    expect(isYou('you')).toBe(true)
    expect(isYou('Sam')).toBe(false)
    settings.yourName = name
  })

  test('header case is ignored for the two columns', () => {
    const row = planOf('| Task | Status | EXECUTOR | Check |\n|---|---|---|---|\n| t | Todo | subagent · Haiku | You |\n').rows[0]!

    expect(assigneeOf(row)).toBe('Haiku')
    expect(checkerOf(row)).toBe('you')
  })

  test('the pane: the task page shows Checked by script (grep) on the Done row, and the Verify card carries the marker', FILE_MODE, async ($, on) => {
    world(on, { files: { [FILE]: PROGRESS_REAL_EXECUTOR } })
    await $.session.start(SESSION)
    const pane = await mountPane($)

    expect(await textIn(pane, await pane.drawn())).toContain('◆ needs you')
    await openCard(pane, 0)
    const text = textOf(await pane.find({ key: 'field:who' }))

    expect(text).toContain('main session')
    expect(text).toContain('Sonnet')
    expect(textOf(await pane.find({ key: 'field:checker' })).replace(/[│╭╮╰╯├┤┬┴┼─]/g, ' ').replace(/\s+/g, ' ').trim()).toBe('Checked by script (grep)')
    await pane.unmount()
  })
})

describe('the board file: a status the reader does not know', () => {
  test('it gets its own lane, named for the status, and the row keeps its text', () => {
    const plan = planOf(`${withStatus('Parked')}| two | Done | ok |\n| three | Parked | later |\n`)
    const lanes = lanesOf(plan)

    expect(lanes.map(lane => lane.header)).toEqual(['Todo 0', 'In Progress 0', 'Verify 0', 'Done 1', 'Parked 2'])
    expect(lanes.at(-1)?.cards.map(card => card.row.statusText)).toEqual(['Parked', 'Parked'])
  })

  test('two unknown statuses share a lane called Other; no unknown status, no fifth lane', () => {
    expect(lanesOf(planOf(`${withStatus('Parked')}| two | Waiting | x |\n`)).at(-1)?.header).toBe('Other 2')
    expect(lanesOf(planOf(withStatus('Done'))).length).toBe(4)
  })

  test('an empty status cell is an unknown status too, not a dropped row', () => {
    expect(planOf(withStatus('')).rows).toHaveLength(1)
  })

  test('the pane shows every row: a card in the lane and the status on its page', FILE_MODE, async ($, on) => {
    world(on, { files: { [FILE]: withStatus('Parked') } })
    await $.session.start(SESSION)
    const pane = await mountPane($)

    expect(await textIn(pane, await pane.drawn())).toContain('Parked 1')
    await pane.unmount()
  })
})

describe('the board file: what it cannot read is one line saying why', () => {
  const cases: [string, string, string][] = [
    ['prose with no table', 'We will do three things.\n', 'has no markdown table with "task" and "status" columns'],
    ['a table without the columns', '| a | b |\n|---|---|\n| 1 | 2 |\n', 'has a table, but none with both a "task" and a "status" column'],
    ['a header and no rows', '| task | status |\n|---|---|\n', 'has no rows with a task'],
    ['an empty file', '\n', 'is empty'],
  ]

  for (const [name, text, reason] of cases) {
    test(`${name}: ${reason}`, FILE_MODE, async ($, on) => {
      expect(parseProgress(text, FILE, 'proj')).toEqual({ error: expect.stringContaining(reason) })
      world(on, { files: { [FILE]: text } })
      await $.session.start(SESSION)
      const pane = await mountPane($)
      const drawn = textOf(await pane.drawn())

      expect(drawn).toContain(reason)
      expect(drawn.split('\n')).toHaveLength(1)
      await pane.unmount()
    })
  }

  test('no file yet is a message, not an error: the pane says the route skill writes it', FILE_MODE, async ($, on) => {
    world(on, { files: {} })
    await $.session.start(SESSION)
    const pane = await mountPane($)

    expect(textOf(await pane.drawn())).toContain('No PROGRESS.md yet')
    await pane.unmount()
  })

  test('a board_location that is a "command:" board is named as one line', { options: { board_command: '', board_location: 'command:gh project item-list' } }, async ($, on) => {
    world(on, { files: {} })
    await $.session.start(SESSION)
    const pane = await mountPane($)

    expect(textOf(await pane.drawn())).toContain('set board_command')
    await pane.unmount()
  })
})

describe('the board file: live refresh', () => {
  test('a changed file redraws the band and the pane with no prompt and no command', FILE_MODE, async ($, on) => {
    const w = world(on, { files: { [FILE]: REAL.replace(/\| Done \|/g, '| Todo |').replace('| Todo |', '| In Progress |') } })
    await $.session.start(SESSION)
    const band = await mountBand($)
    const pane = await mountPane($)

    expect(textOf(await band.drawn())).toContain('0/3')
    expect(await textIn(pane, await pane.drawn())).toContain('In Progress 1')

    // The agent finishes the first step: only the file changes.
    w.files = { [FILE]: REAL.replace(/\| Done \|/g, '| Todo |').replace('| Todo |', '| Done |') }
    await w.clock.advance(3_000)

    expect(textOf(await band.drawn())).toContain('1/3')
    expect(await textIn(pane, await pane.drawn())).toContain('Done 1')
    expect(await textIn(pane, await pane.drawn())).toContain('In Progress 0')

    w.files = { [FILE]: REAL }
    await w.clock.advance(3_000)

    expect(textOf(await band.drawn())).toContain('3/3')
    await band.unmount()
    await pane.unmount()
  })

  test('a file that did not change is read again but redraws nothing', FILE_MODE, async ($, on) => {
    const w = world(on, { files: { [FILE]: REAL } })
    await $.session.start(SESSION)
    const band = await mountBand($)
    const pane = await mountPane($)

    await band.drawn()
    await pane.drawn()

    const reads = () => w.reads.filter(path => path === FILE).length
    const before = reads()
    const drawnBefore = w.bandDraws

    await w.clock.advance(6_000)

    expect(reads()).toBeGreaterThan(before)
    expect(drawnBefore).toBeGreaterThan(0)
    expect(w.bandDraws).toBe(drawnBefore)
    await band.unmount()
    await pane.unmount()
  })

  test('with a board command set the file is not polled', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    const runs = w.jsonRuns.length

    await w.clock.advance(6_000)

    expect(w.jsonRuns.length).toBe(runs)
    expect(w.reads.filter(path => path === FILE)).toEqual([])
  })
})

describe('the board file: the plan line', () => {
  test('a PROGRESS.md plan has no times or usage: no line under the plan name once work is under way, the state word is the header\'s, and a task page has no usage line', FILE_MODE, async ($, on) => {
    world(on, { files: { [FILE]: REAL } })
    await $.session.start(SESSION)
    const pane = await mountPane($)

    expect(await pane.find({ key: 'summary' })).toBeUndefined()
    expect(await pane.find({ key: 'plan-stats' })).toBeUndefined()
    expect(textOf(await pane.find({ key: 'menu' }))).toBe('● Progress  Done  3/3Plan file ›')
    await openCard(pane, 0)
    expect(await pane.find({ key: 'detail:usage' })).toBeUndefined()
    await pane.unmount()
  })
})

describe('the board file: the plan state', () => {
  const state = (...statuses: string[]) => planStateOf(planOf(`# Progress\n\n| task | status | evidence |\n|---|---|---|\n${statuses.map((status, at) => `| t${at} | ${status} | seen |`).join('\n')}\n`))

  test('every row Done or Canceled is Done; a running row (In Progress, Verifying) is In progress; the rest is Idle', () => {
    expect(state('Done', 'Done')).toBe('Done')
    expect(state('Done', 'Canceled')).toBe('Done')
    expect(state('Done', 'In Progress', 'Todo')).toBe('In progress')
    expect(state('Todo', 'Verifying')).toBe('In progress')
    expect(state('Done', 'Needs Verification')).toBe('Idle')
    expect(state('Todo', 'Blocked')).toBe('Idle')
    expect(state('Todo', 'Todo')).toBe('Idle')
  })

  test('the plan summary: nothing started reads "Not started yet"; work under way has no times, so no line', () => {
    expect(notStartedText(planOf(withStatus('Todo')))).toBe('Not started yet')
    expect(notStartedText(planOf(withStatus('In Progress')))).toBe('')
  })
})

describe('columns and keys the board no longer reads are ignored', () => {
  const OLD_COLUMNS =
    '# Progress\n\n| task | status | goal | deliverable | change | artifact | artifact_note |\n|---|---|---|---|---|---|---|\n' +
    '| one | Done | Prove it works | docs/a.md | adds the a page | [Review page](https://claude.ai/x) | the page to read |\n' +
    '| two | In Progress | | out/b.py | | | |\n'

  const REMOVED = /deliverable|artifact|\bdiff\b|docs\/a\.md|adds the a page|Review page|the page to read|out\/b\.py/i

  /** What the pane shows: the board (and whether a Deliverables table is in it), then the first card's page (and whether it has a Deliverable row). */
  async function drawn(pane: Awaited<ReturnType<typeof mountPane>>) {
    const lanes = await textIn(pane, await pane.drawn())
    const hasTable = (await pane.find({ key: 'deliverables' })) !== undefined

    await openCard(pane, 0)

    return { lanes, hasTable, page: await textIn(pane, await pane.drawn()), hasRow: (await pane.find({ key: 'field:deliverable' })) !== undefined }
  }

  test('the reader leaves them out of the row and keeps the rest', () => {
    const row = planOf(OLD_COLUMNS).rows[0]!

    expect(row).toMatchObject({ task: 'one', status: 'Done', goal: 'Prove it works' })

    for (const key of ['deliverable', 'change', 'artifact', 'artifact_note']) {
      expect(row).not.toHaveProperty(key)
    }
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${surface}: a PROGRESS.md that still has deliverable, change and artifact columns draws the lanes with no table, and the task page has no Deliverable row`, FILE_MODE, async ($, on) => {
      world(on, { surfaces: [surface], files: { [FILE]: OLD_COLUMNS } })
      await $.session.start(SESSION)
      const pane = await mountPane($, surface)
      const { lanes, hasTable, page, hasRow } = await drawn(pane)

      expect(lanes).toContain('Done 1')
      expect(lanes).toContain('In Progress 1')
      expect(lanes).toContain('one')
      expect(hasTable).toBe(false)
      expect(lanes).not.toMatch(REMOVED)
      expect(hasRow).toBe(false)
      expect(page).toContain('Prove it works')
      expect(page).not.toMatch(REMOVED)
      await pane.unmount()
    })
  }

  test('a board command\'s JSON that still has the removed keys draws the same', async ($, on) => {
    const row = (task: string, status: string, more: object) => ({ task, status, updated: '2026-10-14T09:00:00+09:00', ...more })
    const rows = [
      row('one', 'Done', { goal: 'Prove it works', deliverable: 'docs/a.md', change: 'adds the a page', changed_at: '2026-10-14T09:05:00+09:00', deliverable_mtime: 1760400000, artifact: '[Review page](https://claude.ai/x)', artifact_note: 'the page to read' }),
      row('two', 'In Progress', { deliverable: 'out/b.py', deliverable_mtime: null }),
    ]

    world(on, { fixture: JSON.stringify({ selected: 'p', message: null, plans: [{ anchor: 'p', name: 'Plan P', goal: 'g', plan_file: '/plans/p.md', rows }] }) })
    await $.session.start(SESSION)
    const pane = await mountPane($)
    const { lanes, hasTable, page, hasRow } = await drawn(pane)

    expect(lanes).toContain('Done 1')
    expect(lanes).toContain('In Progress 1')
    expect(hasTable).toBe(false)
    expect(lanes).not.toMatch(REMOVED)
    expect(hasRow).toBe(false)
    expect(page).toContain('Prove it works')
    expect(page).not.toMatch(REMOVED)
    await pane.unmount()
  })
})

describe('the board file: a row going Done is a toast, a notice and a chime', () => {
  const table = (...rows: [string, string][]) =>
    `# Progress\n\n| task | status | evidence |\n|---|---|---|\n${rows.map(([task, status]) => `| ${task} | ${status} | seen |`).join('\n')}\n`

  /** The world with the table `text` as its PROGRESS.md; the notices the mod appends to the conversation are in `w.appended`. */
  function watched(on: Parameters<typeof world>[0], text: string) {
    const w = world(on, { files: { [FILE]: text } })

    return { w, notices: w.appended }
  }

  /** The colours of the band's bar cells. */
  const barColors = async (band: Awaited<ReturnType<typeof mountBand>>) => (await band.findAll({ type: 'Text', text: /^▰$/ })).map(cell => String(cell.props.color))

  test('one row going Done: a toast `✅ <task> · N left`, a notice of the same text without PLAN-DONE, one chime, no rainbow while rows remain', FILE_MODE, async ($, on) => {
    const { w, notices } = watched(on, table(['a', 'Done'], ['b', 'In Progress'], ['c', 'Todo']))

    await $.session.start(SESSION)
    const band = await mountBand($)

    await w.clock.advance(3_000)
    w.files = { [FILE]: table(['a', 'Done'], ['b', 'Done'], ['c', 'Todo']) }
    await w.clock.advance(3_000)

    expect(w.toasts).toEqual(['✅ b · 1 left'])
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain('✅ b · 1 left')
    expect(notices[0]).not.toContain('PLAN-DONE')
    expect(w.played).toEqual([{ clip: { asset: 'sounds/done.wav' }, shouldLoop: false, gain: 0.6 }])
    expect(w.logLines().filter(line => line.stage === 'sent')).toHaveLength(1)
    expect((await barColors(band)).some(color => RAINBOW.includes(color))).toBe(false)
    await band.unmount()
  })

  test('the row that makes every row Done or Canceled also turns the band to a rainbow until the next prompt', FILE_MODE, async ($, on) => {
    const { w } = watched(on, table(['a', 'Done'], ['x', 'Canceled'], ['b', 'In Progress']))

    await $.session.start(SESSION)
    const band = await mountBand($)

    await w.clock.advance(3_000)
    w.files = { [FILE]: table(['a', 'Done'], ['x', 'Canceled'], ['b', 'Done']) }
    await w.clock.advance(3_000)

    expect(w.toasts).toEqual(['✅ b · 0 left'])
    expect(w.played).toHaveLength(1)

    const colors = await barColors(band)

    expect(colors.length).toBeGreaterThan(1)
    expect(colors.every(color => RAINBOW.includes(color))).toBe(true)
    expect(new Set(colors).size).toBeGreaterThan(1)

    await $.prompt.submit(promptSubmit())
    await w.clock.advance(500)
    expect((await barColors(band)).some(color => RAINBOW.includes(color))).toBe(false)
    await band.unmount()
  })

  test('two rows going Done in one read: a toast each with the count falling, one chime', FILE_MODE, async ($, on) => {
    const { w } = watched(on, table(['a', 'In Progress'], ['b', 'In Progress'], ['c', 'Todo']))

    await $.session.start(SESSION)
    await w.clock.advance(3_000)
    w.files = { [FILE]: table(['a', 'Done'], ['b', 'Done'], ['c', 'Todo']) }
    await w.clock.advance(3_000)

    expect(w.toasts).toEqual(['✅ a · 2 left', '✅ b · 1 left'])
    expect(w.played).toHaveLength(1)
  })

  test('the first read is the baseline only: rows already Done give no toast, notice, chime or rainbow', FILE_MODE, async ($, on) => {
    const { w, notices } = watched(on, table(['a', 'Done'], ['b', 'Done']))

    await $.session.start(SESSION)
    const band = await mountBand($)

    await w.clock.advance(6_000)

    expect(w.toasts).toEqual([])
    expect(notices).toEqual([])
    expect(w.played).toEqual([])
    expect((await barColors(band)).some(color => RAINBOW.includes(color))).toBe(false)
    await band.unmount()
  })

  test('a row that stays Done is silent on later reads, even when its text changes; a row first seen already Done is silent too', FILE_MODE, async ($, on) => {
    const { w } = watched(on, table(['a', 'Done'], ['b', 'In Progress'], ['c', 'Todo']))

    await $.session.start(SESSION)
    await w.clock.advance(3_000)
    w.files = { [FILE]: table(['a', 'Done'], ['b', 'Done'], ['c', 'Todo']) }
    await w.clock.advance(3_000)
    expect(w.toasts).toEqual(['✅ b · 1 left'])

    w.files = { [FILE]: table(['a', 'Done'], ['b', 'Done'], ['c', 'Todo']).replace('| a | Done | seen |', '| a | Done | seen again |') }
    await w.clock.advance(3_000)
    w.files = { [FILE]: table(['a', 'Done'], ['b', 'Done'], ['c', 'Todo'], ['d', 'Done']) }
    await w.clock.advance(3_000)

    expect(w.toasts).toEqual(['✅ b · 1 left'])
    expect(w.played).toHaveLength(1)
  })

  test('Canceled rows are not counted in N left', FILE_MODE, async ($, on) => {
    const { w } = watched(on, table(['a', 'Todo'], ['x', 'Canceled'], ['y', 'Canceled'], ['b', 'In Progress']))

    await $.session.start(SESSION)
    await w.clock.advance(3_000)
    w.files = { [FILE]: table(['a', 'Todo'], ['x', 'Canceled'], ['y', 'Canceled'], ['b', 'Done']) }
    await w.clock.advance(3_000)

    expect(w.toasts).toEqual(['✅ b · 1 left'])
  })

  test('with a board command set a change gives nothing (that tracker prints PLAN-DONE itself)', async ($, on) => {
    const w = world(on, { files: { [FILE]: table(['a', 'Done'], ['b', 'In Progress']) } })

    await $.session.start(SESSION)
    await w.clock.advance(3_000)

    // The tracker's board now has its In Progress row Done, and the file does too.
    w.fixture = { ...BOARD, plans: [{ ...BOARD.plans[0]!, rows: BOARD.plans[0]!.rows.map(row => (row.status === 'In Progress' ? { ...row, status: 'Done' as const } : row)) }, ...BOARD.plans.slice(1)] }
    w.files = { [FILE]: table(['a', 'Done'], ['b', 'Done']) }
    await $.prompt.submit(promptSubmit())
    await w.clock.advance(10_000)

    expect(w.jsonRuns.length).toBeGreaterThan(1)
    expect(w.toasts).toEqual([])
    expect(w.appended).toEqual([])
    expect(w.played).toEqual([])
  })
})
