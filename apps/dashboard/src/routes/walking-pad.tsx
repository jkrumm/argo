import { Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Grid, SimpleGrid, Skeleton, Stack } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { PageBar } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { FilterSet, RangeFilter } from 'basalt-ui/controls'
import { CONTAINER_GRID_BREAKPOINTS, CONTAINER_KEYS as CQ } from 'basalt-ui/tokens'
import { walkingStore } from '../lib/window-stores'
import {
  AchievementsList,
  DistanceChart,
  EmptyWindow,
  HistoryTable,
  HourGrid,
  RecordHeader,
  SummaryLine,
  WalkingStrip,
  WeekChart,
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
      context.queryClient.ensureQueryData(walkingPadQueries.summary(params)),
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
  const summary = useQuery(walkingPadQueries.summary(params))

  // Toast + confetti on new achievement unlocks. Side-effect hook.
  useAchievementWatcher()

  // An empty window renders the record header and one empty-state row, nothing else: no strip of
  // zeros and no empty chart cards. Pending is not empty, so the first paint waits for the count.
  const empty = summary.data?.sessions === 0

  return (
    <>
      <PageBar
        filters={
          <FilterSet>
            <RangeFilter field={walkingStore.field.window} />
          </FilterSet>
        }
      />

      <Stack gap="md">
        {!empty && <SummaryLine params={params} />}
        <RecordHeader />
        {summary.isPending ? (
          <Skeleton height={160} radius="md" />
        ) : empty ? (
          <EmptyWindow />
        ) : (
          <>
            <WalkingStrip params={params} />
            <WeekChart params={params} />
            <SimpleGrid type="container" cols={{ base: 1, [CQ.wide]: 2 }} spacing="md">
              <DistanceChart params={params} />
              <HourGrid params={params} />
            </SimpleGrid>
            <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
              <Grid.Col span={{ base: 12, lg: 8 }}>
                <Suspense
                  fallback={<ChartCard state={{ pending: true }} placeholderHeight={420} />}
                >
                  <HistoryTable />
                </Suspense>
              </Grid.Col>
              <Grid.Col span={{ base: 12, lg: 4 }}>
                <AchievementsList />
              </Grid.Col>
            </Grid>
          </>
        )}
      </Stack>
    </>
  )
}
