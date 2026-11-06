import { Elysia } from 'elysia'
import { z } from 'zod'
import { sql, type SQL } from 'drizzle-orm'
import { db } from '../db/index.js'
import { USAGE_ROWS } from '../lib/usage-source.js'
import {
  COST_BASIS,
  DEFAULT_WEEKS,
  ISSUE_LIMIT,
  MAX_WEEKS,
  shapeByWeek,
  shapeIssues,
  shapeSubagents,
  windowStart,
  type IssueLaneRow,
  type IssueRow,
  type SpawnGroupRow,
  type SpawnWeekRow,
} from '../lib/agent-kpis.js'

// Agent performance, usage half: what the subagents, factory workers and Issues cost, read from the same
// usage read model as every /usage route. The review-stats half is pushed by agent-workflows
// (POST /agents/review-stats, routes/agents.ts). Argo only reads `usage`.

const rowsOf = <T>(result: unknown) => result as unknown as T[]

/** Closed expression lists: no request value reaches the SQL text; `weeks` only moves the bound `since`. */
const NAME_SQL = sql.raw(`(CASE
  WHEN lane = 'subagent' THEN COALESCE(NULLIF(lane_detail->>'subagent_type', ''), 'unknown')
  WHEN lane = 'worker' THEN COALESCE(NULLIF(lane_detail->>'role', ''), 'worker')
  ELSE lane
END)`)
const COST_SQL = sql.raw('COALESCE(sum(cost_usd), 0)')
const ISO_SQL = (col: string): SQL =>
  sql.raw(`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`)

const QuerySchema = z.object({
  weeks: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_WEEKS)
    .default(DEFAULT_WEEKS)
    .optional()
    .describe(
      `Window in ISO weeks (Monday 00:00 UTC), current partial week included; 1..${MAX_WEEKS}, default ${DEFAULT_WEEKS}`,
    ),
})

const KindEnum = z.enum(['subagent', 'worker'])

const SubagentSchema = z.object({
  kind: KindEnum,
  name: z
    .string()
    .describe(
      'subagent_type (kind=subagent, "unknown" when unset) or factory role (kind=worker, "worker" when unset)',
    ),
  runs: z
    .number()
    .int()
    .describe('Distinct sessions: each subagent / worker run is its own session'),
  requests: z.number().int(),
  costUsd: z.number().describe(COST_BASIS),
  avgCostUsd: z.number().describe('costUsd / runs; 0 when runs is 0'),
})

const WeekRowSchema = z.object({
  weekStart: z.string().describe('Monday of the UTC week, YYYY-MM-DD, by the row timestamp'),
  kind: KindEnum,
  name: z.string(),
  runs: z.number().int(),
  costUsd: z.number(),
})

const IssueLaneSchema = z.object({
  lane: z.string().describe("Raw record lane: 'lead', 'subagent', 'worker', ..."),
  name: z.string().describe("subagent_type, factory role or the lane itself ('lead')"),
  runs: z.number().int(),
  requests: z.number().int(),
  costUsd: z.number(),
})

const IssueSchema = z.object({
  issueId: z.string().describe("Bare factory issue number, e.g. '230'"),
  repo: z
    .string()
    .nullable()
    .describe('Project with the most cost on this Issue; null when no row carried one'),
  firstTs: z.string().describe('ISO 8601'),
  lastTs: z.string().describe('ISO 8601'),
  runs: z.number().int().describe('Distinct sessions across all lanes'),
  requests: z.number().int(),
  costUsd: z
    .number()
    .describe('All lanes of the Issue; a subagent inherits the issue_id of its lead'),
  lanes: z.array(IssueLaneSchema).describe('Cost desc'),
})

const ResponseSchema = z.object({
  since: z.string().describe('ISO 8601, Monday 00:00 UTC of the first window week'),
  weeks: z.number().int(),
  generatedAt: z.string().describe('ISO 8601'),
  costBasis: z.string(),
  subagents: z.array(SubagentSchema).describe('Cost desc'),
  byWeek: z.array(WeekRowSchema).describe('Weeks without rows are omitted; oldest week first'),
  issues: z.array(IssueSchema).describe(`Newest lastTs first, at most ${ISSUE_LIMIT}`),
})

