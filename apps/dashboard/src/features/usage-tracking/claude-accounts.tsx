import { Suspense } from 'react'
import { Grid, Stack } from '@mantine/core'
import { Section } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { CONTAINER_GRID_BREAKPOINTS } from 'basalt-ui/tokens'
import type { Range } from '../../lib/queries/usage'
import { LanePicksTable, PicksChart } from './picks-panel'
import QuotaChart from './quota-chart'

/**
 * Quota history and picker balancing for the Claude accounts. The charts sit in the same 8-column
 * cell as the spend chart above, on the same time axis, so a quota climb reads against the spend behind it.
 */
export default function ClaudeAccounts({
  range,
  account,
}: {
  range: Range
  account?: string[] | undefined
}) {
  return (
    <Section title="Claude accounts">
      <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Stack gap="md">
            <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={280} />}>
              <QuotaChart range={range} account={account} />
            </Suspense>
            <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={200} />}>
              <PicksChart range={range} />
            </Suspense>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={200} />}>
            <LanePicksTable range={range} />
          </Suspense>
        </Grid.Col>
      </Grid>
    </Section>
  )
}
