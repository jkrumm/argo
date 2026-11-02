/**
 * The Flow tab's Demand column over the page Range: who draws the money. agw's workflows on credit
 * (each row a node, split by purpose), the Claude Code lanes at list value on the subscriptions, and
 * the other callers. Workflow rows select `demand:<workflow>`; lanes and callers have no detail (Explore
 * holds that analysis).
 */
import { Suspense } from 'react'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { Box, Group, Stack, Text } from '@mantine/core'
import { BarList } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { usageQueries, type Range } from '../../lib/queries/usage'
import { shotState } from '../../lib/shot-state'
import { useNow } from '../../lib/use-now'
import { FlowBoundary } from './flow-boundary'
import {
  CREDIT_PAYERS,
  SUB_PAYERS,
  PURPOSES,
  UNSET_KEYS,
  demandTotals,
  fmtUsd,
  laneRows,
  lastRequestNote,
  originKnown,
  purposeSegments,
} from './flow-model'
import { demandNode, type FlowNode } from './flow-node'
import { PURPOSE_STYLE } from './flow-ink'
import classes from './flow.module.css'
import { ColumnHeader, FlowRow, SegmentBar, SegmentLegend } from './flow-parts'
import { periodNoun } from './model'
import { under, type NodeSlot } from './flow-slot'

const WORKFLOWS_SHOWN = 6

const fallback = (height: number) => (
  <ChartCard state={{ pending: true }} placeholderHeight={height} />
)

const EMPTY = 'No gateway traffic in this range'

const WORKFLOWS_INFO =
  'agw workflows that spent API credit (the pools’ payers) over the range: each workflow, split by purpose. Production is everything that is not an eval; evals run on the reserve and can stop. A workflow row opens its steps and models.'
const LANES_INFO =
  'List value of Claude Code on the subscriptions per lane: dollars at API prices, never what a flat plan cost. Interactive, wave mother, lead, worker, fan worker, subagent.'
const CALLERS_INFO =
  'Who asked agw, from the origin the door forwards: Hermes, Iris, MacWhisper, oc, modelpick, the CLI. Rows before the origin header existed read unset.'

const PURPOSE_LEGEND = PURPOSES.map((k) => ({
  key: k,
  label: PURPOSE_STYLE[k].label,
  color: PURPOSE_STYLE[k].color,
}))

function WorkflowsCard({
  range,
  node,
  onSelect,
}: {
  range: Range
  node: FlowNode | null
  onSelect: (value: string) => void
}) {
  const { data } = useSuspenseQuery(
    usageQueries.demand({ range, by: 'workflow', payer: CREDIT_PAYERS }),
  )
  const empty = shotState() === 'empty' || data.rows.length === 0
  const totals = demandTotals(data)
  const rows = empty ? [] : data.rows.slice(0, WORKFLOWS_SHOWN)
  const top = rows.reduce((max, r) => Math.max(max, r.usd), 0)
  return (
    <ChartCard
      title="agw on credit"
      {...(node?.kind === 'demand' ? { className: classes.selected } : {})}
      {...(empty
        ? {}
        : {
            facts: {
              value: fmtUsd(totals.usd),
              unit: 'on credit',
              period: [
                `production ${fmtUsd(totals.productionUsd)}`,
                `eval ${fmtUsd(totals.evalUsd)}`,
                periodNoun(range),
              ],
            },
          })}
      info={WORKFLOWS_INFO}
      placeholderHeight="content"
    >
      <Stack gap="xs" data-shot="flow-workflows" data-shot-states="empty">
        {empty ? (
          <Text size="sm" c="dimmed">
            {EMPTY}
          </Text>
        ) : (
          <>
            {rows.map((r) => {
              const selectable = !UNSET_KEYS.includes(r.key)
              const body = (
                <Stack gap={4}>
                  <Group justify="space-between" wrap="nowrap" gap="xs">
                    <Text size="sm" truncate>
                      {r.key}
                    </Text>
                    <Text size="sm" ff="monospace">
                      {fmtUsd(r.usd)}
                    </Text>
                  </Group>
                  <SegmentBar
                    scale={top}
                    height={6}
                    segments={purposeSegments(r).map((s) => ({
                      key: s.key,
                      label: PURPOSE_STYLE[s.key].label,
                      value: s.usd,
                      color: PURPOSE_STYLE[s.key].color,
                    }))}
                  />
                </Stack>
              )
              return selectable ? (
                <FlowRow
                  key={r.key}
                  selected={node?.kind === 'demand' && node.workflow === r.key}
                  onSelect={() => onSelect(demandNode(r.key))}
                  label={`Open the ${r.key} workflow detail`}
                >
                  {body}
                </FlowRow>
              ) : (
                <Stack key={r.key} px="xs">
                  {body}
                </Stack>
              )
            })}
            <SegmentLegend segments={PURPOSE_LEGEND} />
          </>
        )}
      </Stack>
    </ChartCard>
  )
}

