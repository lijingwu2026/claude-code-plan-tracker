import { describe, expect, test } from './testing'

import {
  CAPPED,
  SHOW_LESS,
  STYLE,
  asksForYou,
  assigneeOf,
  checkerOf,
  bandLine,
  cardLines,
  cardView,
  countOf,
  displayWidth,
  doneBlocks,
  doneHeader,
  executorOf,
  failureText,
  fileHref,
  finishedAnchor,
  hang,
  hasInProgress,
  isRunning,
  routeText,
  isTagPoint,
  noteLinesOf,
  filledOf,
  lanesOf,
  markerOf,
  needsYou,
  moreButton,
  overflowLabel,
  parseBoard,
  pointsOf,
  piecesOf,
  segmentsOf,
  settings,
  shortPath,
  boardArgv,
  commandMarkOf,
  commandArgv,
  parseProgress,
  usageArgv,
  whoLineOf,
  worstStatus,
  wrap,
} from '../hooks/board'
import type { LaneKey } from '../hooks/board'
import type { PlanEntry, PlanRow, PlanStatus } from '../types'
import { ALPHA_ROWS, BOARD, HOME, ROOT, SCRIPT } from './fixtures'

const ALPHA = BOARD.plans[0] as PlanEntry
const rowNamed = (start: string) => ALPHA_ROWS.find(one => one.task.startsWith(start))!

describe('lane mapping', () => {
  test('four lanes: Todo, In Progress, Verify, Done, in that order', () => {
    expect(lanesOf(ALPHA).map(lane => lane.key)).toEqual(['Todo', 'In Progress', 'Verify', 'Done'])
  })

  test('Needs Verification is Verify; Blocked stays on the In Progress lane; Canceled is on no lane', () => {
    const [, doing, verify] = lanesOf(ALPHA)
    const all = lanesOf(ALPHA).flatMap(lane => lane.cards.map(card => card.row.task))

    expect(verify?.cards.map(card => card.row.task)).toEqual(['v1 look at the prototype'])
    expect(doing?.cards.map(card => card.row.status)).toEqual(['Blocked', 'In Progress'])
    expect(all).not.toContain('c1 dropped')
  })

  test('headers count every row of the lane; the Done header says nothing of the canceled row', () => {
    expect(lanesOf(ALPHA).map(lane => lane.header)).toEqual(['Todo 5', 'In Progress 2 · 1 blocked', 'Verify 1', 'Done 5'])
  })

  test('without a canceled row the Done header has no suffix', () => {
    const lanes = lanesOf({ ...ALPHA, rows: ALPHA_ROWS.filter(one => one.status !== 'Canceled') })

    expect(lanes[3]?.header).toBe('Done 5')
  })

  test('Todo shows 3 cards and +2 more; Done shows its 3 latest and +2 more', () => {
    const [todo, , , done] = lanesOf(ALPHA)

    expect(CAPPED).toBe(3)
    expect(todo?.cards.map(card => card.row.task)).toEqual(['t1 first todo', 't2 second todo', 't3 third todo'])
    expect(todo?.more).toBe(2)
    expect(done?.cards.map(card => card.row.task)).toEqual(['d4 newest', 'd2 newest but one', 'd3 middle'])
    expect(done?.more).toBe(2)
  })

  test('the four lane colors are four different theme keys', () => {
    const colors = lanesOf(ALPHA).map(lane => lane.color)

    expect(colors).toEqual(['inactive', 'suggestion', 'warning', 'success'])
    expect(new Set(colors).size).toBe(4)
    expect(new Set(Object.values(STYLE).map(style => style.color)).size).toBe(6)
  })

  test('n/m counts the Canceled row in neither, and reports no canceled count', () => {
    expect(countOf(ALPHA)).toEqual({ done: 5, total: 13 })
  })

  test('the plan\'s color is its most urgent open status: Blocked first', () => {
    expect(worstStatus(ALPHA)).toBe('Blocked')
    expect(worstStatus(BOARD.plans[1] as PlanEntry)).toBe('Done')
    expect(worstStatus(BOARD.plans[2] as PlanEntry)).toBe('In Progress')
  })
})

