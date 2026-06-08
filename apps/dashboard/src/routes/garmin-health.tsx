import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Suspense, useCallback, useMemo, useState } from 'react'
import { Grid, Group, SimpleGrid, Stack } from '@mantine/core'
import { z } from 'zod'
import { HoverContext, type HoverCtx } from '@argo/charts'
import {
  HeroStats,
  Section,
  SyncControl,
  WindowSelector,
  presetToParams,
  type SummaryParams,
  type WindowPreset,
} from '../features/garmin-health'
import { PageActions } from '../components/app-shell/page-header'
import ActivitiesChart from '../features/garmin-health/charts/activities-chart'
import ActivityScoreChart from '../features/garmin-health/charts/activity-score-chart'
import AcwrChart from '../features/garmin-health/charts/acwr-chart'
import BodyBatteryChart from '../features/garmin-health/charts/body-battery-chart'
import DivergenceChart from '../features/garmin-health/charts/divergence-chart'
import FitnessTrendsChart from '../features/garmin-health/charts/fitness-trends-chart'
import RecoveryTrendChart from '../features/garmin-health/charts/recovery-trend-chart'
import SleepBreakdownChart from '../features/garmin-health/charts/sleep-breakdown-chart'
import StressChart from '../features/garmin-health/charts/stress-chart'
import {
  fitnessDirectionQueries,
  recoveryQueries,
  trainingLoadQueries,
} from '../lib/queries/daily-metrics'

function ChartFallback({ height = 320 }: { height?: number }) {
  return <div style={{ height, width: '100%' }} />
}

// ── Search params ──────────────────────────────────────────────────────────

const PresetEnum = z.enum(['7d', '30d', '3m', '1y', 'all'])

const SearchSchema = z.object({
  window: PresetEnum.default('30d'),
  from: z.string().optional(),
  to: z.string().optional(),
})

type SearchParams = z.infer<typeof SearchSchema>

// ── Route definition ───────────────────────────────────────────────────────

export const Route = createFileRoute('/garmin-health')({
  validateSearch: (raw: Record<string, unknown>) => SearchSchema.parse(raw),
  loaderDeps: ({ search }: { search: SearchParams }) => ({
    window: search.window,
    from: search.from,
    to: search.to,
  }),
  loader: ({ context, deps }) => {
    const params = resolveParams(deps)
    // Prefetch the three hero-card queries; charts prefetch their own data.
    return Promise.all([
      context.queryClient.ensureQueryData(recoveryQueries.summary(params)),
      context.queryClient.ensureQueryData(fitnessDirectionQueries.summary(params)),
      context.queryClient.ensureQueryData(trainingLoadQueries.summary(params)),
    ])
  },
  component: GarminHealthPage,
})

function resolveParams(search: SearchParams): SummaryParams {
  if (search.from !== undefined && search.to !== undefined) {
    return { from: search.from, to: search.to }
  }
  return presetToParams(search.window)
}

// ── Page component ─────────────────────────────────────────────────────────

function GarminHealthPage() {
  const search = Route.useSearch()
  const navigate = useNavigate()

  const params = useMemo<SummaryParams>(() => resolveParams(search), [search])

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
        to: '/garmin-health',
        search: { window: preset, from: undefined, to: undefined },
      })
    },
    [navigate],
  )

  const handleRangeChange = useCallback(
    (from: string | undefined, to: string | undefined) => {
      void navigate({
        to: '/garmin-health',
        search: { window: search.window, from, to },
      })
    },
    [navigate, search.window],
  )

  return (
    <HoverContext.Provider value={hoverCtx}>
      {/* Page controls live in the shared top-bar slot; the breadcrumb names the page. */}
      <PageActions>
        <Group gap="sm" wrap="nowrap">
          <SyncControl />
          <WindowSelector
            preset={search.window}
            from={search.from}
            to={search.to}
            onPresetChange={handlePresetChange}
            onRangeChange={handleRangeChange}
          />
        </Group>
      </PageActions>

      <Stack gap="md">
        {/* Hero composite cards */}
        <HeroStats params={params} />

        {/* Section 1: Activity & Fitness */}
        <Section title="Activity & Fitness">
          <Suspense fallback={<ChartFallback height={240} />}>
            <ActivitiesChart params={params} />
          </Suspense>
          <Grid>
            <Grid.Col span={{ base: 12, lg: 6 }}>
              <Suspense fallback={<ChartFallback />}>
                <ActivityScoreChart params={params} />
              </Suspense>
            </Grid.Col>
            <Grid.Col span={{ base: 12, lg: 6 }}>
              <Suspense fallback={<ChartFallback />}>
                <FitnessTrendsChart params={params} />
              </Suspense>
            </Grid.Col>
          </Grid>
        </Section>

        {/* Section 2: Training Load */}
        <Section title="Training Load">
          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
            <Suspense fallback={<ChartFallback />}>
              <AcwrChart params={params} />
            </Suspense>
            <Suspense fallback={<ChartFallback />}>
              <DivergenceChart params={params} />
            </Suspense>
          </SimpleGrid>
        </Section>

        {/* Section 3: Recovery & Sleep */}
        <Section title="Recovery & Sleep">
          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
            <Suspense fallback={<ChartFallback />}>
              <RecoveryTrendChart params={params} />
            </Suspense>
            <Suspense fallback={<ChartFallback />}>
              <SleepBreakdownChart params={params} />
            </Suspense>
          </SimpleGrid>
        </Section>

        {/* Section 4: Energy & Stress */}
        <Section title="Energy & Stress">
          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
            <Suspense fallback={<ChartFallback />}>
              <BodyBatteryChart params={params} />
            </Suspense>
            <Suspense fallback={<ChartFallback />}>
              <StressChart params={params} />
            </Suspense>
          </SimpleGrid>
        </Section>
      </Stack>
    </HoverContext.Provider>
  )
}
