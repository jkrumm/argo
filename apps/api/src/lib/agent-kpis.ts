// Pure shaping for GET /agents/kpis/usage: window math and the fold from SQL rows into the response.
// The SQL lives in routes/agent-kpis.ts; nothing here touches the database.

export const DEFAULT_WEEKS = 8
export const MAX_WEEKS = 26
export const ISSUE_LIMIT = 50
const WEEK_MS = 7 * 86_400_000

export const COST_BASIS =
  'cost_usd as stored in usage.records: Max-subscription rows carry the list value of the tokens, not billed money; API-key and credit rows carry their reported or priced cost.'

export type SpawnKind = 'subagent' | 'worker'

/** A numeric the driver may hand back as a string (bigint counts, float8 sums). */
type Num = number | string | null

export interface SpawnGroupRow {
  kind: SpawnKind
  name: string
  runs: Num
  requests: Num
  cost: Num
}
export interface SpawnWeekRow extends SpawnGroupRow {
  week_start: string
}
export interface IssueRow {
  issue_id: string
  repo: string | null
  first_ts: string
  last_ts: string
  runs: Num
  requests: Num
  cost: Num
}
export interface IssueLaneRow {
  issue_id: string
  lane: string
  name: string
  runs: Num
  requests: Num
  cost: Num
}

const num = (v: Num): number => (v === null ? 0 : Number(v))

/** Monday 00:00 UTC of the ISO week containing `d`. */
export function mondayOf(d: Date): Date {
  const day = d.getUTCDay() === 0 ? 7 : d.getUTCDay()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (day - 1)))
}

/** `YYYY-MM-DD` of the Monday starting the week that contains `d`. */
export function weekStartOf(d: Date): string {
  return mondayOf(d).toISOString().slice(0, 10)
}

/** Start of the window: Monday 00:00 UTC, `weeks - 1` weeks before the current week (current partial week included). */
export function windowStart(weeks: number, now: Date): Date {
  return new Date(mondayOf(now).getTime() - (weeks - 1) * WEEK_MS)
}

const avg = (cost: number, runs: number): number => (runs === 0 ? 0 : cost / runs)

const byCostDesc = <T extends { costUsd: number; name: string }>(a: T, b: T): number =>
  b.costUsd - a.costUsd || a.name.localeCompare(b.name)

export function shapeSubagents(rows: SpawnGroupRow[]) {
  return rows
    .map((r) => {
      const runs = num(r.runs)
      const costUsd = num(r.cost)
      return {
        kind: r.kind,
        name: r.name,
        runs,
        requests: num(r.requests),
        costUsd,
        avgCostUsd: avg(costUsd, runs),
      }
    })
    .sort(byCostDesc)
}

export function shapeByWeek(rows: SpawnWeekRow[]) {
  return rows
    .map((r) => ({
      weekStart: r.week_start,
      kind: r.kind,
      name: r.name,
      runs: num(r.runs),
      costUsd: num(r.cost),
    }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart) || byCostDesc(a, b))
}

export function shapeIssues(issues: IssueRow[], lanes: IssueLaneRow[], limit = ISSUE_LIMIT) {
  const lanesByIssue = new Map<string, ReturnType<typeof toLane>[]>()
  for (const l of lanes) {
    const list = lanesByIssue.get(l.issue_id) ?? []
    list.push(toLane(l))
    lanesByIssue.set(l.issue_id, list)
  }
  return issues
    .map((i) => ({
      issueId: i.issue_id,
      repo: i.repo,
      firstTs: i.first_ts,
      lastTs: i.last_ts,
      runs: num(i.runs),
      requests: num(i.requests),
      costUsd: num(i.cost),
      lanes: (lanesByIssue.get(i.issue_id) ?? []).sort(byCostDesc),
    }))
    .sort((a, b) => b.lastTs.localeCompare(a.lastTs))
    .slice(0, limit)
}

function toLane(l: IssueLaneRow) {
  return {
    lane: l.lane,
    name: l.name,
    runs: num(l.runs),
    requests: num(l.requests),
    costUsd: num(l.cost),
  }
}
