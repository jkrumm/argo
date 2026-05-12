import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Suspense, useCallback, useMemo, useState } from 'react'
import { Grid, Group, SimpleGrid, Stack, Title } from '@mantine/core'
import { z } from 'zod'
import { HoverContext, type HoverCtx } from '@argo/charts'
import {
  BodyWeightPanel,
  DEFAULT_EXERCISES,
  DeloadBanner,
  ExerciseFilter,
  ExerciseSummaryCards,
  HeroStats,
  Placeholder,
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
import { exerciseQueries } from '../lib/queries/exercises'
import { strengthQueries } from '../lib/queries/strength'
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

function ChartFallback({ height = 320 }: { height?: number }) {
  return <div style={{ height, width: '100%' }} />
}

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

        <Suspense fallback={<ChartFallback height={120} />}>
          <HeroStats params={queryParams} />
        </Suspense>

        <Grid>
          <Grid.Col span={{ base: 12, lg: 8 }}>
            {search.tab === 'charts' && <ChartsPanel />}
            {search.tab === 'scan' && <ScanPanel />}
            {search.tab === 'history' && (
              <Suspense fallback={<ChartFallback height={320} />}>
                <WorkoutsTable />
              </Suspense>
            )}
            {search.tab === 'body-weight' && (
              <Suspense fallback={<ChartFallback height={320} />}>
                <BodyWeightPanel params={windowParams} />
              </Suspense>
            )}
          </Grid.Col>

          {/* Right rail */}
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <Stack gap="md">
              <Suspense fallback={<ChartFallback height={320} />}>
                <WorkoutForm />
              </Suspense>
              <RecentRecords params={queryParams} multiExercise={activeExercises.length > 1} />
            </Stack>
          </Grid.Col>
        </Grid>
      </Stack>
    </HoverContext.Provider>
  )
}

function ChartsPanel() {
  return (
    <Stack gap="md">
      <Suspense fallback={<ChartFallback height={120} />}>
        <ExerciseSummaryCardsSlot />
      </Suspense>

      <Section title="Strength Trajectory">
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Placeholder label="1RM Trend Chart" />
          <Placeholder label="Strength Composite Chart" />
        </SimpleGrid>
      </Section>

      <Section title="Load Quality">
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Placeholder label="Weekly Volume Chart" />
          <Placeholder label="Training Load Chart" />
        </SimpleGrid>
      </Section>

      <Section title="Efficiency & Momentum">
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Placeholder label="INOL Chart" />
          <Placeholder label="Momentum Chart" />
        </SimpleGrid>
      </Section>

      <Section title="Balance">
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Placeholder label="Relative Progression Chart" />
          <Placeholder label="Strength Ratios Chart" />
        </SimpleGrid>
      </Section>

      <Section title="Readiness">
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Placeholder label="Readiness Strain Chart" />
          <Placeholder label="Training Recovery Alignment Chart" />
        </SimpleGrid>
      </Section>
    </Stack>
  )
}

function ScanPanel() {
  return (
    <Stack gap="md">
      <Placeholder label="Sparkline Grid (Scan View)" height={420} />
    </Stack>
  )
}

function ExerciseSummaryCardsSlot() {
  const search = Route.useSearch()
  const windowParams = useMemo<SummaryParams>(() => resolveWindow(search), [search])
  return <ExerciseSummaryCards params={windowParams} />
}
