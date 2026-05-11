/**
 * One-shot migration: copies all data from the legacy SQLite homelab.db to Postgres.
 * Idempotent — uses ON CONFLICT DO NOTHING throughout.
 * Resets identity sequences after insert so future inserts don't collide.
 *
 * Usage:
 *   DATABASE_URL="postgres://argo:<pw>@localhost:5433/argo" \
 *   SQLITE_PATH="./data/homelab.db" \
 *   bun run scripts/migrate-sqlite-to-pg.ts
 */

import { Database } from 'bun:sqlite'
import postgres from 'postgres'

const SQLITE_PATH = process.env['SQLITE_PATH'] ?? './data/homelab.db'
const DATABASE_URL = process.env['DATABASE_URL']

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

const sqlite = new Database(SQLITE_PATH)
const pg = postgres(DATABASE_URL)

type Row = Record<string, unknown>

function sqliteAll(query: string): Row[] {
  return sqlite.query(query).all() as Row[]
}

async function migrateTable(
  tableName: string,
  rows: Row[],
  insertFn: (row: Row) => Promise<void>,
): Promise<void> {
  const [pgCountRow] = await pg`SELECT count(*) AS c FROM argo.${pg(tableName)}`
  const pgBefore = Number(pgCountRow?.['c'] ?? 0)

  for (const row of rows) {
    await insertFn(row)
  }

  const [pgCountAfter] = await pg`SELECT count(*) AS c FROM argo.${pg(tableName)}`
  const pgAfter = Number(pgCountAfter?.['c'] ?? 0)

  const match = rows.length === pgAfter ? '✓' : '✗ MISMATCH'
  console.log(
    `  ${tableName}: sqlite=${rows.length}  pg_before=${pgBefore}  pg_after=${pgAfter}  ${match}`,
  )

  if (rows.length !== pgAfter) {
    process.exitCode = 1
  }
}

async function resetSequence(table: string, column: string = 'id'): Promise<void> {
  await pg.unsafe(
    `SELECT setval(pg_get_serial_sequence('argo.${table}', '${column}'), COALESCE((SELECT MAX(${column}) FROM argo.${table}), 1))`,
  )
}

