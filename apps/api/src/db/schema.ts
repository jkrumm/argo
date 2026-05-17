import { pgSchema, text, integer, bigint, real, timestamp, index } from 'drizzle-orm/pg-core'

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

// ── User profile (single row id=1, static body data) ────────────────────────

export const userProfile = argoSchema.table('user_profile', {
  id: integer('id').primaryKey().default(1),
  height_cm: real('height_cm'),
  birth_date: text('birth_date'), // yyyy-mm-dd
  gender: text('gender'), // male | female
  goal_weight_kg: real('goal_weight_kg'),
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

// ── WalkingPad achievements ──────────────────────────────────────────────────
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