describe('lane order: the latest updated task first', () => {
  // `minute` counts from 10:00, so 70 is 11:10.
  const at = (minute: number) => `2026-10-12T${String(10 + Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00+09:00`
  const timed = (task: string, status: PlanStatus, minute: number | null, extra: Partial<PlanRow> = {}): PlanRow => ({ task, status, updated: minute === null ? null : at(minute), ...extra })
  const planOf = (...rows: PlanRow[]): PlanEntry => ({ anchor: 'p', name: 'p', goal: '', plan_file: '/p.md', rows })
  const ALL: LaneKey[] = ['Todo', 'In Progress', 'Verify', 'Done']
  /** The tasks of one lane, every card shown. */
  const lane = (plan: PlanEntry, key: LaneKey) => lanesOf(plan, ALL).find(one => one.key === key)?.cards.map(card => card.row.task)
  const HERS = 'serial × Sam · — — only she can judge'

  test('Todo, In Progress, Verify and Done each list the latest updated first', () => {
    const plan = planOf(
      timed('todo old', 'Todo', 10), timed('todo new', 'Todo', 30), timed('todo mid', 'Todo', 20),
      timed('run old', 'In Progress', 11), timed('run new', 'In Progress', 31), timed('run mid', 'In Progress', 21),
      timed('chk old', 'Verifying', 12), timed('chk new', 'Verifying', 32),
      timed('wait old', 'Needs Verification', 13), timed('wait new', 'Needs Verification', 33),
      timed('done old', 'Done', 14), timed('done new', 'Done', 34), timed('done mid', 'Done', 24),
    )

    expect(lane(plan, 'Todo')).toEqual(['todo new', 'todo mid', 'todo old'])
    expect(lane(plan, 'In Progress')).toEqual(['run new', 'run mid', 'run old'])
    expect(lane(plan, 'Verify')).toEqual(['chk new', 'chk old', 'wait new', 'wait old'])
    expect(lane(plan, 'Done')).toEqual(['done new', 'done mid', 'done old'])
  })

  test('rows updated at the same moment keep the later row first, in every lane', () => {
    const plan = planOf(
      timed('todo a', 'Todo', 10), timed('todo b', 'Todo', 10),
      timed('run a', 'In Progress', 10), timed('run b', 'In Progress', 10),
      timed('blocked a', 'Blocked', 10), timed('blocked b', 'Blocked', 10),
      timed('wait a', 'Needs Verification', 10), timed('wait b', 'Needs Verification', 10),
    )

    expect(lane(plan, 'Todo')).toEqual(['todo b', 'todo a'])
    expect(lane(plan, 'In Progress')).toEqual(['blocked b', 'blocked a', 'run b', 'run a'])
    expect(lane(plan, 'Verify')).toEqual(['wait b', 'wait a'])
  })

  test('In Progress keeps Blocked first: a newer running card stays below an older blocked one, each group sorted inside', () => {
    const plan = planOf(timed('run newest', 'In Progress', 50), timed('blocked old', 'Blocked', 10), timed('run older', 'In Progress', 40), timed('blocked new', 'Blocked', 20))

    expect(lane(plan, 'In Progress')).toEqual(['blocked new', 'blocked old', 'run newest', 'run older'])
  })

  test('the folded In Progress lane keeps the cap: the latest blocked cards first, then the latest running ones', () => {
    const blocked = [1, 2, 3, 4].map(minute => timed(`blocked ${minute}`, 'Blocked', minute))
    const running = [11, 12, 13, 14].map(minute => timed(`run ${minute}`, 'In Progress', minute))
    const doing = lanesOf(planOf(...blocked, ...running))[1]

    // 3 blocked at the most while running cards fill the rest of 5
    expect(doing?.cards.map(card => card.row.task)).toEqual(['blocked 4', 'blocked 3', 'blocked 2', 'run 14', 'run 13'])
    expect(doing?.more).toBe(3)
  })

  test('Verify keeps its groups: verifying, then waiting on you, then other waiting; a needs-you card stays above a newer other-waiting one', () => {
    const plan = planOf(
      timed('other newest', 'Needs Verification', 60, { route: 'serial × inline · Opus — x — check by main session · Sonnet: y' }),
      timed('hers old', 'Needs Verification', 10, { route: HERS }),
      timed('hers new', 'Needs Verification', 20, { route: HERS }),
      timed('other old', 'Needs Verification', 30, { route: 'serial × inline · Opus — x — check by main session · Sonnet: y' }),
      timed('verifying old', 'Verifying', 5),
    )

    expect(lane(plan, 'Verify')).toEqual(['verifying old', 'hers new', 'hers old', 'other newest', 'other old'])
  })

  test('the folded lanes show the latest cards: Todo and Done their 3 latest, Verify its 5 latest', () => {
    const todo = [10, 40, 20, 50, 30].map(minute => timed(`todo ${minute}`, 'Todo', minute))
    const verify = [10, 70, 20, 60, 30, 50, 40].map(minute => timed(`wait ${minute}`, 'Needs Verification', minute))
    const lanes = lanesOf(planOf(...todo, ...verify))

    expect(lanes[0]?.cards.map(card => card.row.task)).toEqual(['todo 50', 'todo 40', 'todo 30'])
    expect(lanes[2]?.cards.map(card => card.row.task)).toEqual(['wait 70', 'wait 60', 'wait 50', 'wait 40', 'wait 30'])
  })

  test('a lane in which no card has a time (a PROGRESS.md) keeps file order, whatever the other lanes do', () => {
    const plan = planOf(
      timed('todo 1', 'Todo', null), timed('todo 2', 'Todo', null), timed('todo 3', 'Todo', null),
      timed('run 1', 'In Progress', null), timed('run 2', 'In Progress', null),
      timed('blocked 1', 'Blocked', null), timed('blocked 2', 'Blocked', null),
      timed('wait 1', 'Needs Verification', null), timed('wait 2', 'Needs Verification', null),
      timed('verifying 1', 'Verifying', null), timed('verifying 2', 'Verifying', null),
      timed('done old', 'Done', 14), timed('done new', 'Done', 34),
    )

    expect(lane(plan, 'Todo')).toEqual(['todo 1', 'todo 2', 'todo 3'])
    expect(lane(plan, 'In Progress')).toEqual(['blocked 1', 'blocked 2', 'run 1', 'run 2'])
    expect(lane(plan, 'Verify')).toEqual(['verifying 1', 'verifying 2', 'wait 1', 'wait 2'])
    expect(lane(plan, 'Done')).toEqual(['done new', 'done old'])
  })

  test('a PROGRESS.md board keeps its table order in every lane', () => {
    const table = ['| task | status |', '|---|---|', '| a | Todo |', '| b | Todo |', '| c | In Progress |', '| d | In Progress |', '| e | Needs Verification |', '| f | Needs Verification |']
    const parsed = parseProgress(`# P\n\n${table.join('\n')}\n`, '/p/PROGRESS.md', 'p')
    const plan = 'board' in parsed ? parsed.board.plans[0]! : planOf()

    expect(lane(plan, 'Todo')).toEqual(['a', 'b'])
    expect(lane(plan, 'In Progress')).toEqual(['c', 'd'])
    expect(lane(plan, 'Verify')).toEqual(['e', 'f'])
  })
})

