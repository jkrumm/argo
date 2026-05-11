import { Elysia } from 'elysia'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { userProfile } from '../db/schema.js'

const UserProfileSchema = z.object({
  id: z.number(),
  height_cm: z.number().nullable(),
  birth_date: z.string().nullable(),
  gender: z.string().nullable(),
  goal_weight_kg: z.number().nullable(),
  updated_at: z.string().nullable(),
})

export const userProfileRoutes = new Elysia({ prefix: '/user-profile' })
  .get(
    '/',
    async () => {
      const [profile] = await db.select().from(userProfile).where(eq(userProfile.id, 1))
      if (!profile) {
        // Create default profile on first access
        const [created] = await db.insert(userProfile).values({ id: 1 }).returning()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return created as any
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return profile as any
    },
    {
      response: UserProfileSchema,
      detail: {
        tags: ['User Profile'],
        summary: 'Get user profile (single row, auto-created on first access)',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .put(
    '/',
    async ({ body }) => {
      const [existing] = await db.select().from(userProfile).where(eq(userProfile.id, 1))
      if (!existing) {
        const [created] = await db
          .insert(userProfile)
          .values({ id: 1, ...body, updated_at: new Date().toISOString() })
          .returning()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return created as any
      }
      const [updated] = await db
        .update(userProfile)
        .set({ ...body, updated_at: new Date().toISOString() })
        .where(eq(userProfile.id, 1))
        .returning()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return updated as any
    },
    {
      body: z.object({
        height_cm: z.number().min(100).max(250).nullish(),
        birth_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullish(),
        gender: z.enum(['male', 'female']).nullish(),
        goal_weight_kg: z.number().min(30).max(300).nullish(),
      }),
      response: UserProfileSchema,
      detail: {
        tags: ['User Profile'],
        summary: 'Update user profile',
        security: [{ BearerAuth: [] }],
      },
    },
  )
