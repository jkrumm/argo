import { useSuspenseQuery } from '@tanstack/react-query'
import { Text } from '@mantine/core'
import { BarList } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { shotState } from '../../lib/shot-state'
import { usageQueries, type Range } from '../../lib/queries/usage'
import { useUsageHeadline } from './use-headline'
import classes from './usage.module.css'
import type { PayerValue, WorkspaceValue } from './types'
import {
  EM_DASH,
  footerTotal,
  isFiltered,
  noUsageWindow,
  fmtShare,
  fmtUsdWhole,
  periodNoun,
} from './model'

export default function TopProjects({
  range,
  payer,
  workspace,
  printTotal,
  stripEmpty,
}: {
  range: Range
  payer?: PayerValue[] | undefined
  workspace?: WorkspaceValue[] | undefined
  /** Whether the card prints its window's total; decided once, in the route. */
  printTotal: boolean
  /** The 30 d strip is empty and covers this range. */
  stripEmpty: boolean
}) {
  const query = useSuspenseQuery(
    usageQueries.breakdown({
      range,
      metric: 'cost',
      dimension: 'project',
      limit: 10,
      payer,
      workspace,
    }),
  )
  const data = shotState() === 'empty' ? { ...query.data, rows: [], total: 0 } : query.data
  const emptyText = noUsageWindow({
    filtered: isFiltered(payer, workspace),
    stripEmpty,
    leading: false,
    range,
  })
  // The strip owns the unfiltered 30 d total: when this card does not print its own, its footer
  // reads that same figure, so the two never round different sums.
  const headline = useUsageHeadline(payer).data
  const total = footerTotal({
    printTotal,
    headlineCostUsd30d: headline?.costUsd30d,
    breakdownTotal: data.total,
    rowsShown: data.rows.length,
  })
  const shown = data.rows.reduce((acc, r) => acc + r.value, 0)
  const rest = Math.max(0, total - shown)

  return (
    <ChartCard
      className={classes.fill}
      placeholderHeight="content"
      title={`Top projects · ${periodNoun(range)}${printTotal ? ` · ${fmtUsdWhole(data.total)}` : ''}`}
      state={{ empty: data.rows.length === 0 && emptyText }}
    >
      <BarList
        label={`Top ${data.rows.length} projects by cost, ${periodNoun(range)}`}
        format={fmtUsdWhole}
        variant="thin"
        items={data.rows.map((r) => ({
          key: r.key,
          label: r.key,
          value: r.value,
          secondary: data.total > 0 ? fmtShare(r.share) : EM_DASH,
        }))}
      />
      {rest > 0.5 && (
        <Text size="sm" c="dimmed">
          {fmtUsdWhole(rest)}
          {printTotal ? '' : ` of ${fmtUsdWhole(total)}`} in projects below the top{' '}
          {data.rows.length}
        </Text>
      )}
    </ChartCard>
  )
}
