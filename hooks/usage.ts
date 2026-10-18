/**
 * What the plugin shows of the usage: every session's ledger file (`register.tsx` writes one per session) read from the ledger folder and
 * summed per plan and row. A file is read again only when its size or modification time changed. A file that does not parse is read once
 * more after 200 ms (a read can land mid-write); one that still fails is listed in `ledger_errors` and read again only when it changes.
 */
import type { EngineInterface } from 'claude-code'

import type { PlanBoard, PlanEntry, PlanRow, RowUsage, SessionUsage, UsageTokens } from '../types'
import { settings } from './board'
import { ledgerDir, parseLedger } from './ledger'
import type { LedgerFile } from './ledger'

/**
 * The key a plan is counted under in the ledgers. A plain PROGRESS.md names its one plan `progress` in every project, so its key is the
 * file's absolute path; a board command's plan is the project root and its anchor, so two projects whose commands return the same anchor
 * never mix.
 */
export const planKey = (plan: PlanEntry): string => (settings.boardCommand === '' ? plan.plan_file : `${settings.root}#${plan.anchor}`)

/** How long a file that does not parse waits before its second read. */
export const LEDGER_RETRY_MS = 200

/** The ledgers read, and the ids of the sessions whose file could not be read. */
export type Ledgers = { files: readonly LedgerFile[]; errors: readonly string[] }

/** A file as it was last read: its size and modification time then, and its ledger, undefined when it would not parse. */
type Held = { size: number; mtimeMs: number; ledger: LedgerFile | undefined }

const held = new Map<string, Held>()

/** The ledger in `path`, or undefined when it cannot be read or is no ledger. A file is the ledger of the session it names (`session`), else of its own name. */
async function readOne($: EngineInterface, path: string, stem: string): Promise<LedgerFile | undefined> {
  try {
    const text = await $.fs.read(path)
    const named = (JSON.parse(text) as { session?: unknown } | null)?.session

    return parseLedger(text, typeof named === 'string' && named !== '' ? named : stem)
  } catch {
    return undefined
  }
}

/** Reads every `*.json` of the ledger folder, those that changed since the last call only; the rest is kept in memory. A missing folder is no ledgers. */
export async function readLedgers($: EngineInterface): Promise<Ledgers> {
  const home = await $.env.get('HOME')
  const dir = home === undefined || home === '' ? undefined : ledgerDir(home)
  const listed = dir === undefined ? [] : await $.fs.list(dir).catch(() => [])
  const files = listed.filter(one => one.kind === 'file' && one.name.endsWith('.json')).sort((a, b) => (a.name < b.name ? -1 : 1))
  const pathOf = (name: string) => `${dir}/${name}`
  const stemOf = (name: string) => name.slice(0, -'.json'.length)

  for (const path of [...held.keys()]) {
    if (!files.some(one => pathOf(one.name) === path)) {
      held.delete(path)
    }
  }

  // The size and time are those of the listing, taken before the read: a file rewritten meanwhile no longer matches them.
  const changed = files.filter(one => {
    const was = held.get(pathOf(one.name))

    return was === undefined || was.size !== one.size || was.mtimeMs !== one.mtimeMs
  })
  const first = await Promise.all(changed.map(one => readOne($, pathOf(one.name), stemOf(one.name))))
  const failed = changed.filter((_, at) => first[at] === undefined)
  const again = new Map<string, LedgerFile | undefined>()

  if (failed.length > 0) {
    await $.clock.sleep(LEDGER_RETRY_MS)

    for (const one of failed) {
      again.set(one.name, await readOne($, pathOf(one.name), stemOf(one.name)))
    }
  }

  changed.forEach((one, at) => held.set(pathOf(one.name), { size: one.size, mtimeMs: one.mtimeMs, ledger: first[at] ?? again.get(one.name) }))

  const read = files.map(one => ({ name: one.name, ledger: held.get(pathOf(one.name))?.ledger }))

  return {
    files: read.flatMap(one => (one.ledger === undefined ? [] : [one.ledger])),
    errors: read.flatMap(one => (one.ledger === undefined ? [stemOf(one.name)] : [])),
  }
}

// ---------------------------------------------------------------- summing

