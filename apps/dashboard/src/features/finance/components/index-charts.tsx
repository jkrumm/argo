import { Lines } from 'basalt-ui/charts'
import type { ChartFact, ChartSeries } from 'basalt-ui/charts'
import { useIndexSeries } from '../api/queries'
import { FINANCE_INDEX } from '../../../lib/series'
import { gainTone } from '../lib/format'
import { INDEX_SOURCE } from '../lib/index-series'
import type { IndexSeries } from '../lib/index-series'
import { levelText, rangeStart, signedPercent } from '../lib/depot-chart'
import { isoDayDe } from '../lib/depot-number'
import type { DepotRange } from '../lib/depot-chart'
import { dayMonth, monthTick } from '../lib/months'
import { QueryCard } from './query-card'

/** The axis label of a day by how many days the chart spans: years, months or days. */
function axisLabel(first: string | undefined, last: string | undefined): (d: Date) => string {
  const span =
    first === undefined || last === undefined
      ? 0
      : (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000
  if (span > 3 * 366) return (d) => String(d.getUTCFullYear())
  if (span > 100) return (d) => monthTick(d.toISOString().slice(0, 7))
  return (d) => dayMonth(d.toISOString().slice(0, 10))
}

/** An axis level: whole points, the tooltip keeps the decimal. */
const axisLevel = (level: number): string => Math.round(level).toLocaleString('de-DE')

const asDate = (day: string): Date => new Date(`${day}T00:00:00Z`)

type Point = { day: string; value: number }

/** The index alone, over the stored history the range filter allows. */
export function IndexHistoryCard({
  index,
  range,
  today,
}: {
  index: IndexSeries
  range: DepotRange
  today: string
}) {
  const query = useIndexSeries(index.id, { from: rangeStart(range, today), to: today })
  const points: Point[] = query.data?.points ?? []
  const first = points[0]
  const last = points.at(-1)
  const change = first === undefined || last === undefined ? null : last.value / first.value - 1
  const facts: ChartFact[] =
    first === undefined || last === undefined
      ? []
      : [
          { value: levelText(last.value), unit: 'points', period: isoDayDe(last.day) },
          ...(change === null
            ? []
            : [
                {
                  value: signedPercent(change),
                  unit: `since ${isoDayDe(first.day)}`,
                  tone: gainTone(change) ?? ('muted' as const),
                },
              ]),
        ]
  const series: ChartSeries<Point>[] = [
    {
      key: 'index',
      label: index.name,
      color: FINANCE_INDEX.index,
      strokeWidth: 2,
      getValue: (p) => p.value,
      formatValue: levelText,
    },
  ]
  return (
    <QueryCard
      shot="depot-index"
      title={index.other === undefined ? `${index.name} · EUR` : index.name}
      subtitle={index.other?.unit ?? INDEX_SOURCE}
      info={`${index.other === undefined ? `The official ${index.name} index, net return (dividends reinvested after withholding tax), in euros, from the market store: index points, not a price. Before 2001 some series hold month ends only.` : `${index.name} from the market store (${index.other.unit}): index points, not a price.`} Over the whole history the axis is logarithmic, so equal steps are equal percentages; over a range it is linear.`}
      query={query}
      empty={
        points.length === 0
          ? `The market store holds no ${index.name} levels in this range.`
          : false
      }
      facts={facts}
      ghost="line"
    >
      <Lines<Point, Date>
        data={points}
        ariaLabel={`${index.name} index, index points`}
        x={(p) => asDate(p.day)}
        formatX={axisLabel(first?.day, last?.day)}
        series={series}
        y={{ format: axisLevel, scale: range === 'max' ? 'log' : 'linear' }}
        height={{ base: 240, regular: 340 }}
        legend={false}
      />
    </QueryCard>
  )
}
