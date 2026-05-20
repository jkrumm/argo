import { useEffect, useState } from 'react'
import { Badge, Button, Group, Paper, Select, Stack, Text, TextInput } from '@mantine/core'
import { useSuspenseQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  useCreateWorkout,
  workoutsQueries,
  type CreateWorkoutResponse,
} from '../../../lib/queries/workouts'
import { exerciseQueries } from '../../../lib/queries/exercises'
import { EXERCISES, type ExerciseKey } from '../constants'
import { showAchievements } from '../achievements-toast'
import { SetEditor, type SetEntry } from './set-editor'
import { startRestTimer } from './rest-timer-bus'

const DEFAULT_SETS: SetEntry[] = [{ set_type: 'work', weight_kg: 60, reps: 5 }]

function today(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

/**
 * Client-side preview of the session aggregates the backend will compute on
 * save. Mirrors the work-set filter + Brzycki/Epley average from
 * `apps/api/src/lib/strength-formulas.ts:estimate1RM`. Best-set e1RM is the
 * max across qualifying sets — same logic as the backend's `bestSet`.
 */
function previewMetrics(sets: SetEntry[]): {
  workSets: number
  topReps: number | null
  topWeight: number | null
  totalVolume: number
  bestE1rm: number | null
} {
  let workSets = 0
  let totalVolume = 0
  let bestE1rm: number | null = null
  let topReps: number | null = null
  let topWeight: number | null = null

  for (const s of sets) {
    totalVolume += s.weight_kg * s.reps
    if (s.set_type !== 'work' && s.set_type !== 'amrap') continue
    workSets++
    if (s.reps < 1 || s.reps > 12) continue
    const epley = s.weight_kg * (1 + s.reps / 30)
    const e1rm = s.reps <= 10 ? (epley + (s.weight_kg * 36) / (37 - s.reps)) / 2 : epley
    if (bestE1rm === null || e1rm > bestE1rm) {
      bestE1rm = e1rm
      topReps = s.reps
      topWeight = s.weight_kg
    }
  }

  return { workSets, topReps, topWeight, totalVolume, bestE1rm }
}

type WorkoutRowLite = {
  id: number
  date: string
  exercise_id: string
  sets: Array<{ set_number: number; set_type: string; weight_kg: number; reps: number }>
}

/**
 * Resolve the most-recent session's sets for an exercise from the recent
 * workouts list — used to pre-fill the "Previous" column in the set editor.
 */
function findLastSession(
  workouts: ReadonlyArray<WorkoutRowLite>,
  exerciseId: ExerciseKey,
): SetEntry[] | undefined {
  const latest = workouts
    .filter((w) => w.exercise_id === exerciseId)
    .toSorted((a, b) => b.date.localeCompare(a.date))[0]
  if (!latest || latest.sets.length === 0) return undefined
  return latest.sets
    .toSorted((a, b) => a.set_number - b.set_number)
    .map((s) => ({
      set_type: (s.set_type as SetEntry['set_type']) ?? 'work',
      weight_kg: s.weight_kg,
      reps: s.reps,
    }))
}

export function WorkoutForm() {
  const [exercise, setExercise] = useState<ExerciseKey>('bench_press')
  const [date, setDate] = useState<string>(today())
  const [sets, setSets] = useState<SetEntry[]>(DEFAULT_SETS)
  const [completedCount, setCompletedCount] = useState(0)

  const exercisesResult = useSuspenseQuery(exerciseQueries.list())
  const recentResult = useSuspenseQuery(workoutsQueries.list({ page: 1, limit: 20 }))

  const exerciseOptions = (exercisesResult.data?.data ?? []).map(
    (e: { id: string; name: string }) => ({ value: e.id, label: e.name }),
  )

  const recentWorkouts = (recentResult.data?.data ?? []) as ReadonlyArray<WorkoutRowLite>
  const previousSets = findLastSession(recentWorkouts, exercise)

  // Auto pre-fill on exercise change (mirror old behaviour) + restart the check-off.
  useEffect(() => {
    if (previousSets !== undefined) {
      setSets(previousSets)
    }
    setCompletedCount(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise])

  const createWorkout = useCreateWorkout()

  const allChecked = sets.length > 0 && completedCount >= sets.length

  // Check-off a set: lock it, unlock the next, and rest before a non-drop next set.
  function handleCompletedChange(count: number) {
    const advancing = count > completedCount
    setCompletedCount(count)
    if (advancing) {
      const next = sets[count]
      if (next !== undefined && next.set_type !== 'drop') startRestTimer()
    }
  }

  function handleSubmit() {
    if (sets.length === 0 || !allChecked) return
    const body = {
      date,
      exercise_id: exercise,
      sets: sets.map((s, i) => ({
        set_number: i + 1,
        set_type: s.set_type,
        weight_kg: s.weight_kg,
        reps: s.reps,
      })),
    }
    createWorkout.mutate(body, {
      onSuccess: (result) => {
        const res = result as unknown as CreateWorkoutResponse
        showAchievements(res.achievements)
        setSets([{ set_type: 'work', weight_kg: sets[0]?.weight_kg ?? 60, reps: 5 }])
        setCompletedCount(0)
      },
    })
  }

  const preview = previewMetrics(sets)
  const previewParts: string[] = []
  if (preview.workSets > 0 && preview.topReps !== null && preview.topWeight !== null) {
    previewParts.push(
      `${preview.workSets} work × ${preview.topReps} @ ${preview.topWeight.toFixed(1)} kg`,
    )
  }
  if (preview.totalVolume > 0) {
    previewParts.push(`${Math.round(preview.totalVolume).toLocaleString()} kg total`)
  }
  if (preview.bestE1rm !== null) {
    previewParts.push(`${Math.round(preview.bestE1rm)} e1RM`)
  }

  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        <Text fw={600} size="sm">
          Log Workout
        </Text>

        <Select
          label="Exercise"
          data={exerciseOptions.length > 0 ? exerciseOptions : EXERCISES}
          value={exercise}
          onChange={(v) => v !== null && setExercise(v as ExerciseKey)}
          size="md"
          allowDeselect={false}
        />

        <TextInput
          type="date"
          label="Date"
          value={date}
          onChange={(e) => setDate(e.currentTarget.value)}
          size="md"
        />

        <SetEditor
          sets={sets}
          onChange={setSets}
          previousSets={previousSets}
          checklist
          completedCount={completedCount}
          onCompletedChange={handleCompletedChange}
        />

        {previewParts.length > 0 && (
          <Group justify="flex-start" gap={4} mt={2}>
            <Badge variant="light" color="gray" size="sm" radius="sm">
              {previewParts.join(' · ')}
            </Badge>
          </Group>
        )}

        <Button
          onClick={handleSubmit}
          loading={createWorkout.isPending}
          disabled={!allChecked}
          color={allChecked ? 'teal' : undefined}
          fullWidth
        >
          Save Workout
        </Button>
      </Stack>
    </Paper>
  )
}