describe('the In Progress lane cap', () => {
  const rows = (blocked: number, running: number): PlanEntry => ({
    ...ALPHA,
    rows: [
      ...Array.from({ length: blocked }, (_, at) => ({ ...rowNamed('b1'), task: `stuck ${at}` })),
      ...Array.from({ length: running }, (_, at) => ({ ...rowNamed('Build'), task: `run ${at}` })),
    ],
  })
  const lane = (blocked: number, running: number) => lanesOf(rows(blocked, running))[1]!
  const tasks = (blocked: number, running: number) => lane(blocked, running).cards.map(card => card.row.task)

  test('the header counts every card and says how many are blocked; no blocked part at 0', () => {
    expect(lane(6, 12).header).toBe('In Progress 18 · 6 blocked')
    expect(lane(0, 4).header).toBe('In Progress 4')
  })

  test('6 blocked and 12 running: 3 blocked first, then 2 running cards (the mascot), and "+3 blocked · 10 running"', () => {
    expect(tasks(6, 12)).toEqual(['stuck 0', 'stuck 1', 'stuck 2', 'run 0', 'run 1'])
    expect(lane(6, 12).moreLabel).toBe('+3 blocked · 10 running')
    expect(lane(6, 12).more).toBe(13)
  })

  test('blocked cards fill what running cards leave: 6 blocked and 1 running show 4 blocked and the running one', () => {
    expect(tasks(6, 1)).toEqual(['stuck 0', 'stuck 1', 'stuck 2', 'stuck 3', 'run 0'])
    expect(lane(6, 1).moreLabel).toBe('+2 blocked')
  })

  test('only running cards: 5 and then "+3 running"; only blocked: 5 and then "+3 blocked"', () => {
    expect(tasks(0, 8)).toHaveLength(5)
    expect(lane(0, 8).moreLabel).toBe('+3 running')
    expect(lane(8, 0).moreLabel).toBe('+3 blocked')
  })

  test('5 cards or fewer have no overflow line', () => {
    expect(lane(2, 3).moreLabel).toBe('')
    expect(lane(2, 3).more).toBe(0)
  })

  test('Todo and Done keep "+N more"', () => {
    expect(lanesOf(ALPHA).map(one => one.moreLabel)).toEqual(['+2 more', '', '', '+2 more'])
  })
})

describe('wrapping', () => {
  test('a wide (CJK) sentence breaks between any two characters, not only at the ASCII space', () => {
    // 5 CJK chars, a space, "plan", a space, then CJK: the line must fill with CJK instead of breaking at the space before "plan"
    const lines = wrap('\u4e00\u4e8c\u4e09\u56db\u4e94\u3002\u516d plan \u4e03\u516b\u4e5d\u5341\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341', 20)

    expect(lines.every(line => displayWidth(line) <= 20)).toBe(true)
    expect(lines).not.toContain('\u516d plan')
    expect(lines.join(' ')).toContain('plan')
    // no line is a lone "\u516d plan" with the sentence jumped: every line but the last is at least 16 columns wide
    expect(lines.slice(0, -1).every(line => displayWidth(line) >= 16)).toBe(true)
  })

  test('a break never starts a line with a closing mark or ends one with an opening mark', () => {
    const lines = wrap('\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d，\u5341\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d（\u5341）', 20)

    expect(lines.slice(1).every(line => !'，。）'.includes(line[0] ?? ''))).toBe(true)
    expect(lines.slice(0, -1).every(line => !'（'.includes(line.at(-1) ?? ''))).toBe(true)
    expect(lines.join('')).toBe('\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d，\u5341\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d（\u5341）')
  })

  test('Latin text still breaks at spaces only, and a long word is cut where the line fills', () => {
    expect(wrap('alpha beta gamma delta', 12)).toEqual(['alpha beta', 'gamma delta'])
    expect(wrap('abcdefghijklmnop', 6)).toEqual(['abcdef', 'ghijkl', 'mnop'])
  })

  test('mixed text: the line fills to the edge with CJK, and the Latin word stays whole when it fits', () => {
    const lines = wrap('\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b Sam \u4e5d\u5341\u4e00\u4e8c', 16)

    expect(lines.every(line => displayWidth(line) <= 16)).toBe(true)
    expect(lines.join(' ')).toContain('Sam')
  })
})

describe('points', () => {
  test('pointsOf keeps backtick spans and paths with a ";" whole', () => {
    expect(pointsOf('a `x; y` b；c')).toEqual(['a `x; y` b', 'c'])
    expect(pointsOf('see src/a;b.py now；end')).toEqual(['see src/a;b.py now', 'end'])
    expect(pointsOf('x；y')).toEqual(['x', 'y'])
  })

  test('asksForYou: "needs you" anywhere, in any case; other points, bracketed tags included, no', () => {
    expect(asksForYou('this Needs You now')).toBe(true)
    expect(asksForYou('【Decide】Should it run?')).toBe(false)
    expect(asksForYou('please look')).toBe(false)
    expect(asksForYou('a plain point')).toBe(false)
  })

  test('moreButton: ▾ for a count, ▴ for Show less', () => {
    expect(moreButton('+1 more')).toBe('+1 more ▾')
    expect(moreButton('Show less')).toBe('Show less ▴')
  })
})

describe('tag points', () => {
  test('isTagPoint: a whole point of the form 【…】 and nothing else', () => {
    expect(isTagPoint('【Blocked on you】')).toBe(true)
    expect(isTagPoint('【Decide】Should it run?')).toBe(false)
    expect(isTagPoint('before【Blocked】')).toBe(false)
  })

  test('noteLinesOf: a tag point has its own line without a bullet, and does not count as a text point', () => {
    expect(noteLinesOf('one；two；【Blocked on you】', 40).map(line => line.text)).toEqual(['• one', '• two', '【Blocked on you】'])
    expect(noteLinesOf('one；【Blocked on you】', 40).map(line => line.text)).toEqual(['one', '【Blocked on you】'])
    expect(noteLinesOf('one；【Blocked on you】', 40)[1]).toMatchObject({ tag: true })
  })
})

