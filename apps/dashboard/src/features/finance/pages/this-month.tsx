import { Box, ColorSwatch, Group, Stack, Text } from '@mantine/core'
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import { BarList, Meter, StatGroup } from 'basalt-ui'
import type { StatStripCell } from 'basalt-ui'
import { Bars, Lines } from 'basalt-ui/charts'
import type { BarsBar, ChartSeries } from 'basalt-ui/charts'
import { FilterSet, SelectFilter } from 'basalt-ui/controls'
import { date } from 'basalt-ui/format'
import { VX, alpha } from 'basalt-ui/tokens'
import { createElement } from 'react'
import {
  useAllTransactions,
  useCategoryMonths,
  useMeta,
  useMonthStatus,
  useOverview,
  useTransactions,
} from '../api/queries'
import type { CashflowMonth, MonthStatus } from '../api/types'
import { BookingList } from '../components/booking-row'
import { CategoryBars } from '../components/category-bars'
import { FinanceBar } from '../components/finance-bar'
import { NoDataState } from '../components/no-data-state'
import { QueryCard } from '../components/query-card'
import { useMonthOptions } from '../components/range-bar'
import { deltaEur, eur, eurCompact, gainTone, ratio, signedEur, toneProp } from '../lib/format'
import { everyNth, monthName, monthTick, shiftMonth } from '../lib/months'
import { categoryLines, paceRows, type PaceRow, elapsedDays } from '../lib/pace'
import { FINANCE_SPLIT } from '../../../lib/series'
import { FILTERS_CLEARED, finStore } from '../../../lib/window-stores'
import classes from '../components/finance.module.css'
import { useField } from '../../../lib/use-field'

const HISTORY = 3
const TREND_MONTHS = 12
const LATEST = 10
const DUE_SHOWN = 8

/** The month a booking list or chart window starts at, not before the first month the vault has. */
const clampFrom = (month: string, first: string | null): string =>
  first !== null && month < first ? first : month

const PACE_SERIES = (projectedLabel: string): ChartSeries<PaceRow>[] => [
  {
    key: 'average',
    label: `Average of ${HISTORY} months`,
    color: VX.muted,
    dash: 'dashed',
    strokeWidth: 1.5,
    getValue: (r) => r.average,
    formatValue: eur,
  },
  {
    key: 'previous',
    label: 'Last month',
    color: VX.ink2,
    strokeWidth: 1.5,
    getValue: (r) => r.previous,
    formatValue: eur,
  },
  {
    key: 'projected',
    label: projectedLabel,
    color: FINANCE_SPLIT.regular,
    dash: 'dashed',
    strokeWidth: 2,
    getValue: (r) => r.projected,
    formatValue: eur,
  },
  {
    key: 'current',
    label: 'This month',
    color: FINANCE_SPLIT.regular,
    strokeWidth: 2.5,
    getValue: (r) => r.current,
    formatValue: eur,
  },
]

const NET_BARS: BarsBar<CashflowMonth>[] = [
  {
    key: 'net',
    label: 'Net',
    color: FINANCE_SPLIT.regular,
    getValue: (m) => m.net_cents,
    formatValue: signedEur,
  },
]

/** The parts of the month's income, in bar order; each has its own shade of the accent, the forecast part the lighter one. */
function splitParts(s: MonthStatus) {
  return [
    { key: 'spent', label: 'Spent', value: -s.spent_cents, color: FINANCE_SPLIT.fixed },
    { key: 'due', label: 'Due', value: -s.fixed_due_cents, color: FINANCE_SPLIT.variable },
    {
      key: 'expected',
      label: 'Expected',
      value: -s.variable_projection_cents,
      color: VX.muted,
      forecast: true,
    },
    {
      key: 'left',
      label: 'Left',
      value: Math.max(s.projected_end_cents, 0),
      color: FINANCE_SPLIT.leftover,
    },
  ].filter((part) => part.value > 0)
}

/** Where the month's income goes: spent, still due, the usual rest of the month (a forecast), what is left. */
function SplitMeter({ status: s }: { status: MonthStatus }) {
  const parts = splitParts(s)
  const total = parts.reduce((sum, p) => sum + p.value, 0)
  return (
    <Meter
      label="Income split into spent, still due, expected spending and left over"
      max={Math.max(s.income_cents, total)}
      format={eur}
      startCaption={null}
      endCaption={null}
      forecastCaption="Expected: the usual daily spending for the days left"
      segments={parts.map(({ value, label, color, forecast }) => ({
        value,
        label,
        color,
        ...(forecast === true && { forecast }),
      }))}
    />
  )
}

