import { createFileRoute } from '@tanstack/react-router'
import { Suspense } from 'react'
import { Grid, Stack } from '@mantine/core'
import { PageBar, Section } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { FilterSet, MultiSelectFilter, SelectFilter } from 'basalt-ui/controls'
import { usageQueries } from '../lib/queries/usage'
import { usageStore } from '../lib/window-stores'
import { HeroStats } from '../features/usage-tracking/hero-stats'
import CostOverTime from '../features/usage-tracking/charts/cost-over-time'
import TokensOverTime from '../features/usage-tracking/charts/tokens-over-time'
import CacheHitRatio from '../features/usage-tracking/charts/cache-hit-ratio'
import ErrorRate from '../features/usage-tracking/charts/error-rate'
import LatencyP95 from '../features/usage-tracking/charts/latency-p95'
import BillingSplit from '../features/usage-tracking/charts/billing-split'
import TopProjects from '../features/usage-tracking/charts/top-projects'

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
        <HeroStats />

        <Section title="Cost">
          <Grid>
            <Grid.Col span={{ base: 12, lg: 8 }}>
              <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={280} />}>
                <CostOverTime {...tsBase} groupBy={search.costGroupBy} />
              </Suspense>
            </Grid.Col>
            <Grid.Col span={{ base: 12, lg: 4 }}>
              <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={280} />}>
                <BillingSplit range={search.range} workspace={workspace} />
              </Suspense>
            </Grid.Col>
          </Grid>
        </Section>

        <Section title="Volume">
          <Grid>
            <Grid.Col span={{ base: 12, lg: 8 }}>
              <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={280} />}>
                <TokensOverTime {...tsBase} groupBy={search.tokensGroupBy} />
              </Suspense>
            </Grid.Col>
            <Grid.Col span={{ base: 12, lg: 4 }}>
              <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={240} />}>
                <CacheHitRatio {...tsBase} />
              </Suspense>
            </Grid.Col>
          </Grid>
        </Section>

        <Section title="Health">
          <Grid>
            <Grid.Col span={{ base: 12, lg: 6 }}>
              <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={240} />}>
                <ErrorRate {...tsBase} />
              </Suspense>
            </Grid.Col>
            <Grid.Col span={{ base: 12, lg: 6 }}>
              <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={240} />}>
                <LatencyP95 {...tsBase} />
              </Suspense>
            </Grid.Col>
          </Grid>
        </Section>

        <Section title="Top projects">
          <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={280} />}>
            <TopProjects range={search.range} billing={billing} workspace={workspace} />
          </Suspense>
        </Section>
      </Stack>
    </>
  )
}
