import { ChartCard, Lines } from 'basalt-ui/charts'
import type { ChartFact, ChartSeries } from 'basalt-ui/charts'
import { SelectFilter } from 'basalt-ui/controls'
import { date } from 'basalt-ui/format'
import { useCandles, useIndexSeries } from '../api/queries'
import { FINANCE_INDEX } from '../../../lib/series'
import { useField } from '../../../lib/use-field'
import { finStore } from '../../../lib/window-stores'
import { gainTone } from '../lib/format'
import { INDEX_SOURCE, indexById } from '../lib/index-series'
import type { IndexSeries } from '../lib/index-series'
import {
  candleWindow,
  daysBefore,
  levelText,
  rangeStart,
  rebasedPair,
  signedPercent,
} from '../lib/depot-chart'
import type { DepotRange, RebasedRow } from '../lib/depot-chart'
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

/** Both lines with a little room: the axis starts near the lines, not at 0, as a comparison reads from 100. */
const fitted = (rows: readonly RebasedRow[]): readonly [number, number] => {
  const values = rows.flatMap((r) => [r.etf, r.index])
  return [Math.min(...values) * 0.98, Math.max(...values) * 1.02]
}

/** An axis level: whole points, the tooltip keeps the decimal. */
const axisLevel = (level: number): string =>
  level.toLocaleString('en-US', { maximumFractionDigits: 0 })

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
          { value: levelText(last.value), unit: 'points', period: date(last.day) },
          ...(change === null
            ? []
            : [
                {
                  value: signedPercent(change),
                  unit: `since ${date(first.day)}`,
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

/** An instrument and one index, both set to 100 on the first day they share. */
export function IndexOverlayCard({
  isin,
  name,
  range,
  today,
}: {
  isin: string
  name: string
  range: DepotRange
  today: string
}) {
  const [chosen] = useField(finStore.field.cmp)
  const index = indexById(chosen)
  const bars = useCandles({ isin, interval: '1d', ...candleWindow(range, '1d', today) })
  const closes = bars.data?.candles ?? []
  const firstBar = closes[0]
  const firstDay =
    firstBar === undefined ? null : new Date(firstBar.time * 1000).toISOString().slice(0, 10)
  const levels = useIndexSeries(firstDay === null ? null : (index?.id ?? null), {
    from: firstDay === null ? undefined : daysBefore(firstDay, 10),
    to: today,
  })
  if (index === undefined) return null

  const rows = rebasedPair(closes, levels.data?.points ?? [])
  const start = rows[0]
  const end = rows.at(-1)
  const euro = bars.data?.currency == null || bars.data.currency === 'EUR'
  const facts: ChartFact[] =
    start === undefined || end === undefined
      ? []
      : [
          {
            value: signedPercent(end.etf / 100 - 1),
            unit: name,
            period: `since ${date(start.day)}`,
            tone: gainTone(end.etf - 100) ?? ('muted' as const),
          },
          {
            value: signedPercent(end.index / 100 - 1),
            unit: index.name,
            period: `since ${date(start.day)}`,
            tone: gainTone(end.index - 100) ?? ('muted' as const),
          },
        ]
  const series: ChartSeries<RebasedRow>[] = [
    {
      key: 'fund',
      label: name,
      color: FINANCE_INDEX.fund,
      strokeWidth: 2,
      getValue: (r) => r.etf,
      formatValue: levelText,
    },
    {
      key: 'index',
      label: index.name,
      color: FINANCE_INDEX.benchmark,
      getValue: (r) => r.index,
      formatValue: levelText,
    },
  ]
  const waiting = firstDay !== null && levels.isPending
  const empty =
    closes.length === 0
      ? 'No bars for this range.'
      : levels.data?.points.length === 0
        ? `The market store holds no ${index.name} levels for these days.`
        : rows.length < 2
          ? 'The two lines share fewer than two days in this range.'
          : false
  return (
    <ChartCard
      data-shot="depot-overlay"
      title={`${name} vs ${index.name}`}
      subtitle={start === undefined ? INDEX_SOURCE : `100 on ${date(start.day)} · ${INDEX_SOURCE}`}
      info={`The fund's close and the index level, both set to 100 on the first day they share; the range filter decides how far back the fund is read. The fund line is its price: a distributing fund's payouts are not in it, while the net-return index reinvests them. The index is MSCI's, a stand-in with the same size segments, not the fund's own benchmark: the gap is not tracking error.${euro ? '' : ' The fund is quoted in a currency other than euros, the index is in euros: the gap includes the exchange rate.'}`}
      facts={facts}
      state={{
        pending: bars.isPending || waiting,
        error: bars.error ?? levels.error ?? undefined,
        empty,
      }}
      onRetry={() => {
        void bars.refetch()
        void levels.refetch()
      }}
      actions={<SelectFilter field={finStore.field.cmp} label="Index" />}
      ghost="line"
    >
      <Lines<RebasedRow, Date>
        data={rows}
        ariaLabel={`${name} against ${index.name}, both set to 100 on the first common day`}
        x={(r) => asDate(r.day)}
        formatX={axisLabel(start?.day, end?.day)}
        series={series}
        y={{ format: axisLevel, domain: fitted }}
        height={{ base: 220, regular: 280 }}
      />
    </ChartCard>
  )
}
