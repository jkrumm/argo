import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../eden'
import { unwrap } from 'basalt-ui'
import { strengthQueries } from './strength'

export type WorkoutWindowParams = {
  window?: '7d' | '30d' | '90d' | 'all'
  from?: string
  to?: string
}

export type WorkoutListParams = {
  page?: number
  limit?: number
  /** An `exercise_id` from GET /exercises. */
  exercise?: string
  dateFrom?: string
  dateTo?: string
}

export type CreateWorkoutInput = {
  date: string
  exercise_id: string
  notes?: string
  sets: Array<{
    set_number: number
    set_type: 'warmup' | 'work' | 'drop' | 'amrap'
    weight_kg: number
    reps: number
  }>
}

export type AchievementType =
  | 'first_workout'
  | 'weight_milestone'
  | 'max_weight_pr'
  | 'estimated_1rm_pr'
  | 'volume_pr'

export type Achievement = {
  type: AchievementType
  title: string
  description: string
  confetti: boolean
}

export type CreateWorkoutResponse = {
  id: number
  achievements: Achievement[]
}

export type UpdateWorkoutInput = {
  id: number
  date: string
  exercise_id: string
  notes: string | null
  sets: Array<{
    set_number: number
    set_type: 'warmup' | 'work' | 'drop' | 'amrap'
    weight_kg: number
    reps: number
  }>
}

// The strength page is the one surface genuinely used from two devices in the
// same session, so it opts out of the app-wide `refetchOnWindowFocus: false` /
// 60s staleTime — those are right for a single-device dashboard and wrong here:
// a session logged on the phone would sit invisible on the laptop until a manual
// reload. The draft sync pulls a workout in the moment its shared draft
// disappears; this covers the rest — an edit, a delete, or a session logged
// while this tab was closed. Focus, not a poll: the trigger for "is this still
// current" is picking the device back up.
const CROSS_DEVICE = { staleTime: 30_000, refetchOnWindowFocus: true } as const

export const workoutsQueries = {
  all: () => ['workouts'] as const,
  summaryStrength: (params: WorkoutWindowParams) =>
    queryOptions({
      ...CROSS_DEVICE,
      queryKey: [...workoutsQueries.all(), 'summary', 'strength', params] as const,
      queryFn: async () => unwrap(await api.workouts.summary.strength.get({ query: params })),
    }),
  summarySeries: (params: WorkoutWindowParams) =>
    queryOptions({
      ...CROSS_DEVICE,
      queryKey: [...workoutsQueries.all(), 'summary', 'series', params] as const,
      queryFn: async () => unwrap(await api.workouts.summary.series.get({ query: params })),
    }),
  list: (params: WorkoutListParams) =>
    queryOptions({
      ...CROSS_DEVICE,
      queryKey: [...workoutsQueries.all(), 'list', params] as const,
      queryFn: async () => unwrap(await api.workouts.get({ query: params })),
    }),
}

// Workout mutations change both the raw workout list and every derived strength
// summary (heroes, charts) — invalidate both key roots so the page refreshes.
// Exported because a workout can also be logged on ANOTHER device: the draft
// sync notices the shared draft disappear and calls this to pull the session in.
export function invalidateWorkoutData(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: workoutsQueries.all() })
  void qc.invalidateQueries({ queryKey: strengthQueries.all() })
}

export function useCreateWorkout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateWorkoutInput) => api.workouts.post(body).then(unwrap),
    onSuccess: () => invalidateWorkoutData(qc),
  })
}

export function useUpdateWorkout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, date, exercise_id, notes, sets }: UpdateWorkoutInput) =>
      api
        .workouts({ id: String(id) })
        .patch({ date, exercise_id, notes, sets })
        .then(unwrap),
    onSuccess: () => invalidateWorkoutData(qc),
  })
}

export function useDeleteWorkout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api
        .workouts({ id: String(id) })
        .delete()
        .then(unwrap),
    onSuccess: () => invalidateWorkoutData(qc),
  })
}