describe('notes', () => {
  test('a note is split at ｜ and | into points, trimmed, none empty', () => {
    expect(segmentsOf('one ｜ two|three｜｜ ｜four')).toEqual(['one', 'two', 'three', 'four'])
    expect(segmentsOf('')).toEqual([])
  })

  test('a point wraps with a 2-column hanging indent', () => {
    const lines = hang('alpha beta gamma delta epsilon', 12)

    expect(lines[0]?.startsWith(' ')).toBe(false)
    expect(lines.slice(1).every(line => line.startsWith('  ') && !line.startsWith('   '))).toBe(true)
    expect(lines.every(line => displayWidth(line) <= 12)).toBe(true)
    expect(lines.map(line => line.trim()).join(' ')).toBe('alpha beta gamma delta epsilon')
  })

  test('file paths in a note are found: relative (word/word.ext, ./ and ../), ~/ and .claude, with the dot of the extension', () => {
    expect(piecesOf('full text: docs/report-2026-09-20.md, and ~/.claude/mods/x/a.ts.')).toEqual([
      { text: 'full text: ' },
      { text: 'docs/report-2026-09-20.md', path: 'docs/report-2026-09-20.md' },
      { text: ', and ' },
      { text: '~/.claude/mods/x/a.ts', path: '~/.claude/mods/x/a.ts' },
      { text: '.' },
    ])
    expect(piecesOf('no path here: version 2.1.3')).toEqual([{ text: 'no path here: version 2.1.3' }])
  })

  test('any folder/name.ext and any ./, ../ or ~/ path with a known extension is a link; words, versions and URLs are not', () => {
    const paths = (text: string) => piecesOf(text).flatMap(piece => (piece.path === undefined ? [] : [piece.path]))

    expect(paths('see docs/plan.md and src/a/b.ts, then ./notes.txt, ../up/x.json and ~/y.yaml.')).toEqual(['docs/plan.md', 'src/a/b.ts', './notes.txt', '../up/x.json', '~/y.yaml'])
    expect(paths('use and/or, plan.md, v2.1/final, data/file.xyz')).toEqual([])
    expect(paths('see https://example.com/page.md for it')).toEqual([])
  })

  test('the link of a path in a note: ~/ is under the home folder, a path from / is as it is, any other is under the project root; each segment is encoded', () => {
    expect(fileHref('~/code/a.md', HOME)).toBe(`file://${HOME}/code/a.md`)
    expect(fileHref('~/code/a.md', undefined)).toBeNull()
    expect(fileHref('/plans/alpha.md', HOME)).toBe('file:///plans/alpha.md')
    expect(fileHref('docs/plan.md', HOME)).toBe(`file://${ROOT}/docs/plan.md`)
    expect(fileHref('docs/a b#c.md', HOME)).toBe(`file://${ROOT}/docs/a%20b%23c.md`)
  })

  test('the plan file path is project-relative, and cut from the left so the file name stays', () => {
    expect(shortPath(`${ROOT}/docs/plans/sample-plan-2026-09-14.md`, 90)).toBe('docs/plans/sample-plan-2026-09-14.md')

    const cut = shortPath(`${ROOT}/docs/plans/sample-plan-2026-09-14.md`, 30)

    expect(cut.startsWith('…')).toBe(true)
    expect(cut.endsWith('sample-plan-2026-09-14.md')).toBe(true)
    expect(displayWidth(cut)).toBeLessThanOrEqual(30)
    expect(shortPath('/plans/alpha.md', 40)).toBe('/plans/alpha.md')
  })
})

describe('the Verify lane with Verifying rows', () => {
  const row = (task: string, status: 'Verifying' | 'Needs Verification', route?: string) => ({ ...rowNamed('t3'), task, status, ...(route === undefined ? {} : { route }) })
  const PLAN: PlanEntry = {
    ...ALPHA,
    rows: [
      row('w1 waiting plain', 'Needs Verification', 'serial × inline · Opus — x'),
      row('v1 verifying a', 'Verifying', 'serial × subagent · Sonnet — x'),
      row('w2 waiting for her', 'Needs Verification', 'serial × Sam · — — she decides'),
      row('w3 waiting plain', 'Needs Verification'),
      row('v2 verifying b', 'Verifying'),
    ],
  }
  const verify = lanesOf(PLAN)[2]!

  test('Verifying and Needs Verification are both on the Verify lane, and on no other', () => {
    const lanes = lanesOf(PLAN)

    expect(verify.cards).toHaveLength(5)
    expect(lanes.filter(lane => lane.key !== 'Verify').flatMap(lane => lane.cards)).toEqual([])
  })

  test('order: the rows being verified first, then the ones waiting for her, then the other waiting rows; each group in row order', () => {
    expect(verify.cards.map(card => card.row.task)).toEqual(['v1 verifying a', 'v2 verifying b', 'w2 waiting for her', 'w1 waiting plain', 'w3 waiting plain'])
    // a Verifying row of hers is not "waiting on her decision": no marker
    expect(needsYou({ ...PLAN.rows[1]!, route: 'serial × Sam · —' })).toBe(false)
  })

  test('the header counts both and says how many are verifying; with none verifying it is the plain count', () => {
    expect(verify.header).toBe('Verify 5 · 2 verifying')
    expect(lanesOf({ ...PLAN, rows: PLAN.rows.filter(one => one.status === 'Needs Verification') })[2]?.header).toBe('Verify 3')
  })

  test('Verifying has the Verify lane colour and counts as running; Needs Verification does not', () => {
    expect(STYLE.Verifying.color).toBe(STYLE['Needs Verification'].color)
    expect(verify.color).toBe('warning')
    expect(isRunning(rowNamed('t3'))).toBe(false)
    expect(isRunning(PLAN.rows[1]!)).toBe(true)
    expect(isRunning(PLAN.rows[0]!)).toBe(false)
  })

  test('the plan\'s colour: Verifying and Needs Verification both rank above In Progress, below Blocked', () => {
    expect(worstStatus({ ...PLAN, rows: [PLAN.rows[1]!, rowNamed('Build')] })).toBe('Verifying')
    expect(worstStatus({ ...PLAN, rows: [rowNamed('Build'), PLAN.rows[0]!] })).toBe('Needs Verification')
  })

  test('a Verifying card has the mascot like an In Progress card; a Needs Verification card does not', () => {
    expect(cardView(PLAN.rows[1]!, 40).mascot).toBe(true)
    expect(cardView(PLAN.rows[0]!, 40).mascot).toBe(false)
    expect(cardView(rowNamed('Build'), 40).mascot).toBe(true)
  })

  test('the band counts Verifying as running', () => {
    expect(hasInProgress({ ...PLAN, rows: [PLAN.rows[1]!] })).toBe(true)
    expect(hasInProgress({ ...PLAN, rows: [PLAN.rows[0]!] })).toBe(false)
  })

  test('a row from the tracker\'s --json (a "who", no route, no note) is read: the executor comes from "who", "unrouted" is none', () => {
    const fromJson = { task: 'x', status: 'Needs Verification' as const, who: 'serial × Sam · —', updated: null }

    expect(executorOf(fromJson)).toBe('Sam')
    expect(needsYou(fromJson)).toBe(true)
    expect(needsYou({ ...fromJson, status: 'Todo' })).toBe(false)
    expect(whoLineOf({ ...fromJson, who: 'spawn × subagent · Sonnet' })).toEqual({ tier: 'Sonnet', executor: 'subagent' })
    expect(executorOf({ ...fromJson, who: 'unrouted' })).toBeUndefined()
    expect(routeText({ ...fromJson, who: 'unrouted' })).toBeUndefined()
  })
})

