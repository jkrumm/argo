import { createFileRoute } from '@tanstack/react-router'
import { Suspense } from 'react'
import { Box, Grid, SimpleGrid, Stack } from '@mantine/core'
import { PageBar, Section } from 'basalt-ui'
import { FilterSet, RangeFilter } from 'basalt-ui/controls'
import { DateRangePicker } from 'basalt-ui/controls-dates'
import { garminStore, toApiWindow } from '../lib/window-stores'
import { HeroStats, useGarminSync } from '../features/garmin-health'
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
  return <Box h={height} w="100%" />
}

// ── Route definition ───────────────────────────────────────────────────────

export const Route = createFileRoute('/garmin-health')({
  // One store owns the window: `validateSearch` resolves URL ⊳ localStorage ⊳ fallback, and
  // `lib/nav.tsx`'s link reads the same store — so the two cannot disagree about what opens.
  validateSearch: garminStore.validateSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => {
    // `3m`/`1y` are the two presets the backend's `WindowQuerySchema` refuses; the field's own
    // `window:` resolvers turn them into `from`/`to` here. `toApiWindow` folds only the unreachable
    // dateless-`custom` branch onto the field's fallback.
    const params = toApiWindow(
      garminStore.field.window.toWindow({ preset: deps.window, from: deps.from, to: deps.to }),
      '30d',
    )
    // Prefetch the three hero-card queries; charts prefetch their own data.
    return Promise.all([
      context.queryClient.ensureQueryData(recoveryQueries.summary(params)),
      context.queryClient.ensureQueryData(fitnessDirectionQueries.summary(params)),
      context.queryClient.ensureQueryData(trainingLoadQueries.summary(params)),
    ])
  },
  component: GarminHealthPage,
})

// ── Page component ─────────────────────────────────────────────────────────

function GarminHealthPage() {
  const search = garminStore.useValues()
  const params = toApiWindow(
    garminStore.field.window.toWindow({ preset: search.window, from: search.from, to: search.to }),
    '30d',
  )
  const sync = useGarminSync()

  return (
    <>
      <PageBar
        sync={sync}
        filters={
          <FilterSet>
            <RangeFilter field={garminStore.field.window} customPicker={DateRangePicker} />
          </FilterSet>
        }
      />

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
    </>
  )
}
