/**
 * The Flow tab: the verdict, then three columns of node cards (Supply, Router, Demand, joined by a thin
 * chevron rule), the selected node's detail at full width below and Athena apart at the foot. The
 * selection is `?node=`; on a phone one column stacks the cards and the detail opens directly under
 * the node that was tapped.
 */
import { Suspense } from 'react'
import { SimpleGrid, Stack } from '@mantine/core'
import { useSizeClass } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { CONTAINER_KEYS } from 'basalt-ui/tokens'
import type { Range } from '../../lib/queries/usage'
import { usageStore } from '../../lib/window-stores'
import { AthenaSection } from './athena-section'
import { DemandColumn } from './demand-column'
import { FlowBoundary } from './flow-boundary'
import { parseNode, toggleNode } from './flow-node'
import { NodeDetail } from './node-detail'
import { RouterColumn } from './router-column'
import { SupplyColumn } from './supply-column'
import { VerdictBand } from './verdict-band'

export function FlowTab({ range, node }: { range: Range; node: string }) {
  const compact = useSizeClass() === 'compact'
  const [, setNode] = usageStore.field.node.use()
  const selected = parseNode(node)
  const select = (value: string) => setNode(toggleNode(node, value))

  const detail =
    selected === null ? null : (
      <FlowBoundary noun="the node detail" height={300}>
        <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={300} />}>
          <NodeDetail key={node} node={selected} range={range} />
        </Suspense>
      </FlowBoundary>
    )
  const slot = { node: selected, detail: compact ? detail : null }

  return (
    <Stack gap="xl">
      <FlowBoundary noun="the credit verdict" height={520}>
        <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={520} />}>
          <VerdictBand />
        </Suspense>
      </FlowBoundary>
      <SimpleGrid type="container" cols={{ base: 1, [CONTAINER_KEYS.wide]: 3 }} spacing="md">
        <SupplyColumn slot={slot} onSelect={select} />
        <RouterColumn range={range} slot={slot} onSelect={select} />
        <DemandColumn range={range} slot={slot} onSelect={select} />
      </SimpleGrid>
      {compact ? null : detail}
      <AthenaSection range={range} />
    </Stack>
  )
}
