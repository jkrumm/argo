import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import {
  ActionIcon,
  Button,
  Card,
  Grid,
  Group,
  Modal,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { useForm } from '@mantine/form'
import { modals } from '@mantine/modals'
import { useElementSize } from '@mantine/hooks'
import {
  IconMinus,
  IconPlus,
  IconTrash,
  IconEdit,
  IconTrendingUp,
  IconTrendingDown,
} from '@tabler/icons-react'
import {
  ChartCard,
  ChartLegend,
  HoverContext,
  VX,
  ZonedLine,
  useVxTheme,
  type HoverCtx,
} from '@argo/charts'
import {
  workoutsQueries,
  useCreateWorkout,
  useUpdateWorkout,
  useDeleteWorkout,
  type UpdateWorkoutInput,
} from '../lib/queries/workouts'
import { weightLogQueries, useCreateWeightLog } from '../lib/queries/weight-log'
import { exerciseQueries } from '../lib/queries/exercises'
import { zodResolver } from '../lib/zod-resolver'

// ── Search params ──────────────────────────────────────────────────────────

const SearchSchema = z.object({
  window: z.enum(['7d', '30d', '90d', 'all']).default('90d'),
  from: z.string().optional(),
  to: z.string().optional(),
  tab: z.enum(['workouts', 'bodyweight']).default('workouts'),
})

type SearchParams = z.infer<typeof SearchSchema>
type WindowParams = Pick<SearchParams, 'window' | 'from' | 'to'>

// ── Form schemas ───────────────────────────────────────────────────────────

const SetFormSchema = z.object({
  setType: z.enum(['warmup', 'work', 'drop', 'amrap']),
  weightKg: z.coerce.number().min(0, 'Weight must be ≥ 0'),
  reps: z.coerce.number().int().min(1, 'At least 1 rep required'),
})

const WorkoutFormSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format'),
  exerciseId: z.string().min(1, 'Select an exercise'),
  notes: z.string(),
  sets: z.array(SetFormSchema).min(1, 'Add at least one set'),
})

const WeightFormSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format'),
  weightKg: z.coerce.number().min(30, 'Min 30 kg').max(300, 'Max 300 kg'),
})

type SetFormValues = z.infer<typeof SetFormSchema>
type WorkoutFormValues = z.infer<typeof WorkoutFormSchema>
type WeightFormValues = z.infer<typeof WeightFormSchema>

// ── Local types (mirror API response shapes) ───────────────────────────────

type ExerciseSummaryItem = {
  exercise_id: string
  exercise_name: string
  currentE1RM: number | null
  bestE1RM: number | null
  prDate: string | null
  totalVolumeWindow: number
  sessionCountWindow: number
}

type SeriesPoint = {
  date: string
  e1rm: number | null
  volume: number
  maxWeight: number
}

type ExerciseSeries = {
  exercise_id: string
  exercise_name: string
  points: SeriesPoint[]
}

type WorkoutSet = {
  id: number
  workout_id: number
  set_number: number
  set_type: string
  weight_kg: number
  reps: number
  created_at: string | null
}

type WorkoutRow = {
  id: number
  date: string
  exercise_id: string
  exercise_name: string | null
  is_bodyweight: number | null
  notes: string | null
  created_at: string | null
  sets: WorkoutSet[]
  estimated_1rm_epley: number | null
  estimated_1rm_brzycki: number | null
  estimated_1rm: number | null
  total_volume: number
}

type ExerciseRow = {
  id: string
  name: string
  category: string
  muscle_group: string
  is_bodyweight: number | null
  display_order: number | null
}

type WeightSummary = {
  current: number | null
  ma7: number | null
  ma30: number | null
  trend: 'up' | 'down' | 'flat'
  weeklyDelta: number | null
  monthlyDelta: number | null
}

type WeightPoint = {
  date: string
  weightKg: number
}

// ── Route definition ───────────────────────────────────────────────────────

