import { createFileRoute } from '@tanstack/react-router'
import { Suspense } from 'react'
import { Box, Grid, Stack } from '@mantine/core'
import { PageBar } from 'basalt-ui'
import { CONTAINER_GRID_BREAKPOINTS } from 'basalt-ui/tokens'
import { ChartCard } from 'basalt-ui/charts'
import { FilterSet, MultiSelectFilter, SelectFilter } from 'basalt-ui/controls'
import { usageQueries } from '../lib/queries/usage'
import { printTotal } from '../features/usage-tracking/model'
import { usageStore } from '../lib/window-stores'
import { UsageStrip } from '../features/usage-tracking/usage-strip'
import { UsageHeadline } from '../features/usage-tracking/page-headline'
import CostChart from '../features/usage-tracking/cost-chart'
import TokensChart from '../features/usage-tracking/tokens-chart'
import HealthCard from '../features/usage-tracking/health-card'
import TopProjects from '../features/usage-tracking/top-projects'

export const Route = createFileRoute('/usage-tracking')({
  validateSearch: usageStore.validateSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ context }) => context.queryClient.ensureQueryData(usageQueries.headline()),
  component: UsageTrackingPage,
})

function UsageTrackingPage() {
  const search = usageStore.useValues()

  // An EMPTY multi selection means "no constraint" on the URL, and the API wants the key absent
  // rather than an empty array — the one translation the store deliberately does not make, because
  // "empty means every row" is this API's convention, not a store law.
  const billing = search.billing.length > 0 ? [...search.billing] : undefined
  const workspace = search.workspace.length > 0 ? [...search.workspace] : undefined
  const filtered = billing !== undefined || workspace !== undefined
  const showTotal = printTotal({ range: search.range, filtered })
  const tsBase = { range: search.range, grain: search.grain, billing, workspace }

  return (
    <>
      <PageBar
        filters={
          <FilterSet>
            <SelectFilter field={usageStore.field.range} label="Range" />
            <SelectFilter field={usageStore.field.grain} label="Grain" />
            <MultiSelectFilter
              field={usageStore.field.workspace}
              label="All workspaces"
              noun="workspaces"
            />
            <MultiSelectFilter
              field={usageStore.field.billing}
              label="All billing"
              noun="billing lanes"
            />
          </FilterSet>
        }
      />

      <Stack gap="md">
        <UsageHeadline />
        <UsageStrip />

        <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={280} />}>
          <CostChart {...tsBase} groupBy={search.costGroupBy} printTotal={showTotal} />
        </Suspense>

        <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={280} />}>
          <TokensChart {...tsBase} groupBy={search.tokensGroupBy} printTotal={showTotal} />
        </Suspense>

        <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
          <Grid.Col span={{ base: 12, lg: 8 }}>
            <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={240} />}>
              <Box data-shot="health">
                <HealthCard {...tsBase} />
              </Box>
            </Suspense>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={240} />}>
              <Box data-shot="projects">
                <TopProjects
                  range={search.range}
                  billing={billing}
                  workspace={workspace}
                  printTotal={showTotal}
                />
              </Box>
            </Suspense>
          </Grid.Col>
        </Grid>
      </Stack>
    </>
  )
}
