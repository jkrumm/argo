import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from '../eden'

export type WorkoutWindowParams = {
  window?: '7d' | '30d' | '90d' | 'all'
  from?: string
  to?: string
}

export type WorkoutListParams = {
  page?: number
  limit?: number
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

export const workoutsQueries = {
  all: () => ['workouts'] as const,
  summaryStrength: (params: WorkoutWindowParams) =>
    queryOptions({
      queryKey: [...workoutsQueries.all(), 'summary', 'strength', params] as const,
      queryFn: async () => unwrap(await api.workouts.summary.strength.get({ query: params })),
    }),
  summarySeries: (params: WorkoutWindowParams) =>
    queryOptions({
      queryKey: [...workoutsQueries.all(), 'summary', 'series', params] as const,
      queryFn: async () => unwrap(await api.workouts.summary.series.get({ query: params })),
    }),
  list: (params: WorkoutListParams) =>
    queryOptions({
      queryKey: [...workoutsQueries.all(), 'list', params] as const,
      queryFn: async () => unwrap(await api.workouts.get({ query: params })),
    }),
}

export function useCreateWorkout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateWorkoutInput) => api.workouts.post(body).then(unwrap),
    onSuccess: () => void qc.invalidateQueries({ queryKey: workoutsQueries.all() }),
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
    onSuccess: () => void qc.invalidateQueries({ queryKey: workoutsQueries.all() }),
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
    onSuccess: () => void qc.invalidateQueries({ queryKey: workoutsQueries.all() }),
  })
}
