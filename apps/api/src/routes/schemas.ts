import { z } from 'zod'

export const ExerciseSchema = z.string()

export const SetTypeSchema = z.enum(['warmup', 'work', 'drop', 'amrap'])

export const WorkoutSetSchema = z.object({
  id: z.number(),
  workout_id: z.number(),
  set_number: z.number(),
  set_type: z.string(),
  weight_kg: z.number(),
  reps: z.number(),
  created_at: z.string().nullable(),
})
