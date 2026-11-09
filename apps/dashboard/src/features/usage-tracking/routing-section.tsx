/**
 * The Quotas tab's closed-by-default disclosure: the Router and Demand columns, the selected node's
 * detail and the Athena producer list. Unlike the cards above, these follow the page Range. The queries
 * mount only once it is opened; selecting a node (`?node=`) opens it, so a deep link never lands on a
 * closed panel.
 */
import { Suspense, useState } from 'react'
import { Accordion, SimpleGrid, Stack, Text } from '@mantine/core'
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
import { useField } from '../../lib/use-field'

const PANEL = 'routing'

export function RoutingSection({ range, node }: { range: Range; node: string }) {
  const compact = useSizeClass() === 'compact'
  const [, setNode] = useField(usageStore.field.node)
  const selected = parseNode(node)
  const hasNode = selected !== null
  const [open, setOpen] = useState(hasNode)
  // A node picked later (a link, a click in the page) opens the panel; closing it stays the visitor's.
  const [hadNode, setHadNode] = useState(hasNode)
  if (hasNode !== hadNode) {
    setHadNode(hasNode)
    if (hasNode) setOpen(true)
  }

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
    <Accordion
      variant="separated"
      value={open ? PANEL : null}
      onChange={(value) => setOpen(value === PANEL)}
      data-shot="quotas-routing"
    >
      <Accordion.Item value={PANEL}>
        <Accordion.Control>
          Routing and demand{' '}
          <Text span size="xs" c="dimmed">
            · follows Range
          </Text>
        </Accordion.Control>
        <Accordion.Panel>
          {open ? (
            <Stack gap="xl">
              <SimpleGrid
                type="container"
                cols={{ base: 1, [CONTAINER_KEYS.wide]: 2 }}
                spacing="md"
              >
                <RouterColumn range={range} slot={slot} onSelect={select} />
                <DemandColumn range={range} slot={slot} onSelect={select} />
              </SimpleGrid>
              {compact ? null : detail}
              <AthenaSection range={range} />
            </Stack>
          ) : null}
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  )
}