function LanesCard({ range }: { range: Range }) {
  const { data } = useSuspenseQuery(
    usageQueries.laneSplit({ range, lens: 'cost', payer: SUB_PAYERS }),
  )
  const rows = shotState() === 'empty' ? [] : laneRows(data)
  return (
    <ChartCard
      title="Claude Code lanes"
      {...(rows.length === 0
        ? {}
        : {
            facts: {
              value: fmtUsd(rows.reduce((acc, r) => acc + r.listUsd, 0)),
              unit: 'list value',
              period: ['on the subscriptions', periodNoun(range)],
            },
          })}
      info={LANES_INFO}
      placeholderHeight="content"
    >
      <Box data-shot="flow-lanes" data-shot-states="empty">
        <BarList
          label={`Claude Code list value per lane, ${periodNoun(range)}`}
          variant="thin"
          format={(v) => fmtUsd(v)}
          emptyText="No Claude Code usage in this range"
          items={rows.map((r) => ({ key: r.key, label: r.label, value: r.listUsd }))}
        />
      </Box>
    </ChartCard>
  )
}

function CallersCard({ range }: { range: Range }) {
  const { data } = useSuspenseQuery(usageQueries.demand({ range, by: 'origin' }))
  const known = shotState() !== 'empty' && originKnown(data)
  const rows = known ? data.rows.filter((r) => !UNSET_KEYS.includes(r.key)) : []
  return (
    <ChartCard
      title={`Who asked agw · ${periodNoun(range)}`}
      info={CALLERS_INFO}
      placeholderHeight="content"
    >
      <Stack gap="sm" data-shot="flow-callers" data-shot-states="empty">
        {known ? (
          <BarList
            label={`agw spend by who asked, ${periodNoun(range)}`}
            variant="thin"
            format={(v) => fmtUsd(v)}
            items={rows.map((r) => ({ key: r.key, label: r.key, value: r.usd }))}
          />
        ) : (
          <Text size="sm" c="dimmed">
            Not recorded yet: gateway rows carry the door that called, not who asked agw. It fills
            once agw forwards its caller as the origin header.
          </Text>
        )}
      </Stack>
    </ChartCard>
  )
}

export function DemandColumn({
  range,
  slot,
  onSelect,
}: {
  range: Range
  slot: NodeSlot
  onSelect: (value: string) => void
}) {
  // The gateway's silence is a router fact; both columns read it from the one /usage/router query.
  const { data } = useQuery(usageQueries.router(range))
  const now = useNow()
  const note = shotState() === 'empty' ? null : lastRequestNote(data?.lastRequestAt ?? null, now)
  return (
    <Stack gap="md" miw={0}>
      <ColumnHeader
        name="Demand"
        window={note === null ? periodNoun(range) : `${periodNoun(range)} · ${note}`}
        last
      />
      <FlowBoundary noun="agw workflows" height={300}>
        <Suspense fallback={fallback(300)}>
          <WorkflowsCard range={range} node={slot.node} onSelect={onSelect} />
        </Suspense>
      </FlowBoundary>
      {under(slot, ['demand'])}
      <FlowBoundary noun="Claude Code lanes" height={220}>
        <Suspense fallback={fallback(220)}>
          <LanesCard range={range} />
        </Suspense>
      </FlowBoundary>
      <FlowBoundary noun="other callers" height={140}>
        <Suspense fallback={fallback(140)}>
          <CallersCard range={range} />
        </Suspense>
      </FlowBoundary>
    </Stack>
  )
}