describe('who', () => {
  test('the executor comes from the route; "needs you" is an open row whose executor is Sam', () => {
    expect(executorOf(rowNamed('v1'))).toBe('Sam')
    expect(needsYou(rowNamed('v1'))).toBe(true)
    expect(needsYou(rowNamed('t2'))).toBe(false)
    expect(needsYou(rowNamed('t3'))).toBe(false)
  })

  test('"needs you" is a decision waiting: Sam AND Needs Verification; her row in any other status keeps the tag only', () => {
    const hers = rowNamed('t1')

    expect(executorOf(hers)).toBe('Sam')

    for (const status of ['Todo', 'In Progress', 'Verifying', 'Blocked', 'Done', 'Canceled'] as const) {
      expect(needsYou({ ...hers, status })).toBe(false)
      expect(markerOf({ ...hers, status }) === '◆ needs you · ').toBe(false)
    }

    expect(needsYou({ ...hers, status: 'Needs Verification' })).toBe(true)
    expect(markerOf({ ...hers, status: 'Needs Verification' })).toBe('◆ needs you · ')
    // her Todo card says "you" as the executor tag, without the marker
    expect(markerOf(hers)).toBe('')
    expect(assigneeOf(hers)).toBe('you')
    expect(markerOf({ ...hers, status: 'Blocked' })).toBe('⚑ Blocked · ')
    expect(cardView(hers, 40)).toMatchObject({ marker: '', tag: 'you' })
    expect(cardView({ ...hers, status: 'Needs Verification' }, 40)).toMatchObject({ marker: '◆ needs you · ', tag: 'you' })
  })

  test('a finished row of hers is not "needs you"', () => {
    expect(executorOf(rowNamed('d5'))).toBe('Sam')
    expect(needsYou(rowNamed('d5'))).toBe(false)
    expect(markerOf(rowNamed('d5'))).toBe('')
  })

  test('the markers: ⚑ Blocked · for a blocked row, ◆ needs you · for hers, else none', () => {
    expect(markerOf(rowNamed('b1'))).toBe('⚑ Blocked · ')
    expect(markerOf(rowNamed('v1'))).toBe('◆ needs you · ')
    expect(markerOf(rowNamed('t2'))).toBe('')
  })

  test('the tag is you or the route\'s tier; who names the executor and the tier', () => {
    expect(assigneeOf(rowNamed('v1'))).toBe('you')
    expect(assigneeOf(rowNamed('t2'))).toBe('Haiku')
    expect(assigneeOf(rowNamed('t3'))).toBeUndefined()
    expect(whoLineOf(rowNamed('Build'))).toEqual({ tier: 'Sonnet', executor: 'subagent' })
    expect(whoLineOf(rowNamed('v1'))).toEqual({ executor: 'you' })
    expect(whoLineOf(rowNamed('t3'))).toBeUndefined()
  })

  test('a route with an executor that has parentheses and a default tier', () => {
    const row = { ...rowNamed('t3'), route: 'spawn × subagent(harness-author) · default — system files' }

    expect(executorOf(row)).toBe('subagent(harness-author)')
    expect(assigneeOf(row)).toBeUndefined()
    expect(whoLineOf(row)).toEqual({ tier: 'default', executor: 'subagent(harness-author)' })
  })
})

