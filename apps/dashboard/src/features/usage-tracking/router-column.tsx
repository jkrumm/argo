/**
 * The Flow tab's Router column over the page Range: where the gateway sent each Anthropic request
 * (one pick per request: a pool, the IU passthrough or a refusal), what reached IU and why, and how
 * the prompt cache hits per caller. The three cards are one node, `router`: they take its ring and the
 * first card opens its detail.
 */
import { Suspense } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Stack, Text } from '@mantine/core'
import { BarList } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { usageQueries, type Range } from '../../lib/queries/usage'
import { shotState } from '../../lib/shot-state'
import { FlowBoundary } from './flow-boundary'
import {
  cacheRows,
  coldCaller,
  fmtUsd,
  iuByCause,
  picksByReason,
  picksByTarget,
  routerNotes,
  routerTotals,
  targetLabel,
} from './flow-model'
import { ROUTER_NODE, type FlowNode } from './flow-node'
import { ColumnHeader, NodeCard, SegmentBar, SegmentLegend } from './flow-parts'
import { targetColor } from './flow-ink'
import { periodNoun } from './model'
import { PICKS_INFO, IU_INFO, CACHE_INFO } from './flow-copy'
import { under, type NodeSlot } from './flow-slot'

const NUMBER = new Intl.NumberFormat('en-GB')

const fallback = (height: number) => (
  <ChartCard state={{ pending: true }} placeholderHeight={height} />
)

const EMPTY = 'No gateway traffic in this range'

function PicksCard({
  range,
  node,
  onSelect,
}: {
  range: Range
  node: FlowNode | null
  onSelect: (value: string) => void
}) {
  const { data } = useSuspenseQuery(usageQueries.router(range))
  const picks = shotState() === 'empty' ? [] : data.picks
  const targets = picksByTarget(picks)
  const totals = routerTotals({ ...data, picks })
  const reasons = picksByReason(picks)
  const segments = targets.map((t) => ({
    key: t.target,
    label: `${targetLabel(t.target)} ${NUMBER.format(t.n)}`,
    value: t.n,
    color: targetColor(t.target),
  }))
  return (
    <NodeCard
      selected={node?.kind === 'router'}
      onSelect={() => onSelect(ROUTER_NODE)}
      title="Where the gateway sent requests"
      {...(totals.picks === 0
        ? {}
        : {
            facts: { value: NUMBER.format(totals.picks), unit: 'picks', period: periodNoun(range) },
          })}
      info={PICKS_INFO}
      shot="flow-router-picks"
    >
      {totals.picks === 0 ? (
        <Text size="sm" c="dimmed">
          {data.picksAvailable ? EMPTY : 'The gateway’s picks table is not readable yet'}
        </Text>
      ) : (
        <Stack gap="sm">
          <SegmentBar segments={segments} />
          <SegmentLegend segments={segments} />
          <BarList
            label={`Gateway picks by reason, ${periodNoun(range)}`}
            variant="thin"
            format={(v) => NUMBER.format(v)}
            items={reasons.map((r) => ({ key: r.reason, label: r.reason, value: r.n }))}
          />
        </Stack>
      )}
    </NodeCard>
  )
}

function IuCard({ range, node }: { range: Range; node: FlowNode | null }) {
  const { data } = useSuspenseQuery(usageQueries.router(range))
  const iu = shotState() === 'empty' ? [] : data.iu
  const causes = iuByCause(iu)
  const totals = routerTotals({ ...data, iu })
  const claude = causes.filter((c) => c.warn).reduce((acc, c) => acc + c.usd, 0)
  const notes = routerNotes(data)
  return (
    <NodeCard
      selected={node?.kind === 'router'}
      title="What reached IU, and why"
      facts={{ value: fmtUsd(totals.iuUsd), unit: 'on the IU key', period: periodNoun(range) }}
      info={IU_INFO}
      shot="flow-router-iu"
    >
      <Stack gap="sm">
        <BarList
          label={`IU spend by cause, ${periodNoun(range)}`}
          variant="thin"
          format={(v) => fmtUsd(v)}
          items={causes.map((c) => ({
            key: c.cause,
            label: c.label,
            value: c.usd,
            ...(c.warn
              ? {
                  secondary: (
                    <Text span size="xs" c={VX.status.warn}>
                      Claude on IU
                    </Text>
                  ),
                }
              : {}),
          }))}
        />
        {claude > 0 ? (
          <Text size="xs" c={VX.status.warn}>
            {fmtUsd(claude)} of Claude work reached IU in this range.
          </Text>
        ) : null}
        {notes.map((n) => (
          <Text key={n} size="xs" c="dimmed">
            {n}
          </Text>
        ))}
      </Stack>
    </NodeCard>
  )
}

function CacheCard({ range, node }: { range: Range; node: FlowNode | null }) {
  const { data } = useSuspenseQuery(usageQueries.router(range))
  const rows = shotState() === 'empty' ? [] : cacheRows(data.cache)
  const cold = coldCaller(rows)
  return (
    <NodeCard
      selected={node?.kind === 'router'}
      title={`Cache hit · ${periodNoun(range)}`}
      info={CACHE_INFO}
      shot="flow-router-cache"
    >
      {rows.length === 0 ? (
        <Text size="sm" c="dimmed">
          {EMPTY}
        </Text>
      ) : (
        <Stack gap="sm">
          <BarList
            label={`Prompt cache hit per caller and target, ${periodNoun(range)}`}
            variant="thin"
            max={100}
            format={(v) => `${Math.round(v)} %`}
            items={rows.slice(0, 6).map((r) => ({
              key: r.key,
              label: `${r.caller} → ${targetLabel(r.target)}`,
              value: r.hitRate === null ? 0 : r.hitRate * 100,
              secondary: (
                <Text span size="xs" c="dimmed">
                  {r.hitRate === null ? 'no input' : `${NUMBER.format(r.requests)} requests`}
                </Text>
              ),
            }))}
          />
          {cold === null ? null : (
            <Text size="xs" c="dimmed">
              {cold.caller} → {targetLabel(cold.target)}: {NUMBER.format(cold.requests)} requests,
              almost no cache read.
            </Text>
          )}
        </Stack>
      )}
    </NodeCard>
  )
}

export function RouterColumn({
  range,
  slot,
  onSelect,
}: {
  range: Range
  slot: NodeSlot
  onSelect: (value: string) => void
}) {
  return (
    <Stack gap="md" miw={0}>
      <ColumnHeader name="Router" window={periodNoun(range)} />
      <FlowBoundary noun="gateway picks" height={300}>
        <Suspense fallback={fallback(300)}>
          <PicksCard range={range} node={slot.node} onSelect={onSelect} />
        </Suspense>
      </FlowBoundary>
      <FlowBoundary noun="IU spend" height={220}>
        <Suspense fallback={fallback(220)}>
          <IuCard range={range} node={slot.node} />
        </Suspense>
      </FlowBoundary>
      <FlowBoundary noun="cache hit rates" height={180}>
        <Suspense fallback={fallback(180)}>
          <CacheCard range={range} node={slot.node} />
        </Suspense>
      </FlowBoundary>
      {under(slot, ['router'])}
    </Stack>
  )
}