export const Route = createFileRoute('/strength-tracker')({
  validateSearch: (raw: Record<string, unknown>) => SearchSchema.parse(raw),
  loaderDeps: ({ search }: { search: SearchParams }) => ({
    window: search.window as WindowParams['window'],
    from: search.from,
    to: search.to,
    tab: search.tab,
  }),
  loader: ({ context, deps }) => {
    if (deps.tab === 'bodyweight') {
      return Promise.all([
        context.queryClient.ensureQueryData(weightLogQueries.summary(deps)),
        context.queryClient.ensureQueryData(weightLogQueries.series(deps)),
      ])
    }
    return Promise.all([
      context.queryClient.ensureQueryData(workoutsQueries.summaryStrength(deps)),
      context.queryClient.ensureQueryData(workoutsQueries.summarySeries(deps)),
      context.queryClient.ensureQueryData(workoutsQueries.list({ page: 1, limit: 20 })),
      context.queryClient.ensureQueryData(exerciseQueries.list()),
    ])
  },
  component: StrengthTracker,
})

// ── Shared helpers ─────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function fmtKg(v: number | null): string {
  if (v === null) return '—'
  return `${v % 1 === 0 ? v : v.toFixed(1)} kg`
}

function fmtNum(v: number | null): string {
  return v === null ? '—' : String(Math.round(v))
}

function formatSets(sets: WorkoutSet[]): string {
  const workSets = sets.filter((s) => s.set_type === 'work' || s.set_type === 'amrap')
  if (workSets.length === 0) return `${sets.length} sets`
  const weights = [...new Set(workSets.map((s) => s.weight_kg))]
  const reps = [...new Set(workSets.map((s) => s.reps))]
  const w = weights[0]
  const r = reps[0]
  if (weights.length === 1 && reps.length === 1 && w !== undefined && r !== undefined) {
    return `${workSets.length} × ${r} @ ${w} kg`
  }
  return `${workSets.length} sets`
}

// ── Shared chart container ─────────────────────────────────────────────────

function ChartContainer({
  height = 220,
  children,
}: {
  height?: number
  children: (width: number) => ReactNode
}) {
  const { ref, width } = useElementSize<HTMLDivElement>()
  return (
    <div ref={ref} style={{ height, width: '100%' }}>
      {width > 0 ? children(Math.max(width, 200)) : null}
    </div>
  )
}

// ── Workout form ───────────────────────────────────────────────────────────

const emptySet = (): SetFormValues => ({ setType: 'work', weightKg: 0, reps: 5 })

