import { SimpleGrid, Stack } from '@mantine/core'
import { Meter, StatGroup } from 'basalt-ui'
import type { StatStripCell } from 'basalt-ui'
import { Bars, Lines, Sparkline } from 'basalt-ui/charts'
import type { BarsBar, BarsLine, ChartSeries, ChartTooltipRow } from 'basalt-ui/charts'
import { alpha, CONTAINER_KEYS, VX } from 'basalt-ui/tokens'
import { useReport } from '../api/queries'
import type { CashflowMonthV2, Forecast } from '../api/types'
import { MonthStrip } from '../components/month-strip'
import { NoDataState } from '../components/no-data-state'
import { QueryCard } from '../components/query-card'
import { RangeBar } from '../components/range-bar'
import { SentenceList } from '../components/sentence-list'
import { eur, eurCompact, gainTone, ratio, signedEur, toneProp } from '../lib/format'
import { monthName, monthTick } from '../lib/months'
import { FINANCE_SPLIT } from '../../../lib/series'
import { useRange } from '../lib/use-range'

const BARS: BarsBar<CashflowMonthV2>[] = [
  {
    key: 'regular',
    label: 'Regular net',
    color: FINANCE_SPLIT.regular,
    getValue: (m) => m.regular_net_cents,
    formatValue: signedEur,
    note: 'income minus fixed and variable spending',
  },
  {
    key: 'oneoff',
    label: 'One-offs',
    color: FINANCE_SPLIT.oneoff,
    getValue: (m) => m.one_off_cents,
    formatValue: signedEur,
    note: 'trips and shared costs, reimbursements included',
  },
]

const NET_LINE: BarsLine<CashflowMonthV2>[] = [
  {
    key: 'net',
    label: 'Net',
    color: VX.ink,
    getValue: (m) => m.net_cents,
    formatValue: signedEur,
  },
]

const lossRows = (m: CashflowMonthV2): ChartTooltipRow[] =>
  m.net_cents < 0 ? [{ label: 'Month with a loss', value: signedEur(m.net_cents) }] : []

const HISTORY_MONTHS = 6

type ForecastRow = {
  date: Date
  actual: number | null
  low: number | null
  mid: number | null
  high: number | null
}

const monthDate = (month: string): Date => new Date(`${month}-01T00:00:00Z`)

/** The last months of regular net, then the forecast band; the lines meet at the last real month. */
function forecastRows(months: readonly CashflowMonthV2[], forecast: Forecast): ForecastRow[] {
  const history = months.slice(-HISTORY_MONTHS)
  const rows: ForecastRow[] = history.map((m, i) => {
    const last = i === history.length - 1
    return {
      date: monthDate(m.month),
      actual: m.regular_net_cents,
      low: last ? m.regular_net_cents : null,
      mid: last ? m.regular_net_cents : null,
      high: last ? m.regular_net_cents : null,
    }
  })
  for (const f of forecast.months) {
    rows.push({
      date: monthDate(f.month),
      actual: null,
      low: f.low_cents,
      mid: f.mid_cents,
      high: f.high_cents,
    })
  }
  return rows
}

const FORECAST_SERIES: ChartSeries<ForecastRow>[] = [
  {
    key: 'actual',
    label: 'Regular net',
    color: FINANCE_SPLIT.regular,
    getValue: (r) => r.actual,
    formatValue: signedEur,
  },
  {
    key: 'mid',
    label: 'Expected',
    color: FINANCE_SPLIT.regular,
    dash: 'dashed',
    getValue: (r) => r.mid,
    formatValue: signedEur,
  },
  {
    key: 'high',
    label: 'Best case',
    color: FINANCE_SPLIT.leftover,
    dash: 'dashed',
    strokeOpacity: 0.7,
    getValue: (r) => r.high,
    formatValue: signedEur,
  },
  {
    key: 'low',
    label: 'Worst case',
    color: FINANCE_SPLIT.oneoff,
    dash: 'dashed',
    strokeOpacity: 0.7,
    getValue: (r) => r.low,
    formatValue: signedEur,
  },
]

