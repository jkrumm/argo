import { Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Grid, SimpleGrid, Stack } from '@mantine/core'
import { useElementSize, useMediaQuery } from '@mantine/hooks'
import { PageBar, Section } from 'basalt-ui'
import { FilterSet, MultiSelectFilter, RangeFilter } from 'basalt-ui/controls'
import { walkingStore } from '../lib/window-stores'
import {
  AchievementsGallery,
  ChartSkeleton,
  DailyActivityChart,
  HeroStats,
  HeroStatsSkeleton,
  LengthHistogramChart,
  LiveCard,
  LiveCardSkeleton,
  PaceTrendChart,
  SessionHistoryTable,
  SparklineGridChart,
  TimeOfDayChart,
  WeeklyVolumeChart,
  useAchievementWatcher,
} from '../features/walking-pad'
import { walkingPadQueries } from '../lib/queries/walking-pad'

export const Route = createFileRoute('/walking-pad')({
  validateSearch: walkingStore.validateSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => {
    // The field declares no `custom`, and its `window:` resolvers turn `6m`/`1y` — the two presets
    // the backend refuses — into `from`/`to`, so `toWindow` IS the whole projection here.
    const params = walkingStore.field.window.toWindow({
      preset: deps.window,
      from: deps.from,
      to: deps.to,
    })
    return Promise.all([
      context.queryClient.ensureQueryData(walkingPadQueries.heroes(params)),
      context.queryClient.ensureQueryData(walkingPadQueries.list({ page: 1, limit: 1 })),
      // Don't await live — it polls anyway, no need to block first paint.
    ])
  },
  component: WalkingPadPage,
})

function WalkingPadPage() {
  const search = walkingStore.useValues()
  const params = walkingStore.field.window.toWindow({
    preset: search.window,
    from: search.from,
    to: search.to,
  })

  // Toast + confetti on new achievement unlocks. Side-effect hook.
  useAchievementWatcher()

  // Mirror the left column's height into the achievements card on lg+ so the
  // two columns line up. Below lg the columns stack — the prop drops back to
  // undefined and the gallery uses its own default scroll height.
  const { ref: leftColRef, height: leftColHeight } = useElementSize<HTMLDivElement>()
  const isLg = useMediaQuery('(min-width: 75em)')
  const matchHeight = isLg === true && leftColHeight > 0 ? leftColHeight : undefined

  // Same trick for the bottom row: the (capped) history card drives the
  // time-of-day heatmap so the two cards line up at lg+. Below lg the
  // columns stack and `bottomMatchHeight` drops back to undefined.
  const { ref: historyRef, height: historyHeight } = useElementSize<HTMLDivElement>()
  const bottomMatchHeight = isLg === true && historyHeight > 0 ? historyHeight : undefined

  return (
    <>
      <PageBar
        filters={
          <FilterSet>
            <RangeFilter field={walkingStore.field.window} />
            <MultiSelectFilter
              field={walkingStore.field.metrics}
              label="All metrics"
              noun="metrics"
            />
          </FilterSet>
        }
      />

      <Stack gap="md">
        <Grid>
          <Grid.Col span={{ base: 12, lg: 8 }}>
            <Stack gap="md" ref={leftColRef}>
              <Suspense fallback={<LiveCardSkeleton />}>
                <LiveCard />
              </Suspense>
              <Suspense fallback={<HeroStatsSkeleton />}>
                <HeroStats params={params} />
              </Suspense>
              <Suspense fallback={<ChartSkeleton height={200} />}>
                <SparklineGridChart params={params} />
              </Suspense>
            </Stack>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <Suspense fallback={<ChartSkeleton height={320} />}>
              <AchievementsGallery matchHeight={matchHeight} />
            </Suspense>
          </Grid.Col>
        </Grid>

        <Section title="Daily rhythm" subtitle="How is each day adding up?">
          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
            <Suspense fallback={<ChartSkeleton />}>
              <DailyActivityChart params={params} />
            </Suspense>
            <Suspense fallback={<ChartSkeleton />}>
              <PaceTrendChart params={params} />
            </Suspense>
          </SimpleGrid>
        </Section>

        <Section title="Volume" subtitle="Am I keeping the habit alive week to week?">
          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
            <Suspense fallback={<ChartSkeleton />}>
              <WeeklyVolumeChart params={params} />
            </Suspense>
            <Suspense fallback={<ChartSkeleton height={280} />}>
              <LengthHistogramChart params={params} />
            </Suspense>
          </SimpleGrid>
        </Section>

        <Grid>
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <Section title="Patterns" subtitle="When do I tend to walk?">
              <Suspense fallback={<ChartSkeleton height={240} />}>
                <TimeOfDayChart params={params} matchHeight={bottomMatchHeight} />
              </Suspense>
            </Section>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 8 }}>
            <Section title="History" subtitle="Every closed session, newest first.">
              <div ref={historyRef}>
                <Suspense fallback={<ChartSkeleton height={420} />}>
                  <SessionHistoryTable />
                </Suspense>
              </div>
            </Section>
          </Grid.Col>
        </Grid>
      </Stack>
    </>
  )
}
