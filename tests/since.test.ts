import { describe, expect, test } from './testing'

import { CHIPS, bandFit, bandLine, cardView, chipOf, displayWidth, fullCard, planStateOf, planStateText, sinceText } from '../hooks/board'
import type { PlanEntry, PlanRow, PlanStatus } from '../types'
import { dayName, localTime } from './fixtures'

describe('sinceText: a time as the clock time today, as the day and the clock time on another day', () => {
  const NOW = Date.parse('2026-10-12T21:00:00+09:00')

  test('today: HH:MM; another day: Mon D HH:MM', () => {
    expect(sinceText('2026-10-12T19:23:00+09:00', NOW)).toBe('19:23')
    expect(sinceText('2026-10-12T00:05:00+09:00', NOW)).toBe('00:05')
    expect(sinceText('2026-10-11T19:23:00+09:00', NOW)).toBe('Oct 11 19:23')
    expect(sinceText('2025-10-12T19:23:00+09:00', NOW)).toBe('Oct 12 19:23')
  })

  test('"today" is the day on the clock the time was written in, not this machine\'s', () => {
    // 04:40Z is 23:40 on the 11th at -05:00; 05:40Z is 00:40 on the 12th there
    expect(sinceText('2026-10-11T23:30:00-05:00', Date.parse('2026-10-12T04:40:00Z'))).toBe('23:30')
    expect(sinceText('2026-10-11T23:30:00-05:00', Date.parse('2026-10-12T05:40:00Z'))).toBe('Oct 11 23:30')
  })

  test('a time ending in Z reads on this machine\'s clock', () => {
    const at = new Date(2026, 9, 12, 14, 2, 30)

    expect(sinceText(at.toISOString(), at.getTime() + 3_600_000)).toBe('14:02')
    expect(sinceText(at.toISOString(), at.getTime() + 3 * 86_400_000)).toBe('Oct 12 14:02')
  })

  test('text that is not an ISO time with a clock time gives nothing', () => {
    for (const text of ['', 'yesterday', '2026-10-12', '2026-10-12 14:02', 'Z']) {
      expect(sinceText(text, NOW)).toBeUndefined()
    }
  })
})

describe('planStateText: the state word with the time it began', () => {
  const NOW = Date.parse(localTime(0, 21, 0))
  const at = (daysAgo: number, hour: number, minute: number) => localTime(daysAgo, hour, minute)
  const row = (status: PlanStatus, stalled?: string): PlanRow => ({ task: `a ${status} task`, status, updated: null, ...(stalled === undefined ? {} : { stalled_since: stalled }) })
  const plan = (rows: PlanRow[], extra: Partial<PlanEntry> = {}): PlanEntry => ({ anchor: 'p', name: 'Plan', goal: '', plan_file: '/p.md', rows, ...extra })

  test('Stalled since: the newest stalled_since of the running rows, a row that is not running never counts', () => {
    const stalled = plan([row('In Progress', at(0, 14, 2)), row('Verifying', at(0, 15, 30)), row('In Progress', at(0, 13, 0)), row('Todo', at(0, 20, 0)), row('Done')])

    expect(planStateOf(stalled)).toBe('Stalled')
    expect(planStateText(stalled, NOW)).toBe('Stalled since 15:30')
    expect(planStateText(plan([row('In Progress', at(2, 14, 2))]), NOW)).toBe(`Stalled since ${dayName(2)} 14:02`)
  })

  test('Stalled without a time it can read is plain Stalled', () => {
    expect(planStateText(plan([row('In Progress', '2026-10-12 14:02')]), NOW)).toBe('Stalled')
  })

  test('Idle since: from the plan\'s idle_since; plain Idle without it', () => {
    expect(planStateText(plan([row('Done'), row('Todo')], { idle_since: at(0, 19, 40) }), NOW)).toBe('Idle since 19:40')
    expect(planStateText(plan([row('Done'), row('Needs Verification')], { idle_since: at(1, 19, 40) }), NOW)).toBe(`Idle since ${dayName(1)} 19:40`)
    expect(planStateText(plan([row('Done'), row('Todo')]), NOW)).toBe('Idle')
    expect(planStateText(plan([row('Done'), row('Todo')], { idle_since: 'a while ago' }), NOW)).toBe('Idle')
    expect(planStateText(plan([]), NOW)).toBe('Idle')
  })

  test('In progress and Done are the bare words, whatever the plan carries', () => {
    expect(planStateText(plan([row('In Progress'), row('Todo')], { idle_since: at(0, 19, 40) }), NOW)).toBe('In progress')
    expect(planStateText(plan([row('In Progress', at(0, 14, 2)), row('In Progress')]), NOW)).toBe('In progress')
    expect(planStateText(plan([row('Done'), row('Canceled')], { idle_since: at(0, 19, 40) }), NOW)).toBe('Done')
    expect(planStateText(plan([row('Done'), row('Todo')], { finished: at(0, 19, 40), idle_since: at(0, 19, 40) }), NOW)).toBe('Done')
  })
})

