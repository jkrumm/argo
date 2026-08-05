import {
  pgSchema,
  serial,
  text,
  integer,
  bigint,
  real,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
// basalt-agent-allow — deliberate per locked decision D3: apps/api stays on ai@5 and imports no basalt-ui; the v5/v7 skew is neutralized producer-side in A1 by a TransformStream rewriting finishReason 'unknown' -> 'other', never by upgrading apps/api (docs/HERMES-CHAT-V2.md).
import type { UIMessagePart, UIDataTypes, UITools } from 'ai'

const argoSchema = pgSchema('argo')

// ── Exercises reference table ────────────────────────────────────────────────

export const exercises = argoSchema.table('exercises', {
  id: text('id').primaryKey(), // "bench_press" | "squat" | "deadlift" | "pull_ups"
  name: text('name').notNull(), // "Bench Press"
  category: text('category').notNull(), // "push" | "pull" | "legs" | "hinge"
  muscle_group: text('muscle_group').notNull(), // "chest" | "back" | "quads" | "posterior"
  is_bodyweight: integer('is_bodyweight').default(0), // 0 | 1 (kept as int for response compat)
  display_order: integer('display_order').default(0),
})

// ── Garmin daily metrics (auto-synced via garmin-sync cron) ─────────────────

export const dailyMetrics = argoSchema.table('daily_metrics', {
  date: text('date').primaryKey(), // yyyy-mm-dd

  // Activity
  steps: integer('steps'),
  distance_m: integer('distance_m'),
  total_kcal: real('total_kcal'),
  active_kcal: real('active_kcal'),
  floors_ascended: real('floors_ascended'),
  moderate_intensity_min: integer('moderate_intensity_min'),
  vigorous_intensity_min: integer('vigorous_intensity_min'),

  // Heart rate
  resting_hr: integer('resting_hr'),
  max_hr: integer('max_hr'),
  min_hr: integer('min_hr'),

  // HRV
  hrv_last_night_avg: integer('hrv_last_night_avg'),
  hrv_last_night_5min_high: integer('hrv_last_night_5min_high'),
  hrv_weekly_avg: integer('hrv_weekly_avg'),
  hrv_status: text('hrv_status'), // BALANCED | LOW | UNBALANCED

  // Sleep
  sleep_score: integer('sleep_score'),
  sleep_duration_sec: integer('sleep_duration_sec'),
  deep_sleep_sec: integer('deep_sleep_sec'),
  light_sleep_sec: integer('light_sleep_sec'),
  rem_sleep_sec: integer('rem_sleep_sec'),
  awake_sleep_sec: integer('awake_sleep_sec'),
  avg_sleep_stress: real('avg_sleep_stress'),
  avg_sleep_hr: real('avg_sleep_hr'),
  avg_sleep_respiration: real('avg_sleep_respiration'),

  // Stress / Body battery
  avg_stress: integer('avg_stress'),
  max_stress: integer('max_stress'),
  bb_highest: integer('bb_highest'),
  bb_lowest: integer('bb_lowest'),
  bb_charged: integer('bb_charged'),
  bb_drained: integer('bb_drained'),

  // Respiration
  avg_waking_respiration: real('avg_waking_respiration'),

  // SpO2
  avg_spo2: real('avg_spo2'),
  lowest_spo2: real('lowest_spo2'),

  // Fitness
  vo2_max: real('vo2_max'),

  // Meta
  completed: integer('completed').default(0), // 0 = partial, 1 = full 24h (int for response compat)
  synced_at: text('synced_at'), // ISO string set from application layer
})

// ── Garmin activities (per-workout, auto-synced via garmin-sync) ─────────────

export const garminActivities = argoSchema.table(
  'garmin_activities',
  {
    activity_id: bigint('activity_id', { mode: 'number' }).primaryKey(), // Garmin's own id (>int32)
    date: text('date').notNull(), // yyyy-mm-dd, derived from start_time_local
    start_time_local: text('start_time_local').notNull(),
    type_key: text('type_key').notNull(), // cycling | indoor_cardio | tennis_v2 | running | …
    activity_name: text('activity_name'),
    duration_sec: real('duration_sec'),
    distance_m: real('distance_m'),
    calories: integer('calories'),
    avg_hr: real('avg_hr'), // stored as average from Garmin, can be fractional
    max_hr: integer('max_hr'),
    aerobic_te: real('aerobic_te'),
    anaerobic_te: real('anaerobic_te'),
    training_effect_label: text('training_effect_label'), // AEROBIC_BASE | RECOVERY | SPEED | …
    training_load: real('training_load'),
    moderate_intensity_min: integer('moderate_intensity_min'),
    vigorous_intensity_min: integer('vigorous_intensity_min'),
    hr_zone_1_sec: real('hr_zone_1_sec'),
    hr_zone_2_sec: real('hr_zone_2_sec'),
    hr_zone_3_sec: real('hr_zone_3_sec'),
    hr_zone_4_sec: real('hr_zone_4_sec'),
    hr_zone_5_sec: real('hr_zone_5_sec'),
    bb_delta: integer('bb_delta'), // differenceBodyBattery (typically negative)
    steps: integer('steps'),
    vo2_max: real('vo2_max'),
    synced_at: text('synced_at'), // ISO string set from application layer
  },
  (t) => [index('idx_garmin_activities_date').on(t.date)],
)

// ── Garmin sync control (cross-process flag table, single row id=1) ──────────

export const syncControl = argoSchema.table('sync_control', {
  id: integer('id').primaryKey().default(1),
  refresh_requested: integer('refresh_requested').default(0), // 0 | 1
  requested_at: text('requested_at'), // ISO string
  in_progress: integer('in_progress').default(0), // 0 | 1
  last_started_at: text('last_started_at'), // ISO string
  last_completed_at: text('last_completed_at'), // ISO string
  last_status: text('last_status'), // 'ok' | 'error'
  last_message: text('last_message'),
})

// ── Weight log (manual entries) ──────────────────────────────────────────────

export const weightLog = argoSchema.table('weight_log', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  date: text('date').notNull(),
  weight_kg: real('weight_kg').notNull(),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
})