function WorkoutForm({ exercises }: { exercises: ExerciseRow[] }) {
  const createWorkout = useCreateWorkout()

  const form = useForm<WorkoutFormValues>({
    initialValues: {
      date: today(),
      exerciseId: '',
      notes: '',
      sets: [emptySet()],
    },
    validate: zodResolver(WorkoutFormSchema),
  })

  const exerciseData = useMemo(
    () => exercises.map((e) => ({ value: e.id, label: e.name })),
    [exercises],
  )

  function handleSubmit(values: WorkoutFormValues) {
    const body = {
      date: values.date,
      exercise_id: values.exerciseId,
      ...(values.notes.length > 0 ? { notes: values.notes } : {}),
      sets: values.sets.map((s, i) => ({
        set_number: i + 1,
        set_type: s.setType,
        weight_kg:
          typeof s.weightKg === 'number' ? s.weightKg : parseFloat(String(s.weightKg)) || 0,
        reps: typeof s.reps === 'number' ? s.reps : parseInt(String(s.reps)) || 0,
      })),
    }

    createWorkout.mutate(body, {
      onSuccess: () => form.reset(),
    })
  }

  return (
    <Paper withBorder p="md">
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="sm">
          <Text fw={600} size="sm">
            Log Workout
          </Text>

          <Grid>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <TextInput type="date" label="Date" size="lg" {...form.getInputProps('date')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <Select
                label="Exercise"
                placeholder="Select exercise"
                data={exerciseData}
                searchable
                size="lg"
                {...form.getInputProps('exerciseId')}
              />
            </Grid.Col>
          </Grid>

          <TextInput
            label="Notes"
            placeholder="Optional notes"
            size="lg"
            {...form.getInputProps('notes')}
          />

          <Stack gap={6}>
            <Group justify="space-between">
              <Text size="sm" fw={500}>
                Sets
              </Text>
              <Button
                size="xs"
                variant="light"
                leftSection={<IconPlus size={14} />}
                onClick={() => form.insertListItem('sets', emptySet())}
              >
                Add set
              </Button>
            </Group>

            {form.errors['sets'] && (
              <Text size="xs" c="red">
                {form.errors['sets']}
              </Text>
            )}

            {form.values.sets.map((_, i) => (
              <Group key={i} gap="xs" align="flex-end">
                <Select
                  label={i === 0 ? 'Type' : undefined}
                  size="lg"
                  style={{ width: 110 }}
                  data={[
                    { value: 'work', label: 'Work' },
                    { value: 'warmup', label: 'Warm-up' },
                    { value: 'amrap', label: 'AMRAP' },
                    { value: 'drop', label: 'Drop' },
                  ]}
                  {...form.getInputProps(`sets.${i}.setType`)}
                />
                <NumberInput
                  label={i === 0 ? 'Weight (kg)' : undefined}
                  placeholder="0"
                  min={0}
                  step={2.5}
                  decimalScale={2}
                  size="lg"
                  style={{ flex: 1 }}
                  inputMode="decimal"
                  {...form.getInputProps(`sets.${i}.weightKg`)}
                />
                <NumberInput
                  label={i === 0 ? 'Reps' : undefined}
                  placeholder="5"
                  min={1}
                  max={100}
                  size="lg"
                  style={{ width: 80 }}
                  inputMode="numeric"
                  {...form.getInputProps(`sets.${i}.reps`)}
                />
                <ActionIcon
                  color="red"
                  variant="subtle"
                  size="lg"
                  style={{ marginBottom: 2 }}
                  onClick={() => form.removeListItem('sets', i)}
                  disabled={form.values.sets.length <= 1}
                  aria-label="Remove set"
                >
                  <IconMinus size={16} />
                </ActionIcon>
              </Group>
            ))}
          </Stack>

          <Button type="submit" loading={createWorkout.isPending} fullWidth>
            Save Workout
          </Button>
        </Stack>
      </form>
    </Paper>
  )
}

// ── Exercise summary cards ─────────────────────────────────────────────────

function ExerciseSummaryCard({ item }: { item: ExerciseSummaryItem }) {
  return (
    <Card padding="md" withBorder>
      <Text size="xs" c="dimmed" mb={4} truncate>
        {item.exercise_name}
      </Text>
      <Group gap={6} align="baseline" mb={8}>
        <Text size="xl" fw={700} style={{ lineHeight: 1 }}>
          {fmtKg(item.currentE1RM)}
        </Text>
        <Text size="xs" c="dimmed">
          e1RM
        </Text>
      </Group>
      <SimpleGrid cols={2} spacing={8}>
        <div>
          <Text size="xs" c="dimmed">
            Best
          </Text>
          <Text size="sm">{fmtKg(item.bestE1RM)}</Text>
        </div>
        <div>
          <Text size="xs" c="dimmed">
            Sessions
          </Text>
          <Text size="sm">{item.sessionCountWindow}</Text>
        </div>
        <div>
          <Text size="xs" c="dimmed">
            Volume
          </Text>
          <Text size="sm">{Math.round(item.totalVolumeWindow / 1000)}k kg</Text>
        </div>
        <div>
          <Text size="xs" c="dimmed">
            PR date
          </Text>
          <Text size="sm">{item.prDate ?? '—'}</Text>
        </div>
      </SimpleGrid>
    </Card>
  )
}

// ── E1RM chart ─────────────────────────────────────────────────────────────

function E1RMChart({
  exerciseName,
  points,
  chartId,
}: {
  exerciseName: string
  points: SeriesPoint[]
  chartId: string
}) {
  const { line } = useVxTheme()
  const latest = points.at(-1)
  const latestE1RM = latest?.e1rm ?? null

  return (
    <ChartCard
      title={exerciseName}
      subtitle="Is my strength increasing over time?"
      tooltip="Estimated 1-rep max (Epley + Brzycki average). Work and AMRAP sets only, reps 1–12."
      extra={
        latestE1RM !== null ? (
          <span style={{ fontSize: 13 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{latestE1RM.toFixed(1)}</span>
            <span style={{ opacity: 0.5 }}> kg</span>
          </span>
        ) : undefined
      }
    >
      <ChartContainer height={220}>
        {(width) => (
          <ZonedLine
            data={points}
            width={width}
            height={220}
            chartId={chartId}
            getX={(d) => d.date}
            getY={(d) => d.e1rm}
            yDomain="auto"
            yAutoMinCeil={Infinity}
            seriesLabel="e1RM (kg)"
            formatValue={(v) => `${v.toFixed(1)} kg`}
          />
        )}
      </ChartContainer>
      <ChartLegend
        items={[{ key: 'e1rm', label: 'e1RM (kg)', color: line }]}
        highlighted={null}
        onHighlight={() => {}}
      />
    </ChartCard>
  )
}

// ── Edit workout modal ─────────────────────────────────────────────────────

function EditWorkoutForm({
  workout,
  exercises,
  onClose,
}: {
  workout: WorkoutRow
  exercises: ExerciseRow[]
  onClose: () => void
}) {
  const updateWorkout = useUpdateWorkout()

  const exerciseData = useMemo(
    () => exercises.map((e) => ({ value: e.id, label: e.name })),
    [exercises],
  )

  const form = useForm<WorkoutFormValues>({
    initialValues: {
      date: workout.date,
      exerciseId: workout.exercise_id,
      notes: workout.notes ?? '',
      sets: workout.sets.map((s) => ({
        setType: (s.set_type as SetFormValues['setType']) ?? 'work',
        weightKg: s.weight_kg,
        reps: s.reps,
      })),
    },
    validate: zodResolver(WorkoutFormSchema),
  })

  function handleSubmit(values: WorkoutFormValues) {
    const input: UpdateWorkoutInput = {
      id: workout.id,
      date: values.date,
      exercise_id: values.exerciseId,
      notes: values.notes.length > 0 ? values.notes : null,
      sets: values.sets.map((s, i) => ({
        set_number: i + 1,
        set_type: s.setType,
        weight_kg:
          typeof s.weightKg === 'number' ? s.weightKg : parseFloat(String(s.weightKg)) || 0,
        reps: typeof s.reps === 'number' ? s.reps : parseInt(String(s.reps)) || 0,
      })),
    }
    updateWorkout.mutate(input, { onSuccess: onClose })
  }

  return (
    <form onSubmit={form.onSubmit(handleSubmit)}>
      <Stack gap="sm">
        <Grid>
          <Grid.Col span={{ base: 12, sm: 6 }}>
            <TextInput type="date" label="Date" size="md" {...form.getInputProps('date')} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6 }}>
            <Select
              label="Exercise"
              data={exerciseData}
              searchable
              size="md"
              {...form.getInputProps('exerciseId')}
            />
          </Grid.Col>
        </Grid>

        <TextInput label="Notes" size="md" {...form.getInputProps('notes')} />

        <Stack gap={6}>
          <Group justify="space-between">
            <Text size="sm" fw={500}>
              Sets
            </Text>
            <Button
              size="xs"
              variant="light"
              leftSection={<IconPlus size={14} />}
              onClick={() => form.insertListItem('sets', emptySet())}
            >
              Add set
            </Button>
          </Group>

          {form.values.sets.map((_, i) => (
            <Group key={i} gap="xs" align="flex-end">
              <Select
                label={i === 0 ? 'Type' : undefined}
                size="md"
                style={{ width: 100 }}
                data={[
                  { value: 'work', label: 'Work' },
                  { value: 'warmup', label: 'Warm-up' },
                  { value: 'amrap', label: 'AMRAP' },
                  { value: 'drop', label: 'Drop' },
                ]}
                {...form.getInputProps(`sets.${i}.setType`)}
              />
              <NumberInput
                label={i === 0 ? 'Weight (kg)' : undefined}
                min={0}
                step={2.5}
                decimalScale={2}
                size="md"
                style={{ flex: 1 }}
                inputMode="decimal"
                {...form.getInputProps(`sets.${i}.weightKg`)}
              />
              <NumberInput
                label={i === 0 ? 'Reps' : undefined}
                min={1}
                max={100}
                size="md"
                style={{ width: 72 }}
                inputMode="numeric"
                {...form.getInputProps(`sets.${i}.reps`)}
              />
              <ActionIcon
                color="red"
                variant="subtle"
                size="md"
                onClick={() => form.removeListItem('sets', i)}
                disabled={form.values.sets.length <= 1}
                aria-label="Remove set"
              >
                <IconMinus size={14} />
              </ActionIcon>
            </Group>
          ))}
        </Stack>

        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={updateWorkout.isPending}>
            Save
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

// ── Workouts table ─────────────────────────────────────────────────────────

function WorkoutsTable({
  workouts,
  exercises,
}: {
  workouts: WorkoutRow[]
  exercises: ExerciseRow[]
}) {
  const deleteWorkout = useDeleteWorkout()
  const [editing, setEditing] = useState<WorkoutRow | null>(null)

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
    <>
      <Modal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit Workout"
        size="lg"
      >
        {editing !== null && (
          <EditWorkoutForm
            workout={editing}
            exercises={exercises}
            onClose={() => setEditing(null)}
          />
        )}
      </Modal>

      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Date</Table.Th>
            <Table.Th>Exercise</Table.Th>
            <Table.Th>Sets</Table.Th>
            <Table.Th>e1RM</Table.Th>
            <Table.Th style={{ width: 80 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {workouts.map((w) => (
            <Table.Tr key={w.id}>
              <Table.Td>{w.date}</Table.Td>
              <Table.Td>{w.exercise_name ?? w.exercise_id}</Table.Td>
              <Table.Td>{formatSets(w.sets)}</Table.Td>
              <Table.Td>{fmtKg(w.estimated_1rm)}</Table.Td>
              <Table.Td>
                <Group gap={4} justify="flex-end">
                  <Tooltip label="Edit" withArrow>
                    <ActionIcon variant="subtle" size="sm" onClick={() => setEditing(w)}>
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
              <Table.Td colSpan={5}>
                <Text c="dimmed" ta="center" py="sm">
                  No workouts in this window
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </>
  )
}

// ── Workouts panel ─────────────────────────────────────────────────────────

function WorkoutsPanel({ windowParams }: { windowParams: WindowParams }) {
  const { data: strengthSummary } = useSuspenseQuery(workoutsQueries.summaryStrength(windowParams))
  const { data: seriesData } = useSuspenseQuery(workoutsQueries.summarySeries(windowParams))
  const { data: workoutList } = useSuspenseQuery(workoutsQueries.list({ page: 1, limit: 20 }))
  const exercisesResult = useSuspenseQuery(exerciseQueries.list())

  const exercises = (exercisesResult.data?.data ?? []) as ExerciseRow[]
  const recentWorkouts = workoutList.data as WorkoutRow[]

  const byExerciseSummary = strengthSummary.byExercise as ExerciseSummaryItem[]
  const byExerciseSeries = seriesData.byExercise as ExerciseSeries[]

  const [hoverState, setHoverState] = useState<{ date: string | null; source: string | null }>({
    date: null,
    source: null,
  })

  const setHover = useCallback((date: string | null, source: string | null) => {
    setHoverState({ date, source })
  }, [])

  const hoverCtx = useMemo<HoverCtx>(() => ({ ...hoverState, setHover }), [hoverState, setHover])

  const topExercises = useMemo(
    () =>
      byExerciseSummary.toSorted((a, b) => b.sessionCountWindow - a.sessionCountWindow).slice(0, 4),
    [byExerciseSummary],
  )

  const seriesMap = useMemo(() => {
    const m = new Map<string, ExerciseSeries>()
    for (const e of byExerciseSeries) m.set(e.exercise_id, e)
    return m
  }, [byExerciseSeries])

  return (
    <HoverContext.Provider value={hoverCtx}>
      <Grid>
        {/* Workout entry form — full width on mobile, left column on lg */}
        <Grid.Col span={{ base: 12, lg: 5 }}>
          <WorkoutForm exercises={exercises} />
        </Grid.Col>

        {/* Summary cards + charts — right side on lg */}
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <Stack>
            {byExerciseSummary.length > 0 && (
              <>
                <Text fw={600} size="sm" c="dimmed">
                  Exercise Summaries
                </Text>
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  {topExercises.map((item) => (
                    <ExerciseSummaryCard key={item.exercise_id} item={item} />
                  ))}
                </SimpleGrid>
              </>
            )}

            {topExercises.map((item) => {
              const series = seriesMap.get(item.exercise_id)
              if (!series || series.points.length < 2) return null
              return (
                <E1RMChart
                  key={item.exercise_id}
                  exerciseName={item.exercise_name}
                  points={series.points}
                  chartId={`e1rm-${item.exercise_id}`}
                />
              )
            })}
          </Stack>
        </Grid.Col>

        {/* Recent workouts table — full width */}
        <Grid.Col span={12}>
          <Stack gap="xs">
            <Text fw={600} size="sm" c="dimmed">
              Recent Workouts
            </Text>
            <WorkoutsTable workouts={recentWorkouts} exercises={exercises} />
          </Stack>
        </Grid.Col>
      </Grid>
    </HoverContext.Provider>
  )
}

// ── Body weight summary cards ──────────────────────────────────────────────

function WeightSummaryCards({ summary }: { summary: WeightSummary }) {
  const trendColor =
    summary.trend === 'flat' ? 'gray' : summary.trend === 'down' ? VX.goodSolid : VX.warnSolid

  const TrendIcon =
    summary.trend === 'up' ? (
      <IconTrendingUp size={16} color={trendColor} />
    ) : summary.trend === 'down' ? (
      <IconTrendingDown size={16} color={trendColor} />
    ) : (
      <IconMinus size={16} color={trendColor} />
    )

  return (
    <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }}>
      <Card padding="md" withBorder>
        <Text size="xs" c="dimmed" mb={4}>
          Current
        </Text>
        <Group gap={6} align="baseline">
          <Text size="xl" fw={700} style={{ lineHeight: 1 }}>
            {fmtNum(summary.current)}
          </Text>
          <Text size="sm" c="dimmed">
            kg
          </Text>
          {TrendIcon}
        </Group>
      </Card>

      <Card padding="md" withBorder>
        <Text size="xs" c="dimmed" mb={4}>
          7d avg
        </Text>
        <Text size="xl" fw={700} style={{ lineHeight: 1 }}>
          {summary.ma7 !== null ? summary.ma7.toFixed(1) : '—'}
        </Text>
      </Card>

      <Card padding="md" withBorder>
        <Text size="xs" c="dimmed" mb={4}>
          30d avg
        </Text>
        <Text size="xl" fw={700} style={{ lineHeight: 1 }}>
          {summary.ma30 !== null ? summary.ma30.toFixed(1) : '—'}
        </Text>
      </Card>

      <Card padding="md" withBorder>
        <Text size="xs" c="dimmed" mb={4}>
          Weekly Δ
        </Text>
        <Text
          size="xl"
          fw={700}
          style={{
            lineHeight: 1,
            color:
              summary.weeklyDelta !== null && summary.weeklyDelta > 0 ? VX.warnSolid : VX.goodSolid,
          }}
        >
          {summary.weeklyDelta !== null
            ? `${summary.weeklyDelta > 0 ? '+' : ''}${summary.weeklyDelta.toFixed(1)}`
            : '—'}
        </Text>
      </Card>

      <Card padding="md" withBorder>
        <Text size="xs" c="dimmed" mb={4}>
          Monthly Δ
        </Text>
        <Text
          size="xl"
          fw={700}
          style={{
            lineHeight: 1,
            color:
              summary.monthlyDelta !== null && summary.monthlyDelta > 0
                ? VX.warnSolid
                : VX.goodSolid,
          }}
        >
          {summary.monthlyDelta !== null
            ? `${summary.monthlyDelta > 0 ? '+' : ''}${summary.monthlyDelta.toFixed(1)}`
            : '—'}
        </Text>
      </Card>

      <Card padding="md" withBorder>
        <Text size="xs" c="dimmed" mb={4}>
          Trend
        </Text>
        <Group gap={4} align="center" mt={4}>
          {TrendIcon}
          <Text size="sm" fw={600} style={{ color: trendColor }}>
            {summary.trend === 'up' ? 'Gaining' : summary.trend === 'down' ? 'Losing' : 'Stable'}
          </Text>
        </Group>
      </Card>
    </SimpleGrid>
  )
}

// ── Weight chart ───────────────────────────────────────────────────────────

function WeightChart({ points }: { points: WeightPoint[] }) {
  const { line } = useVxTheme()
  const latest = points.at(-1)
  const latestWeight = latest?.weightKg ?? null

  return (
    <ChartCard
      title="Body Weight"
      subtitle="Am I trending toward my goal weight?"
      tooltip="Logged body weight over time (kg). Lower 7d avg vs 30d avg = losing weight."
      extra={
        latestWeight !== null ? (
          <span style={{ fontSize: 13 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{latestWeight.toFixed(1)}</span>
            <span style={{ opacity: 0.5 }}> kg</span>
          </span>
        ) : undefined
      }
    >
      <ChartContainer height={240}>
        {(width) => (
          <ZonedLine
            data={points}
            width={width}
            height={240}
            chartId="body-weight"
            getX={(d) => d.date}
            getY={(d) => d.weightKg}
            yDomain="auto"
            yAutoMinCeil={Infinity}
            seriesLabel="Weight (kg)"
            formatValue={(v) => `${v.toFixed(1)} kg`}
          />
        )}
      </ChartContainer>
      <ChartLegend
        items={[{ key: 'weight', label: 'Weight (kg)', color: line }]}
        highlighted={null}
        onHighlight={() => {}}
      />
    </ChartCard>
  )
}

// ── Weight entry form ──────────────────────────────────────────────────────

function WeightEntryForm() {
  const createWeightLog = useCreateWeightLog()

  const form = useForm<WeightFormValues>({
    initialValues: { date: today(), weightKg: 80 },
    validate: zodResolver(WeightFormSchema),
  })

  function handleSubmit(values: WeightFormValues) {
    const weight =
      typeof values.weightKg === 'number'
        ? values.weightKg
        : parseFloat(String(values.weightKg)) || 0
    createWeightLog.mutate(
      { date: values.date, weight_kg: weight },
      { onSuccess: () => form.setFieldValue('weightKg', weight) },
    )
  }

  return (
    <Paper withBorder p="md">
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="sm">
          <Text fw={600} size="sm">
            Log Weight
          </Text>
          <Group align="flex-end" gap="sm">
            <TextInput
              type="date"
              label="Date"
              size="lg"
              style={{ flex: 1 }}
              {...form.getInputProps('date')}
            />
            <NumberInput
              label="Weight (kg)"
              min={30}
              max={300}
              step={0.1}
              decimalScale={1}
              size="lg"
              style={{ flex: 1 }}
              inputMode="decimal"
              {...form.getInputProps('weightKg')}
            />
            <Button type="submit" size="lg" loading={createWeightLog.isPending}>
              Save
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  )
}

// ── Body weight panel ──────────────────────────────────────────────────────

function BodyWeightPanel({ windowParams }: { windowParams: WindowParams }) {
  const { data: summary } = useSuspenseQuery(weightLogQueries.summary(windowParams))
  const { data: series } = useSuspenseQuery(weightLogQueries.series(windowParams))

  return (
    <Stack>
      <WeightSummaryCards summary={summary as WeightSummary} />
      <WeightEntryForm />
      <WeightChart points={(series.points ?? []) as WeightPoint[]} />
    </Stack>
  )
}

// ── Page component ─────────────────────────────────────────────────────────

function StrengthTracker() {
  const search = Route.useSearch()
  const navigate = useNavigate()

  const windowParams = useMemo<WindowParams>(
    () => ({ window: search.window, from: search.from, to: search.to }),
    [search.window, search.from, search.to],
  )

  function handleWindowChange(value: string) {
    void navigate({
      to: '/strength-tracker',
      search: {
        window: value as SearchParams['window'],
        tab: search.tab,
      },
    })
  }

  function handleDateRange([from, to]: [string | null, string | null]) {
    void navigate({
      to: '/strength-tracker',
      search: {
        window: search.window,
        tab: search.tab,
        ...(from !== null ? { from } : undefined),
        ...(to !== null ? { to } : undefined),
      },
    })
  }

  function handleTabChange(tab: string | null) {
    if (tab === 'workouts' || tab === 'bodyweight') {
      void navigate({
        to: '/strength-tracker',
        search: {
          window: search.window,
          tab,
          ...(search.from !== undefined ? { from: search.from } : undefined),
          ...(search.to !== undefined ? { to: search.to } : undefined),
        },
      })
    }
  }

  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Title order={2}>Strength Tracker</Title>
        <Group>
          <SegmentedControl
            value={search.window}
            onChange={handleWindowChange}
            size="xs"
            data={[
              { label: '7D', value: '7d' },
              { label: '30D', value: '30d' },
              { label: '90D', value: '90d' },
              { label: 'All', value: 'all' },
            ]}
          />
          <DatePickerInput
            type="range"
            placeholder="Custom range"
            value={[search.from ?? null, search.to ?? null]}
            onChange={handleDateRange}
            clearable
            size="xs"
          />
        </Group>
      </Group>

      <Tabs value={search.tab} onChange={handleTabChange}>
        <Tabs.List mb="md">
          <Tabs.Tab value="workouts">Workouts</Tabs.Tab>
          <Tabs.Tab value="bodyweight">Body Weight</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="workouts">
          {search.tab === 'workouts' && <WorkoutsPanel windowParams={windowParams} />}
        </Tabs.Panel>

        <Tabs.Panel value="bodyweight">
          {search.tab === 'bodyweight' && <BodyWeightPanel windowParams={windowParams} />}
        </Tabs.Panel>
      </Tabs>
    </Stack>
  )
}
