import { Elysia } from 'elysia'
import { z } from 'zod'
import { and, asc, count, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { walkingPadSessions, walkingPadAchievements } from '../db/schema.js'
import { WindowQuerySchema, parseWindow } from '../lib/window.js'
import {
  ACHIEVEMENT_TYPES,
  bucketSessions,
  computeWalkingPadHeroes,
  detectWalkingPadAchievements,
  hourOfDayMatrix,
  sessionLengthHistogram,
  type DetectedAchievement,
  type WalkingPadSessionRow,
} from '../lib/walking-pad-formulas.js'

// ISO-8601 with second precision and `Z` suffix; the daemon always sends UTC.
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
const isoUtc = z.string().regex(ISO_RE, 'expected UTC ISO-8601 (e.g. 2026-05-17T15:30:00Z)')

const WalkingPadSessionSchema = z.object({
  uuid: z.string().uuid().describe('Daemon-generated session id; primary key, used for upsert.'),
  started_at: z.string().describe('ISO 8601 UTC timestamp when the session began.'),
  ended_at: z.string().describe('ISO 8601 UTC timestamp when the session was closed.'),
  duration_s: z
    .number()
    .int()
    .nonnegative()
    .describe('Walking duration in seconds, pauses excluded.'),
  distance_m: z.number().nonnegative().describe('Distance walked in meters.'),
  steps: z.number().int().nonnegative().describe('Step count for the session.'),
  avg_speed_kmh: z.number().nonnegative().describe('Mean walking speed in km/h.'),
  max_speed_kmh: z.number().nonnegative().describe('Peak walking speed in km/h.'),
  kcal: z.number().nonnegative().describe('Energy expenditure estimated by the treadmill.'),
  pause_count: z
    .number()
    .int()
    .nonnegative()
    .describe('Number of pause→resume transitions during the session.'),
  created_at: z.string().nullable().describe('Server-side insert timestamp (ISO 8601).'),
})

const WalkingPadSessionInputSchema = z.object({
  uuid: z.string().uuid(),
  started_at: isoUtc,
  ended_at: isoUtc,
  duration_s: z.number().int().min(0),
  distance_m: z.number().min(0),
  steps: z.number().int().min(0),
  avg_speed_kmh: z.number().min(0).max(60),
  max_speed_kmh: z.number().min(0).max(60),
  kcal: z.number().min(0),
  pause_count: z.number().int().min(0).default(0),
})

const WalkingPadSummarySchema = z.object({
  sessions: z.number().int().nonnegative().describe('Closed-session count inside the window.'),
  duration_s: z.number().int().nonnegative().describe('Total walking duration in seconds.'),
  distance_m: z.number().nonnegative().describe('Total distance in meters (rounded to integer).'),
  steps: z.number().int().nonnegative().describe('Total step count.'),
  kcal: z.number().nonnegative().describe('Total energy expenditure in kcal (one decimal).'),
  avg_session_min: z
    .number()
    .nullable()
    .describe('Mean session duration in minutes (one decimal); null when no sessions in window.'),
})

// ── Achievements ────────────────────────────────────────────────────────────

const AchievementTypeEnum = z.enum(ACHIEVEMENT_TYPES as unknown as [string, ...string[]])

const AchievementSchema = z.object({
  id: z.number().int(),
  type: AchievementTypeEnum,
  session_uuid: z.string().nullable(),
  value: z.number().nullable(),
  title: z.string(),
  description: z.string(),
  confetti: z.boolean(),
  unlocked_at: z.string(),
})

const NewAchievementSchema = z.object({
  type: AchievementTypeEnum,
  session_uuid: z.string().nullable(),
  value: z.number(),
  title: z.string(),
  description: z.string(),
  confetti: z.boolean(),
})

// ── Live session ────────────────────────────────────────────────────────────

const LiveSnapshotSchema = z.object({
  uuid: z.string().uuid(),
  started_at: isoUtc,
  state: z.enum(['active', 'paused', 'ended']),
  duration_s: z.number().int().min(0),
  distance_m: z.number().min(0),
  steps: z.number().int().min(0),
  current_speed_kmh: z.number().min(0).max(60),
  avg_speed_kmh: z.number().min(0).max(60),
  max_speed_kmh: z.number().min(0).max(60),
  kcal: z.number().min(0),
  pause_count: z.number().int().min(0).default(0),
  sample_at: isoUtc,
})

const LiveSnapshotResponseSchema = z.object({
  uuid: z.string().uuid(),
  started_at: z.string(),
  state: z.enum(['active', 'paused', 'ended']),
  duration_s: z.number().int(),
  distance_m: z.number(),
  steps: z.number().int(),
  current_speed_kmh: z.number(),
  avg_speed_kmh: z.number(),
  max_speed_kmh: z.number(),
  kcal: z.number(),
  pause_count: z.number().int(),
  sample_at: z.string(),
  received_at: z.string(),
  age_s: z.number().describe('Seconds since sample_at; consumers use this to detect staleness.'),
})

// Envelope so the wire is always a non-empty JSON object. Returning bare `null`
// from an Elysia handler serializes to an empty response body — Eden then
// parses that as `""` (not `null`), and consumers crash dereferencing fields
// like `live.steps`.
const LiveResponseSchema = z.object({
  snapshot: LiveSnapshotResponseSchema.nullable(),
})

// In-memory live-snapshot store. One row only (single daemon, single Mac).
// TTL is enforced at read time: any snapshot older than LIVE_TTL_MS is treated
// as if it never existed, so a crashed daemon doesn't show a "live" session
// forever. The user opted for in-memory over Valkey/Redis — fine for a
// single-instance deploy.
type LiveSnapshot = z.infer<typeof LiveSnapshotSchema> & { received_at: string }
let liveSnapshot: LiveSnapshot | null = null
const LIVE_TTL_MS = 15_000

// ── Series ──────────────────────────────────────────────────────────────────

const SeriesPointSchema = z.object({
  date: z.string().describe('YYYY-MM-DD for bucket=day, YYYY-Www (ISO week) for bucket=week.'),
  sessions: z.number().int(),
  duration_s: z.number().int(),
  distance_m: z.number(),
  steps: z.number().int(),
  kcal: z.number(),
  avg_speed_kmh: z
    .number()
    .nullable()
    .describe(
      'Distance-weighted average across all sessions in the bucket; null when no sessions.',
    ),
})

const SeriesResponseSchema = z.object({
  bucket: z.enum(['day', 'week']),
  points: z.array(SeriesPointSchema),
})

const HourDowCellSchema = z.object({
  dow: z.number().int().min(0).max(6).describe('0=Sunday … 6=Saturday (UTC).'),
  hour: z.number().int().min(0).max(23).describe('Hour of day in UTC.'),
  sessions: z.number().int().nonnegative(),
  distance_m: z.number().nonnegative(),
})

const LengthHistogramSchema = z.object({
  bucketMin: z.number().int().describe('Lower bound of the 5-minute bucket (0,5,10,…).'),
  sessions: z.number().int().nonnegative(),
})

// ── Heroes ──────────────────────────────────────────────────────────────────

const HeroesResponseSchema = z.object({
  volume: z.object({
    direction: z.enum(['increasing', 'stable', 'decreasing', 'insufficient']),
    currentDistanceM: z.number().int().nonnegative(),
    priorDistanceM: z.number().int().nonnegative(),
    deltaPct: z.number().nullable(),
  }),
  pace: z.object({
    direction: z.enum(['faster', 'stable', 'slower', 'insufficient']),
    currentAvgKmh: z.number().nullable(),
    priorAvgKmh: z.number().nullable(),
    deltaKmh: z.number().nullable(),
  }),
  streak: z.object({
    currentDays: z.number().int().nonnegative(),
    bestDays: z.number().int().nonnegative(),
    walkedToday: z.boolean(),
    momentum: z.enum(['accelerating', 'steady', 'cooling']),
    sessionsThisWeek: z.number().int().nonnegative(),
  }),
})

// ── Helpers ─────────────────────────────────────────────────────────────────

async function recomputeAchievements(
  sessionUuid: string,
): Promise<ReadonlyArray<DetectedAchievement>> {
  // Load full session history + all prior achievements. The table is small
  // (one row per closed session) so this is fine without an index dance.
  const [sessions, prior] = await Promise.all([
    db
      .select({
        uuid: walkingPadSessions.uuid,
        started_at: walkingPadSessions.started_at,
        ended_at: walkingPadSessions.ended_at,
        duration_s: walkingPadSessions.duration_s,
        distance_m: walkingPadSessions.distance_m,
        steps: walkingPadSessions.steps,
        avg_speed_kmh: walkingPadSessions.avg_speed_kmh,
        max_speed_kmh: walkingPadSessions.max_speed_kmh,
        kcal: walkingPadSessions.kcal,
        pause_count: walkingPadSessions.pause_count,
      })
      .from(walkingPadSessions),
    db
      .select({
        type: walkingPadAchievements.type,
        value: walkingPadAchievements.value,
        unlocked_at: walkingPadAchievements.unlocked_at,
      })
      .from(walkingPadAchievements),
  ])

  const typed = prior
    .filter((p): p is { type: string; value: number | null; unlocked_at: string } =>
      ACHIEVEMENT_TYPES.includes(p.type as (typeof ACHIEVEMENT_TYPES)[number]),
    )
    .map((p) => ({
      type: p.type as (typeof ACHIEVEMENT_TYPES)[number],
      value: p.value,
      unlocked_at: p.unlocked_at,
    }))

  const detected = detectWalkingPadAchievements(
    sessionUuid,
    sessions as WalkingPadSessionRow[],
    typed,
  )
  if (detected.length === 0) return []

  await db.insert(walkingPadAchievements).values(
    detected.map((d) => ({
      type: d.type,
      session_uuid: d.session_uuid,
      value: d.value,
      title: d.title,
      description: d.description,
      confetti: d.confetti ? 1 : 0,
    })),
  )

  return detected
}

// ── Routes ──────────────────────────────────────────────────────────────────

export const walkingPadRoutes = new Elysia({ prefix: '/walking-pad' })
  .post(
    '/sessions',
    async ({ body, set }) => {
      // Idempotent upsert on uuid — the daemon retries on transient failures.
      // A second POST with the same uuid overwrites the row (the daemon is the
      // source of truth, and totals may be re-emitted if it crashed mid-flush).
      const existing = await db
        .select({ uuid: walkingPadSessions.uuid })
        .from(walkingPadSessions)
        .where(sql`${walkingPadSessions.uuid} = ${body.uuid}`)
        .limit(1)

      await db
        .insert(walkingPadSessions)
        .values(body)
        .onConflictDoUpdate({
          target: walkingPadSessions.uuid,
          set: {
            started_at: body.started_at,
            ended_at: body.ended_at,
            duration_s: body.duration_s,
            distance_m: body.distance_m,
            steps: body.steps,
            avg_speed_kmh: body.avg_speed_kmh,
            max_speed_kmh: body.max_speed_kmh,
            kcal: body.kcal,
            pause_count: body.pause_count,
          },
        })

      // Clear the live snapshot the moment the daemon closes a session — the
      // dashboard would otherwise keep polling stale "live" data until TTL.
      if (liveSnapshot !== null && liveSnapshot.uuid === body.uuid) liveSnapshot = null

      const achievements = await recomputeAchievements(body.uuid)

      set.status = existing.length === 0 ? 201 : 200
      return { uuid: body.uuid, achievements: achievements.map((a) => ({ ...a })) }
    },
    {
      body: WalkingPadSessionInputSchema,
      response: {
        200: z.object({
          uuid: z.string().uuid(),
          achievements: z.array(NewAchievementSchema),
        }),
        201: z.object({
          uuid: z.string().uuid(),
          achievements: z.array(NewAchievementSchema),
        }),
      },
      detail: {
        tags: ['WalkingPad'],
        summary: 'Upsert a WalkingPad session',
        description:
          'Idempotent insert-or-replace keyed on `uuid`. Called by the `king-smith-walkingpad-mac` Go daemon to sync each closed treadmill session — a duplicate POST overwrites the row (the daemon is the source of truth and may re-emit totals after a crash mid-flush). Returns 201 on first insert, 200 when the row already existed. Per-second sample rows are not synced — they stay in the daemon-local SQLite. Timestamps must be UTC ISO 8601 with a `Z` suffix. The response also includes any new achievements unlocked by this session (first_walk, longest_*, streak_*, distance_milestone_*, weekly_distance_pr, …) — the dashboard polls GET /walking-pad/achievements to surface them. For reads use GET /walking-pad/sessions (paginated list) or GET /walking-pad/sessions/summary (windowed totals).',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .delete(
    '/sessions/:uuid',
    async ({ params }) => {
      const result = await db
        .delete(walkingPadSessions)
        .where(eq(walkingPadSessions.uuid, params.uuid))
        .returning({ uuid: walkingPadSessions.uuid })
      // Clear the live snapshot if it referenced the deleted row — mirrors the
      // upsert path so the dashboard doesn't keep polling a ghost session.
      if (liveSnapshot !== null && liveSnapshot.uuid === params.uuid) liveSnapshot = null
      return { uuid: params.uuid, deleted: result.length > 0 }
    },
    {
      params: z.object({ uuid: z.string().uuid() }),
      response: z.object({
        uuid: z.string().uuid(),
        deleted: z
          .boolean()
          .describe('True when a row was removed, false when no matching uuid existed.'),
      }),
      detail: {
        tags: ['WalkingPad'],
        summary: 'Delete a WalkingPad session',
        description:
          'Idempotent delete keyed on `uuid`. Returns 200 whether or not the row existed so the `king-smith-walkingpad-mac` daemon can retry freely (the daemon emits a delete when it discards a session locally — e.g. user wiped a row from its UI). Achievements unlocked by the deleted session are not retroactively revoked. To re-create the row use POST /walking-pad/sessions; for reads use GET /walking-pad/sessions.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/sessions',
    async ({ query }) => {
      const page = query.page ?? 1
      const limit = query.limit ?? 50
      const order = query.order ?? 'desc'
      const offset = (page - 1) * limit

      const [rows, countResult] = await Promise.all([
        db
          .select()
          .from(walkingPadSessions)
          .orderBy(
            order === 'asc'
              ? asc(walkingPadSessions.started_at)
              : desc(walkingPadSessions.started_at),
          )
          .limit(limit)
          .offset(offset),
        db.select({ count: count() }).from(walkingPadSessions),
      ])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { data: rows as any, total: Number(countResult[0]?.count ?? 0) }
    },
    {
      query: z.object({
        page: z.coerce.number().int().min(1).default(1).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
        order: z.enum(['asc', 'desc']).default('desc').optional(),
      }),
      response: z.object({
        data: z.array(WalkingPadSessionSchema),
        total: z.number().int(),
      }),
      detail: {
        tags: ['WalkingPad'],
        summary: 'List WalkingPad sessions',
        description:
          'Paginated list of closed treadmill sessions ordered by `started_at`. `page` is 1-indexed, `limit` ≤ 200, `order` defaults to `desc` (newest first). Each row is a single completed session as upserted by the daemon — there is no per-second sample data here. For aggregated totals over a date window use GET /walking-pad/sessions/summary; sessions are created by the daemon via POST /walking-pad/sessions.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/sessions/summary',
    async ({ query }) => {
      const { from, to } = parseWindow(query)
      const rows = await db
        .select({
          duration_s: walkingPadSessions.duration_s,
          distance_m: walkingPadSessions.distance_m,
          steps: walkingPadSessions.steps,
          kcal: walkingPadSessions.kcal,
        })
        .from(walkingPadSessions)
        .where(
          and(
            gte(walkingPadSessions.started_at, from.toISOString()),
            lte(walkingPadSessions.started_at, to.toISOString()),
          ),
        )

      const sessions = rows.length
      const duration_s = rows.reduce((acc, r) => acc + r.duration_s, 0)
      const distance_m = rows.reduce((acc, r) => acc + r.distance_m, 0)
      const steps = rows.reduce((acc, r) => acc + r.steps, 0)
      const kcal = rows.reduce((acc, r) => acc + r.kcal, 0)
      const avg_session_min =
        sessions === 0 ? null : Math.round((duration_s / sessions / 60) * 10) / 10

      return {
        sessions,
        duration_s,
        distance_m: Math.round(distance_m),
        steps,
        kcal: Math.round(kcal * 10) / 10,
        avg_session_min,
      }
    },
    {
      query: WindowQuerySchema,
      response: WalkingPadSummarySchema,
      detail: {
        tags: ['WalkingPad'],
        summary: 'WalkingPad session totals over a window',
        description:
          'Aggregated totals (session count, duration, distance, steps, kcal, mean session length) across closed sessions whose `started_at` falls inside the requested window. Accepts `?window=7d|30d|90d|all` (default 30d) or `?from=ISO&to=ISO`. `avg_session_min` is null when the window has no sessions. For individual session rows use GET /walking-pad/sessions. Example: GET /walking-pad/sessions/summary?window=7d',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/sessions/series',
    async ({ query }) => {
      const { from, to } = parseWindow(query)
      const bucket = query.bucket ?? 'day'
      const rows = await db
        .select()
        .from(walkingPadSessions)
        .where(
          and(
            gte(walkingPadSessions.started_at, from.toISOString()),
            lte(walkingPadSessions.started_at, to.toISOString()),
          ),
        )
      const points = bucketSessions(rows as WalkingPadSessionRow[], bucket, from, to)
      return { bucket, points }
    },
    {
      query: WindowQuerySchema.extend({
        bucket: z.enum(['day', 'week']).default('day').optional(),
      }),
      response: SeriesResponseSchema,
      detail: {
        tags: ['WalkingPad'],
        summary: 'WalkingPad time-bucketed series for charts',
        description:
          'Per-day or per-week aggregates across the requested window: sessions, duration_s, distance_m, steps, kcal, distance-weighted avg_speed_kmh. Empty buckets are returned with zero counts so charts can render gaps explicitly. `bucket=day` keys are YYYY-MM-DD; `bucket=week` keys are ISO week strings (YYYY-Www). Use this for daily-activity bars, weekly-volume bars, pace-trend lines, and sparkline grids.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/sessions/hour-of-day',
    async ({ query }) => {
      const { from, to } = parseWindow(query)
      const rows = await db
        .select()
        .from(walkingPadSessions)
        .where(
          and(
            gte(walkingPadSessions.started_at, from.toISOString()),
            lte(walkingPadSessions.started_at, to.toISOString()),
          ),
        )
      return { cells: hourOfDayMatrix(rows as WalkingPadSessionRow[]) }
    },
    {
      query: WindowQuerySchema,
      response: z.object({ cells: z.array(HourDowCellSchema) }),
      detail: {
        tags: ['WalkingPad'],
        summary: 'WalkingPad hour-of-day × day-of-week matrix',
        description:
          'Returns a 7×24 grid of (day-of-week, hour-of-day-UTC) cells with session counts and total distance. Used by the time-of-day heatmap on the WalkingPad dashboard to show when walks tend to happen.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/sessions/length-histogram',
    async ({ query }) => {
      const { from, to } = parseWindow(query)
      const rows = await db
        .select()
        .from(walkingPadSessions)
        .where(
          and(
            gte(walkingPadSessions.started_at, from.toISOString()),
            lte(walkingPadSessions.started_at, to.toISOString()),
          ),
        )
      return { buckets: sessionLengthHistogram(rows as WalkingPadSessionRow[]) }
    },
    {
      query: WindowQuerySchema,
      response: z.object({ buckets: z.array(LengthHistogramSchema) }),
      detail: {
        tags: ['WalkingPad'],
        summary: 'WalkingPad session-length distribution (5-minute buckets)',
        description:
          'Histogram of session durations within the window, bucketed into 5-minute bins from 0 to 90 minutes (clamped at the top end). Drives the session-length distribution chart on the WalkingPad dashboard.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/sessions/heroes',
    async ({ query }) => {
      const { from, to } = parseWindow(query)
      const windowMs = to.getTime() - from.getTime()
      const priorFrom = new Date(from.getTime() - windowMs)
      const priorTo = from
      const [windowRows, priorRows, allRows] = await Promise.all([
        db
          .select()
          .from(walkingPadSessions)
          .where(
            and(
              gte(walkingPadSessions.started_at, from.toISOString()),
              lte(walkingPadSessions.started_at, to.toISOString()),
            ),
          ),
        db
          .select()
          .from(walkingPadSessions)
          .where(
            and(
              gte(walkingPadSessions.started_at, priorFrom.toISOString()),
              lte(walkingPadSessions.started_at, priorTo.toISOString()),
            ),
          ),
        // Streak/momentum need full history; the table is small.
        db.select().from(walkingPadSessions),
      ])
      return computeWalkingPadHeroes(
        windowRows as WalkingPadSessionRow[],
        priorRows as WalkingPadSessionRow[],
        allRows as WalkingPadSessionRow[],
        new Date(),
      )
    },
    {
      query: WindowQuerySchema,
      response: HeroesResponseSchema,
      detail: {
        tags: ['WalkingPad'],
        summary: 'WalkingPad hero stats (volume, pace, streak)',
        description:
          'Three composite cards for the dashboard top row: volume direction (this window vs equal-length prior window), pace direction (distance-weighted avg km/h delta), streak (consecutive UTC days with ≥1 real session, plus best-ever, momentum, sessions-this-week). `insufficient` direction means there is no prior data to compare against.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/achievements',
    async ({ query }) => {
      const limit = query.limit ?? 50
      const since = query.since
      const rows = await db
        .select()
        .from(walkingPadAchievements)
        .where(since !== undefined ? gte(walkingPadAchievements.unlocked_at, since) : undefined)
        .orderBy(desc(walkingPadAchievements.unlocked_at))
        .limit(limit)
      return {
        data: rows.map((r) => ({
          id: r.id,
          type: r.type as (typeof ACHIEVEMENT_TYPES)[number],
          session_uuid: r.session_uuid,
          value: r.value,
          title: r.title,
          description: r.description,
          confetti: r.confetti === 1,
          unlocked_at: r.unlocked_at,
        })),
      }
    },
    {
      query: z.object({
        since: z
          .string()
          .optional()
          .describe('ISO 8601; return only achievements unlocked at or after this timestamp.'),
        limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
      }),
      response: z.object({ data: z.array(AchievementSchema) }),
      detail: {
        tags: ['WalkingPad'],
        summary: 'List unlocked WalkingPad achievements',
        description:
          'Newest-first list of unlocked WalkingPad achievements. Pass `?since=ISO` to fetch only unlocks after a known watermark — the dashboard uses this to detect new unlocks and trigger toast + confetti. Achievement types include first_walk, longest_distance, longest_duration, most_steps, fastest_avg_speed, multi_walk_day, streak_3/7/14/30, distance_milestone_10/50/100/250/500/1000_km, and weekly_distance_pr.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .post(
    '/live',
    ({ body }) => {
      // Single in-memory snapshot. The daemon POSTs every ~1s while a session
      // is active; we overwrite. On session end the daemon POSTs `state: ended`
      // once, then stops — we treat that as the clear signal.
      if (body.state === 'ended') {
        liveSnapshot = null
        return { ok: true as const, cleared: true }
      }
      liveSnapshot = { ...body, received_at: new Date().toISOString() }
      return { ok: true as const, cleared: false }
    },
    {
      body: LiveSnapshotSchema,
      response: z.object({ ok: z.literal(true), cleared: z.boolean() }),
      detail: {
        tags: ['WalkingPad'],
        summary: 'Push a live WalkingPad session snapshot',
        description:
          "Called by the `king-smith-walkingpad-mac` daemon every ~1s while the belt is running. Stored in-memory with a 15s TTL — a single-instance, fire-and-forget channel that the dashboard polls to render the live session card. POST with `state: 'ended'` once on session close to clear the snapshot immediately (otherwise it falls off on TTL). No persistence: a missed snapshot is fine, the next tick supersedes it. For the closed-session sync use POST /walking-pad/sessions instead.",
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/live',
    () => {
      if (liveSnapshot === null) return { snapshot: null }
      const ageMs = Date.now() - new Date(liveSnapshot.sample_at).getTime()
      if (ageMs > LIVE_TTL_MS) {
        liveSnapshot = null
        return { snapshot: null }
      }
      return { snapshot: { ...liveSnapshot, age_s: Math.round(ageMs / 1000) } }
    },
    {
      response: LiveResponseSchema,
      detail: {
        tags: ['WalkingPad'],
        summary: 'Read the current live WalkingPad snapshot',
        description:
          'Returns `{ snapshot: <live row> | null }`. The snapshot is null when no session is running (or the last snapshot is older than 15s). The dashboard polls this every ~2s while the WalkingPad tab is active. `age_s` lets consumers render a "stale" indicator if the daemon falters mid-session. The envelope shape exists so the response is always a non-empty JSON object (a bare `null` return serializes to an empty body, which trips Eden Treaty). Closed sessions are not visible here — list them via GET /walking-pad/sessions.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
