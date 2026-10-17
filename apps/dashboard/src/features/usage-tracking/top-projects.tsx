import { useSuspenseQuery } from '@tanstack/react-query'
import { Text } from '@mantine/core'
import { BarList } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { usageQueries, type Range } from '../../lib/queries/usage'
import type { BillingValue, WorkspaceValue } from './types'
import { EM_DASH, fmtShare, fmtUsdWhole, periodNoun } from './model'

export default function TopProjects({
  range,
  billing,
  workspace,
  headlineTotal,
}: {
  range: Range
  billing?: BillingValue[] | undefined
  workspace?: WorkspaceValue[] | undefined
  headlineTotal?: number | null | undefined
}) {
  const { data } = useSuspenseQuery(
    usageQueries.breakdown({
      range,
      metric: 'cost',
      dimension: 'project',
      limit: 10,
      billing,
      workspace,
    }),
  )
  const unfiltered = range === '30d' && billing === undefined && workspace === undefined
  const total = unfiltered && headlineTotal != null ? headlineTotal : data.total
  const shown = data.rows.reduce((acc, r) => acc + r.value, 0)
  const rest = Math.max(0, total - shown)

  return (
    <ChartCard title={`Top projects · ${periodNoun(range)} · ${fmtUsdWhole(total)}`}>
      <BarList
        label={`Top ${data.rows.length} projects by cost, ${periodNoun(range)}`}
        format={fmtUsdWhole}
        variant="thin"
        emptyText="No data in this window"
        items={data.rows.map((r) => ({
          key: r.key,
          label: r.key,
          value: r.value,
          secondary: data.total > 0 ? fmtShare(r.share) : EM_DASH,
        }))}
      />
      {rest > 0.5 && (
        <Text size="sm" c="dimmed">
          {fmtUsdWhole(rest)} in projects below the top {data.rows.length}
        </Text>
      )}
    </ChartCard>
  )
}