/** One session's sums for one plan and row: the earliest first and the latest last time, and the counts. */
type Acc = { surface: string; first: string; last: string; tokens: UsageTokens; cost: number; requests: number }

/** The sums by plan key and row text (null for the plan's own share), then by session id. */
type Sums = Map<string, Map<string, Acc>>

const slot = (key: string, row: string | null): string => JSON.stringify([key, row])

const time = (iso: string): number => {
  const ms = Date.parse(iso)

  return Number.isNaN(ms) ? 0 : ms
}

function sumsOf(ledgers: readonly LedgerFile[]): Sums {
  const sums: Sums = new Map()

  for (const one of ledgers) {
    for (const entry of one.entries) {
      const bySession = sums.get(slot(entry.plan, entry.row)) ?? new Map<string, Acc>()
      const acc = bySession.get(one.session) ?? { surface: one.surface, first: entry.first, last: entry.last, tokens: { in: 0, cached: 0, cache_write: 0, out: 0 }, cost: 0, requests: 0 }

      if (time(entry.first) < time(acc.first)) {
        acc.first = entry.first
      }

      if (time(entry.last) > time(acc.last)) {
        acc.last = entry.last
      }

      acc.tokens = { in: acc.tokens.in + entry.tokens.in, cached: acc.tokens.cached + entry.tokens.cached, cache_write: acc.tokens.cache_write + entry.tokens.cache_write, out: acc.tokens.out + entry.tokens.out }
      acc.cost += entry.cost_usd
      acc.requests += entry.requests
      bySession.set(one.session, acc)
      sums.set(slot(entry.plan, entry.row), bySession)
    }
  }

  return sums
}

const round = (usd: number): number => Math.round(usd * 1e6) / 1e6

function usageOf(accs: readonly Acc[]): RowUsage {
  return {
    tokens_in: accs.reduce((sum, one) => sum + one.tokens.in, 0),
    tokens_cached: accs.reduce((sum, one) => sum + one.tokens.cached, 0),
    tokens_cache_write: accs.reduce((sum, one) => sum + one.tokens.cache_write, 0),
    tokens_out: accs.reduce((sum, one) => sum + one.tokens.out, 0),
    cost_usd: round(accs.reduce((sum, one) => sum + one.cost, 0)),
    requests: accs.reduce((sum, one) => sum + one.requests, 0),
  }
}

/** The row's sessions, by the time each first worked on it. */
function sessionsOf(bySession: ReadonlyMap<string, Acc>): SessionUsage[] {
  return [...bySession.entries()]
    .sort(([a, one], [b, two]) => time(one.first) - time(two.first) || (a < b ? -1 : 1))
    .map(([session, acc]) => ({ session, surface: acc.surface, first: acc.first, last: acc.last, tokens: acc.tokens, cost_usd: round(acc.cost) }))
}

/**
 * `board` with the usage the ledgers hold: each row some entry names gets `usage` and `sessions_usage`; each plan `usage_totals` (its rows'
 * and its own share, which is also given alone as `plan_own`; zeros when nothing was counted); the board `ledger_errors` when a file could
 * not be read. `keyOf` gives the key a plan is counted under (its ledger entries' `plan`).
 */
export function withUsage(board: PlanBoard, ledgers: Ledgers, keyOf: (plan: PlanEntry) => string): PlanBoard {
  const sums = sumsOf(ledgers.files)
  const accsOf = (key: string, row: string | null): Acc[] => [...(sums.get(slot(key, row))?.values() ?? [])]

  const plans = board.plans.map((plan): PlanEntry => {
    const key = keyOf(plan)
    const own = accsOf(key, null)
    const ofRows = [...new Set(plan.rows.map(one => one.task))].flatMap(task => accsOf(key, task))

    return {
      ...plan,
      usage_totals: { ...usageOf([...ofRows, ...own]), plan_own: usageOf(own) },
      rows: plan.rows.map((one): PlanRow => {
        const bySession = sums.get(slot(key, one.task))

        return bySession === undefined || bySession.size === 0 ? one : { ...one, usage: usageOf([...bySession.values()]), sessions_usage: sessionsOf(bySession) }
      }),
    }
  })

  return { ...board, plans, ...(ledgers.errors.length === 0 ? {} : { ledger_errors: [...ledgers.errors] }) }
}