// ── Skinfold log (manual caliper measurements) ───────────────────────────────

export const skinfoldLog = argoSchema.table(
  'skinfold_log',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    date: text('date').notNull(), // YYYY-MM-DD
    site: text('site').notNull(), // SkinfoldSite key, e.g. 'abdominal'
    value_mm: real('value_mm').notNull(), // skinfold thickness in mm
    created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  },
  (t) => [uniqueIndex('skinfold_log_date_site_uq').on(t.date, t.site)],
)

// ── User profile (single row id=1, static body data) ────────────────────────

export const userProfile = argoSchema.table('user_profile', {
  id: integer('id').primaryKey().default(1),
  height_cm: real('height_cm'),
  birth_date: text('birth_date'), // yyyy-mm-dd
  gender: text('gender'), // male | female
  goal_weight_kg: real('goal_weight_kg'),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
})

// ── Gym equipment (single row id=1, whole-state jsonb) ──────────────────────

// The dashboard's gym profiles — which bars exist, what plates sit in the rack,
// and how each exercise is assembled from them. It used to live only in the
// browser's localStorage, which made it per-device: a bar edited on the laptop
// never reached the phone at the gym, which just re-rendered the seed. It is
// user configuration, so it belongs on the server.
//
// Stored as one opaque jsonb blob rather than normalized tables: it is a single
// user's equipment list, read and written whole, and its shape is owned by the
// frontend. Normalizing it would buy nothing and cost a migration every time a
// bar grows a field. The Zod schema on the route is the contract.
export const gymState = argoSchema.table('gym_state', {
  id: integer('id').primaryKey().default(1),
  state: jsonb('state').notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
})

// ── Workout draft (single row id=1, per-exercise jsonb map) ──────────────────

// The workout currently being ENTERED — the half-filled set list that exists
// between opening the form and pressing Save. Same single-row jsonb shape as
// `gym_state`, but the blob is a MAP keyed by exercise_id, not one value.
//
// Keying by exercise is what makes cross-device editing safe without any merge
// logic: two devices in the same session are usually on different lifts (laptop
// on bench, phone on squat), and per-exercise keys make that case collision-free
// by construction. Same-exercise collisions are last-write-wins on the whole
// draft — see the policy comment in the route.
//
// Writes are per-key (`jsonb_set` on one path), never whole-state, so a device
// saving its bench draft can never clobber another device's squat draft.
export const workoutDraft = argoSchema.table('workout_draft', {
  id: integer('id').primaryKey().default(1),
  state: jsonb('state').notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
})

// ── Workouts ─────────────────────────────────────────────────────────────────

export const workouts = argoSchema.table('workouts', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  date: text('date').notNull(),
  exercise_id: text('exercise_id').notNull(),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
})

export const workoutSets = argoSchema.table(
  'workout_sets',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    workout_id: integer('workout_id')
      .notNull()
      .references(() => workouts.id, { onDelete: 'cascade' }),
    set_number: integer('set_number').notNull(),
    set_type: text('set_type').notNull(),
    weight_kg: real('weight_kg').notNull(),
    reps: integer('reps').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  },
  (t) => [index('idx_workout_sets_workout_id').on(t.workout_id)],
)