describe('who: the tag names who does the task next', () => {
  const routed = (status: PlanStatus, route: string): PlanRow => ({ task: 'a task', status, updated: null, route })

  test('a Done or Canceled card has no tag, whoever did it; its page still says who did it', () => {
    for (const status of ['Done', 'Canceled'] as const) {
      expect(assigneeOf(routed(status, 'spawn × subagent · Sonnet — x'))).toBeUndefined()
      expect(assigneeOf(routed(status, 'serial × Sam · — — x'))).toBeUndefined()
      expect(assigneeOf(routed(status, 'serial × inline · Opus — x — check by Sam: y'))).toBeUndefined()
      expect(cardView(routed(status, 'spawn × subagent · Sonnet — x'), 40).tag).toBe('')
    }

    expect(whoLineOf(routed('Done', 'spawn × subagent · Sonnet — x'))).toEqual({ tier: 'Sonnet', executor: 'subagent' })
    expect(assigneeOf(routed('Todo', 'spawn × subagent · Sonnet — x'))).toBe('Sonnet')
    expect(assigneeOf(routed('Needs Verification', 'serial × inline · Opus — x — check by Sam: y'))).toBe('you')
  })

  test('a tier followed by a note is read: the first word after the dot, up to a space, a comma or a bracket', () => {
    const noted = routed('In Progress', 'serial × subagent · Sonnet (fork worker, own branch) — why — check by Sam: x')

    expect(assigneeOf(noted)).toBe('Sonnet')
    expect(executorOf(noted)).toBe('subagent')
    expect(whoLineOf(noted)).toEqual({ tier: 'Sonnet', executor: 'subagent' })
    expect(cardView(noted, 40).tag).toBe('Sonnet')
    expect(assigneeOf(routed('In Progress', 'serial × inline · Sonnet, note — why'))).toBe('Sonnet')
    expect(assigneeOf(routed('In Progress', 'serial × inline · Opus (1M) note'))).toBe('Opus')
    expect(checkerOf(noted)).toBe('you')
  })

  test('a route with no split reads too: `inline · Opus — x`', () => {
    const bare = routed('Todo', 'inline · Opus — x')

    expect(executorOf(bare)).toBe('inline')
    expect(assigneeOf(bare)).toBe('Opus')
    expect(whoLineOf(bare)).toEqual({ tier: 'Opus', executor: 'main session' })
  })

  test('a route that starts with your name is yours: `Sam ★ — check: y` waits for you, `Sam publishes, inline` is you', () => {
    const check = routed('Needs Verification', 'Sam ★ — check: y')

    expect(assigneeOf(check)).toBe('you')
    expect(needsYou(check)).toBe(true)
    expect(markerOf(check)).toBe('◆ needs you · ')
    expect(whoLineOf(check)).toEqual({ executor: 'you' })

    const publishes = routed('Blocked', 'serial × Sam publishes, inline · Opus — z')

    expect(assigneeOf(publishes)).toBe('you')
    expect(whoLineOf(publishes)).toEqual({ executor: 'you' })
    expect(assigneeOf(routed('Todo', 'Sam — pick one of the two'))).toBe('you')
    expect(assigneeOf(routed('Todo', 'You decide · Opus — x'))).toBe('you')
  })

  test('only the whole word counts: a longer name, or your name later in the route, is not you; with no name set only `you` is', () => {
    expect(assigneeOf(routed('Todo', 'Samuel reviews · Opus — x'))).toBe('Opus')
    expect(assigneeOf(routed('Todo', 'serial × inline · Opus — Sam decides later'))).toBe('Opus')
    expect(assigneeOf(routed('Todo', 'serial × Samuel · Opus — x'))).toBe('Opus')

    const name = settings.yourName

    settings.yourName = ''
    expect(assigneeOf(routed('Needs Verification', 'Sam ★ — check: y'))).toBeUndefined()
    expect(assigneeOf(routed('Needs Verification', 'You ★ — check: y'))).toBe('you')
    settings.yourName = name
  })

  test('a route that reads the same as before still does: executor, tier and note of the formats in use', () => {
    const cases: [string, string | undefined, string | undefined][] = [
      ['serial × Sam · — — a', 'Sam', undefined],
      ['spawn × subagent(harness-author) · default — system files', 'subagent(harness-author)', undefined],
      ['serial × inline · Opus — a — check by main session · Opus: x', 'inline', 'Opus'],
      ['parallel × subagent · Haiku', 'subagent', 'Haiku'],
    ]

    for (const [route, executor, tier] of cases) {
      expect(executorOf(routed('Todo', route))).toBe(executor)
      expect(assigneeOf(routed('Todo', route))).toBe(tier === undefined ? (executor === 'Sam' ? 'you' : undefined) : tier)
    }
  })
})

describe('the band row', () => {
  test('the bar is 12 cells at most; filled in proportion, never all of them before the plan is complete', () => {
    expect(bandLine(ALPHA, 120)).toMatchObject({ name: 'Alpha plan', filled: 5, empty: 7, count: '5/13' })
    expect(filledOf(0, 10, 12)).toBe(0)
    expect(filledOf(1, 100, 12)).toBe(1)
    expect(filledOf(99, 100, 12)).toBe(11)
    expect(filledOf(10, 10, 12)).toBe(12)
  })

  test('a long name is cut and the bar keeps its 12 cells', () => {
    const line = bandLine({ ...ALPHA, name: 'Plan-tracking MVP: terminal board + agent finishes/cancels and then some more words' }, 90)

    expect(line.filled + line.empty).toBe(12)
    expect(line.name.endsWith('…')).toBe(true)
    expect(displayWidth(`● ${line.name} ▾  ${'▰'.repeat(12)} ${line.count}  Plan file ›`)).toBeLessThanOrEqual(90)
  })

  test('a very narrow band shrinks the bar to 4 cells at the least', () => {
    const line = bandLine({ ...ALPHA, name: 'A very long plan name that cannot fit anywhere' }, 36)

    expect(line.name.endsWith('…')).toBe(true)
    expect(line.filled + line.empty).toBeGreaterThanOrEqual(4)
    expect(displayWidth(`● ${line.name} ▾  ${'▰'.repeat(line.filled + line.empty)} ${line.count}  Plan file ›`)).toBeLessThanOrEqual(50)
  })
})

describe('card lines', () => {
  test('the whole name is kept: the tag has the last line when it leaves room, else a line of its own, and no line is cut', () => {
    expect(cardLines('short', 30, 6)).toEqual(['short'])
    expect(cardLines('x'.repeat(28), 30, 6)).toEqual(['x'.repeat(28), ''])

    const long = cardLines('word '.repeat(40), 30, 6)

    expect(long.length).toBeGreaterThan(4)
    expect(long.map(displayWidth).every(width => width <= 30)).toBe(true)
    expect(long.join(' ').split(/\s+/).filter(word => word !== '')).toEqual(Array.from({ length: 40 }, () => 'word'))
    expect(long.join('')).not.toContain('…')
    expect(displayWidth(long.at(-1) ?? '')).toBeLessThanOrEqual(30 - 6 - 2)
  })

  test('a mascot card has at least two lines; the tag sits on a line below the title, so the title keeps the width', () => {
    const view = cardView(rowNamed('Build'), 40)

    expect(view.mascot).toBe(true)
    // the title takes the lines it needs (three at this width), then the tag's line
    expect(view.lines).toHaveLength(4)
    expect(view.tag).toBe('Sonnet')
    expect(view.tagAt).toBe(3)
    expect(view.lines[3]).toBe('')
    expect(view.lines[0]?.startsWith('Build the eval suite')).toBe(true)
    // no tag: the title alone
    expect(cardView(rowNamed('t3'), 60).lines.length).toBe(1)
  })

  test('a blocked card has the mascot too, and the flag leads its text', () => {
    const view = cardView(rowNamed('b1'), 60)

    expect(view.mascot).toBe(true)
    expect(view.lines[0]?.startsWith('⚑ Blocked · b1')).toBe(true)
    expect(view.tag).toBe('Opus')
  })

  test('a Todo card with no tag is one line', () => {
    expect(cardView(rowNamed('t3'), 40).lines).toEqual(['t3 third todo'])
  })
})

