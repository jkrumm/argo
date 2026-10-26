import { createFileRoute } from '@tanstack/react-router'
import { Suspense } from 'react'
import { Grid, Stack } from '@mantine/core'
import { PageBar } from 'basalt-ui'
import { CONTAINER_GRID_BREAKPOINTS } from 'basalt-ui/tokens'
import { ChartCard } from 'basalt-ui/charts'
import { FilterSet, MultiSelectFilter, SelectFilter, ViewTabs } from 'basalt-ui/controls'
import { scopePayers } from '../features/usage-tracking/budget-model'
import { usageQueries } from '../lib/queries/usage'
import { usageStore } from '../lib/window-stores'
import { TopBand } from '../features/usage-tracking/top-band'
import { WhereOverTime } from '../features/usage-tracking/where-over-time'
import TopSpenders from '../features/usage-tracking/top-spenders'
import CacheEfficiency from '../features/usage-tracking/cache-efficiency'
import Reconciliation from '../features/usage-tracking/reconciliation'
import Projects from '../features/usage-tracking/projects'
import Routing from '../features/usage-tracking/picks-panel'
import Reliability from '../features/usage-tracking/reliability'

export const Route = createFileRoute('/usage-tracking')({
  validateSearch: usageStore.validateSearch,
  // The IU cap is the first thing the top band paints; everything below streams behind Suspense.
  loader: ({ context }) => context.queryClient.ensureQueryData(usageQueries.iuBudget()),
  component: UsageTrackingPage,
})

function UsageTrackingPage() {
  const search = usageStore.useValues()

  // The payer scope replaces the old payer multi-filter: the page speaks API spend by default and
  // adds the subscriptions (list value) only on request. `undefined` means every payer, and an EMPTY
  // workspace selection means "no constraint": the API wants the key absent rather than an empty array.
  const payer = scopePayers(search.scope)
  const workspace = search.workspace.length > 0 ? [...search.workspace] : undefined
  const sections = { range: search.range, lens: search.lens, scope: search.scope, workspace }

  return (
    <>
      <PageBar
        tabs={<ViewTabs field={usageStore.field.lens} label="Lens" />}
        filters={
          <FilterSet>
            <SelectFilter field={usageStore.field.range} label="Range" />
            <SelectFilter field={usageStore.field.grain} label="Grain" />
            <MultiSelectFilter
              field={usageStore.field.workspace}
              label="All workspaces"
              noun="workspaces"
            />
            <SelectFilter field={usageStore.field.scope} label="Payer scope" />
          </FilterSet>
        }
      />

      <Stack gap="md">
        <TopBand />

        <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={280} />}>
          <WhereOverTime
            range={search.range}
            grain={search.grain}
            lens={search.lens}
            scope={search.scope}
            groupBy={search.groupBy}
            workspace={workspace}
          />
        </Suspense>

        <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
          <Grid.Col span={{ base: 12, lg: 6 }}>
            <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={320} />}>
              <TopSpenders {...sections} />
            </Suspense>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 6 }}>
            <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={320} />}>
              <CacheEfficiency {...sections} />
            </Suspense>
          </Grid.Col>
        </Grid>

        <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={420} />}>
          <Reconciliation />
        </Suspense>

        <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={240} />}>
          <Projects {...sections} />
        </Suspense>

        <Routing range={search.range} />

        <Reliability
          range={search.range}
          sourceScope={search.sourceScope}
          payer={payer}
          workspace={workspace}
        />
      </Stack>
    </>
  )
}