describe('the longer state word and tag take their room', () => {
  const NOW = Date.parse(localTime(0, 21, 0))
  const STALLED = localTime(0, 14, 2)
  const stalledRow = (stalled: string): PlanRow => ({ task: 'Build it', status: 'In Progress', updated: null, stalled_since: stalled, route: 'spawn × subagent · Sonnet — x' })
  const plan = (stalled: string): PlanEntry => ({
    anchor: 'p',
    name: 'A plan with a name that is long enough to be cut in a narrow band',
    goal: '',
    plan_file: '/p.md',
    rows: [stalledRow(stalled), { task: 'later', status: 'Todo', updated: null }],
  })

  // The same plan with a stalled time the board cannot read as a clock time: its state word is the bare `Stalled`.
  const bare = plan('2026-10-12 14:02')
  const timed = plan(STALLED)

  test('the band row cuts the name for the whole text: bandLine reads the text, its width comes out of the name', () => {
    const wide = bandLine(timed, 100, NOW)
    const plain = bandLine(bare, 100, NOW)

    expect(wide.state).toBe('Stalled')
    expect(wide.stateText).toBe('Stalled since 14:02')
    expect(plain.stateText).toBe('Stalled')
    expect(displayWidth(plain.name) - displayWidth(wide.name)).toBe(displayWidth(' since 14:02'))
  })

  test('the terminal band drops the state word at a wider row when the word is longer, and never cuts it', () => {
    const firstWithState = (one: PlanEntry) => {
      for (let cols = 10; cols < 200; cols += 1) {
        if (bandFit(one, cols, false, 12, NOW).hasState) {
          return cols
        }
      }

      return Number.POSITIVE_INFINITY
    }

    expect(bandFit(timed, 100, false, 12, NOW)).toMatchObject({ state: 'Stalled', stateText: 'Stalled since 14:02', hasState: true })
    expect(firstWithState(timed) - firstWithState(bare)).toBe(displayWidth(' since 14:02'))
  })

  test('a card shows its tag only where the whole chip, two spaces and a column of name fit beside the mascot: `stalled 14:02` needs 29 columns, `stalled` alone 19', () => {
    // a mascot card keeps 4 columns of border and 7 of mascot: the chip (word and a space each side), two spaces and one column of name need 15 + 3 on top
    expect(cardView(stalledRow(STALLED), 28, NOW).tag).toBe('')
    expect(cardView(stalledRow(STALLED), 29, NOW).tag).toBe('stalled 14:02')
    expect(cardView(stalledRow('2026-10-12 14:02'), 28, NOW).tag).toBe('stalled')
    expect(cardView(stalledRow(STALLED), 60, NOW).tag).toBe('stalled 14:02')
  })

  test('the hover box carries the same tag', () => {
    expect(fullCard(stalledRow(STALLED), 40, 0, NOW).tag).toBe('stalled 14:02')
    expect(fullCard(stalledRow(localTime(3, 14, 2)), 40, 0, NOW).tag).toBe(`stalled ${dayName(3)}`)
  })
})

describe('chipOf: the chip of a tag word', () => {
  test('the model and `you` words have their chips; `stalled` with or without its time is the grey one; anything else has none', () => {
    expect(chipOf('Opus')).toEqual(CHIPS.Opus)
    expect(chipOf('you')).toEqual(CHIPS.you)
    expect(chipOf('stalled')).toEqual(CHIPS.stalled)
    expect(chipOf('stalled 14:02')).toEqual(CHIPS.stalled)
    expect(chipOf(`stalled ${dayName(3)}`)).toEqual(CHIPS.stalled)
    expect(chipOf('stalledness')).toBeUndefined()
    expect(chipOf('')).toBeUndefined()
    expect(chipOf('Gemini')).toBeUndefined()
  })
})