export function ReportPage() {
  const { range, noData } = useRange()
  const report = useReport(range)
  if (noData) return <NoDataState />

  const data = report.data
  const months = data?.months ?? []
  const period = data?.period
  const fixed = data?.fixed
  const forecast = data?.forecast
  const loading = report.isPending
  const failed =
    report.error === null
      ? {}
      : {
          state: {
            kind: 'error' as const,
            error: report.error,
            onRetry: () => void report.refetch(),
          },
        }
  const span =
    period === undefined ? undefined : `${monthTick(period.from)} – ${monthTick(period.to)}`
  const worst = data?.loss_months.toSorted((a, b) => a.net_cents - b.net_cents)[0]

  const cells: StatStripCell[] = [
    {
      key: 'net',
      caption: 'Net',
      ...(span !== undefined && { qualifier: span }),
      info: 'Income minus spending over the selected months, one-offs included.',
      value: period === undefined ? null : signedEur(period.net_cents),
      ...(period !== undefined && toneProp(period.net_cents)),
      ...(period !== undefined && {
        footer: `Regular ${signedEur(period.regular_net_cents)} · one-offs ${signedEur(period.one_off_cents)}`,
      }),
      visual: (
        <Sparkline
          ariaLabel="Net per month, selected months, in euros"
          data={months.map((m) => m.net_cents)}
          height={28}
          reference={0}
          emphasizeLast
          format={signedEur}
        />
      ),
      loading,
      ...failed,
    },
    {
      key: 'savings',
      caption: 'Savings rate',
      ...(span !== undefined && { qualifier: span }),
      info: 'Net divided by income. Negative when spending exceeded income.',
      value: period === undefined ? null : ratio(period.savings_rate),
      ...(period?.savings_rate != null && toneProp(period.savings_rate)),
      footer: 'of income kept',
      visual: (
        <Sparkline
          ariaLabel="Savings rate per month, selected months"
          // One bar per month: a month without income has no rate and draws no bar, so the months stay aligned.
          data={months.map((m) => m.savings_rate ?? 0)}
          labels={months.map((m) => `${monthTick(m.month)}: ${ratio(m.savings_rate)}`)}
          height={28}
          mark="bar"
          format={(v) => ratio(v)}
        />
      ),
      loading,
      ...failed,
    },
    {
      key: 'loss-months',
      caption: 'Months with a loss',
      ...(span !== undefined && { qualifier: span }),
      info: 'Months whose net was below zero.',
      value: period === undefined ? null : `${period.loss_months} of ${period.months}`,
      ...(period !== undefined && {
        tone: period.loss_months > 0 ? ('bad' as const) : ('good' as const),
      }),
      ...(worst !== undefined && {
        footer: `Worst: ${monthTick(worst.month)} ${signedEur(worst.net_cents)}`,
      }),
      visual: (
        <Sparkline
          ariaLabel="Net per month as bars, selected months, in euros"
          data={months.map((m) => m.net_cents)}
          height={28}
          mark="bar"
          format={signedEur}
        />
      ),
      loading,
      ...failed,
    },
    {
      key: 'free-budget',
      caption: 'Left after fixed costs',
      qualifier: 'per month, typical',
      info: 'Typical monthly income minus the current fixed commitments: what everything else has to fit into.',
      value: fixed === undefined ? null : eur(fixed.free_budget_cents),
      ...(fixed !== undefined && toneProp(fixed.free_budget_cents)),
      visual:
        fixed === undefined ? undefined : (
          <Meter
            label="Fixed costs against typical income"
            value={Math.abs(fixed.total_cents)}
            max={Math.max(fixed.typical_income_cents, Math.abs(fixed.total_cents), 1)}
            format={eur}
            startCaption={`Fixed ${eur(Math.abs(fixed.total_cents))}`}
            endCaption={`Income ${eur(fixed.typical_income_cents)}`}
          />
        ),
      loading,
      ...failed,
    },
  ]

  return (
    <Stack gap="sm">
      <RangeBar />
      <StatGroup variant="strip" label="The period at a glance" cols={4} cells={cells} />
      <QueryCard
        title="Which months lost money, and why?"
        info="Per month: the regular net (income minus fixed and variable spending) and the one-offs (trips, shared costs, their reimbursements) stacked around zero. The line is their sum, the month's net. A shaded month ended below zero."
        query={report}
        empty={months.length === 0 ? 'No bookings in the selected months.' : false}
        facts={
          period === undefined
            ? undefined
            : [
                {
                  value: `${period.loss_months} of ${period.months}`,
                  unit: 'months with a loss',
                  tone: period.loss_months > 0 ? 'bad' : 'good',
                },
                {
                  value: signedEur(period.one_off_cents),
                  unit: 'from one-offs',
                  period: `${signedEur(period.regular_net_cents)} regular`,
                  tone: gainTone(period.one_off_cents) ?? 'muted',
                },
              ]
        }
      >
        <Stack gap="xs">
          <Bars<CashflowMonthV2, string>
            data={months}
            ariaLabel="Regular net and one-offs per month with the net line, in euros"
            x={(m) => m.month}
            formatX={monthTick}
            bars={BARS}
            lines={NET_LINE}
            layout="stacked"
            y={{ format: eurCompact }}
            refLines={[{ value: 0, color: VX.muted }]}
            xZones={months
              .filter((m) => m.net_cents < 0)
              .map((m) => ({
                from: m.month,
                to: m.month,
                fill: alpha(VX.status.bad, 0.12),
                align: 'edge' as const,
              }))}
            tooltip={{ rows: lossRows }}
            height={{ base: 280, regular: 360 }}
          />
          <MonthStrip months={months} />
        </Stack>
      </QueryCard>
      <SimpleGrid type="container" cols={{ base: 1, [CONTAINER_KEYS.wide]: 2 }}>
        <QueryCard
          title="What stands out?"
          info="Generated from the numbers: every sentence names a fact you can open."
          query={report}
          empty={data?.sentences.length === 0 ? 'Not enough bookings to report on yet.' : false}
          content
        >
          <SentenceList sentences={data?.sentences ?? []} />
        </QueryCard>
        <QueryCard
          title="What can I expect next?"
          info="Regular net for the next months: income and fixed costs as they are now, variable spending between its typical low and high. One-offs are not predicted."
          query={report}
          empty={
            forecast === undefined || forecast.months.length === 0
              ? 'Not enough history to forecast.'
              : false
          }
          ghost="line"
          facts={
            forecast === undefined
              ? undefined
              : [
                  {
                    value: eur(forecast.year_end.mid_cents),
                    unit: `cash at end of ${monthName(forecast.year_end.month)}`,
                    period: `range ${eur(forecast.year_end.low_cents)} to ${eur(forecast.year_end.high_cents)}`,
                  },
                  ...(forecast.months[0] === undefined
                    ? []
                    : [
                        {
                          value: signedEur(forecast.months[0].mid_cents),
                          unit: `expected in ${monthName(forecast.months[0].month)}`,
                          tone: gainTone(forecast.months[0].mid_cents) ?? ('muted' as const),
                        },
                      ]),
                ]
          }
        >
          <Lines<ForecastRow, Date>
            data={forecast === undefined ? [] : forecastRows(months, forecast)}
            ariaLabel="Regular net, last months and the forecast range for the next months, in euros"
            x={(r) => r.date}
            formatX={(d) => monthTick(d.toISOString().slice(0, 7))}
            series={FORECAST_SERIES}
            y={{ format: eurCompact }}
            refLines={[{ value: 0, color: VX.muted }]}
            height={{ base: 260, regular: 300 }}
          />
        </QueryCard>
      </SimpleGrid>
    </Stack>
  )
}
