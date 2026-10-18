import { useSuspenseQuery } from '@tanstack/react-query'
import { Text } from '@mantine/core'
import { BarList } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { shotState } from '../../lib/shot-state'
import { usageQueries, type Range } from '../../lib/queries/usage'
import { useNoUsageWindow } from './use-headline'
import classes from './usage.module.css'
import type { BillingValue, WorkspaceValue } from './types'
import { EM_DASH, isFiltered, fmtShare, fmtUsdWhole, periodNoun } from './model'

export default function TopProjects({
  range,
  billing,
  workspace,
  printTotal,
}: {
  range: Range
  billing?: BillingValue[] | undefined
  workspace?: WorkspaceValue[] | undefined
  /** Whether the card prints its window's total; decided once, in the route. */
  printTotal: boolean
}) {
  const query = useSuspenseQuery(
    usageQueries.breakdown({
      range,
      metric: 'cost',
      dimension: 'project',
      limit: 10,
      billing,
      workspace,
    }),
  )
  const data = shotState() === 'empty' ? { ...query.data, rows: [], total: 0 } : query.data
  const emptyText = useNoUsageWindow({
    filtered: isFiltered(billing, workspace),
    leading: false,
  })
  const shown = data.rows.reduce((acc, r) => acc + r.value, 0)
  const rest = Math.max(0, data.total - shown)

  return (
    <ChartCard
      className={classes.fill}
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
          {printTotal ? '' : ` of ${fmtUsdWhole(data.total)}`} in projects below the top{' '}
          {data.rows.length}
        </Text>
      )}
    </ChartCard>
  )
}