describe('parseBoard', () => {
  test('a row of an unknown status is refused with one line', () => {
    const bad = JSON.stringify({ selected: 'x', message: null, plans: [{ anchor: 'x', rows: [{ task: 't', status: 'Review' }] }] })

    expect(parseBoard(bad)).toEqual({ error: expect.stringContaining('known status') })
  })

  test('the seven statuses of the tracker parse', () => {
    const rows = ['Todo', 'In Progress', 'Blocked', 'Needs Verification', 'Verifying', 'Done', 'Canceled'].map(status => ({ task: status, status }))
    const parsed = parseBoard(JSON.stringify({ selected: 'x', message: null, plans: [{ anchor: 'x', rows }] }))

    expect('board' in parsed && parsed.board.plans[0]?.rows.map(one => one.status)).toEqual(rows.map(one => one.status))
  })

  test('the test board parses to itself, and text that is not JSON is one line', () => {
    expect(parseBoard(JSON.stringify(BOARD))).toMatchObject({ board: { selected: 'alpha', plans: [{ anchor: 'alpha' }, { anchor: 'beta' }, { anchor: 'gamma' }] } })
    expect(parseBoard('not json')).toEqual({ error: expect.stringMatching(/^plan-tracker: the board command did not print JSON: / ) })
  })

  test('null fields of the tracker are dropped: no goal reads "", no note or route or progress is absent', () => {
    const parsed = parseBoard(
      JSON.stringify({
        selected: null,
        message: 'none',
        plans: [{ anchor: 'x', name: 'X', goal: null, plan_file: '/p.md', rows: [{ task: 't', status: 'Todo', who: 'unrouted', note: null, route: null, progress: null, updated: null }] }],
      }),
    )

    expect(parsed).toEqual({
      board: {
        selected: null,
        message: 'none',
        plans: [{ anchor: 'x', name: 'X', goal: '', plan_file: '/p.md', rows: [{ task: 't', status: 'Todo', updated: null, who: 'unrouted' }] }],
      },
    })
  })
})

describe('the tracker\'s empty-state message', () => {
  test('keeps the script\'s own words: /plan-tracker <anchor> is the one command that opens a plan', () => {
    const message = 'This session has not written any plan row yet. Use `/plan-tracker <anchor>` to open a plan.'
    const parsed = parseBoard(JSON.stringify({ selected: null, message, plans: [] }))

    expect('board' in parsed && parsed.board.message).toBe(message)
  })
})

describe('the Verify lane overflow', () => {
  const waiting = (task: string, route: string) => ({ ...rowNamed('t3'), task, status: 'Needs Verification' as const, route })
  const hers = (task: string) => waiting(task, 'serial × Sam · — — she decides')
  const theirs = (task: string) => waiting(task, 'serial × inline · Opus — x')
  const verifying = (task: string) => ({ ...rowNamed('t3'), task, status: 'Verifying' as const })
  const plan = (rows: PlanEntry['rows']): PlanEntry => ({ ...ALPHA, rows })
  const verify = (rows: PlanEntry['rows'], expanded: readonly LaneKey[] = []) => lanesOf(plan(rows), expanded)[2]!

  // verifying first, then hers, then the others: 3 + 2 + 2 = 7 cards, the last two hidden are hers when she has 4
  const SEVEN = [verifying('v1'), verifying('v2'), verifying('v3'), hers('h1'), hers('h2'), theirs('w1'), theirs('w2')]

  test('five cards show, as In Progress; the label counts the hidden ones and says none of them waits on her when none does', () => {
    const lane = verify(SEVEN)

    expect(lane.cards).toHaveLength(5)
    expect(lane.more).toBe(2)
    expect(lane.moreLabel).toBe('+2 more')
  })

  test('hidden rows that wait on her are counted in the label: "+3 more · 1 needs you"', () => {
    const lane = verify([verifying('v1'), verifying('v2'), verifying('v3'), verifying('v4'), verifying('v5'), verifying('v6'), hers('h1'), theirs('w1')])

    expect(lane.cards.map(card => card.row.task)).toEqual(['v1', 'v2', 'v3', 'v4', 'v5'])
    expect(lane.more).toBe(3)
    expect(lane.moreLabel).toBe('+3 more · 1 needs you')
    expect(moreButton(lane.moreLabel)).toBe('+3 more · 1 needs you ▾')
  })

  test('several hidden rows of hers are all counted', () => {
    const lane = verify([...Array.from({ length: 5 }, (_, at) => verifying(`v${at}`)), hers('h1'), hers('h2'), theirs('w1')])

    expect(lane.moreLabel).toBe('+3 more · 2 needs you')
  })

  test('a Verify lane of five or fewer has no overflow line', () => {
    const lane = verify(SEVEN.slice(0, 5))

    expect(lane.more).toBe(0)
    expect(lane.moreLabel).toBe('')
    expect(lane.header).toBe('Verify 5 · 3 verifying')
  })

  test('expanded, the lane shows every card and the line folds back', () => {
    const lane = verify(SEVEN, ['Verify'])

    expect(lane.cards).toHaveLength(7)
    expect(lane.more).toBe(0)
    expect(lane.moreLabel).toBe(SHOW_LESS)
  })

  test('the button keeps the whole label when it fits, else the short form that keeps the arrow', () => {
    const lane = verify([...Array.from({ length: 5 }, (_, at) => verifying(`v${at}`)), hers('h1'), theirs('w1'), theirs('w2')])

    expect(lane.moreLabel).toBe('+3 more · 1 needs you')
    expect(overflowLabel(lane, 40)).toBe('+3 more · 1 needs you ▾')
    // the label is 23 columns and the button's `[ ]` four more
    expect(overflowLabel(lane, 27)).toBe('+3 more · 1 needs you ▾')
    expect(overflowLabel(lane, 26)).toBe('+3 more ▾')
  })
})

