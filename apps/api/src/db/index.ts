import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres, { type Sql } from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { instrumentDrizzleClient } from '@kubiks/otel-drizzle'
import * as schema from './schema.js'
import { env } from '../env.js'

// Strip ?schema= / ?search_path= params — postgres.js does not understand them;
// pgSchema() handles schema qualification at the query level.
const DATABASE_URL = env.DATABASE_URL.replace(/[?&](?:schema|search_path)=[^&]*/g, '').replace(
  /[?&]$/,
  '',
)

export const client = postgres(DATABASE_URL)
// OTel-instrumented Drizzle — emits CLIENT spans per query with db.statement,
// db.operation, durations. Idempotent; safe to wrap once at module load.
export const db = instrumentDrizzleClient(drizzle(client, { schema }), {
  dbSystem: 'postgresql',
})

// Resolve the migrations folder relative to this source file so it works
// regardless of the process CWD (local dev runs with --cwd apps/api; the
// production container's CMD runs from /app).
const moduleDir = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(moduleDir, '../../drizzle')

/**
 * One-time, idempotent relocation of the drizzle migration journal from the
 * legacy shared `drizzle` schema into argo's own schema. drizzle-kit defaults
 * the journal to `drizzle.__drizzle_migrations`, which is shared by every app
 * in this cluster and owned by whichever role created it — fragile after a
 * whole-DB restore ("permission denied for schema drizzle"). Keeping it in
 * `argo.__drizzle_migrations` makes migrations self-contained and lets the
 * journal travel with `db:sync` schema dumps.
 *
 * Safe in every state: copies only when argo's journal is empty AND a legacy
 * one exists, so it no-ops on fresh DBs and after the first run. Can be removed
 * once every environment has booted past it once.
 */
export async function relocateDrizzleJournal(sql: Sql): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS argo.__drizzle_migrations (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
  )`
  // information_schema.tables filters by the role's visibility, so a missing
  // USAGE grant on the legacy `drizzle` schema appears as "not present" rather
  // than erroring with "permission denied for schema drizzle".
  const [legacy] = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
    ) AS exists
  `
  if (legacy?.exists) {
    await sql`
      INSERT INTO argo.__drizzle_migrations (hash, created_at)
      SELECT hash, created_at FROM drizzle.__drizzle_migrations
      WHERE NOT EXISTS (SELECT 1 FROM argo.__drizzle_migrations)
    `
  }
}

export async function runMigrations(): Promise<void> {
  const migrationClient = postgres(DATABASE_URL, { max: 1 })
  await relocateDrizzleJournal(migrationClient)
  await migrate(drizzle(migrationClient), { migrationsFolder, migrationsSchema: 'argo' })
  await migrationClient.end()

  // Seed reference exercises (idempotent)
  await db
    .insert(schema.exercises)
    .values([
      {
        id: 'bench_press',
        name: 'Bench Press',
        category: 'push',
        muscle_group: 'chest',
        is_bodyweight: 0,
        display_order: 1,
      },
      {
        id: 'squat',
        name: 'Squat',
        category: 'legs',
        muscle_group: 'quads',
        is_bodyweight: 0,
        display_order: 2,
      },
      {
        id: 'deadlift',
        name: 'Deadlift',
        category: 'hinge',
        muscle_group: 'posterior',
        is_bodyweight: 0,
        display_order: 3,
      },
      {
        id: 'pull_ups',
        name: 'Pull-ups',
        category: 'pull',
        muscle_group: 'back',
        is_bodyweight: 1,
        display_order: 4,
      },
    ])
    .onConflictDoNothing()

  // Ensure sync_control singleton row exists
  await db.insert(schema.syncControl).values({ id: 1 }).onConflictDoNothing()
}
