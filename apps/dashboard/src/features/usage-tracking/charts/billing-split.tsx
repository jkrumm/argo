import { useSuspenseQuery } from '@tanstack/react-query'
import { ChartCard, Donut, type DonutDatum } from 'basalt-ui/charts'
import { usageQueries, type Range } from '../../../lib/queries/usage'
import type { WorkspaceValue } from '../types'
import { colorForBilling, fmtUsd } from '../constants'

export default function BillingSplit({
  range,
  workspace,
}: {
  range: Range
  workspace?: WorkspaceValue[] | undefined
}) {
  const { data } = useSuspenseQuery(
    usageQueries.breakdown({
      range,
      metric: 'cost',
      dimension: 'billing',
      limit: 10,
      workspace,
    }),
  )

  const slices = data.rows.map((r) => ({ key: r.key, value: r.value }))
  const valueByKey = new Map(slices.map((s) => [s.key, s.value]))

  return (
    <ChartCard
      title="Billing split (cost)"
      subtitle="$ by billing class over the window"
      info="Max = sunk value of the Max subscription (already paid). IU = real per-token spend through the IU gateway. Unknown = rows the source did not tag — most often pre-instrumentation data."
    >
      {slices.length > 0 && (
        <Donut
          ariaLabel="Billing split donut chart showing cost by billing class"
          data={slices as DonutDatum[]}
          height={280}
          colorForKey={colorForBilling}
          formatValue={fmtUsd}
          centerLabel={fmtUsd(data.total)}
          centerSubLabel="total"
          seriesLabel={(k) => `${k} · ${fmtUsd(valueByKey.get(k) ?? 0)}`}
        />
      )}
    </ChartCard>
  )
}
