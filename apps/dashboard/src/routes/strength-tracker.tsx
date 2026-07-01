import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Suspense, useCallback, useMemo, useState } from 'react'
import { Grid, Group, SimpleGrid, Stack } from '@mantine/core'
import { z } from 'zod'
import { HoverContext, type HoverCtx } from '@argo/charts'
import { PageActions } from '../components/app-shell/page-header'
import {
  ChartSkeleton,
  DEFAULT_EXERCISES,
  EmptyState,
  ExerciseFilter,
  ExerciseSummaryCards,
  RecentRecords,
  Section,
  TimerCard,
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
import { workoutsQueries } from '../lib/queries/workouts'

// ── Search params ──────────────────────────────────────────────────────────

const PresetEnum = z.enum(['7d', '30d', '3m', '6m', '1y', 'ytd', 'all'])
const ViewEnum = z.enum(['charts', 'train', 'history'])

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
      {/* Page controls live in the shared top-bar slot; the breadcrumb names the page. */}
      <PageActions>
        <Group gap="sm" wrap="nowrap">
          <ViewTabs value={search.tab} onChange={handleTabChange} />
          <WindowSelector
            preset={search.window}
            from={search.from}
            to={search.to}
            onPresetChange={handlePresetChange}
            onRangeChange={handleRangeChange}
          />
          <ExerciseFilter active={activeExercises} onToggle={handleExerciseToggle} />
        </Group>
      </PageActions>

      <Stack gap="md">
        <Grid>
          <Grid.Col span={{ base: 12, lg: 8 }}>
            {search.tab === 'train' ? (
              <TrainingTools
                params={queryParams}
                hasWorkouts={hasWorkouts}
                multiExercise={activeExercises.length > 1}
              />
            ) : !hasWorkouts ? (
              <EmptyState />
            ) : (
              <>
                {search.tab === 'charts' && (
                  <ChartsPanel params={queryParams} activeExercises={activeExercises} />
                )}
                {search.tab === 'history' && (
                  <Suspense fallback={<ChartSkeleton height={320} />}>
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
              multiExercise={activeExercises.length > 1}
            />
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
      <Suspense fallback={<ChartSkeleton height={420} />}>
        <SparklineGridChart params={params} />
      </Suspense>

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
  // Default to the strength-direction leader, but only if it has enough sessions
  // to actually draw a trend (the trailing ZMA needs ≥3 entries). A fast-rising
  // lift logged once or twice would otherwise default to a blank chart. Both
  // queries are prefetched in the loader, so this hits the cache.
  const { data: heroes } = useSuspenseQuery(strengthQueries.heroes(params))
  const { data: sparks } = useSuspenseQuery(strengthQueries.sparklines(params))
  const initial = useMemo(() => {
    const sessions = new Map(sparks.byExercise.map((r) => [r.exercise_id, r.e1rm.length]))
    const enough = (ex: string) => (sessions.get(ex) ?? 0) >= 3
    const leader = heroes.strengthDirection.leaderExercise
    if (leader !== null && enough(leader)) return leader
    const mostData = [...activeExercises].toSorted(
      (a, b) => (sessions.get(b) ?? 0) - (sessions.get(a) ?? 0),
    )[0]
    return mostData ?? activeExercises[0] ?? 'bench_press'
  }, [sparks, heroes, activeExercises])
  return <StrengthCompositeChart params={params} exerciseId={initial} />
}

function ExerciseSummaryCardsSlot() {
  const search = Route.useSearch()
  const windowParams = useMemo<SummaryParams>(() => resolveWindow(search), [search])
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
      <Suspense fallback={<ChartSkeleton height={320} />}>
        <WorkoutForm />
      </Suspense>
      <TimerCard />
      {hasWorkouts && <RecentRecords params={params} multiExercise={multiExercise} />}
    </Stack>
  )
}
