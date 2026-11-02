/**
 * Athena Teamchat, apart: the team key's cap, its spend by producer and whether agw has touched it
 * lately. It is a different organization's key, so it sits under its own divider and enters no total,
 * no "all" and no node figure above it (spec pass criterion 5).
 */
import { Suspense } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Divider, Grid, Stack, Text } from '@mantine/core'
import { BarList } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { CONTAINER_GRID_BREAKPOINTS, VX } from 'basalt-ui/tokens'
import { usageQueries, type Range } from '../../lib/queries/usage'
import { shotState } from '../../lib/shot-state'
import { useNow } from '../../lib/use-now'
import { budgetReading } from './budget-model'
import { CapMeter } from './limits'
import { FlowBoundary } from './flow-boundary'
import { agwOnKey, agwReading, fmtDay, fmtInstant, fmtUsd } from './flow-model'
import { periodNoun } from './model'

const fallback = (height: number) => (
  <ChartCard state={{ pending: true }} placeholderHeight={height} />
)

function CapCard() {
  const { data: budget } = useSuspenseQuery(usageQueries.iuBudget('athena-team'))
  const now = useNow()
  const reading = budgetReading(budget, now)
  return (
    <ChartCard
      title="Athena team key"
      info="Athena Teamchat's own IU key: a separate rolling 30-day $500 cap in IU's portal. Never summed with the personal key."
      placeholderHeight="content"
    >
      <Stack gap={4} data-shot="flow-athena-cap" data-shot-states="empty">
        <CapMeter budget={budget} now={now} title="Athena team" heading="window" />
        {reading.state === null || reading.state === 'ok' ? null : (
          <Text size="xs" c={reading.state === 'over' ? VX.status.bad : VX.status.warn}>
            {reading.state}
            {budget.underCapOn === null
              ? ''
              : ` · under the cap around ${fmtDay(budget.underCapOn)}`}
          </Text>
        )}
      </Stack>
    </ChartCard>
  )
}

function ProducersCard({ range }: { range: Range }) {
  const { data } = useSuspenseQuery(
    usageQueries.split({ by: 'sub_tool', range, lens: 'cost', payer: ['iu-team-api'], top: 6 }),
  )
  const rows = shotState() === 'empty' ? [] : data.rows
  return (
    <ChartCard
      title={`Spend by producer · ${periodNoun(range)}`}
      info="What was spent on the Athena team key, by the tool that produced it. agw rows end when agw moved to the gateway; Athena Teamchat's own rows are producer-reported."
      placeholderHeight="content"
    >
      <BarList
        label={`Athena team key spend by producer, ${periodNoun(range)}`}
        variant="thin"
        emptyText="No spend on this key in this range"
        format={(v) => fmtUsd(v)}
        items={rows.map((r) => ({ key: r.key, label: r.key, value: r.cost }))}
      />
    </ChartCard>
  )
}

function AgwCard() {
  const { data: pace } = useSuspenseQuery(usageQueries.pace())
  const { data } = useSuspenseQuery(
    usageQueries.timeseries({
      range: '30d',
      grain: 'hour',
      metric: 'cost',
      groupBy: 'source',
      payer: ['iu-team-api'],
    }),
  )
  const now = useNow()
  const { sinceUsd, lastRowAt } = agwOnKey(data.buckets, new Date(pace.cutover).getTime())
  const bills = agwReading(lastRowAt, now).state === 'bills'
  return (
    <ChartCard
      title="agw on this key since the cutover"
      info="Whether agent-workflows still bills this key since the gateway's first row: its calls pay on our own key, so anything here is a call that bypassed the gateway. Hourly buckets, the hour of the cutover included."
      placeholderHeight="content"
    >
      <Stack gap={2} data-shot="flow-athena-agw">
        <Text
          size="sm"
          fw={600}
          ff="monospace"
          {...(bills ? { c: VX.status.warn } : { c: 'dimmed' })}
        >
          {fmtUsd(sinceUsd)}
        </Text>
        {bills ? (
          <Text size="xs" c={VX.status.warn}>
            agw still bills this key
          </Text>
        ) : null}
        <Text size="xs" c="dimmed">
          since {fmtInstant(pace.cutover)} ·{' '}
          {lastRowAt === null
            ? 'no agw row in 30 days'
            : bills
              ? `last agw row ${fmtInstant(lastRowAt)}`
              : `last agw row ${fmtInstant(lastRowAt)} · nothing since`}
        </Text>
      </Stack>
    </ChartCard>
  )
}

export function AthenaSection({ range }: { range: Range }) {
  return (
    <Stack gap="md" data-shot="flow-athena" data-shot-states="empty">
      <Divider
        variant="dashed"
        labelPosition="left"
        label={
          <Text size="xs" fw={600} c="dimmed" tt="uppercase">
            Athena Teamchat · its own key, never in a total
          </Text>
        }
      />
      <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <FlowBoundary noun="the Athena key cap" height={120}>
            <Suspense fallback={fallback(120)}>
              <CapCard />
            </Suspense>
          </FlowBoundary>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <FlowBoundary noun="Athena spend by producer" height={120}>
            <Suspense fallback={fallback(120)}>
              <ProducersCard range={range} />
            </Suspense>
          </FlowBoundary>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <FlowBoundary noun="agw on the Athena key" height={120}>
            <Suspense fallback={fallback(120)}>
              <AgwCard />
            </Suspense>
          </FlowBoundary>
        </Grid.Col>
      </Grid>
    </Stack>
  )
}
