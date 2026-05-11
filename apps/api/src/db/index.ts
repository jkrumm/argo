import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import * as schema from './schema.js'

const rawUrl = process.env['DATABASE_URL'] ?? ''
if (!rawUrl) throw new Error('DATABASE_URL env var is not set')

// Strip ?schema= / ?search_path= params — postgres.js does not understand them;
// pgSchema() handles schema qualification at the query level.
const DATABASE_URL = rawUrl.replace(/[?&](?:schema|search_path)=[^&]*/g, '').replace(/[?&]$/, '')

export const client = postgres(DATABASE_URL)
export const db = drizzle(client, { schema })

export async function runMigrations(): Promise<void> {
  const migrationClient = postgres(DATABASE_URL, { max: 1 })
  await migrate(drizzle(migrationClient), { migrationsFolder: './drizzle' })
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
