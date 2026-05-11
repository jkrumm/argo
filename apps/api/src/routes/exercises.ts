import { Elysia } from 'elysia'
import { z } from 'zod'
import { asc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { exercises } from '../db/schema.js'

const ExerciseRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  muscle_group: z.string(),
  is_bodyweight: z.number().nullable(),
  display_order: z.number().nullable(),
})

export const exerciseRoutes = new Elysia({ prefix: '/exercises' }).get(
  '/',
  async () => {
    return db.select().from(exercises).orderBy(asc(exercises.display_order))
  },
  {
    response: z.array(ExerciseRowSchema),
    detail: {
      tags: ['Exercises'],
      summary: 'List all exercises sorted by display_order',
      security: [{ BearerAuth: [] }],
    },
  },
)
