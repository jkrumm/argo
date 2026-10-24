import { useSuspenseQuery } from '@tanstack/react-query'
import { Box, Table } from '@mantine/core'
import { format as formatDate } from 'date-fns'
import { Bars, ChartCard } from 'basalt-ui/charts'
import { shotState } from '../../lib/shot-state'
import { usageQueries, type Range } from '../../lib/queries/usage'
import { USAGE_ACCOUNT } from '../../lib/series'
import { useNow } from '../../lib/use-now'
import { ACCOUNT_LABELS } from './accounts'
import { periodNoun, shortDay } from './model'
import {
  SPILL,
  USAGE_TIME_GROUP,
  laneRows,
  orderPicked,
  pickRows,
  rangeDomain,
  rangeHours,
  type PickRow,
  type PicksResponse,
} from './quota-model'
import classes from './usage.module.css'

const EMPTY: PicksResponse = { total: 0, bucketHours: 1, counts: [], pickedKeys: [], series: [] }

const pickedLabel = (key: string) =>
  key === SPILL ? 'spill (IU path)' : ((ACCOUNT_LABELS as Record<string, string>)[key] ?? key)
const pickedColor = (key: string) =>
  USAGE_ACCOUNT[key] ?? USAGE_ACCOUNT['unknown'] ?? USAGE_ACCOUNT['iu'] ?? ''

function usePicks(range: Range) {
  const query = useSuspenseQuery(usageQueries.pickSummary(rangeHours(range)))
  return shotState() === 'empty' ? EMPTY : query.data
}

const BARS_INFO =
  'How often the picker chose each account for a new Claude session, per hour (or per day for long ranges). “spill” means no Max account had headroom and the caller fell back to its IU path.'

/** Picker decisions over time, stacked by the account it chose. Shares the time axis with the charts above. */
export function PicksChart({ range, height = 200 }: { range: Range; height?: number }) {
  const data = usePicks(range)
  const now = useNow()
  const keys = orderPicked(data.pickedKeys)
  const rows = pickRows(data)
  const domain = rangeDomain(range, now)
  const hourly = data.bucketHours === 1

  return (
    <ChartCard
      title={`Account picks per ${hourly ? 'hour' : 'day'} · ${periodNoun(range)}`}
      info={BARS_INFO}
      state={{ empty: rows.length === 0 && 'No picker decisions in this window yet' }}
      data-shot="picks-chart"
      data-shot-states="empty"
    >
      <Bars
        ariaLabel="Picker decisions per bucket, stacked by chosen account"
        data={rows}
        height={height}
        x={(d: PickRow) => d.date}
        {...(domain === undefined ? {} : { xDomain: domain })}
        formatX={(d) => shortDay(d)}
        cursorGroup={USAGE_TIME_GROUP}
        cursorResolution="leading"
        legend={{ placement: 'bottom' }}
        y={{ ticks: 3 }}
        bars={keys.map((k) => ({
          key: k,
          label: pickedLabel(k),
          color: pickedColor(k),
          getValue: (d: PickRow) => d.picks[k] ?? 0,
        }))}
        tooltip={{
          formatHeader: (x) => formatDate(x, hourly ? 'd MMM HH:mm' : 'd MMM'),
        }}
      />
    </ChartCard>
  )
}

/** Lane × account pick counts with the reasons behind each lane's choices. */
export function LanePicksTable({ range }: { range: Range }) {
  const data = usePicks(range)
  const keys = orderPicked(data.pickedKeys)
  const lanes = laneRows(data.counts)

  return (
    <ChartCard
      className={classes.fill}
      placeholderHeight="content"
      title={`Picks by lane · ${periodNoun(range)}`}
      info="Picker decisions per spawn lane and chosen account, with why: home (the lane’s own account), expiring (an account whose week is about to reset), or spill."
      state={{ empty: lanes.length === 0 && 'No picker decisions in this window yet' }}
      data-shot="picks-table"
      data-shot-states="empty"
    >
      <Box style={{ overflowX: 'auto' }}>
        <Table withRowBorders={false} verticalSpacing={4} horizontalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Lane</Table.Th>
              {keys.map((k) => (
                <Table.Th key={k} ta="right">
                  {pickedLabel(k)}
                </Table.Th>
              ))}
              <Table.Th>Why</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {lanes.map((l) => (
              <Table.Tr key={l.lane}>
                <Table.Td>{l.lane}</Table.Td>
                {keys.map((k) => (
                  <Table.Td key={k} ta="right">
                    {l.byPicked[k] ?? 0}
                  </Table.Td>
                ))}
                <Table.Td c="dimmed">
                  {l.reasons.map((r) => `${r.reason} ${r.count}`).join(' · ')}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Box>
    </ChartCard>
  )
}
