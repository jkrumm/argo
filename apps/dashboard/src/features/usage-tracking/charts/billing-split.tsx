import { useSuspenseQuery } from '@tanstack/react-query'
import { useElementSize } from '@mantine/hooks'
import { ChartCard, ChartLegend, Donut } from '@argo/charts'
import { usageQueries, type Range } from '../../../lib/queries/usage'
import type { WorkspaceValue } from '../types'
import { colorForBilling, fmtUsd } from '../constants'

export default function BillingSplit({
  range,
  workspace,
}: {
  range: Range
  workspace?: WorkspaceValue[]
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
  const { ref, width } = useElementSize<HTMLDivElement>()

  const slices = data.rows.map((r) => ({ key: r.key, value: r.value }))
  const height = 280

  return (
    <ChartCard
      title="Billing split (cost)"
      subtitle="$ by billing class over the window"
      tooltip="Max = sunk value of the Max subscription (already paid). IU = real per-token spend through the IU gateway. Unknown = rows the source did not tag — most often pre-instrumentation data."
    >
      <div ref={ref} style={{ height, width: '100%' }}>
        {width > 0 && slices.length > 0 && (
          <Donut
            data={slices}
            width={Math.max(width, 200)}
            height={height}
            colorForKey={colorForBilling}
            formatValue={fmtUsd}
            centerLabel={fmtUsd(data.total)}
            centerSubLabel="total"
          />
        )}
      </div>
      <ChartLegend
        items={slices.map((s) => ({
          key: s.key,
          label: `${s.key} · ${fmtUsd(s.value)}`,
          color: colorForBilling(s.key),
          shape: 'bar' as const,
        }))}
      />
    </ChartCard>
  )
}
