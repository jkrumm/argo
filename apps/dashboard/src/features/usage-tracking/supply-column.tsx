/**
 * The Flow tab's Supply column: what pays. The credit pools (one row each, a meter of spend against
 * the grant with an even-pace tick), the subscriptions' weekly windows and the IU personal key's cap.
 * All of it is state ("now", the cycle), so none of it follows the page Range. Each row selects its node.
 */
import { Suspense } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Group, Stack, Text } from '@mantine/core'
import { Meter } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { alpha } from 'basalt-ui/tokens'
import { usageQueries } from '../../lib/queries/usage'
import { shotState } from '../../lib/shot-state'
import { useNow } from '../../lib/use-now'
import { USAGE_ACCOUNTS, type AccountId } from './accounts'
import { CapMeter, SubscriptionMeter } from './limits'
import { colorForPayer } from './constants'
import { FlowBoundary } from './flow-boundary'
import { fmtDay, fmtRate, fmtUsd, poolPayer, poolReading, type PoolReading } from './flow-model'
import { keyNode, poolNode, subNode, type FlowNode } from './flow-node'
import classes from './flow.module.css'
import { ColumnHeader, FlowRow, NodeCard } from './flow-parts'
import { under, type NodeSlot } from './flow-slot'

const fallback = (height: number) => (
  <ChartCard state={{ pending: true }} placeholderHeight={height} />
)

/** The share of the payer shade the outside-the-gateway part of a pool bar takes: same hue, lighter. */
const OUTSIDE_ALPHA = 0.45

const POOLS_INFO =
  'The API credit each subscription grants its Console org every cycle (Ultra $200, Max $100): it expires unspent, and the gateway draws on the pool that expires first. The bar is spend of the grant (our meter against the provider’s report, the larger per day); the tick is where an even pace would have it today.'

function PoolRow({
  reading,
  selected,
  onSelect,
}: {
  reading: PoolReading
  selected: boolean
  onSelect: () => void
}) {
  const color = colorForPayer(poolPayer(reading.account))
  const spent = reading.outsideUsd + reading.throughUsd
  return (
    <FlowRow selected={selected} onSelect={onSelect} label={`Open the ${reading.title} detail`}>
      <Stack gap={4}>
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Text size="sm" fw={500}>
            {reading.title}
          </Text>
          <Text size="sm" ff="monospace">
            {reading.leftUsd === null
              ? `${fmtUsd(reading.grantUsd)} / cycle`
              : `${fmtUsd(reading.leftUsd)} left`}
          </Text>
        </Group>
        {reading.enabled ? (
          <Meter
            label={`${reading.title}: ${fmtUsd(spent)} spent of ${fmtUsd(reading.grantUsd)}`}
            segments={[
              {
                value: reading.outsideUsd,
                label: 'spent outside the gateway',
                color: alpha(color, OUTSIDE_ALPHA),
              },
              { value: reading.throughUsd, label: 'through it', color },
            ]}
            max={reading.grantUsd}
            format={fmtUsd}
            size="row"
            {...(reading.evenSpentUsd === null
              ? {}
              : { ticks: [{ at: reading.evenSpentUsd, label: 'even pace today' }] })}
          />
        ) : null}
        <Text size="xs" c="dimmed">
          {reading.line}
        </Text>
      </Stack>
    </FlowRow>
  )
}

function PoolsCard({
  node,
  onSelect,
}: {
  node: FlowNode | null
  onSelect: (value: string) => void
}) {
  const { data } = useSuspenseQuery({ ...usageQueries.pace(), refetchInterval: 5 * 60_000 })
  const readings = data.pools.map((p) => poolReading(p, data.asOf))
  return (
    <ChartCard
      title="Credit pools"
      {...(node?.kind === 'pool' ? { className: classes.selected } : {})}
      info={POOLS_INFO}
      placeholderHeight="content"
      state={{ empty: readings.length === 0 && 'No credit pool on record' }}
    >
      <Stack gap="xs" data-shot="flow-pools">
        {readings.map((r) => {
          const value = poolNode(r.account as AccountId)
          return (
            <PoolRow
              key={r.account}
              reading={r}
              selected={node?.kind === 'pool' && node.account === r.account}
              onSelect={() => onSelect(value)}
            />
          )
        })}
        <Text size="xs" c="dimmed">
          tick: even pace today
        </Text>
      </Stack>
    </ChartCard>
  )
}

function SubscriptionsCard({
  node,
  onSelect,
}: {
  node: FlowNode | null
  onSelect: (value: string) => void
}) {
  const { data } = useSuspenseQuery(usageQueries.quotaLatest())
  const now = useNow()
  const samples = shotState() === 'empty' ? [] : data.accounts
  return (
    <ChartCard
      title="Subscriptions · weekly window"
      {...(node?.kind === 'sub' ? { className: classes.selected } : {})}
      info="Claude Code's 5 h and weekly windows per subscription; they never pass through the gateway. The tick is the share of the week already elapsed."
      placeholderHeight="content"
    >
      <Stack gap="xs" data-shot="flow-subscriptions" data-shot-states="empty">
        {USAGE_ACCOUNTS.map((a) => (
          <FlowRow
            key={a.id}
            selected={node?.kind === 'sub' && node.account === a.id}
            onSelect={() => onSelect(subNode(a.id))}
            label={`Open the ${a.label} subscription detail`}
          >
            <SubscriptionMeter
              account={a.id}
              sample={samples.find((s) => s.account === a.id)}
              now={now}
            />
          </FlowRow>
        ))}
      </Stack>
    </ChartCard>
  )
}

function KeyCard({ node, onSelect }: { node: FlowNode | null; onSelect: (value: string) => void }) {
  const { data: budget } = useSuspenseQuery(usageQueries.iuBudget('personal'))
  const now = useNow()
  const value = keyNode('personal')
  const selected = node?.kind === 'key' && node.iuKey === 'personal'
  return (
    <NodeCard
      selected={selected}
      onSelect={() => onSelect(value)}
      title="IU key · personal"
      info="Metered by IU, a rolling 30-day cap of $500. It pays the non-Claude seats and any fallback. Never summed with the Athena team key."
      shot="flow-key"
    >
      <Stack gap={4}>
        <CapMeter budget={budget} now={now} title="IU API" heading="window" />
        {budget.fetchedAt !== null && budget.underCapOn !== null ? (
          <Text size="xs" c="dimmed">
            under the cap around {fmtDay(budget.underCapOn)} at {fmtRate(budget.burn7dUsdPerDay)}
          </Text>
        ) : null}
      </Stack>
    </NodeCard>
  )
}

export function SupplyColumn({
  slot,
  onSelect,
}: {
  slot: NodeSlot
  onSelect: (value: string) => void
}) {
  return (
    <Stack gap="md" miw={0}>
      <ColumnHeader name="Supply" window="now" />
      <FlowBoundary noun="credit pools" height={260}>
        <Suspense fallback={fallback(260)}>
          <PoolsCard node={slot.node} onSelect={onSelect} />
        </Suspense>
      </FlowBoundary>
      {under(slot, ['pool'])}
      <FlowBoundary noun="subscription quota" height={220}>
        <Suspense fallback={fallback(220)}>
          <SubscriptionsCard node={slot.node} onSelect={onSelect} />
        </Suspense>
      </FlowBoundary>
      {under(slot, ['sub'])}
      <FlowBoundary noun="the IU key cap" height={120}>
        <Suspense fallback={fallback(120)}>
          <KeyCard node={slot.node} onSelect={onSelect} />
        </Suspense>
      </FlowBoundary>
      {under(slot, ['key'])}
    </Stack>
  )
}
