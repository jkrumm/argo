import { Elysia } from 'elysia'
import { z } from 'zod'
import { and, asc, count, desc, gte, lte, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { walkingPadSessions } from '../db/schema.js'
import { WindowQuerySchema, parseWindow } from '../lib/window.js'

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

      set.status = existing.length === 0 ? 201 : 200
      return { uuid: body.uuid }
    },
    {
      body: WalkingPadSessionInputSchema,
      response: {
        200: z.object({ uuid: z.string().uuid() }),
        201: z.object({ uuid: z.string().uuid() }),
      },
      detail: {
        tags: ['WalkingPad'],
        summary: 'Upsert a WalkingPad session',
        description:
          'Idempotent insert-or-replace keyed on `uuid`. Called by the `king-smith-walkingpad-mac` Go daemon to sync each closed treadmill session — a duplicate POST overwrites the row (the daemon is the source of truth and may re-emit totals after a crash mid-flush). Returns 201 on first insert, 200 when the row already existed. Per-second sample rows are not synced — they stay in the daemon-local SQLite. Timestamps must be UTC ISO 8601 with a `Z` suffix. For reads use GET /walking-pad/sessions (paginated list) or GET /walking-pad/sessions/summary (windowed totals).',
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
