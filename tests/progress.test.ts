import { describe, expect, test } from './testing'
import type { Engine } from 'claude-code/testing'

import { assigneeOf, checkerOf, executorOf, isYou, lanesOf, markerOf, needsYou, parseProgress, settings, whoLineOf } from '../hooks/board'
import type { PlanEntry, PlanRow } from '../types'
import { PROGRESS_REAL } from './fixtures/progress-real'
import { PROGRESS_REAL_EXECUTOR } from './fixtures/progress-real-executor'
import { PANE_ID, ROOT, SESSION, bandProps, openCard, paneProps, textIn, textOf, world } from './fixtures'

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
      '| Evidence | STATUS | Task | Executor | Deliverable | Change |\n|---|---|---|---|---|---|\n| ok | **In Progress** | build it | subagent | out/a.md | adds a |\n',
    )
    const row = plan.rows[0]!

    expect(row).toMatchObject({ task: 'build it', status: 'In Progress', note: 'ok', deliverable: 'out/a.md', change: 'adds a' })
    expect(executorOf(row)).toBe('subagent')
  })

  test('an executor equal to your_name is you; with no name set nobody is', () => {
    const row = planOf('| task | status | executor |\n|---|---|---|\n| t | Todo | Sam |\n').rows[0]!

    expect(settings.yourName).toBe('Sam')
    expect(executorOf(row)).toBe('Sam')
  })
})

describe('the board file: the kit\'s executor and check columns', () => {
  const plan = () => planOf(PROGRESS_REAL_EXECUTOR)

  test('executor and check are read into the row: who-chip from the model, Done by and Checked by from the cells', () => {
    const [done, verify] = plan().rows as [PlanRow, PlanRow]

    expect(done.check).toBe('script (grep)')
    expect(whoLineOf(done)).toEqual({ tier: 'Sonnet', executor: 'main session' })
    expect(assigneeOf(done)).toBe('Sonnet')
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
    const row = planOf('| Task | Status | EXECUTOR | Check |\n|---|---|---|---|\n| t | Done | subagent · Haiku | You |\n').rows[0]!

    expect(assigneeOf(row)).toBe('Haiku')
    expect(checkerOf(row)).toBe('you')
  })

  test('the pane: the task page shows Checked by script (grep) on the Done row, and the Verify card carries the marker', FILE_MODE, async ($, on) => {
    world(on, { files: { [FILE]: PROGRESS_REAL_EXECUTOR } })
    await $.session.start(SESSION)
    const pane = await mountPane($)

    expect(await textIn(pane, await pane.drawn())).toContain('◆ needs you')
    await openCard(pane, 0)
    const text = textOf(await pane.find({ key: 'detail:status' }))

    expect(text).toContain('main session')
    expect(text).toContain('Sonnet')
    expect(textOf(await pane.find({ key: 'detail:checked' }))).toBe('Checked by script (grep)')
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
    const reads = () => w.reads.filter(path => path === FILE).length
    const before = reads()

    await w.clock.advance(6_000)

    expect(reads()).toBeGreaterThan(before)
    expect(w.diagnostics().filter(line => line.stage === 'redraw')).toEqual([])
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
  test('a PROGRESS.md plan has no times or usage: the line under the plan name is the state alone, and a task page has no usage line', FILE_MODE, async ($, on) => {
    world(on, { files: { [FILE]: REAL } })
    await $.session.start(SESSION)
    const pane = await mountPane($)

    expect(await pane.find({ key: 'summary' })).toBeUndefined()
    expect(textOf(await pane.find({ key: 'plan-line' }))).toMatch(/^(Not started|In progress|Done)$/)
    await openCard(pane, 0)
    expect(await pane.find({ key: 'detail:usage' })).toBeUndefined()
    await pane.unmount()
  })
})
