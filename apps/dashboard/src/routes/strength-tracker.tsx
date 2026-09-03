import { createFileRoute } from '@tanstack/react-router'
import { Suspense, useMemo } from 'react'
import { Card, Grid, SimpleGrid, Stack } from '@mantine/core'
import { IconBarbell } from '@tabler/icons-react'
import { EmptyState, PageBar, Section } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { FilterSet, MultiSelectFilter, RangeFilter, ViewTabs } from 'basalt-ui/controls'
import { DateRangePicker } from 'basalt-ui/controls-dates'
import { strengthStore, toApiWindow } from '../lib/window-stores'
import {
  DEFAULT_EXERCISES,
  ExerciseSummaryCards,
  RecentRecords,
  TimerCard,
  WorkoutForm,
  WorkoutsTable,
  type ExerciseKey,
} from '../features/strength-tracker'
import AlignmentMatrixChart from '../features/strength-tracker/charts/alignment-matrix-chart'
import InolChart from '../features/strength-tracker/charts/inol-chart'
import MomentumChart from '../features/strength-tracker/charts/momentum-chart'
import OneRmTrendChart from '../features/strength-tracker/charts/one-rm-trend-chart'
import ReadinessStrainChart from '../features/strength-tracker/charts/readiness-strain-chart'
import RelativeProgressionChart from '../features/strength-tracker/charts/relative-progression-chart'
import SparklineGridChart from '../features/strength-tracker/charts/sparkline-grid-chart'
import StrengthCompositeChart from '../features/strength-tracker/charts/strength-composite-chart'
import StrengthRatiosChart from '../features/strength-tracker/charts/strength-ratios-chart'
import TrainingLoadChart from '../features/strength-tracker/charts/training-load-chart'
import WeeklyVolumeChart from '../features/strength-tracker/charts/weekly-volume-chart'
import { useSuspenseQuery } from '@tanstack/react-query'
import { exerciseQueries } from '../lib/queries/exercises'
import { strengthQueries, type StrengthQueryParams } from '../lib/queries/strength'
import { workoutsQueries } from '../lib/queries/workouts'
import { useGymSync } from '../lib/queries/gym'
import { useWorkoutDraftSync } from '../lib/queries/workout-draft'

/**
 * An EMPTY selection is the multi field's way of saying "no constraint", and every strength query
 * wants the full set instead — so the page substitutes the default four. The API takes them as one
 * comma-separated string; the URL carries them as an array.
 */
function activeExercises(selected: ReadonlyArray<ExerciseKey>): ReadonlyArray<ExerciseKey> {
  return selected.length > 0 ? selected : DEFAULT_EXERCISES
}

// ── Route definition ───────────────────────────────────────────────────────

export const Route = createFileRoute('/strength-tracker')({
  validateSearch: strengthStore.validateSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => {
    // `3m`/`6m`/`1y`/`ytd` are the four presets the backend's `WindowQuerySchema` refuses; the
    // field's own `window:` resolvers turn them into `from`/`to`. `toApiWindow` folds only the
    // unreachable dateless-`custom` branch onto the field's fallback.
    const windowParams = toApiWindow(
      strengthStore.field.window.toWindow({ preset: deps.window, from: deps.from, to: deps.to }),
      'all',
    )
    const params = { ...windowParams, exercises: activeExercises(deps.exercises).join(',') }

    const base: Promise<unknown>[] = [
      context.queryClient.ensureQueryData(strengthQueries.heroes(params)),
      context.queryClient.ensureQueryData(exerciseQueries.list()),
      context.queryClient.ensureQueryData(workoutsQueries.list({ page: 1, limit: 20 })),
    ]

    if (deps.tab === 'history') {
      base.push(context.queryClient.ensureQueryData(workoutsQueries.list({ page: 1, limit: 50 })))
    } else if (deps.tab === 'charts') {
      base.push(context.queryClient.ensureQueryData(workoutsQueries.summaryStrength(windowParams)))
      base.push(context.queryClient.ensureQueryData(strengthQueries.sparklines(params)))
    }

    return Promise.all(base)
  },
  component: StrengthTrackerPage,
})

