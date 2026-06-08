import { useState } from 'react'
import { ActionIcon, Badge, Group, Stack, Table, Text, Tooltip } from '@mantine/core'
import { modals } from '@mantine/modals'
import { useSuspenseQuery } from '@tanstack/react-query'
import { IconEdit, IconTrash } from '@tabler/icons-react'
import { alpha, VX } from '@argo/charts'
import { useDeleteWorkout, workoutsQueries } from '../../../lib/queries/workouts'
import { EXERCISE_COLORS, type ExerciseKey } from '../constants'
import { exerciseLabel } from '../formulas'
import { EditWorkoutModal, type EditableWorkout } from './edit-workout-modal'

type WorkoutSetRow = {
  id: number
  workout_id: number
  set_number: number
  set_type: string
  weight_kg: number
  reps: number
}

type WorkoutRow = {
  id: number
  date: string
  exercise_id: string
  exercise_name: string | null
  notes: string | null
  sets: WorkoutSetRow[]
  estimated_1rm: number | null
  total_volume: number
}

function exerciseDot(id: string): string {
  return EXERCISE_COLORS[id as ExerciseKey] ?? alpha(VX.neutral, 0.5)
}

function formatSets(sets: WorkoutSetRow[]): string {
  const work = sets.filter((s) => s.set_type === 'work' || s.set_type === 'amrap')
  const warmup = sets.filter((s) => s.set_type === 'warmup').length
  if (work.length === 0) return `${sets.length} ${sets.length === 1 ? 'set' : 'sets'}`
  const weights = [...new Set(work.map((s) => s.weight_kg))]
  const reps = [...new Set(work.map((s) => s.reps))]
  if (weights.length === 1 && reps.length === 1) {
    const w = weights[0]!
    const r = reps[0]!
    const head = `${work.length} × ${r} @ ${w} kg`
    return warmup > 0 ? `${head} (+${warmup} WU)` : head
  }
  return `${work.length} work${warmup > 0 ? ` + ${warmup} WU` : ''}`
}

function topSet(sets: WorkoutSetRow[]): string {
  const work = sets.filter((s) => s.set_type === 'work' || s.set_type === 'amrap')
  if (work.length === 0) return '—'
  const top = work.reduce((best, s) => (s.weight_kg > best.weight_kg ? s : best), work[0]!)
  return `${top.weight_kg} kg × ${top.reps}`
}

export function WorkoutsTable() {
  const { data } = useSuspenseQuery(workoutsQueries.list({ page: 1, limit: 50 }))
  const workouts = (data?.data ?? []) as WorkoutRow[]

  const deleteWorkout = useDeleteWorkout()
  const [editing, setEditing] = useState<EditableWorkout | null>(null)

  function handleDelete(workout: WorkoutRow) {
    modals.openConfirmModal({
      title: 'Delete workout',
      children: (
        <Text size="sm">
          Delete {workout.exercise_name ?? workout.exercise_id} on {workout.date}? This cannot be
          undone.
        </Text>
      ),
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteWorkout.mutate(workout.id),
    })
  }

  return (
    <Stack gap="xs">
      <EditWorkoutModal workout={editing} onClose={() => setEditing(null)} />
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Date</Table.Th>
            <Table.Th>Exercise</Table.Th>
            <Table.Th>Sets</Table.Th>
            <Table.Th>Top Set</Table.Th>
            <Table.Th>Volume</Table.Th>
            <Table.Th>e1RM</Table.Th>
            <Table.Th style={{ width: 96 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {workouts.map((w) => (
            <Table.Tr key={w.id}>
              <Table.Td>{w.date}</Table.Td>
              <Table.Td>
                <Group gap={6} wrap="nowrap">
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: exerciseDot(w.exercise_id),
                      flexShrink: 0,
                    }}
                  />
                  <Text size="sm">{w.exercise_name ?? exerciseLabel(w.exercise_id)}</Text>
                </Group>
              </Table.Td>
              <Table.Td>{formatSets(w.sets)}</Table.Td>
              <Table.Td>{topSet(w.sets)}</Table.Td>
              <Table.Td>{Math.round(w.total_volume).toLocaleString()} kg</Table.Td>
              <Table.Td>
                {w.estimated_1rm !== null ? (
                  <Badge variant="light" color="blue">
                    {w.estimated_1rm.toFixed(1)} kg
                  </Badge>
                ) : (
                  '—'
                )}
              </Table.Td>
              <Table.Td>
                <Group gap={4} justify="flex-end">
                  <Tooltip label="Edit" withArrow>
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      onClick={() => setEditing(w as unknown as EditableWorkout)}
                      aria-label="Edit"
                    >
                      <IconEdit size={14} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Delete" withArrow>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      size="sm"
                      loading={deleteWorkout.isPending && deleteWorkout.variables === w.id}
                      onClick={() => handleDelete(w)}
                      aria-label="Delete"
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
          {workouts.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={7}>
                <Text c="dimmed" ta="center" py="sm">
                  No workouts logged yet
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </Stack>
  )
}