/** Names the parts of the split bar, in bar order, each with its swatch and its amount. */
function SplitLegend({ status: s }: { status: MonthStatus }) {
  return (
    <Group gap="sm" wrap="wrap">
      {splitParts(s).map((part) => (
        <Group key={part.key} gap={4} wrap="nowrap">
          <ColorSwatch size={8} color={part.color} withShadow={false} />
          <Text size="xs" c="dimmed">
            {part.label} {eur(part.value)}
          </Text>
        </Group>
      ))}
    </Group>
  )
}

export function ThisMonthPage() {
  const meta = useMeta()
  const [monthParam, setMonth] = useField(finStore.field.month)
  const status = useMonthStatus(monthParam)
  const options = useMonthOptions()
  const s = status.data
  const month = s?.month ?? null
  const first = meta.data?.first_month ?? null
  const last = meta.data?.last_month ?? null
  const categories = meta.data?.categories

  const windowQuery =
    month === null ? null : { from: clampFrom(shiftMonth(month, -HISTORY), first), to: month }
  const spend = useAllTransactions(windowQuery)
  const cats = useCategoryMonths(windowQuery)
  const trend = useOverview(
    month === null
      ? null
      : { from: clampFrom(shiftMonth(month, 1 - TREND_MONTHS), first), to: month },
  )
  const latest = useTransactions(
    month === null
      ? null
      : { from: month, to: month, limit: LATEST, sort: 'booked_on', dir: 'desc' },
  )

  const elapsed = s === undefined ? 0 : elapsedDays(s)
  const projectedSpend =
    s === undefined ? null : -(s.spent_cents + s.fixed_due_cents + s.variable_projection_cents)
  const pace =
    month === null || spend.data === undefined
      ? []
      : paceRows({
          rows: spend.data,
          month,
          elapsed,
          projectedEnd: s !== undefined && s.days_left > 0 ? projectedSpend : null,
          history: HISTORY,
        })
  const running = s !== undefined && s.days_left > 0
  const lines = month === null ? [] : categoryLines(cats.data ?? [], month, HISTORY)

  if (meta.isSuccess && meta.data.last_month === null) return <NoDataState />

  const shift = (delta: number) => {
    if (month !== null) setMonth(shiftMonth(month, delta))
  }
  const bar = (
    <FinanceBar
      filters={
        <FilterSet>
          <SelectFilter label="Month" field={finStore.field.month} options={options} clearable />
        </FilterSet>
      }
      filtersEnd={[
        {
          key: 'prev',
          label: 'Previous month',
          icon: createElement(IconChevronLeft, { size: 16 }),
          disabled: month === null || (first !== null && month <= first),
          onClick: () => shift(-1),
        },
        {
          key: 'next',
          label: 'Next month',
          icon: createElement(IconChevronRight, { size: 16 }),
          disabled: month === null || (last !== null && month >= last),
          onClick: () => shift(1),
        },
      ]}
    />
  )

  const loading = status.isPending
  const failed =
    status.error === null
      ? {}
      : {
          state: {
            kind: 'error' as const,
            error: status.error,
            onRetry: () => void status.refetch(),
          },
        }
  const name = month === null ? '' : monthName(month)
  const leftAfterDue = s === undefined ? null : s.income_cents + s.spent_cents + s.fixed_due_cents

  const cells: StatStripCell[] = [
    {
      key: 'end',
      caption: 'Projected month end',
      qualifier: month === null ? '' : `end of ${name}`,
      info: 'Income so far, minus spending so far, minus what is still due, minus the usual variable spending for the days left (the average day of the last 3 months).',
      value: s === undefined ? null : signedEur(s.projected_end_cents),
      ...(s !== undefined && toneProp(s.projected_end_cents)),
      ...(s !== undefined &&
        s.income_cents > 0 && {
          visual: <SplitMeter status={s} />,
          footer: <SplitLegend status={s} />,
        }),
      loading,
      ...failed,
    },
    {
      key: 'day',
      caption: 'Can spend per day',
      qualifier:
        s === undefined || s.days_left === 0 ? 'month is over' : `for ${s.days_left} more days`,
      info: 'What is left after everything still due, split over the days left, today included.',
      value: s === undefined || s.daily_budget_cents === null ? null : eur(s.daily_budget_cents),
      ...(s?.daily_budget_cents === 0 && { tone: 'bad' as const }),
      footer:
        leftAfterDue === null ? undefined : `${signedEur(leftAfterDue)} left after what is due`,
      loading,
      ...failed,
    },
    {
      key: 'flow',
      caption: 'Received, spent, due',
      qualifier: month === null ? '' : name,
      info: 'Booked income and spending of this budget month (a salary booked from the 20th counts for the next month) and the recurring charges not yet booked.',
      rows:
        s === undefined
          ? []
          : [
              { key: 'in', label: 'Received', value: signedEur(s.income_cents) },
              { key: 'out', label: 'Spent', value: signedEur(s.spent_cents) },
              { key: 'due', label: 'Still due', value: signedEur(s.fixed_due_cents) },
            ],
      loading,
      ...failed,
    },
  ]

  const dueAll = (s?.fixed_due ?? []).toSorted((a, b) => a.expected_on.localeCompare(b.expected_on))
  const dueItems = dueAll.slice(0, DUE_SHOWN).map((d) => ({
    key: `${d.merchant}-${d.expected_on}`,
    label: d.merchant,
    value: -d.amount_cents,
    secondary: date(d.expected_on),
  }))

  const sameDay = s === undefined ? null : -s.last_month_same_day.spent_cents
  const spentNow = s === undefined ? null : -s.spent_cents
  const paceDelta = sameDay === null || spentNow === null ? null : spentNow - sameDay
  const paceFacts =
    s === undefined || spentNow === null
      ? undefined
      : [
          {
            value: eur(spentNow),
            unit: 'spent',
            period: s.days_left === 0 ? name : `by day ${elapsed}`,
          },
          ...(paceDelta === null || s.days_left === 0 || sameDay === 0
            ? []
            : [
                {
                  value: deltaEur(paceDelta),
                  unit: 'vs last month',
                  period: 'same day',
                  tone:
                    Math.abs(paceDelta) < (sameDay ?? 0) * 0.03
                      ? ('muted' as const)
                      : (gainTone(-paceDelta) ?? ('muted' as const)),
                },
              ]),
        ]

  const trendMonths = trend.data?.months ?? []
  const avgRate = trend.data?.totals.savings_rate ?? null

  return (
    <Box className={classes.page}>
      {bar}
      <StatGroup variant="strip" label="Where the month stands" cols={3} cells={cells} />
      <Box className={`${classes.split} ${classes.splitWide}`}>
        <QueryCard
          title="Is this month running faster than usual?"
          info="Spending added up day by day. The solid line is this month so far, the dashed run in the shaded days to come continues to the projected month end. The grey lines are last month and the average of the 3 months before. The green line is what came in."
          query={spend}
          empty={pace.length === 0 ? 'No spending booked in these months yet.' : false}
          ghost="line"
          facts={paceFacts}
        >
          <Lines<PaceRow, number>
            data={pace}
            ariaLabel="Cumulative spending by day of the month, this month against last month and the average, in euros"
            x={(r) => r.day}
            formatX={(d) => String(d)}
            xTicks={s === undefined ? 5 : [1, 8, 15, 22, s.days_total]}
            series={PACE_SERIES('Projected month end')}
            y={{ format: eurCompact }}
            xZones={
              s === undefined || elapsed === 0 || elapsed >= s.days_total
                ? []
                : [{ from: elapsed, to: s.days_total, fill: alpha(VX.ink, 0.05) }]
            }
            refLines={
              s === undefined || s.income_cents <= 0
                ? []
                : [
                    {
                      value: s.income_cents,
                      color: VX.status.good,
                      dashed: true,
                      label: 'Received',
                    },
                  ]
            }
            height={{ base: 260, regular: 300 }}
          />
          {elapsed > 0 && s !== undefined && s.days_left > 0 && (
            <Text size="xs" c="dimmed">
              Shaded: the days still to come, drawn at the projected pace.
            </Text>
          )}
        </QueryCard>
        <QueryCard
          title="Still due"
          info="Recurring charges expected before the month ends that have not been booked yet."
          query={status}
          empty={dueAll.length === 0 ? 'Nothing more is due this month.' : false}
          content
          facts={
            s === undefined || dueAll.length === 0
              ? undefined
              : {
                  value: eur(-s.fixed_due_cents),
                  unit: `in ${dueAll.length} ${dueAll.length === 1 ? 'charge' : 'charges'}`,
                  period: `until ${date(`${s.month}-${String(s.days_total).padStart(2, '0')}`)}`,
                }
          }
        >
          <BarList
            label="Charges still due this month, in euros"
            items={dueItems}
            format={eur}
            loading={status.isPending}
            loadingRows={5}
          />
          {dueAll.length > DUE_SHOWN && (
            <Text size="xs" c="dimmed">
              {dueAll.length - DUE_SHOWN} more,{' '}
              {eur(dueAll.slice(DUE_SHOWN).reduce((sum, d) => sum - d.amount_cents, 0))}, until the
              month ends
            </Text>
          )}
        </QueryCard>
      </Box>
      <Box className={`${classes.split} ${classes.splitHalf}`}>
        <QueryCard
          title={
            running
              ? 'How much of a usual month is spent?'
              : 'Which categories ran above their average?'
          }
          info="Spending per top category this month. The tick is the average month of the 3 before. While the month runs, the figure beside each bar is that average; once it is over, it is the difference."
          query={cats}
          empty={lines.length === 0 ? 'No spending in this month and the 3 before.' : false}
          content
          facts={
            lines.length === 0
              ? undefined
              : {
                  value: eur(lines.reduce((sum, l) => sum + l.current, 0)),
                  unit: running ? 'spent so far' : 'spent',
                  period: running
                    ? `of ${eur(lines.reduce((sum, l) => sum + l.average, 0))} in an average month`
                    : `${signedEur(lines.reduce((sum, l) => sum + l.delta, 0))} vs an average month`,
                }
          }
        >
          <CategoryBars lines={lines} categories={categories} partial={running} />
        </QueryCard>
        <QueryCard
          title="How did the last 12 months end?"
          info="Net per month: income minus spending, one-offs included. Under the chart each month shows the share of income kept; ▼ marks a month with a loss. Tap a month to open it."
          query={trend}
          empty={trendMonths.length === 0 ? 'No months to show yet.' : false}
          facts={
            trend.data === undefined
              ? undefined
              : [
                  {
                    value: signedEur(trend.data.totals.net),
                    unit: 'net',
                    period: `${monthTick(trendMonths[0]?.month ?? '')} to ${monthTick(trendMonths.at(-1)?.month ?? '')}`,
                    tone: gainTone(trend.data.totals.net) ?? 'muted',
                  },
                  ...(avgRate === null
                    ? []
                    : [
                        {
                          value: ratio(avgRate),
                          unit: 'of income kept',
                          period: 'over the period',
                        },
                      ]),
                ]
          }
        >
          <Stack gap="xs">
            <Bars<CashflowMonth, string>
              data={trendMonths}
              ariaLabel="Net per month, last 12 months, in euros"
              x={(m) => m.month}
              formatX={monthTick}
              xTicks={everyNth(
                trendMonths.map((m) => m.month),
                2,
              )}
              bars={NET_BARS}
              y={{ format: eurCompact }}
              refLines={[{ value: 0, color: VX.muted }]}
              barOpacity={(m) => (m.month === month ? 1 : 0.55)}
              height={{ base: 200, regular: 240 }}
            />
            <Box className={classes.ribbon} component="nav" aria-label="Open a month">
              {trendMonths.map((m) => (
                <Link
                  key={m.month}
                  to="/finance"
                  search={{ ...FILTERS_CLEARED, month: m.month }}
                  className={classes.ribbonLink}
                  {...(m.month === month && { 'data-current': true })}
                >
                  <Text size="xs" c={m.net_cents < 0 ? VX.status.bad : VX.ink2}>
                    {m.net_cents < 0 ? '▼ ' : ''}
                    {monthTick(m.month)}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {m.savings_rate === null ? '—' : ratio(m.savings_rate)}
                  </Text>
                </Link>
              ))}
            </Box>
          </Stack>
        </QueryCard>
      </Box>
      <QueryCard
        title="Latest bookings"
        info="The newest bookings of this month. Change a category here and it is saved at once."
        query={latest}
        empty={latest.data?.rows.length === 0 ? 'No bookings in this month yet.' : false}
        content
        actions={
          <Link to="/finance/transactions" search={finStore.linkSearch}>
            All bookings
          </Link>
        }
      >
        <BookingList rows={latest.data?.rows ?? []} inline />
      </QueryCard>
    </Box>
  )
}
