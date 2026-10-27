/**
 * Routing: how the Claude account picker (dotfiles `docs/claude-accounts.md`) spreads work over the
 * subscriptions, laid out for tuning its ceilings over weeks. Its own range control (a store field,
 * apart from the page Range) and not filtered by the tab's Account switch: routing is about choosing
 * between accounts. Facts strip, who served each lane, why, the 5 h quota with the ceiling, and what
 * each account's windows expired with.
 */
import { Suspense } from 'react'
import { useSuspenseQueries } from '@tanstack/react-query'
import { Box, Stack } from '@mantine/core'
import { Section, StatGroup, type StatStripCell } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { ViewTabs } from 'basalt-ui/controls'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/table'
import { formatMinutes, glue, withUnit } from '../../lib/format'
import { usageQueries } from '../../lib/queries/usage'
import { shotState } from '../../lib/shot-state'
import { useNow } from '../../lib/use-now'
import { usageStore, type UsageRoutingRange } from '../../lib/window-stores'
import { EM_DASH } from './model'
import { ReasonsAndSpill, Sawtooth } from './routing-charts'
import {
  ROUTING_HOURS,
  routingAccounts,
  spillFacts,
  tuningRows,
  windowFacts,
  windowStart,
  type TuningRow,
} from './routing-model'
import { PicksTimeline } from './routing-picks'

const SECTION_INFO =
  'How the Claude account picker spreads work over the subscriptions. The ceilings it enforces (session, weekly) are tuned from these views: the facts say how often it spilled and what it left unused, the timeline and reasons say where and why, the sawtooth shows each 5 h window against the ceiling, the table what every window expired with. Data starts when the picker log did (24 Oct).'

const pctCell = (v: number | null) => (v === null ? EM_DASH : withUnit(Math.round(v), '%'))

const columnHelper = createColumnHelper<TuningRow>()

const columns = [
  columnHelper.accessor('title', {
    meta: { priority: 0, numeral: false },
    header: 'Account',
    cell: (ctx) => glue(ctx.getValue()),
  }),
  columnHelper.accessor('fiveUnused', {
    meta: { priority: 1 },
    header: 'Capacity expired at 5 h reset',
    cell: (ctx) => pctCell(ctx.getValue()),
  }),
  columnHelper.accessor('wait', {
    meta: { priority: 2 },
    header: 'Wait until picked again',
    cell: (ctx) => {
      const v = ctx.getValue()
      return v === null ? EM_DASH : formatMinutes(v)
    },
  }),
  columnHelper.accessor('never', {
    meta: { priority: 3 },
    header: 'Never picked after a 5 h reset',
    cell: (ctx) => (ctx.row.original.fiveResets === 0 ? EM_DASH : String(ctx.getValue())),
  }),
  columnHelper.accessor('sevenUnused', {
    meta: { priority: 4 },
    header: 'Capacity expired at last 7 d reset',
    cell: (ctx) => pctCell(ctx.getValue()),
  }),
  columnHelper.accessor('fiveResets', {
    meta: { priority: 5 },
    header: '5 h windows ended',
  }),
  columnHelper.accessor('sevenResets', {
    meta: { priority: 6 },
    header: '7 d windows ended',
  }),
]

const fallback = (height: number) => (
  <ChartCard state={{ pending: true }} placeholderHeight={height} />
)

function RoutingBody({ range }: { range: UsageRoutingRange }) {
  const now = useNow()
  const hours = ROUTING_HOURS[range]
  const [picks, summary, windows, quota] = useSuspenseQueries({
    queries: [
      usageQueries.accountPicks(hours),
      usageQueries.picksSummary(hours, 'reason'),
      usageQueries.routingWindows(hours),
      usageQueries.quota(hours),
    ],
  })
  const empty = shotState() === 'empty'
  const pickList = empty ? [] : picks.data.picks
  const windowList = empty ? [] : windows.data.windows
  const summaryList = empty ? [] : windows.data.summary
  const lanes = empty ? [] : summary.data.lanes
  const total = empty ? 0 : summary.data.total

  const spill = spillFacts(lanes, total)
  const wf = windowFacts(windowList)
  const fromMs = windowStart(pickList, now, hours)
  const firstMs = pickList.length === 0 ? null : fromMs
  const period = `last ${hours / 24} d`
  const none = { kind: 'empty', reason: 'No picker decisions in this range' } as const
  const state = total === 0 ? { state: none } : {}

  const cells: StatStripCell[] = [
    {
      key: 'spill',
      caption: 'Spill rate',
      qualifier: period,
      info: 'Picks the lane’s own account could not take (an account took the overflow, or none had room) over all picks. Lower means the ceilings leave room; the per-lane split is below.',
      value: spill.rate === null ? null : String(Math.round(spill.rate * 100)),
      unit: '%',
      footer: `${spill.spills} of ${spill.picks} picks`,
      ...state,
    },
    {
      key: 'picks',
      caption: 'Picks',
      qualifier: period,
      info: 'Account decisions the picker logged: one per run it routed, across every lane.',
      value: String(spill.picks),
      footer: `${lanes.length} ${lanes.length === 1 ? 'lane' : 'lanes'}`,
      ...state,
    },
    {
      key: 'unused',
      caption: 'Capacity unused',
      qualifier: 'at a 5 h reset',
      info: 'The median share of a 5 h window still unused when it reset, over every account: capacity that expired. High means the picker leaves subscription time on the table.',
      value: wf.medianUnused === null ? null : String(Math.round(wf.medianUnused)),
      unit: '%',
      footer: `median of ${wf.resets} resets`,
      ...state,
    },
    {
      key: 'wait',
      caption: 'Back to work',
      qualifier: 'after a 5 h reset',
      info: 'The median time from a 5 h reset until the picker next chose that account. Long means a refilled window sits idle.',
      value: wf.medianWait === null ? null : formatMinutes(wf.medianWait),
      footer: `${wf.neverPicked} never picked again`,
      ...state,
    },
  ]

  const accounts = routingAccounts(pickList, quota.data.series, summaryList)
  const rows = tuningRows(accounts, summaryList, windowList)

  return (
    <Stack gap="md">
      <Box data-shot="routing-facts" data-shot-states="empty">
        <StatGroup variant="strip" label={`Routing over ${period}`} cols={4} cells={cells} />
      </Box>
      <PicksTimeline picks={pickList} now={now} hours={hours} fromMs={fromMs} firstMs={firstMs} />
      <ReasonsAndSpill
        summary={empty ? { ...summary.data, series: [], lanes: [] } : summary.data}
        hours={hours}
      />
      <Sawtooth quota={quota.data} now={now} hours={hours} />
      <Box data-shot="routing-tuning" data-shot-states="empty">
        <BasaltDataTable
          title={`Tuning · ${period}`}
          subtitle="What each account’s windows expired with, and how long the picker took to come back"
          data={rows}
          columns={columns}
          enableSorting={false}
          getRowId={(row) => row.account}
          emptyState="No routing data in this range"
        />
      </Box>
    </Stack>
  )
}

export function Routing() {
  return (
    <Section
      title="Routing"
      subtitle="Which account the picker chose, why, and what it left unused"
      info={SECTION_INFO}
      tabs={<ViewTabs field={usageStore.field.routingRange} label="Routing range" />}
    >
      <RoutingBodyForRange />
    </Section>
  )
}

function RoutingBodyForRange() {
  const [range] = usageStore.field.routingRange.use()
  return (
    <Suspense fallback={fallback(420)}>
      <RoutingBody range={range} />
    </Suspense>
  )
}
