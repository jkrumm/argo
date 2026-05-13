import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
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

export async function runMigrations(): Promise<void> {
  const migrationClient = postgres(DATABASE_URL, { max: 1 })
  await migrate(drizzle(migrationClient), { migrationsFolder })
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
