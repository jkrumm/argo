import { createFileRoute } from '@tanstack/react-router'
import { Suspense } from 'react'
import { Box, Grid, Stack } from '@mantine/core'
import { PageBar } from 'basalt-ui'
import { CONTAINER_GRID_BREAKPOINTS } from 'basalt-ui/tokens'
import { ChartCard } from 'basalt-ui/charts'
import { FilterSet, MultiSelectFilter, SelectFilter } from 'basalt-ui/controls'
import { usageQueries } from '../lib/queries/usage'
import { isFiltered, printTotal, stripCoversRange } from '../features/usage-tracking/model'
import { usageStore } from '../lib/window-stores'
import { useUsageHeadline } from '../features/usage-tracking/use-headline'
import { UsageStrip } from '../features/usage-tracking/usage-strip'
import { UsageHeadline } from '../features/usage-tracking/page-headline'
import CostChart from '../features/usage-tracking/cost-chart'
import TokensChart from '../features/usage-tracking/tokens-chart'
import HealthCard from '../features/usage-tracking/health-card'
import classes from '../features/usage-tracking/usage.module.css'
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
  const account = search.account.length > 0 ? [...search.account] : undefined
  const filtered = isFiltered(billing, workspace, account)
  // The same (shot-substituted) headline the strip reads; it speaks for the charts only inside its 30 d.
  const stripEmpty = useUsageHeadline().data?.calls30d === 0 && stripCoversRange(search.range)
  const showTotal = printTotal({ range: search.range, filtered })
  const tsBase = { range: search.range, grain: search.grain, billing, workspace, account }

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
            <MultiSelectFilter
              field={usageStore.field.account}
              label="All accounts"
              noun="accounts"
            />
          </FilterSet>
        }
      />

      <Stack gap="md">
        <UsageHeadline />
        <UsageStrip />

        <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={280} />}>
          <CostChart
            {...tsBase}
            leading
            stripEmpty={stripEmpty}
            groupBy={search.costGroupBy}
            printTotal={showTotal}
          />
        </Suspense>

        <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={280} />}>
          <TokensChart
            {...tsBase}
            stripEmpty={stripEmpty}
            groupBy={search.tokensGroupBy}
            printTotal={showTotal}
          />
        </Suspense>

        <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
          <Grid.Col span={{ base: 12, lg: 8 }}>
            <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={240} />}>
              <Box data-shot="health" data-shot-states="empty">
                <HealthCard {...tsBase} stripEmpty={stripEmpty} />
              </Box>
            </Suspense>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={240} />}>
              <Box data-shot="projects" data-shot-states="empty" className={classes.fill}>
                <TopProjects
                  range={search.range}
                  billing={billing}
                  workspace={workspace}
                  account={account}
                  printTotal={showTotal}
                  stripEmpty={stripEmpty}
                />
              </Box>
            </Suspense>
          </Grid.Col>
        </Grid>
      </Stack>
    </>
  )
}