export const agentKpiRoutes = new Elysia({ prefix: '/agents/kpis' }).get(
  '/usage',
  async ({ query }) => {
    const weeks = query.weeks ?? DEFAULT_WEEKS
    const now = new Date()
    const since = windowStart(weeks, now).toISOString()
    const sinceSql = sql`${since}::timestamptz`

    const [groups, perWeek, issues, lanes] = await Promise.all([
      db.execute(sql`
        SELECT lane AS kind, ${NAME_SQL} AS name, count(DISTINCT session_id) AS runs,
               count(*) AS requests, ${COST_SQL} AS cost
        FROM ${USAGE_ROWS}
        WHERE ts >= ${sinceSql} AND lane IN ('subagent', 'worker')
        GROUP BY 1, 2`),
      db.execute(sql`
        SELECT to_char(date_trunc('week', ts AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS week_start,
               lane AS kind, ${NAME_SQL} AS name, count(DISTINCT session_id) AS runs,
               count(*) AS requests, ${COST_SQL} AS cost
        FROM ${USAGE_ROWS}
        WHERE ts >= ${sinceSql} AND lane IN ('subagent', 'worker')
        GROUP BY 1, 2, 3`),
      db.execute(sql`
        WITH win AS (
          SELECT issue_id, session_id, project, lane, lane_detail, ts, cost_usd
          FROM ${USAGE_ROWS}
          WHERE ts >= ${sinceSql} AND issue_id IS NOT NULL AND issue_id <> ''
        ), top AS (
          SELECT issue_id, min(ts) AS first_ts, max(ts) AS last_ts, count(DISTINCT session_id) AS runs,
                 count(*) AS requests, ${COST_SQL} AS cost
          FROM win GROUP BY issue_id ORDER BY max(ts) DESC, issue_id LIMIT ${ISSUE_LIMIT}
        )
        SELECT t.issue_id, ${ISO_SQL('t.first_ts')} AS first_ts, ${ISO_SQL('t.last_ts')} AS last_ts,
               t.runs, t.requests, t.cost,
               (SELECT w.project FROM win w WHERE w.issue_id = t.issue_id AND w.project IS NOT NULL
                GROUP BY w.project ORDER BY COALESCE(sum(w.cost_usd), 0) DESC, w.project LIMIT 1) AS repo
        FROM top t ORDER BY t.last_ts DESC, t.issue_id`),
      db.execute(sql`
        WITH win AS (
          SELECT issue_id, session_id, lane, lane_detail, ts, cost_usd
          FROM ${USAGE_ROWS}
          WHERE ts >= ${sinceSql} AND issue_id IS NOT NULL AND issue_id <> ''
        ), top AS (
          SELECT issue_id FROM win GROUP BY issue_id ORDER BY max(ts) DESC, issue_id LIMIT ${ISSUE_LIMIT}
        )
        SELECT issue_id, lane, ${NAME_SQL} AS name, count(DISTINCT session_id) AS runs,
               count(*) AS requests, ${COST_SQL} AS cost
        FROM win WHERE issue_id IN (SELECT issue_id FROM top)
        GROUP BY 1, 2, 3`),
    ])

    return {
      since,
      weeks,
      generatedAt: now.toISOString(),
      costBasis: COST_BASIS,
      subagents: shapeSubagents(rowsOf<SpawnGroupRow>(groups)),
      byWeek: shapeByWeek(rowsOf<SpawnWeekRow>(perWeek)),
      issues: shapeIssues(rowsOf<IssueRow>(issues), rowsOf<IssueLaneRow>(lanes)),
    }
  },
  {
    query: QuerySchema,
    response: ResponseSchema,
    detail: {
      tags: ['Agents'],
      summary: 'Agent performance: subagent, worker and Issue usage',
      description: `Reads the usage read model (usage.records_unique) over the last N ISO weeks (?weeks=, 1..${MAX_WEEKS}, default ${DEFAULT_WEEKS}; Monday 00:00 UTC boundaries, the current partial week included; \`since\` echoes the start). \`subagents\`: per subagent_type (kind=subagent) and factory role (kind=worker), runs = distinct sessions, requests, cost and average cost per run, cost desc. \`byWeek\`: the same grouping per UTC Monday week by row timestamp, empty weeks omitted. \`issues\`: up to ${ISSUE_LIMIT} factory Issues (bare issue number) with any record in the window, newest lastTs first, with the repo that carried most of the cost and a per-lane breakdown (a subagent inherits its lead's issue_id, so an Issue's cost is all its lanes). Cost caveat: ${COST_BASIS} Review-quality numbers are in GET /agents/review-stats.`,
      security: [{ BearerAuth: [] }],
    },
  },
)
