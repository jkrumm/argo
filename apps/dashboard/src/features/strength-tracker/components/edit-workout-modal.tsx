import { useState } from 'react'
import { Button, Group, Modal, Select, Stack, TextInput } from '@mantine/core'
import { useSuspenseQuery } from '@tanstack/react-query'
import { exerciseQueries } from '../../../lib/queries/exercises'
import { useUpdateWorkout, type UpdateWorkoutInput } from '../../../lib/queries/workouts'
import { loadingFor } from '../../../lib/gym-profile'
import { useGyms } from '../../../lib/queries/gym'
import { EXERCISES } from '../constants'
import { SetEditor, type SetEntry } from './set-editor'

export type EditableWorkout = {
  id: number
  date: string
  exercise_id: string
  notes: string | null
  sets: Array<{
    set_number: number
    set_type: string
    weight_kg: number
    reps: number
  }>
}

export function EditWorkoutModal({
  workout,
  onClose,
}: {
  workout: EditableWorkout | null
  onClose: () => void
}) {
  const exercisesResult = useSuspenseQuery(exerciseQueries.list())
  const exerciseRows = exercisesResult.data?.data ?? []
  const exerciseOptions = exerciseRows.map((e: { id: string; name: string }) => ({
    value: e.id,
    label: e.name,
  }))

  return (
    <Modal opened={workout !== null} onClose={onClose} title="Edit Workout" size="lg">
      {workout !== null && (
        <EditForm
          workout={workout}
          exerciseOptions={exerciseOptions.length > 0 ? exerciseOptions : EXERCISES}
          onClose={onClose}
        />
      )}
    </Modal>
  )
}

function EditForm({
  workout,
  exerciseOptions,
  onClose,
}: {
  workout: EditableWorkout
  exerciseOptions: ReadonlyArray<{ value: string; label: string }>
  onClose: () => void
}) {
  const [date, setDate] = useState(workout.date)
  const [exerciseId, setExerciseId] = useState(workout.exercise_id)
  const [sets, setSets] = useState<SetEntry[]>(
    workout.sets
      .toSorted((a, b) => a.set_number - b.set_number)
      .map((s) => ({
        set_type: (s.set_type as SetEntry['set_type']) ?? 'work',
        weight_kg: s.weight_kg,
        reps: s.reps,
      })),
  )

  const updateWorkout = useUpdateWorkout()
  const gyms = useGyms()
  const loading = loadingFor(gyms.active, exerciseId)

  function handleSave() {
    const input: UpdateWorkoutInput = {
      id: workout.id,
      date,
      exercise_id: exerciseId,
      notes: workout.notes,
      sets: sets.map((s, i) => ({
        set_number: i + 1,
        set_type: s.set_type,
        weight_kg: s.weight_kg,
        reps: s.reps,
      })),
    }
    updateWorkout.mutate(input, { onSuccess: onClose })
  }

  return (
    <Stack gap="sm">
      <Select
        label="Exercise"
        data={[...exerciseOptions]}
        value={exerciseId}
        onChange={(v) => v !== null && setExerciseId(v)}
        allowDeselect={false}
      />
      <TextInput
        type="date"
        label="Date"
        value={date}
        onChange={(e) => setDate(e.currentTarget.value)}
      />

      {/* No settings gear here: the gym-equipment modal would have to stack on top
          of this one. Editing equipment belongs in the Log Workout form. */}
      <SetEditor
        sets={sets}
        onChange={setSets}
        loadingMode={loading.mode}
        barId={loading.barId}
        onBarChange={(barId) => gyms.setExerciseLoading(exerciseId, { barId })}
      />

      <Group justify="flex-end" mt="sm">
        <Button variant="default" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSave} loading={updateWorkout.isPending} disabled={sets.length === 0}>
          Save
        </Button>
      </Group>
    </Stack>
  )
}
