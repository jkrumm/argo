import { createFileRoute } from '@tanstack/react-router'
import { Suspense } from 'react'
import { Grid, Stack } from '@mantine/core'
import { PageBar } from 'basalt-ui'
import { CONTAINER_GRID_BREAKPOINTS } from 'basalt-ui/tokens'
import { ChartCard } from 'basalt-ui/charts'
import { FilterSet, MultiSelectFilter, SelectFilter, ViewTabs } from 'basalt-ui/controls'
import { usageQueries } from '../lib/queries/usage'
import { usageStore } from '../lib/window-stores'
import { Headline } from '../features/usage-tracking/headline'
import IuDetail from '../features/usage-tracking/iu-detail'
import { Limits } from '../features/usage-tracking/limits'
import { OverTime } from '../features/usage-tracking/over-time'
import RankedList from '../features/usage-tracking/ranked-list'

export const Route = createFileRoute('/usage-tracking')({
  validateSearch: usageStore.validateSearch,
  // The limits are the first thing the page paints; everything below streams behind Suspense.
  loader: ({ context }) => context.queryClient.ensureQueryData(usageQueries.iuBudget()),
  component: UsageTrackingPage,
})

function UsageTrackingPage() {
  const search = usageStore.useValues()
  // An EMPTY workspace selection means "no constraint": the API wants the key absent, not `[]`.
  const workspace = search.workspace.length > 0 ? [...search.workspace] : undefined
  const common = { range: search.range, lens: search.lens, scope: search.scope, workspace }

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
        <Limits />

        <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={120} />}>
          <Headline range={search.range} scope={search.scope} workspace={workspace} />
        </Suspense>

        <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={300} />}>
          <OverTime {...common} grain={search.grain} groupBy={search.groupBy} />
        </Suspense>

        <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
          <Grid.Col span={{ base: 12, lg: 6 }}>
            <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={320} />}>
              <RankedList dimension="project" {...common} />
            </Suspense>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 6 }}>
            <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={320} />}>
              <RankedList dimension="tool" {...common} />
            </Suspense>
          </Grid.Col>
        </Grid>

        <IuDetail range={search.range} lens={search.lens} workspace={workspace} />
      </Stack>
    </>
  )
}