describe('the board command', () => {
  test('boardArgv: the session, the query when there is one, and --json last', () => {
    expect(boardArgv('s1', '')).toEqual(['python3', SCRIPT, '--view', 's1', '--json'])
    expect(boardArgv('s1', 'alpha')).toEqual(['python3', SCRIPT, '--view', 's1', '--query=alpha', '--json'])
  })

  test('boardArgv: a query that starts with a dash is one --query=<value> argument, never a flag', () => {
    expect(boardArgv('s1', '--json')).toEqual(['python3', SCRIPT, '--view', 's1', '--query=--json', '--json'])
    expect(boardArgv('s1', '-x y')).toEqual(['python3', SCRIPT, '--view', 's1', '--query=-x y', '--json'])
  })

  test('commandArgv: quotes keep a word whole, a [group] drops with its empty placeholder, no shell reads a value', () => {
    expect(commandArgv('tool "my dir/x.py" {session} [--query {query}] [--flag]', { session: 's', query: '' })).toEqual([
      'tool', 'my dir/x.py', 's', '--flag',
    ])
    expect(commandArgv('tool [--query {query}]', { query: '$(rm -rf ~); a b' })).toEqual(['tool', '--query', '$(rm -rf ~); a b'])
  })

  test('commandMarkOf: the tool\'s file name, not env or an assignment', () => {
    expect(commandMarkOf(['/usr/bin/env', 'CLAUDE_PROJECT_DIR=/v', 'python3', '/s/board.py', '--view', 's'])).toBe('board.py')
    expect(commandMarkOf(['mytool', '--view', 's'])).toBe('')
    expect(commandMarkOf([])).toBe('')
  })

  test('usageArgv: the placeholders {anchor} {index} {task} {session}', () => {
    expect(usageArgv('a', 2, 'my task', 's1')).toEqual(['python3', SCRIPT, 'a', '--usage', '--task', 'my task'])
  })
})

describe('doneBlocks', () => {
  test('a block is the PLAN-DONE line and the lines after it up to the first blank line', () => {
    const output = 'wrote 1 row\nPLAN-DONE a · t · 2 left\n  next one\n  after it\n\nlater text\nPLAN-DONE b · u · 0 left\n'

    expect(doneBlocks(output)).toEqual(['PLAN-DONE a · t · 2 left\n  next one\n  after it', 'PLAN-DONE b · u · 0 left'])
  })

  test('a block at the end of the output ends there', () => {
    expect(doneBlocks('PLAN-DONE a · t · 0 left\nnothing else')).toEqual(['PLAN-DONE a · t · 0 left\nnothing else'])
  })

  test('only a line that starts with PLAN-DONE and a space counts', () => {
    expect(doneBlocks('echo PLAN-DONE a · t · 1 left\n PLAN-DONE a · t · 1 left\nPLAN-DONE\nPLAN-DONEa')).toEqual([])
  })

  test('an output with no block, or none at all, gives none', () => {
    expect(doneBlocks('')).toEqual([])
    expect(doneBlocks('ok\nPlan done')).toEqual([])
  })
})

describe('doneHeader', () => {
  test('takes the task and the count from the first line', () => {
    expect(doneHeader('PLAN-DONE alpha · §2 wire the CLI · 3 left\n  more')).toEqual({ task: '§2 wire the CLI', left: '3' })
  })

  test('a task that holds the separator stays whole', () => {
    expect(doneHeader('PLAN-DONE a · map · reduce · 0 left')).toEqual({ task: 'map · reduce', left: '0' })
  })

  test('another shape gives nothing', () => {
    expect(doneHeader('PLAN-DONE alpha · only two parts')).toBeUndefined()
    expect(doneHeader('PLAN-DONE a · t · many left')).toBeUndefined()
    expect(doneHeader('PLAN-DONE a · t · 3 left over')).toBeUndefined()
  })
})

describe('finishedAnchor', () => {
  test('a block with 0 left names the plan it finished; any other count names none', () => {
    expect(finishedAnchor('PLAN-DONE alpha · §2 wire the CLI · 0 left\n  more')).toBe('alpha')
    expect(finishedAnchor('PLAN-DONE alpha · map · reduce · 0 left')).toBe('alpha')
    expect(finishedAnchor('PLAN-DONE alpha · t · 1 left')).toBeUndefined()
    expect(finishedAnchor('PLAN-DONE alpha · t · 10 left')).toBeUndefined()
    expect(finishedAnchor('PLAN-DONE alpha without the rest')).toBeUndefined()
  })
})

describe('failureText', () => {
  test('names the exit code and the last non-empty line of stderr, cut to 200 characters', () => {
    expect(failureText(2, '\n  boom\nsecond line\n  \n')).toBe('plan-tracker: the board command exited 2: second line')
    expect(failureText(1, 'Traceback (most recent call last):\n  File "x.py", line 3, in <module>\nKeyError: \'plan\'\n')).toBe(
      "plan-tracker: the board command exited 1: KeyError: 'plan'",
    )
    expect(failureText(1, 'x'.repeat(300))).toBe(`plan-tracker: the board command exited 1: ${'x'.repeat(200)}`)
  })

  test('with nothing on stderr it names the exit code alone', () => {
    expect(failureText(3, '  \n')).toBe('plan-tracker: the board command exited 3')
  })
})