// ── WalkingPad sessions (synced from king-smith-walkingpad-mac daemon) ──────
//
// Source: the local Go daemon at ~/SourceRoot/king-smith-walkingpad-mac stores
// per-session totals in its own SQLite, then POSTs each closed session here.
// Argo never receives the per-second `samples` rows — those stay local for
// debugging.  Idempotency is on `uuid` so the daemon's sync worker can retry
// safely (a duplicate POST is a no-op, not a 4xx).

export const walkingPadSessions = argoSchema.table(
  'walking_pad_sessions',
  {
    uuid: text('uuid').primaryKey(),
    started_at: timestamp('started_at', { withTimezone: true, mode: 'string' }).notNull(),
    ended_at: timestamp('ended_at', { withTimezone: true, mode: 'string' }).notNull(),
    duration_s: integer('duration_s').notNull(),
    distance_m: real('distance_m').notNull(),
    steps: integer('steps').notNull(),
    avg_speed_kmh: real('avg_speed_kmh').notNull(),
    max_speed_kmh: real('max_speed_kmh').notNull(),
    kcal: real('kcal').notNull(),
    pause_count: integer('pause_count').notNull().default(0),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  },
  (t) => [index('idx_walking_pad_sessions_started_at').on(t.started_at)],
)

// ── Usage tracking (ingested from local usage-tracker SQLite) ────────────────
//
// The `usage-tracker` app (~/SourceRoot/usage-tracker) collects per-usage AI
// token/cost records from multiple collectors (Claude Code, LiteLLM bridge,
// Hermes, Feuer, OpenCode) into a local SQLite `usage_record` table. An
// associated LaunchAgent pushes new rows to this table every 15 minutes.
// The upsert is keyed on (source, source_id) which matches the local SQLite
// UNIQUE constraint.

export const usageRecord = argoSchema.table(
  'usage_record',
  {
    id: serial('id').primaryKey(),
    source: text('source').notNull(),
    source_id: text('source_id').notNull(),
    grain: text('grain').notNull(),
    ts: timestamp('ts', { withTimezone: true, mode: 'string' }).notNull(),
    model: text('model'),
    model_norm: text('model_norm'),
    project: text('project'),
    workspace: text('workspace'),
    sub_tool: text('sub_tool'),
    billing: text('billing').notNull(),
    machine: text('machine'),
    outcome: text('outcome').notNull().default('ok'),
    input_tokens: integer('input_tokens').notNull().default(0),
    output_tokens: integer('output_tokens').notNull().default(0),
    cache_read_tokens: integer('cache_read_tokens').notNull().default(0),
    cache_write_tokens: integer('cache_write_tokens').notNull().default(0),
    reasoning_tokens: integer('reasoning_tokens').notNull().default(0),
    duration_ms: integer('duration_ms'),
    cost_usd: real('cost_usd'),
    cost_source: text('cost_source').notNull().default('none'),
    raw: jsonb('raw'),
    ingested_at: text('ingested_at').notNull(),
    received_at: timestamp('received_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_usage_source_sourceid_machine').on(t.source, t.source_id, t.machine),
    index('idx_usage_ts').on(t.ts),
    index('idx_usage_source').on(t.source),
    index('idx_usage_model_norm').on(t.model_norm),
    index('idx_usage_billing').on(t.billing),
    index('idx_usage_machine').on(t.machine),
    index('idx_usage_sub_tool').on(t.sub_tool),
    index('idx_usage_workspace').on(t.workspace),
  ],
)

// ── WalkingPad achievements (unlocked milestones, surfaced by the dashboard) ─
//
// Persisted because the user never triggers a mutation for a walking-pad
// session — the daemon does. The dashboard polls this table to surface new
// unlocks via toast/confetti, comparing `unlocked_at` against a localStorage
// watermark. Each row is one unlock event; the same `type` can recur (e.g.
// `streak_7` unlocks again after a break-and-rebuild).

