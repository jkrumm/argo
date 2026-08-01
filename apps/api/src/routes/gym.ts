import { Elysia } from 'elysia'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { gymState } from '../db/schema.js'

// The gym equipment config the strength tracker loads weights against. Shape is
// owned by the dashboard (`apps/dashboard/src/lib/gym-profile.ts`); this schema
// is the wire contract that keeps the stored blob honest — the column is jsonb,
// so validation here is the only thing standing between a typo and a gym profile
// that no longer parses on the client.
const BarSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  weight_kg: z.number().positive(),
})

const PlateSchema = z.object({
  weight_kg: z.number().positive(),
  // Total plates owned, NOT per side.
  count: z.number().int().nonnegative(),
})

const ExerciseLoadingSchema = z.object({
  mode: z.enum(['barbell', 'single', 'free']),
  barId: z.string().optional(),
})

const GymProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  bars: z.array(BarSchema),
  plates: z.array(PlateSchema),
  defaultBarId: z.string(),
  exercises: z.record(z.string(), ExerciseLoadingSchema),
})

const GymStateSchema = z.object({
  activeId: z.string(),
  profiles: z.array(GymProfileSchema),
})

// `state: null` is the un-seeded case, not an error — the first client to load
// writes its own profile up. Kept explicit rather than auto-seeding a default
// here, so the seed lives in exactly one place (the dashboard).
const ResponseSchema = z.object({
  state: GymStateSchema.nullable(),
  updated_at: z.string().nullable(),
})

export const gymRoutes = new Elysia({ prefix: '/gym' })
  .get(
    '',
    async () => {
      const [row] = await db.select().from(gymState).where(eq(gymState.id, 1))
      if (!row) return { state: null, updated_at: null }
      return {
        state: GymStateSchema.parse(row.state),
        updated_at: row.updated_at,
      }
    },
    {
      response: ResponseSchema,
      detail: {
        tags: ['Strength'],
        summary: 'Get gym equipment config',
        description:
          'Returns the single-row gym equipment config: the list of gym profiles (bars with their weights, the plate rack, and the per-exercise loading mode) plus the active profile id. Drives the strength tracker\'s plate calculator, so it is the answer to "what does the bar weigh" — logged sets always store the absolute total including the bar, so changing a bar here never rewrites history. `state` is null until a client seeds it via PUT /gym; treat that as "not configured yet", not an error.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .put(
    '',
    async ({ body }) => {
      const now = new Date().toISOString()
      const [saved] = await db
        .insert(gymState)
        .values({ id: 1, state: body, updated_at: now })
        .onConflictDoUpdate({
          target: gymState.id,
          set: { state: body, updated_at: now },
        })
        .returning()
      // `body` is already validated and is exactly what was written, so echo it
      // rather than re-parsing the round-tripped jsonb.
      return { state: body, updated_at: saved?.updated_at ?? now }
    },
    {
      body: GymStateSchema,
      response: ResponseSchema,
      detail: {
        tags: ['Strength'],
        summary: 'Replace gym equipment config',
        description:
          'Whole-state replace of the gym equipment config — send the full { activeId, profiles } object, not a patch; there is no partial update. Every bar needs a positive weight_kg and plate counts are totals owned, not per side. Returns the stored state with its updated_at. Read it back with GET /gym.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