// ── Page component ─────────────────────────────────────────────────────────

function StrengthTrackerPage() {
  const search = strengthStore.useValues()

  // Single owner of the gym-config poll — every `useGyms` consumer below reads
  // the cache it fills. Mounting this more than once multiplies the request rate.
  useGymSync()
  useWorkoutDraftSync()

  const windowParams = toApiWindow(
    strengthStore.field.window.toWindow({
      preset: search.window,
      from: search.from,
      to: search.to,
    }),
    'all',
  )
  const exercises = activeExercises(search.exercises)
  const queryParams = { ...windowParams, exercises: exercises.join(',') }

  // Total workout count drives the page-level empty state. The list query is
  // already prefetched in the loader, so this hits the cache.
  const { data: workoutsList } = useSuspenseQuery(workoutsQueries.list({ page: 1, limit: 20 }))
  const hasWorkouts = workoutsList.total > 0

  return (
    <>
      <PageBar
        tabs={
          // `only: 'sm-down'` is how the phone-only Train tab is declared — the desktop track
          // shows two segments, the phone track three, one mount, CSS-only swap (law C9). The
          // page's own `tab === 'train'` branch below still runs on desktop if a URL says so:
          // the control cannot coerce the value, and silently rewriting it would fight the link.
          <ViewTabs
            field={strengthStore.field.tab}
            label="View"
            options={[
              { value: 'train', label: 'Train', only: 'sm-down' },
              { value: 'charts', label: 'Charts' },
              { value: 'history', label: 'History' },
            ]}
          />
        }
        filters={
          <FilterSet>
            <RangeFilter field={strengthStore.field.window} customPicker={DateRangePicker} />
            <MultiSelectFilter
              field={strengthStore.field.exercises}
              label="All exercises"
              noun="lifts"
            />
          </FilterSet>
        }
      />

      <Stack gap="md">
        <Grid>
          <Grid.Col span={{ base: 12, lg: 8 }}>
            {search.tab === 'train' ? (
              <TrainingTools
                params={queryParams}
                hasWorkouts={hasWorkouts}
                multiExercise={exercises.length > 1}
              />
            ) : !hasWorkouts ? (
              <Card py="xs" px="sm">
                <EmptyState
                  icon={<IconBarbell size={28} stroke={1.5} />}
                  title="No workouts yet"
                  description="Log your first workout to see your strength dashboard come to life."
                />
              </Card>
            ) : (
              <>
                {search.tab === 'charts' && (
                  <ChartsPanel params={queryParams} activeExercises={exercises} />
                )}
                {search.tab === 'history' && (
                  <Suspense
                    fallback={<ChartCard state={{ pending: true }} placeholderHeight={320} />}
                  >
                    <WorkoutsTable />
                  </Suspense>
                )}
              </>
            )}
          </Grid.Col>

          {/* Right rail — desktop/tablet only; on phones it moves to the Train tab. */}
          <Grid.Col span={{ base: 12, lg: 4 }} visibleFrom="sm">
            <TrainingTools
              params={queryParams}
              hasWorkouts={hasWorkouts}
              multiExercise={exercises.length > 1}
            />
          </Grid.Col>
        </Grid>
      </Stack>
    </>
  )
}