async function run(): Promise<void> {
  console.log(`\nMigrating ${SQLITE_PATH} → ${DATABASE_URL}\n`)

  // ── exercises ────────────────────────────────────────────────────────────
  const exerciseRows = sqliteAll('SELECT * FROM exercises')
  await migrateTable('exercises', exerciseRows, async (r) => {
    await pg`
      INSERT INTO argo.exercises (id, name, category, muscle_group, is_bodyweight, display_order)
      VALUES (${r['id']}, ${r['name']}, ${r['category']}, ${r['muscle_group']}, ${r['is_bodyweight'] ?? 0}, ${r['display_order'] ?? 0})
      ON CONFLICT DO NOTHING
    `
  })

  // ── user_profile ─────────────────────────────────────────────────────────
  const profileRows = sqliteAll('SELECT * FROM user_profile')
  await migrateTable('user_profile', profileRows, async (r) => {
    await pg`
      INSERT INTO argo.user_profile (id, height_cm, birth_date, gender, goal_weight_kg, updated_at)
      VALUES (${r['id'] ?? 1}, ${r['height_cm'] ?? null}, ${r['birth_date'] ?? null}, ${r['gender'] ?? null}, ${r['goal_weight_kg'] ?? null}, ${r['updated_at'] ?? null})
      ON CONFLICT DO NOTHING
    `
  })

  // ── sync_control ──────────────────────────────────────────────────────────
  const syncRows = sqliteAll('SELECT * FROM sync_control')
  await migrateTable('sync_control', syncRows, async (r) => {
    await pg`
      INSERT INTO argo.sync_control (id, refresh_requested, requested_at, in_progress, last_started_at, last_completed_at, last_status, last_message)
      VALUES (${r['id'] ?? 1}, ${r['refresh_requested'] ?? 0}, ${r['requested_at'] ?? null}, ${r['in_progress'] ?? 0}, ${r['last_started_at'] ?? null}, ${r['last_completed_at'] ?? null}, ${r['last_status'] ?? null}, ${r['last_message'] ?? null})
      ON CONFLICT DO NOTHING
    `
  })

  // ── daily_metrics ─────────────────────────────────────────────────────────
  const metricRows = sqliteAll('SELECT * FROM daily_metrics')
  await migrateTable('daily_metrics', metricRows, async (r) => {
    await pg`
      INSERT INTO argo.daily_metrics (
        date, steps, distance_m, total_kcal, active_kcal, floors_ascended,
        moderate_intensity_min, vigorous_intensity_min, resting_hr, max_hr, min_hr,
        hrv_last_night_avg, hrv_last_night_5min_high, hrv_weekly_avg, hrv_status,
        sleep_score, sleep_duration_sec, deep_sleep_sec, light_sleep_sec, rem_sleep_sec,
        awake_sleep_sec, avg_sleep_stress, avg_sleep_hr, avg_sleep_respiration,
        avg_stress, max_stress, bb_highest, bb_lowest, bb_charged, bb_drained,
        avg_waking_respiration, avg_spo2, lowest_spo2, vo2_max, completed, synced_at
      ) VALUES (
        ${r['date']}, ${r['steps'] ?? null}, ${r['distance_m'] ?? null}, ${r['total_kcal'] ?? null}, ${r['active_kcal'] ?? null}, ${r['floors_ascended'] ?? null},
        ${r['moderate_intensity_min'] ?? null}, ${r['vigorous_intensity_min'] ?? null}, ${r['resting_hr'] ?? null}, ${r['max_hr'] ?? null}, ${r['min_hr'] ?? null},
        ${r['hrv_last_night_avg'] ?? null}, ${r['hrv_last_night_5min_high'] ?? null}, ${r['hrv_weekly_avg'] ?? null}, ${r['hrv_status'] ?? null},
        ${r['sleep_score'] ?? null}, ${r['sleep_duration_sec'] ?? null}, ${r['deep_sleep_sec'] ?? null}, ${r['light_sleep_sec'] ?? null}, ${r['rem_sleep_sec'] ?? null},
        ${r['awake_sleep_sec'] ?? null}, ${r['avg_sleep_stress'] ?? null}, ${r['avg_sleep_hr'] ?? null}, ${r['avg_sleep_respiration'] ?? null},
        ${r['avg_stress'] ?? null}, ${r['max_stress'] ?? null}, ${r['bb_highest'] ?? null}, ${r['bb_lowest'] ?? null}, ${r['bb_charged'] ?? null}, ${r['bb_drained'] ?? null},
        ${r['avg_waking_respiration'] ?? null}, ${r['avg_spo2'] ?? null}, ${r['lowest_spo2'] ?? null}, ${r['vo2_max'] ?? null}, ${r['completed'] ?? 0}, ${r['synced_at'] ?? null}
      )
      ON CONFLICT DO NOTHING
    `
  })

  // ── garmin_activities ─────────────────────────────────────────────────────
  const activityRows = sqliteAll('SELECT * FROM garmin_activities')
  await migrateTable('garmin_activities', activityRows, async (r) => {
    await pg`
      INSERT INTO argo.garmin_activities (
        activity_id, date, start_time_local, type_key, activity_name, duration_sec,
        distance_m, calories, avg_hr, max_hr, aerobic_te, anaerobic_te,
        training_effect_label, training_load, moderate_intensity_min, vigorous_intensity_min,
        hr_zone_1_sec, hr_zone_2_sec, hr_zone_3_sec, hr_zone_4_sec, hr_zone_5_sec,
        bb_delta, steps, vo2_max, synced_at
      ) VALUES (
        ${r['activity_id']}, ${r['date']}, ${r['start_time_local']}, ${r['type_key']}, ${r['activity_name'] ?? null}, ${r['duration_sec'] ?? null},
        ${r['distance_m'] ?? null}, ${r['calories'] ?? null}, ${r['avg_hr'] ?? null}, ${r['max_hr'] ?? null}, ${r['aerobic_te'] ?? null}, ${r['anaerobic_te'] ?? null},
        ${r['training_effect_label'] ?? null}, ${r['training_load'] ?? null}, ${r['moderate_intensity_min'] ?? null}, ${r['vigorous_intensity_min'] ?? null},
        ${r['hr_zone_1_sec'] ?? null}, ${r['hr_zone_2_sec'] ?? null}, ${r['hr_zone_3_sec'] ?? null}, ${r['hr_zone_4_sec'] ?? null}, ${r['hr_zone_5_sec'] ?? null},
        ${r['bb_delta'] ?? null}, ${r['steps'] ?? null}, ${r['vo2_max'] ?? null}, ${r['synced_at'] ?? null}
      )
      ON CONFLICT DO NOTHING
    `
  })

  // ── workouts ──────────────────────────────────────────────────────────────
  const workoutRows = sqliteAll('SELECT * FROM workouts')
  await migrateTable('workouts', workoutRows, async (r) => {
    await pg`
      INSERT INTO argo.workouts (id, date, exercise_id, notes, created_at)
      VALUES (${r['id']}, ${r['date']}, ${r['exercise_id']}, ${r['notes'] ?? null}, ${r['created_at'] ?? null})
      ON CONFLICT DO NOTHING
    `
  })

  // ── workout_sets ──────────────────────────────────────────────────────────
  const setRows = sqliteAll('SELECT * FROM workout_sets')
  await migrateTable('workout_sets', setRows, async (r) => {
    await pg`
      INSERT INTO argo.workout_sets (id, workout_id, set_number, set_type, weight_kg, reps, created_at)
      VALUES (${r['id']}, ${r['workout_id']}, ${r['set_number']}, ${r['set_type']}, ${r['weight_kg']}, ${r['reps']}, ${r['created_at'] ?? null})
      ON CONFLICT DO NOTHING
    `
  })

  // ── weight_log ────────────────────────────────────────────────────────────
  const weightRows = sqliteAll('SELECT * FROM weight_log')
  await migrateTable('weight_log', weightRows, async (r) => {
    await pg`
      INSERT INTO argo.weight_log (id, date, weight_kg, created_at)
      VALUES (${r['id']}, ${r['date']}, ${r['weight_kg']}, ${r['created_at'] ?? null})
      ON CONFLICT DO NOTHING
    `
  })

  // ── Reset identity sequences so future inserts don't collide ─────────────
  console.log('\nResetting sequences...')
  await resetSequence('workouts')
  await resetSequence('workout_sets')
  await resetSequence('weight_log')
  console.log('  workouts, workout_sets, weight_log sequences reset')

  await pg.end()
  sqlite.close()

  if (process.exitCode === 1) {
    console.error('\nRow count mismatch detected — check output above')
  } else {
    console.log('\nMigration complete')
  }
}

run().catch((e: unknown) => {
  console.error('Migration failed:', e)
  process.exit(1)
})
