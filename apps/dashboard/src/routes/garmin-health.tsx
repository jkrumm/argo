import { createFileRoute } from '@tanstack/react-router'
import { Suspense } from 'react'
import { Box, SimpleGrid, Stack } from '@mantine/core'
import { PageBar, Section } from 'basalt-ui'
import { CONTAINER_KEYS as CQ } from 'basalt-ui/tokens'
import { ChartCard } from 'basalt-ui/charts'
import { FilterSet, RangeFilter } from 'basalt-ui/controls'
import { DateRangePicker } from 'basalt-ui/controls-dates'
import { garminStore, toApiWindow } from '../lib/window-stores'
import {
  GapLedgerProvider,
  SummaryLine,
  GarminStrip,
  useGarminSync,
} from '../features/garmin-health'
import { fitnessRange } from '../features/garmin-health/model'
import ActivitiesChart from '../features/garmin-health/charts/activities-chart'
import ActivityScoreChart from '../features/garmin-health/charts/activity-score-chart'
import AcwrChart from '../features/garmin-health/charts/acwr-chart'
import BodyBatteryChart from '../features/garmin-health/charts/body-battery-chart'
import RecoveryTrendChart from '../features/garmin-health/charts/recovery-trend-chart'
import SleepBreakdownChart from '../features/garmin-health/charts/sleep-breakdown-chart'
import StressChart from '../features/garmin-health/charts/stress-chart'
import {
  fitnessDirectionQueries,
  recoveryQueries,
  trainingLoadQueries,
} from '../lib/queries/daily-metrics'

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
    // Prefetch the strip's three queries; charts prefetch their own data. Fitness reads a fixed
    // 14-day window, so the loader warms that exact key rather than the page window's.
    return Promise.all([
      context.queryClient.ensureQueryData(recoveryQueries.summary(params)),
      context.queryClient.ensureQueryData(fitnessDirectionQueries.summary(fitnessRange())),
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

      <GapLedgerProvider>
        <Stack gap="md">
          <SummaryLine params={params} />
          <Box data-shot="strip" data-shot-states="empty">
            <GarminStrip params={params} />
          </Box>

          <Section title="Training load">
            <Box data-shot="acwr-chart" data-shot-states="empty">
              <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={320} />}>
                <AcwrChart params={params} />
              </Suspense>
            </Box>
          </Section>

          <Section title="Recovery, sleep and stress">
            <SimpleGrid type="container" cols={{ base: 1, [CQ.wide]: 2 }} spacing="md">
              <Box data-shot="recovery-chart" data-shot-states="empty">
                <Suspense
                  fallback={<ChartCard state={{ pending: true }} placeholderHeight={320} />}
                >
                  <RecoveryTrendChart params={params} />
                </Suspense>
              </Box>
              <Box data-shot="sleep-chart" data-shot-states="empty">
                <Suspense
                  fallback={<ChartCard state={{ pending: true }} placeholderHeight={320} />}
                >
                  <SleepBreakdownChart params={params} />
                </Suspense>
              </Box>
              <Box data-shot="body-battery-chart" data-shot-states="empty">
                <Suspense
                  fallback={<ChartCard state={{ pending: true }} placeholderHeight={320} />}
                >
                  <BodyBatteryChart params={params} />
                </Suspense>
              </Box>
              <Box data-shot="stress-chart" data-shot-states="empty">
                <Suspense
                  fallback={<ChartCard state={{ pending: true }} placeholderHeight={320} />}
                >
                  <StressChart params={params} />
                </Suspense>
              </Box>
            </SimpleGrid>
          </Section>

          <Section title="Training volume">
            <Box data-shot="activities-chart" data-shot-states="empty">
              <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={240} />}>
                <ActivitiesChart params={params} />
              </Suspense>
            </Box>
            <Box data-shot="activity-score-chart" data-shot-states="empty">
              <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={320} />}>
                <ActivityScoreChart params={params} />
              </Suspense>
            </Box>
          </Section>
        </Stack>
      </GapLedgerProvider>
    </>
  )
}
