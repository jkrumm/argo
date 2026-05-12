import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Suspense, useCallback, useMemo, useState } from 'react'
import { Grid, Group, SimpleGrid, Stack, Title } from '@mantine/core'
import { z } from 'zod'
import { HoverContext, type HoverCtx } from '@argo/charts'
import {
  BodyWeightPanel,
  ChartSkeleton,
  DEFAULT_EXERCISES,
  DeloadBanner,
  EmptyState,
  ExerciseFilter,
  ExerciseSummaryCards,
  HeroStats,
  HeroStatsSkeleton,
  RecentRecords,
  Section,
  ViewTabs,
  WindowSelector,
  WorkoutForm,
  WorkoutsTable,
  presetToParams,
  type ExerciseKey,
  type StrengthView,
  type SummaryParams,
  type WindowPreset,
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
import { weightLogQueries } from '../lib/queries/weight-log'
import { workoutsQueries } from '../lib/queries/workouts'

// ── Search params ──────────────────────────────────────────────────────────

const PresetEnum = z.enum(['7d', '30d', '3m', '6m', '1y', 'ytd', 'all'])
const ViewEnum = z.enum(['charts', 'scan', 'history', 'body-weight'])

const SearchSchema = z.object({
  window: PresetEnum.default('all'),
  from: z.string().optional(),
  to: z.string().optional(),
  tab: ViewEnum.default('charts'),
  exercises: z.string().default('bench_press,deadlift,squat,pull_ups'),
})

type SearchParams = z.infer<typeof SearchSchema>

function resolveWindow(search: SearchParams): SummaryParams {
  if (search.from !== undefined && search.to !== undefined) {
    return { from: search.from, to: search.to }
  }
  return presetToParams(search.window)
}

// ── Route definition ───────────────────────────────────────────────────────

export const Route = createFileRoute('/strength-tracker')({
  validateSearch: (raw: Record<string, unknown>) => SearchSchema.parse(raw),
  loaderDeps: ({ search }: { search: SearchParams }) => ({
    window: search.window,
    from: search.from,
    to: search.to,
    tab: search.tab,
    exercises: search.exercises,
  }),
  loader: ({ context, deps }) => {
    const windowParams = resolveWindow(deps as SearchParams)
    const params = { ...windowParams, exercises: deps.exercises }

    const base: Promise<unknown>[] = [
      context.queryClient.ensureQueryData(strengthQueries.heroes(params)),
      context.queryClient.ensureQueryData(exerciseQueries.list()),
      context.queryClient.ensureQueryData(workoutsQueries.list({ page: 1, limit: 20 })),
    ]

    if (deps.tab === 'body-weight') {
      base.push(context.queryClient.ensureQueryData(weightLogQueries.summary(windowParams)))
    } else if (deps.tab === 'history') {
      base.push(context.queryClient.ensureQueryData(workoutsQueries.list({ page: 1, limit: 50 })))
    } else if (deps.tab === 'charts') {
      base.push(context.queryClient.ensureQueryData(workoutsQueries.summaryStrength(windowParams)))
    }

    return Promise.all(base)
  },
  component: StrengthTrackerPage,
})

// ── Page component ─────────────────────────────────────────────────────────

function StrengthTrackerPage() {
  const search = Route.useSearch()
  const navigate = useNavigate()

  const windowParams = useMemo<SummaryParams>(() => resolveWindow(search), [search])
  const queryParams = useMemo(
    () => ({ ...windowParams, exercises: search.exercises }),
    [windowParams, search.exercises],
  )

  const activeExercises = useMemo<ReadonlyArray<ExerciseKey>>(() => {
    const tokens = search.exercises
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is ExerciseKey => DEFAULT_EXERCISES.includes(s as ExerciseKey))
    return tokens.length > 0 ? tokens : DEFAULT_EXERCISES
  }, [search.exercises])

  // Cross-chart hover sync
  const [hoverState, setHoverState] = useState<{ date: string | null; source: string | null }>({
    date: null,
    source: null,
  })
  const setHover = useCallback((date: string | null, source: string | null) => {
    setHoverState({ date, source })
  }, [])
  const hoverCtx = useMemo<HoverCtx>(() => ({ ...hoverState, setHover }), [hoverState, setHover])

  const handlePresetChange = useCallback(
    (preset: WindowPreset) => {
      void navigate({
        to: '/strength-tracker',
        search: {
          window: preset,
          from: undefined,
          to: undefined,
          tab: search.tab,
          exercises: search.exercises,
        },
      })
    },
    [navigate, search.tab, search.exercises],
  )

  const handleRangeChange = useCallback(
    (from: string | undefined, to: string | undefined) => {
      void navigate({
        to: '/strength-tracker',
        search: {
          window: search.window,
          from,
          to,
          tab: search.tab,
          exercises: search.exercises,
        },
      })
    },
    [navigate, search.window, search.tab, search.exercises],
  )

  const handleTabChange = useCallback(
    (next: StrengthView) => {
      void navigate({
        to: '/strength-tracker',
        search: {
          window: search.window,
          from: search.from,
          to: search.to,
          tab: next,
          exercises: search.exercises,
        },
      })
    },
    [navigate, search.window, search.from, search.to, search.exercises],
  )

  const handleExerciseToggle = useCallback(
    (ex: ExerciseKey) => {
      const next = activeExercises.includes(ex)
        ? activeExercises.filter((e) => e !== ex)
        : [...activeExercises, ex]
      const value = next.length > 0 ? next.join(',') : DEFAULT_EXERCISES.join(',')
      void navigate({
        to: '/strength-tracker',
        search: {
          window: search.window,
          from: search.from,
          to: search.to,
          tab: search.tab,
          exercises: value,
        },
      })
    },
    [activeExercises, navigate, search.window, search.from, search.to, search.tab],
  )

  // Total workout count drives the page-level empty state. The list query is
  // already prefetched in the loader, so this hits the cache.
  const { data: workoutsList } = useSuspenseQuery(workoutsQueries.list({ page: 1, limit: 20 }))
  const hasWorkouts = workoutsList.total > 0

  return (
    <HoverContext.Provider value={hoverCtx}>
      <Stack gap="md">
        {/* Header */}
        <Group justify="space-between" wrap="wrap" gap="sm">
          <Group gap="sm">
            <Title order={2}>Strength Tracker</Title>
            <ViewTabs value={search.tab} onChange={handleTabChange} />
          </Group>
          <Group gap="sm" wrap="wrap">
            <WindowSelector
              preset={search.window}
              from={search.from}
              to={search.to}
              onPresetChange={handlePresetChange}
              onRangeChange={handleRangeChange}
            />
            <ExerciseFilter active={activeExercises} onToggle={handleExerciseToggle} />
          </Group>
        </Group>

        <DeloadBanner exercises={search.exercises} />

        {hasWorkouts && (
          <Suspense fallback={<HeroStatsSkeleton />}>
            <HeroStats params={queryParams} />
          </Suspense>
        )}

        <Grid>
          <Grid.Col span={{ base: 12, lg: 8 }}>
            {!hasWorkouts ? (
              <EmptyState />
            ) : (
              <>
                {search.tab === 'charts' && (
                  <ChartsPanel params={queryParams} activeExercises={activeExercises} />
                )}
                {search.tab === 'scan' && <ScanPanel params={queryParams} />}
                {search.tab === 'history' && (
                  <Suspense fallback={<ChartSkeleton height={320} />}>
                    <WorkoutsTable />
                  </Suspense>
                )}
                {search.tab === 'body-weight' && (
                  <Suspense fallback={<ChartSkeleton height={320} />}>
                    <BodyWeightPanel params={windowParams} />
                  </Suspense>
                )}
              </>
            )}
          </Grid.Col>

          {/* Right rail */}
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <Stack gap="md">
              <Suspense fallback={<ChartSkeleton height={320} />}>
                <WorkoutForm />
              </Suspense>
              {hasWorkouts && (
                <RecentRecords params={queryParams} multiExercise={activeExercises.length > 1} />
              )}
            </Stack>
          </Grid.Col>
        </Grid>
      </Stack>
    </HoverContext.Provider>
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
      <Suspense fallback={<ChartSkeleton height={120} />}>
        <ExerciseSummaryCardsSlot />
      </Suspense>

      <Section
        title="Strength Trajectory"
        subtitle="Am I getting stronger on the lifts I care about?"
      >
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Suspense fallback={<ChartSkeleton />}>
            <OneRmTrendChart params={params} />
          </Suspense>
          <Suspense fallback={<ChartSkeleton />}>
            <CompositeChartSlot params={params} activeExercises={activeExercises} />
          </Suspense>
        </SimpleGrid>
      </Section>

      <Section title="Load Quality" subtitle="Am I loading smart or just hard?">
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Suspense fallback={<ChartSkeleton />}>
            <WeeklyVolumeChart params={params} />
          </Suspense>
          <Suspense fallback={<ChartSkeleton />}>
            <TrainingLoadChart params={params} />
          </Suspense>
        </SimpleGrid>
      </Section>

      <Section title="Efficiency & Momentum" subtitle="Are my sessions producing quality work?">
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Suspense fallback={<ChartSkeleton />}>
            <InolChart params={params} />
          </Suspense>
          <Suspense fallback={<ChartSkeleton />}>
            <MomentumChart params={params} />
          </Suspense>
        </SimpleGrid>
      </Section>

      <Section title="Balance" subtitle="Are my lifts proportional?">
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Suspense fallback={<ChartSkeleton />}>
            <RelativeProgressionChart params={params} />
          </Suspense>
          <Suspense fallback={<ChartSkeleton />}>
            <StrengthRatiosChart params={params} />
          </Suspense>
        </SimpleGrid>
      </Section>

      <Section title="Readiness" subtitle="Is today a push, sustain, or rest day?">
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Suspense fallback={<ChartSkeleton />}>
            <ReadinessStrainChart params={params} />
          </Suspense>
          <Suspense fallback={<ChartSkeleton />}>
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
  // Pull the strength-direction leader from heroes (already prefetched + cached);
  // fall back to the first active exercise.
  const { data: heroes } = useSuspenseQuery(strengthQueries.heroes(params))
  const leader = heroes.strengthDirection.leaderExercise ?? activeExercises[0] ?? 'bench_press'
  return <StrengthCompositeChart params={params} exerciseId={leader} />
}

function ScanPanel({ params }: { params: StrengthQueryParams }) {
  return (
    <Stack gap="md">
      <Suspense fallback={<ChartSkeleton height={420} />}>
        <SparklineGridChart params={params} />
      </Suspense>
    </Stack>
  )
}

function ExerciseSummaryCardsSlot() {
  const search = Route.useSearch()
  const windowParams = useMemo<SummaryParams>(() => resolveWindow(search), [search])
  return <ExerciseSummaryCards params={windowParams} />
}
