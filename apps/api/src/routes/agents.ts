import { Elysia } from 'elysia'
import { z } from 'zod'
import { desc, gte, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { agentNarrative, agentOverviewSnapshot } from '../db/schema.js'
import {
  exceedsSnapshotBytes,
  HISTORY_DAYS,
  insertAndPruneSnapshot,
  latestSnapshotRow,
  MAX_SNAPSHOT_BYTES,
  pgIso,
  toIso,
} from '../lib/snapshot-store.js'

// Agent observation surface — Argo stores what sideclaw's deterministic
// overview (`GET /api/overview` on the mini) and the narrator produce, and
// serves it back to the dashboard, Hermes and the brain page. Argo derives
// nothing: the snapshot is stored as raw jsonb and validated LOOSELY (every
// object below is `looseObject`, unknown fields ride through untouched) so a
// new sideclaw field never 422s the ingest. Retention: the latest snapshot per
// machine plus a rolling 7-day history, pruned on every ingest.

/** Accepts sideclaw's epoch-ms `generatedAt` as well as an ISO string. */
const TimestampInput = z
  .union([z.number(), z.string()])
  .describe('Epoch milliseconds (sideclaw) or an ISO 8601 timestamp')

const AgentStateEnum = z.enum(['needs_you', 'working', 'idle', 'stale', 'done', 'unknown'])

const AgentSchema = z.looseObject({
  id: z.string(),
  source: z.string().optional(),
  sessionId: z.string().nullable().optional(),
  paneId: z.string().nullable().optional(),
  workspaceId: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  state: AgentStateEnum,
  herdrStatus: z.string().nullable().optional(),
  claudeStatus: z.string().nullable().optional(),
  waitingFor: z.string().nullable().optional(),
  tier: z.string().nullable().optional(),
  lastPrompt: z.string().nullable().optional(),
  lastReply: z.string().nullable().optional(),
  lastActivityAt: z.number().nullable().optional().describe('Epoch ms'),
  startedAt: z.number().nullable().optional().describe('Epoch ms'),
  recommendation: z.string().nullable().optional(),
  standing: z.string().nullable().optional(),
  blocker: z.string().nullable().optional(),
  confidence: z.string().nullable().optional(),
  recommendationStale: z.boolean().optional(),
  project: z.string().optional().describe('Set on the flattened top-level agents[] only'),
})

const ProjectSchema = z.looseObject({
  name: z.string(),
  cwd: z.string().optional(),
  git: z
    .looseObject({
      branch: z.string(),
      dirty: z.boolean(),
      ahead: z.number(),
      behind: z.number(),
      lastCommit: z
        .looseObject({ sha: z.string(), subject: z.string(), at: z.string() })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
  agents: z.array(AgentSchema),
})

const SummarySchema = z.looseObject({
  needsYou: z.number().int(),
  working: z.number().int(),
  idle: z.number().int(),
  stale: z.number().int(),
  done: z.number().int(),
  dispatch: z.number().int(),
})

const OverviewMetaSchema = z.looseObject({
  generatedAt: z.number().describe('Epoch ms the recommendation job finished'),
  model: z.string(),
  backend: z.string().optional(),
  ageMs: z.number().optional(),
})

/**
 * One pending `ask-human.sh` request, in the shape sideclaw's `/api/overview` publishes it —
 * not the shape of the `.req` file on disk. sideclaw renames `created`/`text` to
 * `askedAt`/`question` on the way out, and that published shape is the contract its other
 * consumer (the Slack digest) already reads, so this mirrors the producer rather than the file.
 * Loose, so a producer that adds `host`/`cwd` back is stored rather than rejected.
 */
const HumanQueueItemSchema = z.looseObject({
  id: z.string(),
  askedAt: z.string().nullable().optional().describe('ISO 8601'),
  question: z.string(),
  cmd: z.string().nullable().optional(),
})

/** The stored snapshot — sideclaw's overview payload; every field past `generatedAt` is optional. */
const SnapshotSchema = z.looseObject({
  generatedAt: z.number().describe('Epoch ms the deterministic snapshot was produced'),
  staleAfterHours: z.number().optional(),
  summary: SummarySchema.optional(),
  projects: z.array(ProjectSchema).optional(),
  agents: z
    .array(AgentSchema)
    .optional()
    .describe('Flattened agents, when the producer sends them'),
  overview: OverviewMetaSchema.nullable().optional(),
  humanQueue: z.array(HumanQueueItemSchema).optional(),
  warnings: z.array(z.string()).optional(),
})

const OverviewIngestSchema = SnapshotSchema.extend({
  machine: z.string().min(1).max(64).describe('Producer host, e.g. "mini"'),
  generatedAt: TimestampInput,
})

const OverviewRecordSchema = z.object({
  id: z.number().int(),
  machine: z.string(),
  generatedAt: z.string().describe('ISO 8601'),
  receivedAt: z.string().describe('ISO 8601'),
  snapshot: SnapshotSchema,
})

const HistoryPointSchema = z.object({
  receivedAt: z.string().describe('ISO 8601'),
  generatedAt: z.string().describe('ISO 8601'),
  machine: z.string(),
  summary: SummarySchema.nullable(),
})

const NarrativeInputSchema = z.object({
  project: z.string().min(1).max(128),
  summary: z.string().min(1).max(20_000),
  revisedAt: TimestampInput,
  page: z.string().nullable().optional().describe('Brain page path the narrative was written to'),
})

const NarrativeSchema = z.object({
  project: z.string(),
  summary: z.string(),
  page: z.string().nullable(),
  revisedAt: z.string().describe('ISO 8601'),
  updatedAt: z.string().describe('ISO 8601'),
})

const AgentOverviewColumns = {
  id: agentOverviewSnapshot.id,
  machine: agentOverviewSnapshot.machine,
  received_at: agentOverviewSnapshot.received_at,
}

function toOverviewRecord(row: typeof agentOverviewSnapshot.$inferSelect) {
  return {
    id: row.id,
    machine: row.machine,
    generatedAt: pgIso(row.generated_at),
    receivedAt: pgIso(row.received_at),
    snapshot: row.raw as z.infer<typeof SnapshotSchema>,
  }
}

function toNarrative(row: typeof agentNarrative.$inferSelect) {
  return {
    project: row.project,
    summary: row.summary,
    page: row.page,
    revisedAt: pgIso(row.revised_at),
    updatedAt: pgIso(row.updated_at),
  }
}

export const agentRoutes = new Elysia({ prefix: '/agents' })
  .post(
    '/overview',
    async ({ body, status }) => {
      const generatedAt = toIso(body.generatedAt)
      if (!generatedAt) return status(400, 'generatedAt is not a valid timestamp')

      const { machine, ...snapshot } = body
      if (exceedsSnapshotBytes(snapshot)) {
        return status(413, `Snapshot exceeds ${MAX_SNAPSHOT_BYTES} bytes`)
      }
      const inserted = await insertAndPruneSnapshot(agentOverviewSnapshot, AgentOverviewColumns, {
        machine,
        generated_at: generatedAt,
        raw: { ...snapshot, generatedAt: Date.parse(generatedAt) },
      })
      return status(201, inserted)
    },
    {
      body: OverviewIngestSchema,
      response: {
        201: z.object({ id: z.number().int(), receivedAt: z.string() }),
        400: z.string(),
        413: z.string(),
      },
      detail: {
        tags: ['Agents'],
        summary: 'Ingest an agent overview snapshot',
        description:
          'Stores one sideclaw `GET /api/overview` payload (summary counts, projects with their agents and per-agent recommendation, the overview job metadata, optional human-queue items) tagged with the producing `machine`. Unknown fields are kept verbatim — the snapshot is stored as raw JSON. Every ingest prunes snapshots older than 7 days, keeping the newest per machine. Snapshots over 1 MB are rejected with 413. Read it back with GET /agents/overview (latest) and GET /agents/overview/history (summary counts over time).',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/overview',
    async ({ query }) => {
      const row = await latestSnapshotRow<typeof agentOverviewSnapshot.$inferSelect>(
        agentOverviewSnapshot,
        AgentOverviewColumns,
        query.machine,
      )
      return { latest: row ? toOverviewRecord(row) : null }
    },
    {
      query: z.object({
        machine: z.string().optional().describe('Restrict to one producer host'),
      }),
      response: z.object({ latest: OverviewRecordSchema.nullable() }),
      detail: {
        tags: ['Agents'],
        summary: 'Latest agent overview snapshot',
        description:
          'Returns the most recently received snapshot (`latest` is null before the first ingest), with `receivedAt` so a consumer can flag a stale feed. Pass ?machine= to pin one host when several push. The snapshot carries `summary` counts, `projects[].agents[]` with state and recommendation, `overview` (model/backend of the recommendation job) and `humanQueue`. For counts over time use GET /agents/overview/history; for per-project prose use GET /agents/narratives.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/overview/history',
    async ({ query }) => {
      const hours = query.hours ?? 24
      const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
      const rows = await db
        .select({
          receivedAt: agentOverviewSnapshot.received_at,
          generatedAt: agentOverviewSnapshot.generated_at,
          machine: agentOverviewSnapshot.machine,
          summary: sql<unknown>`${agentOverviewSnapshot.raw} -> 'summary'`,
        })
        .from(agentOverviewSnapshot)
        .where(gte(agentOverviewSnapshot.received_at, since))
        .orderBy(agentOverviewSnapshot.received_at)
      return {
        data: rows.map((r) => ({
          receivedAt: pgIso(r.receivedAt),
          generatedAt: pgIso(r.generatedAt),
          machine: r.machine,
          summary: SummarySchema.safeParse(r.summary).data ?? null,
        })),
      }
    },
    {
      query: z.object({
        hours: z.coerce
          .number()
          .int()
          .min(1)
          .max(HISTORY_DAYS * 24)
          .default(24)
          .optional(),
      }),
      response: z.object({ data: z.array(HistoryPointSchema) }),
      detail: {
        tags: ['Agents'],
        summary: 'Agent state counts over time',
        description:
          'Returns one point per stored snapshot in the last `hours` (default 24, max 168), oldest first, carrying only the `summary` counts (needsYou, working, idle, stale, done, dispatch) — the shape a sparkline wants. `summary` is null for a snapshot that carried none. For the full latest payload use GET /agents/overview.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .post(
    '/narratives',
    async ({ body, status }) => {
      const revisedAt = toIso(body.revisedAt)
      if (!revisedAt) return status(400, 'revisedAt is not a valid timestamp')
      const now = new Date().toISOString()
      const [row] = await db
        .insert(agentNarrative)
        .values({
          project: body.project,
          summary: body.summary,
          page: body.page ?? null,
          revised_at: revisedAt,
          updated_at: now,
        })
        .onConflictDoUpdate({
          target: agentNarrative.project,
          set: {
            summary: body.summary,
            page: body.page ?? null,
            revised_at: revisedAt,
            updated_at: now,
          },
        })
        .returning()
      return toNarrative(row!)
    },
    {
      body: NarrativeInputSchema,
      response: { 200: NarrativeSchema, 400: z.string() },
      detail: {
        tags: ['Agents'],
        summary: 'Upsert a project narrative',
        description:
          "Stores the narrator's one-paragraph summary for a project, keyed by `project` — a second POST for the same project replaces the row. `revisedAt` is when the narrative was written (epoch ms or ISO); `page` is the brain page it was also written to, if any. Read them all with GET /agents/narratives.",
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/narratives',
    async () => {
      const rows = await db.select().from(agentNarrative).orderBy(desc(agentNarrative.revised_at))
      return { data: rows.map(toNarrative) }
    },
    {
      response: z.object({ data: z.array(NarrativeSchema) }),
      detail: {
        tags: ['Agents'],
        summary: 'List project narratives',
        description:
          'Returns every project narrative, most recently revised first. One row per project — the latest POST /agents/narratives for that project wins. Pair with GET /agents/overview to show prose next to the live agent state.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
