/**
 * The Insights strip under the verdict: three to five ranked observations, each one sentence that names
 * a number and opens the node it is about (`?node=`). Facts by rules (`/usage/insights`), never by a
 * model; thin ones say so. Empty reads "Nothing stands out" only when every source was read; otherwise
 * the strip names what could not be.
 */
import { useSuspenseQuery } from '@tanstack/react-query'
import { Anchor, Group, Stack, Text } from '@mantine/core'
import { ChartCard } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { usageQueries, type Range } from '../../lib/queries/usage'
import { usageStore } from '../../lib/window-stores'
import { insightsPeriodOf, insightsView } from './flow-model'
import { parseNode } from './flow-node'

const INFO =
  'Observations by rules over the same figures as the columns below: the biggest share, the biggest mover against the previous period, a seat or route change, a fallback to IU, a cache-hit drop, a cap approaching. Ranked by the money they move; each opens its node. One that rests on under a day of gateway data is marked thin.'

export function InsightsStrip({ range }: { range: Range }) {
  const period = insightsPeriodOf(range)
  const { data } = useSuspenseQuery(usageQueries.insights(period))
  const [, setNode] = usageStore.field.node.use()
  const view = insightsView(data)

  return (
    <ChartCard
      title={`What stands out · ${period === '7d' ? '7 d' : '30 d'}`}
      info={INFO}
      placeholderHeight="content"
    >
      <Stack gap="xs" data-shot="flow-insights">
        {view.items.map((item) => {
          const target = parseNode(item.node) === null ? null : item.node
          return (
            <Group key={item.id} gap="xs" wrap="nowrap" align="baseline">
              <Text size="sm" c="dimmed" ff="monospace" w={16}>
                {item.rank}
              </Text>
              {target === null ? (
                <Text size="sm">{item.sentence}</Text>
              ) : (
                <Anchor
                  component="button"
                  type="button"
                  size="sm"
                  ta="left"
                  onClick={() => setNode(target)}
                >
                  {item.sentence}
                </Anchor>
              )}
              {item.thin ? (
                <Text size="xs" c="dimmed" span>
                  thin
                </Text>
              ) : null}
            </Group>
          )
        })}
        {view.note === null ? null : (
          <Text
            size="sm"
            {...(data.unavailable.length > 0 ? { c: VX.status.warn } : { c: 'dimmed' })}
          >
            {view.note}
          </Text>
        )}
      </Stack>
    </ChartCard>
  )
}
