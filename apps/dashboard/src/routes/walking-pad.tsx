import { Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Grid, SimpleGrid, Stack } from '@mantine/core'
import { useElementSize } from '@mantine/hooks'
import { PageBar, Section } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { FilterSet, MultiSelectFilter, RangeFilter } from 'basalt-ui/controls'
import { walkingStore } from '../lib/window-stores'
import {
  AchievementsGallery,
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
import { CONTAINER_WIDE, CQ_COMPACT, CQ_REGULAR, CQ_WIDE } from '../lib/container-grid'

// Grid.Col spans resolve through this map; basalt/raw-breakpoint only trusts a same-file literal.
const GRID_BREAKPOINTS = { xs: CQ_COMPACT, sm: CQ_REGULAR, md: CQ_WIDE, lg: CQ_WIDE, xl: CQ_WIDE }

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

  // Mirror the left column's height into the achievements card while the grids sit side by side
  // (their own width at the `wide` container class — the same key their `lg` spans resolve
  // through). Stacked, the prop drops back to undefined and the gallery uses its own default
  // scroll height.
  const { ref: pageRef, width: pageWidth } = useElementSize<HTMLDivElement>()
  const sideBySide = pageWidth >= CONTAINER_WIDE
  const { ref: leftColRef, height: leftColHeight } = useElementSize<HTMLDivElement>()
  const matchHeight = sideBySide && leftColHeight > 0 ? leftColHeight : undefined

  // Same trick for the bottom row: the (capped) history card drives the
  // time-of-day heatmap so the two cards line up side by side; stacked,
  // `bottomMatchHeight` drops back to undefined.
  const { ref: historyRef, height: historyHeight } = useElementSize<HTMLDivElement>()
  const bottomMatchHeight = sideBySide && historyHeight > 0 ? historyHeight : undefined

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

      <Stack gap="md" ref={pageRef}>
        <Grid type="container" breakpoints={GRID_BREAKPOINTS}>
          <Grid.Col span={{ base: 12, lg: 8 }}>
            <Stack gap="md" ref={leftColRef}>
              <Suspense fallback={<LiveCardSkeleton />}>
                <LiveCard />
              </Suspense>
              <Suspense fallback={<HeroStatsSkeleton />}>
                <HeroStats params={params} />
              </Suspense>
              <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={200} />}>
                <SparklineGridChart params={params} />
              </Suspense>
            </Stack>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={320} />}>
              <AchievementsGallery matchHeight={matchHeight} />
            </Suspense>
          </Grid.Col>
        </Grid>

        <Section title="Daily rhythm" subtitle="How is each day adding up?">
          <SimpleGrid type="container" cols={{ base: 1, [CQ_WIDE]: 2 }} spacing="md">
            <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={320} />}>
              <DailyActivityChart params={params} />
            </Suspense>
            <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={320} />}>
              <PaceTrendChart params={params} />
            </Suspense>
          </SimpleGrid>
        </Section>

        <Section title="Volume" subtitle="Am I keeping the habit alive week to week?">
          <SimpleGrid type="container" cols={{ base: 1, [CQ_WIDE]: 2 }} spacing="md">
            <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={320} />}>
              <WeeklyVolumeChart params={params} />
            </Suspense>
            <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={280} />}>
              <LengthHistogramChart params={params} />
            </Suspense>
          </SimpleGrid>
        </Section>

        <Grid type="container" breakpoints={GRID_BREAKPOINTS}>
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <Section title="Patterns" subtitle="When do I tend to walk?">
              <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={240} />}>
                <TimeOfDayChart params={params} matchHeight={bottomMatchHeight} />
              </Suspense>
            </Section>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 8 }}>
            <Section title="History" subtitle="Every closed session, newest first.">
              <div ref={historyRef}>
                <Suspense
                  fallback={<ChartCard state={{ pending: true }} placeholderHeight={420} />}
                >
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