function ChartsPanel({
  params,
  activeExercises,
}: {
  params: StrengthQueryParams
  activeExercises: ReadonlyArray<ExerciseKey>
}) {
  return (
    <Stack gap="md">
      <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={420} />}>
        <SparklineGridChart params={params} />
      </Suspense>

      <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={120} />}>
        <ExerciseSummaryCardsSlot />
      </Suspense>

      <Section
        title="Strength Trajectory"
        subtitle="Am I getting stronger on the lifts I care about?"
      >
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={320} />}>
            <OneRmTrendChart params={params} />
          </Suspense>
          <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={320} />}>
            <CompositeChartSlot params={params} activeExercises={activeExercises} />
          </Suspense>
        </SimpleGrid>
      </Section>

      <Section title="Load Quality" subtitle="Am I loading smart or just hard?">
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={320} />}>
            <WeeklyVolumeChart params={params} />
          </Suspense>
          <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={320} />}>
            <TrainingLoadChart params={params} />
          </Suspense>
        </SimpleGrid>
      </Section>

      <Section title="Efficiency & Momentum" subtitle="Are my sessions producing quality work?">
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={320} />}>
            <InolChart params={params} />
          </Suspense>
          <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={320} />}>
            <MomentumChart params={params} />
          </Suspense>
        </SimpleGrid>
      </Section>

      <Section title="Balance" subtitle="Are my lifts proportional?">
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={320} />}>
            <RelativeProgressionChart params={params} />
          </Suspense>
          <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={320} />}>
            <StrengthRatiosChart params={params} />
          </Suspense>
        </SimpleGrid>
      </Section>

      <Section title="Readiness" subtitle="Is today a push, sustain, or rest day?">
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={320} />}>
            <ReadinessStrainChart params={params} />
          </Suspense>
          <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={320} />}>
            <AlignmentMatrixChart params={params} />
          </Suspense>
        </SimpleGrid>
      </Section>
    </Stack>
  )
}

function CompositeChartSlot({
  params,
  activeExercises,
}: {
  params: StrengthQueryParams
  activeExercises: ReadonlyArray<ExerciseKey>
}) {
  // Default to the strength-direction leader, but only if it has enough sessions
  // to actually draw a trend (the trailing ZMA needs ≥3 entries). A fast-rising
  // lift logged once or twice would otherwise default to a blank chart. Both
  // queries are prefetched in the loader, so this hits the cache.
  const { data: heroes } = useSuspenseQuery(strengthQueries.heroes(params))
  const { data: sparks } = useSuspenseQuery(strengthQueries.sparklines(params))
  const initial = useMemo<ExerciseKey>(() => {
    const sessions = new Map(sparks.byExercise.map((r) => [r.exercise_id, r.e1rm.length]))
    const enough = (ex: string) => (sessions.get(ex) ?? 0) >= 3
    // Matched against the ACTIVE set rather than taken raw: the API types `leaderExercise` as a
    // bare string, and a leader the exercise filter has hidden is not one the chart's own select
    // offers — it would render a lift with no matching option.
    const leader = activeExercises.find((e) => e === heroes.strengthDirection.leaderExercise)
    if (leader !== undefined && enough(leader)) return leader
    const mostData = [...activeExercises].toSorted(
      (a, b) => (sessions.get(b) ?? 0) - (sessions.get(a) ?? 0),
    )[0]
    return mostData ?? activeExercises[0] ?? 'bench_press'
  }, [sparks, heroes, activeExercises])
  return <StrengthCompositeChart params={params} exerciseId={initial} />
}

function ExerciseSummaryCardsSlot() {
  const search = strengthStore.useValues()
  const windowParams = toApiWindow(
    strengthStore.field.window.toWindow({
      preset: search.window,
      from: search.from,
      to: search.to,
    }),
    'all',
  )
  return <ExerciseSummaryCards params={windowParams} />
}

// Workout logger + rest/interval timer + recent PRs. Rendered in the desktop
// right rail and, on phones, under the Train tab (the rail is hidden there).
function TrainingTools({
  params,
  hasWorkouts,
  multiExercise,
}: {
  params: StrengthQueryParams
  hasWorkouts: boolean
  multiExercise: boolean
}) {
  return (
    <Stack gap="md">
      <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={320} />}>
        <WorkoutForm />
      </Suspense>
      <TimerCard />
      {hasWorkouts && <RecentRecords params={params} multiExercise={multiExercise} />}
    </Stack>
  )
}
