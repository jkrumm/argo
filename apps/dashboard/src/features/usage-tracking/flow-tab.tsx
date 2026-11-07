/**
 * The Quotas tab (`view=flow`): how much of each quota is left and whether it will last. A verdict
 * sentence, then four cards in one chart form (Claude subscriptions, Claude API credit, the IU personal
 * key, the Athena team key), then the closed "Routing and demand" disclosure that follows the page Range.
 * The cards are state ("now") and ignore Range.
 */
import { Suspense } from 'react'
import { Stack } from '@mantine/core'
import { ChartCard } from 'basalt-ui/charts'
import type { Range } from '../../lib/queries/usage'
import { FlowBoundary } from './flow-boundary'
import { QuotasSection } from './quotas-section'
import { RoutingSection } from './routing-section'
import { VerdictBand } from './verdict-band'

export function FlowTab({ range, node }: { range: Range; node: string }) {
  return (
    <Stack gap="xl">
      <FlowBoundary noun="the quota verdict" height={120}>
        <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={120} />}>
          <VerdictBand />
        </Suspense>
      </FlowBoundary>
      <QuotasSection />
      <RoutingSection range={range} node={node} />
    </Stack>
  )
}