export const walkingPadAchievements = argoSchema.table(
  'walking_pad_achievements',
  {
    id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
    type: text('type').notNull(),
    // Session that triggered the unlock. Null for streak/milestone unlocks
    // computed over multiple sessions.
    session_uuid: text('session_uuid'),
    // Numeric payload used for sorting/comparison (e.g. distance_m for a
    // distance milestone, days for a streak, km/h for a pace PR).
    value: real('value'),
    title: text('title').notNull(),
    description: text('description').notNull(),
    confetti: integer('confetti').notNull().default(1),
    unlocked_at: timestamp('unlocked_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('idx_walking_pad_achievements_unlocked_at').on(t.unlocked_at),
    index('idx_walking_pad_achievements_type').on(t.type),
  ],
)

// ── Hermes Chat (see docs/HERMES-CHAT-PRD.md) ────────────────────────────────
//
// Argo owns the verbatim display transcript; Hermes owns only compressed agent
// state keyed by X-Hermes-Session-Id. One thread = one session id (fresh id =
// fresh context). Cross-thread long-term memory rides a constant session_key.
//
// `messages.parts` mirrors the Vercel AI SDK `UIMessage` parts shape (the live
// stream's UIMessage is persisted verbatim in the proxy's onFinish — Group 2),
// so the renderer can reproduce text/cards/audio/attachments on reload without
// a parallel structure. Smart cards live inside the markdown text parts; the
// `payload` extension carries only audio refs, attachments, and optional
// tool-progress events (see E2E adjustment #2).

/** A Hermes-hosted audio asset referenced by an assistant message. */
export interface AudioRef {
  url?: string
  title?: string
  durationMs?: number
}

/** A user-supplied text (longform markdown) attachment. */
export interface TextAttachment {
  type: 'text'
  title?: string
  /** Longform markdown body. */
  content?: string
}

/** A user-supplied image attachment stored as a data URL. */
export interface ImageAttachment {
  type: 'image'
  title?: string
  /** data:[mimeType];base64,... */
  dataUrl: string
  mimeType: string
  fileName?: string
}

/** A user-supplied file attachment stored as a data URL. */
export interface FileAttachment {
  type: 'file'
  title?: string
  /** data:[mimeType];base64,... */
  dataUrl: string
  mimeType: string
  fileName: string
  sizeBytes: number
}

export type Attachment = TextAttachment | ImageAttachment | FileAttachment

/** A live tool-progress event tapped from Hermes' custom SSE channel. */
export interface ToolEvent {
  tool: string
  emoji?: string
  label: string
  toolCallId: string
  status: string
}

/** Non-transcript extension data attached to a persisted message. */
export interface MessagePayload {
  audio?: AudioRef[]
  attachments?: Attachment[]
  toolEvents?: ToolEvent[]
}

/** Persisted UIMessage parts — the AI SDK v5 shape, stored verbatim. */
export type MessageParts = UIMessagePart<UIDataTypes, UITools>[]

export const HERMES_THREAD_TYPES = [
  'todo',
  'podcast',
  'infra',
  'note',
  'research',
  'general',
] as const
export type HermesThreadType = (typeof HERMES_THREAD_TYPES)[number]

export const hermesThread = argoSchema.table(
  'hermes_thread',
  {
    // App-generated id (createIdGenerator({ prefix: 'thr' })) — Group 2.
    id: text('id').primaryKey(),
    // Hermes thread-continuity header (X-Hermes-Session-Id). Distinct per thread.
    session_id: text('session_id').notNull(),
    // Long-term memory scope (X-Hermes-Session-Key). Constant across threads.
    session_key: text('session_key').notNull(),
    // DeepSeek-generated title (Group 4); null until the first turn is titled.
    title: text('title'),
    // DeepSeek one-line summary; null until generated (Group 2).
    summary: text('summary'),
    // Thread type badge (Group 2); null until classified.
    type: text('type').$type<HermesThreadType>(),
    // 'active' | 'archived' — kept as text for forward-compat.
    status: text('status').notNull().default('active'),
    pinned: integer('pinned').notNull().default(0), // 0 | 1
    archived_at: timestamp('archived_at', { withTimezone: true, mode: 'string' }),
    // Active resumable-stream id while an assistant turn is generating (durable
    // streaming). Non-null during a live/resumable stream; cleared on finish or
    // explicit stop. Drives GET /hermes/chat/:id/stream resume. Internal state —
    // deliberately absent from the public ThreadSchema response.
    active_stream_id: text('active_stream_id'),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // NOTE: drizzle-orm's `.desc()` means opposite things on a query `orderBy` vs
    // on an INDEX column, and that asymmetry made this index unusable. `desc(col)`
    // in a query emits bare `ORDER BY col DESC`, which Postgres defaults to `NULLS
    // FIRST`. `col.desc()` on an index instead emits `DESC NULLS LAST`. GET
    // /hermes/threads orders with plain `desc(...)` (the natural way to write it),
    // so an index built from `t.pinned.desc()` never matched its pathkeys — the
    // planner could not use it at all (confirmed live via `EXPLAIN` with
    // `enable_seqscan = off`), making every `updated_at` bump (i.e. every turn)
    // pure write amplification. Both columns are NOT NULL, so NULLS ordering is
    // moot for row order — only for planner pathkey matching — hence the `sql`
    // template below forces plain `DESC` (`NULLS FIRST`) to mirror the query
    // exactly. Do not "simplify" this back to `t.pinned.desc()`.
    index('idx_hermes_thread_pinned_updated').on(sql`${t.pinned} DESC`, sql`${t.updated_at} DESC`),
  ],
)

export const hermesMessage = argoSchema.table(
  'hermes_message',
  {
    // App-generated id (createIdGenerator({ prefix: 'msg' })) — Group 2.
    id: text('id').primaryKey(),
    thread_id: text('thread_id')
      .notNull()
      .references(() => hermesThread.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // 'user' | 'assistant' | 'system'
    // Client-minted idempotency key for a retried/double-fired write. NULL for
    // server-originated messages and legacy rows written before this column.
    client_message_id: text('client_message_id'),
    parts: jsonb('parts').$type<MessageParts>().notNull().default([]),
    payload: jsonb('payload').$type<MessagePayload>(),
    // 'complete' | 'streaming' | 'interrupted' | 'error' (Group 4).
    status: text('status').notNull().default('complete'),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('idx_hermes_message_thread_created').on(t.thread_id, t.created_at),
    uniqueIndex('uq_hermes_message_thread_client_id')
      .on(t.thread_id, t.client_message_id)
      .where(sql`${t.client_message_id} IS NOT NULL`),
  ],
)

// ── Reading / Books (Phase A — Hardcover.app read-model) ─────────────────────
//
// `book` and `userBook` are synced daily from the Hardcover.app GraphQL API
// by the hardcover-sync cron. `readingStat` is a generic telemetry table fed by
// a homelab reading-stats job (Phase B). `bookSyncMap` is a placeholder for the
// Phase C reconcile pass that will link readingStat rows to Hardcover books.

export const book = argoSchema.table('book', {
  hardcover_book_id: integer('hardcover_book_id').primaryKey(),
  title: text('title').notNull(),
  subtitle: text('subtitle'),
  slug: text('slug'),
  headline: text('headline'),
  authors: jsonb('authors').$type<string[]>().notNull().default([]),
  genres: jsonb('genres').$type<string[]>().notNull().default([]),
  pages: integer('pages'),
  release_year: integer('release_year'),
  description: text('description'),
  cover_url: text('cover_url'),
  community_rating: real('community_rating'),
  ratings_count: integer('ratings_count'),
  synced_at: timestamp('synced_at', { withTimezone: true, mode: 'string' }).defaultNow(),
})

export const userBook = argoSchema.table('user_book', {
  hardcover_user_book_id: integer('hardcover_user_book_id').primaryKey(),
  hardcover_book_id: integer('hardcover_book_id')
    .notNull()
    .references(() => book.hardcover_book_id),
  status_id: integer('status_id').notNull(),
  rating: real('rating'),
  review_raw: text('review_raw'),
  has_review: integer('has_review').notNull().default(0), // 0 | 1 (boolean stored as int)
  first_started_reading_date: text('first_started_reading_date'),
  first_read_date: text('first_read_date'),
  last_read_date: text('last_read_date'),
  date_added: text('date_added'),
  edition_id: integer('edition_id'),
  hardcover_updated_at: timestamp('hardcover_updated_at', {
    withTimezone: true,
    mode: 'string',
  }),
  synced_at: timestamp('synced_at', { withTimezone: true, mode: 'string' }).defaultNow(),
})

export const readingStat = argoSchema.table('reading_stat', {
  book_key: text('book_key').primaryKey(),
  title: text('title'),
  author: text('author'),
  total_read_seconds: integer('total_read_seconds').notNull().default(0),
  pages_read: integer('pages_read').notNull().default(0),
  current_percent: real('current_percent').notNull().default(0),
  sessions: integer('sessions').notNull().default(0),
  last_read_at: timestamp('last_read_at', { withTimezone: true, mode: 'string' }),
  raw: jsonb('raw'),
  synced_at: timestamp('synced_at', { withTimezone: true, mode: 'string' }).defaultNow(),
})

export const bookSyncMap = argoSchema.table('book_sync_map', {
  book_key: text('book_key').primaryKey(),
  hardcover_book_id: integer('hardcover_book_id'),
  hardcover_edition_id: integer('hardcover_edition_id'),
  confirmed: integer('confirmed').notNull().default(0), // 0 | 1 (boolean stored as int)
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
})
