import { useState } from 'react'
import { ActionIcon, Badge, Box, Group, Stack, Text, Tooltip } from '@mantine/core'
import { modals } from '@mantine/modals'
import { useSuspenseQuery } from '@tanstack/react-query'
import { IconEdit, IconTrash } from '@tabler/icons-react'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/data/table'
import { alpha, VX } from 'basalt-ui/tokens'
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

const columnHelper = createColumnHelper<WorkoutRow>()

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

  const columns = [
    columnHelper.accessor('date', { header: 'Date' }),
    columnHelper.accessor((row) => row.exercise_name ?? exerciseLabel(row.exercise_id), {
      id: 'exercise',
      header: 'Exercise',
      cell: (ctx) => (
        <Group gap={6} wrap="nowrap">
          <Box
            component="span"
            w={8}
            h={8}
            bdrs="50%"
            bg={exerciseDot(ctx.row.original.exercise_id)}
            style={{ flexShrink: 0 }}
          />
          <Text size="sm">{ctx.getValue()}</Text>
        </Group>
      ),
    }),
    columnHelper.display({
      id: 'sets',
      header: 'Sets',
      enableSorting: false,
      cell: (ctx) => formatSets(ctx.row.original.sets),
    }),
    columnHelper.display({
      id: 'topSet',
      header: 'Top Set',
      enableSorting: false,
      cell: (ctx) => topSet(ctx.row.original.sets),
    }),
    columnHelper.accessor('total_volume', {
      header: 'Volume',
      cell: (ctx) => `${Math.round(ctx.getValue()).toLocaleString()} kg`,
    }),
    columnHelper.accessor('estimated_1rm', {
      header: 'e1RM',
      cell: (ctx) => {
        const value = ctx.getValue()
        return value !== null ? (
          <Badge variant="light" color="blue">
            {value.toFixed(1)} kg
          </Badge>
        ) : (
          '—'
        )
      },
    }),
    columnHelper.display({
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: (ctx) => {
        const w = ctx.row.original
        return (
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
        )
      },
    }),
  ]

  return (
    <Stack gap="xs">
      <EditWorkoutModal workout={editing} onClose={() => setEditing(null)} />
      <BasaltDataTable
        data={workouts}
        columns={columns}
        striped
        highlightOnHover
        emptyState={
          <Text c="dimmed" ta="center" size="sm" py="sm">
            No workouts logged yet
          </Text>
        }
      />
    </Stack>
  )
}
