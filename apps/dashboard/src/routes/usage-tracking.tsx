import { createFileRoute } from '@tanstack/react-router'
import { Suspense } from 'react'
import { Box, Grid, Stack } from '@mantine/core'
import { PageBar } from 'basalt-ui'
import { CONTAINER_GRID_BREAKPOINTS } from 'basalt-ui/tokens'
import { ChartCard } from 'basalt-ui/charts'
import { FilterSet, MultiSelectFilter, SelectFilter } from 'basalt-ui/controls'
import { accountsOfPayers } from '../features/usage-tracking/accounts'
import { usageQueries } from '../lib/queries/usage'
import { isFiltered, printTotal, stripCoversRange } from '../features/usage-tracking/model'
import { usageStore } from '../lib/window-stores'
import { useUsageHeadline } from '../features/usage-tracking/use-headline'
import { UsageStrip } from '../features/usage-tracking/usage-strip'
import { UsageHeadline } from '../features/usage-tracking/page-headline'
import CostChart from '../features/usage-tracking/cost-chart'
import TokensChart from '../features/usage-tracking/tokens-chart'
import ClaudeAccounts from '../features/usage-tracking/claude-accounts'
import HealthCard from '../features/usage-tracking/health-card'
import classes from '../features/usage-tracking/usage.module.css'
import TopProjects from '../features/usage-tracking/top-projects'

export const Route = createFileRoute('/usage-tracking')({
  validateSearch: usageStore.validateSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(
      usageQueries.headline(deps.payer.length > 0 ? [...deps.payer] : undefined),
    ),
  component: UsageTrackingPage,
})

function UsageTrackingPage() {
  const search = usageStore.useValues()

  // An EMPTY multi selection means "no constraint" on the URL, and the API wants the key absent
  // rather than an empty array — the one translation the store deliberately does not make, because
  // "empty means every row" is this API's convention, not a store law.
  const payer = search.payer.length > 0 ? [...search.payer] : undefined
  const workspace = search.workspace.length > 0 ? [...search.workspace] : undefined
  const filtered = isFiltered(payer, workspace)
  // The same (shot-substituted) headline the strip reads; it speaks for the charts only inside its 30 d.
  const stripEmpty = useUsageHeadline(payer).data?.calls30d === 0 && stripCoversRange(search.range)
  const showTotal = printTotal({ range: search.range, filtered })
  const tsBase = { range: search.range, grain: search.grain, payer, workspace }

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
            <MultiSelectFilter field={usageStore.field.payer} label="All payers" noun="payers" />
          </FilterSet>
        }
      />

      <Stack gap="md">
        <UsageHeadline payer={payer} />
        <UsageStrip payer={payer} />

        <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={280} />}>
          <CostChart
            {...tsBase}
            leading
            stripEmpty={stripEmpty}
            groupBy={search.costGroupBy}
            printTotal={showTotal}
          />
        </Suspense>

        <ClaudeAccounts range={search.range} account={accountsOfPayers(payer)} />

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
                  payer={payer}
                  workspace={workspace}
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
