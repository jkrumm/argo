import { useEffect, useState } from 'react'
import { Button, Group, Paper, Select, Stack, Text, TextInput } from '@mantine/core'
import { useSuspenseQuery } from '@tanstack/react-query'
import {
  useCreateWorkout,
  workoutsQueries,
  type CreateWorkoutResponse,
} from '../../../lib/queries/workouts'
import { exerciseQueries } from '../../../lib/queries/exercises'
import { EXERCISES, type ExerciseKey } from '../constants'
import { showAchievements } from '../achievements-toast'
import { SetEditor, type SetEntry } from './set-editor'

const DEFAULT_SETS: SetEntry[] = [{ set_type: 'work', weight_kg: 60, reps: 5 }]

function today(): string {
  return new Date().toISOString().slice(0, 10)
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

  const exercisesResult = useSuspenseQuery(exerciseQueries.list())
  const recentResult = useSuspenseQuery(workoutsQueries.list({ page: 1, limit: 20 }))

  const exerciseOptions = (exercisesResult.data?.data ?? []).map(
    (e: { id: string; name: string }) => ({ value: e.id, label: e.name }),
  )

  const recentWorkouts = (recentResult.data?.data ?? []) as ReadonlyArray<WorkoutRowLite>
  const previousSets = findLastSession(recentWorkouts, exercise)

  // Auto pre-fill on exercise change (mirror old behaviour).
  useEffect(() => {
    if (previousSets !== undefined) {
      setSets(previousSets)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise])

  const createWorkout = useCreateWorkout()

  function handleSubmit() {
    if (sets.length === 0) return
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
      },
    })
  }

  const workSetCount = sets.filter((s) => s.set_type === 'work').length
  const totalVolume = sets.reduce((sum, s) => sum + s.weight_kg * s.reps, 0)

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

        <SetEditor sets={sets} onChange={setSets} previousSets={previousSets} />

        <Group justify="space-between" gap={4} mt={4}>
          <Text size="xs" c="dimmed">
            {workSetCount} work {workSetCount === 1 ? 'set' : 'sets'} ·{' '}
            {totalVolume.toLocaleString()} kg
          </Text>
        </Group>

        <Button
          onClick={handleSubmit}
          loading={createWorkout.isPending}
          disabled={sets.length === 0}
          fullWidth
        >
          Save Workout
        </Button>
      </Stack>
    </Paper>
  )
}
