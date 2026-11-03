import { Box, Button, Text } from '@mantine/core'
import { useRef } from 'react'
import { Link } from '@tanstack/react-router'
import { BarList, DeltaBadge } from 'basalt-ui'
import { Bars, Sparkline } from 'basalt-ui/charts'
import type { BarsBar } from 'basalt-ui/charts'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/table'
import { VX } from 'basalt-ui/tokens'
import { useCategoryMonths, useMerchants, useMonthStatus } from '../api/queries'
import type { CategoryMonth, Category, Month } from '../api/types'
import { NoDataState } from '../components/no-data-state'
import { QueryCard } from '../components/query-card'
import { RangeBar } from '../components/range-bar'
import { NONE, merchantFilter, merchantLabel, topLabel } from '../lib/categories'
import { deltaEur, eur, eurCompact, gainTone } from '../lib/format'
import { everyNth, monthName, monthTick, monthsBetween } from '../lib/months'
import { useRange } from '../lib/use-range'
import { FINANCE_SPLIT } from '../../../lib/series'
import { FILTERS_CLEARED, finStore } from '../../../lib/window-stores'
import classes from '../components/finance.module.css'

const MERCHANTS_SHOWN = 12

type SpendRow = {
  key: string
  total: number
  perMonth: number
  monthly: number[]
  /** The last complete month of the range against the one before it; null without two. */
  change: number | null
}

/** Spending (positive cents) per top category and month of the range. */
function spendRows(
  rows: readonly CategoryMonth[],
  months: readonly Month[],
  complete: number,
): SpendRow[] {
  const byKey = new Map<string, Map<Month, number>>()
  for (const r of rows) {
    if (r.kind !== 'expense') continue
    const key = r.top_category ?? NONE
    const perMonth = byKey.get(key) ?? new Map<Month, number>()
    perMonth.set(r.month, (perMonth.get(r.month) ?? 0) - r.amount_cents)
    byKey.set(key, perMonth)
  }
  return [...byKey.entries()]
    .map(([key, perMonth]) => {
      const monthly = months.map((m) => perMonth.get(m) ?? 0)
      const total = monthly.reduce((sum, v) => sum + v, 0)
      const done = monthly.slice(0, complete)
      const last = done.at(-1)
      const before = done.at(-2)
      return {
        key,
        total,
        perMonth: Math.round(total / Math.max(months.length, 1)),
        monthly,
        change: last === undefined || before === undefined ? null : last - before,
      }
    })
    .filter((r) => r.total > 0)
    .toSorted((a, b) => b.total - a.total)
}

type MonthTotal = { month: Month; spent: number }

const BARS: BarsBar<MonthTotal>[] = [
  {
    key: 'spent',
    label: 'Spent',
    color: FINANCE_SPLIT.regular,
    getValue: (m) => m.spent,
    formatValue: eur,
  },
]

const col = createColumnHelper<SpendRow>()

export function SpendingPage() {
  const { range, noData, meta } = useRange()
  const cats = useCategoryMonths(range)
  const merchantsRef = useRef<HTMLDivElement>(null)
  const current = useMonthStatus('')
  const filters = finStore.useValues()
  const [focus, setFocus] = finStore.field.focus.use()
  const categories: readonly Category[] | undefined = meta.data?.categories
  const merchants = useMerchants(
    range === null ? null : { ...range, ...(focus !== '' && { category: focus }) },
  )
  if (noData) return <NoDataState />

  const months = range === null ? [] : monthsBetween(range.from, range.to)
  // The running month is partial: a change against it would read as a saving that is just a date.
  const running =
    current.data !== undefined && current.data.days_left > 0 && range?.to === current.data.month
  const complete = running ? months.length - 1 : months.length
  const rows = spendRows(cats.data ?? [], months, complete)
  const grandTotal = rows.reduce((sum, r) => sum + r.total, 0)
  const focused = rows.find((r) => r.key === focus)
  const focusLabel =
    focus === '' ? 'all categories' : topLabel(categories, focus === NONE ? null : focus)
  const series: MonthTotal[] = months.map((m, i) => ({
    month: m,
    spent: (focused === undefined ? rows : [focused]).reduce(
      (sum, r) => sum + (r.monthly[i] ?? 0),
      0,
    ),
  }))
  const seriesTotal = series.reduce((sum, m) => sum + m.spent, 0)
  const lastChange = (series[complete - 1]?.spent ?? 0) - (series[complete - 2]?.spent ?? 0)
  const seriesAvg = Math.round(seriesTotal / Math.max(series.length, 1))

  const merchantItems = (merchants.data ?? [])
    .filter((m) => m.amount_cents < 0)
    .toSorted((a, b) => a.amount_cents - b.amount_cents)
    .slice(0, MERCHANTS_SHOWN)
    .map((m) => ({
      key: m.merchant,
      label: merchantLabel(m.merchant),
      value: -m.amount_cents,
      secondary: (
        <Link
          className={classes.quietLink}
          to="/finance/transactions"
          search={{
            ...FILTERS_CLEARED,
            from: filters.from,
            to: filters.to,
            category: focus === NONE ? '' : focus,
            merchant: merchantFilter(m.merchant),
          }}
        >
          {m.n} {m.n === 1 ? 'booking' : 'bookings'}
        </Link>
      ),
    }))

  const lastCompleteLabel =
    complete >= 2 ? `${monthTick(months[complete - 1] ?? '')} change` : 'Change'
  const columns = [
    col.accessor((r) => topLabel(categories, r.key === NONE ? null : r.key), {
      id: 'category',
      header: 'Category',
      sortFn: 'basic',
    }),
    col.accessor('total', {
      header: 'Total',
      sortFn: 'basic',
      meta: { align: 'right' },
      cell: (c) => eur(c.getValue()),
    }),
    col.accessor('perMonth', {
      header: 'Per month',
      sortFn: 'basic',
      meta: { align: 'right', priority: 2 },
      cell: (c) => eur(c.getValue()),
    }),
    col.accessor((r) => r.change ?? 0, {
      id: 'change',
      header: lastCompleteLabel,
      sortFn: 'basic',
      meta: { align: 'right', priority: 1 },
      cell: (c) => {
        const v = c.row.original.change
        return v === null || v === 0 ? (
          '—'
        ) : (
          <DeltaBadge value={v} polarity="up-bad" format={(d) => eur(Math.abs(d))} withGlyph />
        )
      },
    }),
    col.display({
      id: 'trend',
      header: 'Months',
      meta: { priority: 3 },
      cell: (c) => (
        <Sparkline
          ariaLabel={`Monthly spending, ${topLabel(categories, c.row.original.key === NONE ? null : c.row.original.key)}`}
          data={c.row.original.monthly}
          height={22}
          width={96}
          mark="bar"
          format={eur}
        />
      ),
    }),
  ]

  const toggle = (row: SpendRow) => {
    setFocus(focus === row.key ? '' : row.key)
    // On a phone the merchants sit below the list: bring them into view.
    const target = merchantsRef.current
    if (target !== null && target.getBoundingClientRect().top > window.innerHeight * 0.6) {
      target.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }

  return (
    <Box className={classes.page}>
      <RangeBar />
      <Box className={`${classes.split} ${classes.splitWide}`}>
        <BasaltDataTable
          title="Where does the money go?"
          {...(range !== null && {
            subtitle: `${monthName(range.from)} to ${monthName(range.to)}. Select a row to see its merchants.`,
          })}
          data={rows}
          columns={columns}
          getRowId={(r) => r.key}
          query={cats}
          skeletonRows={8}
          emptyState="No spending in the selected months."
          initialSorting={[{ id: 'total', desc: true }]}
          onRowActivate={toggle}
          renderCard={(r) => (
            <Box className={classes.booking}>
              <Text size="sm" fw={500} className={classes.merchant}>
                {topLabel(categories, r.key === NONE ? null : r.key)}
              </Text>
              <Text size="sm" className={classes.amount}>
                {eur(r.total)}
              </Text>
              <Text size="xs" c="dimmed" className={classes.meta}>
                {eur(r.perMonth)} a month
                {r.change === null || r.change === 0
                  ? ''
                  : ` · ${lastCompleteLabel} ${r.change > 0 ? '▲' : '▼'} ${eur(Math.abs(r.change))}`}
              </Text>
            </Box>
          )}
        />
        <Box ref={merchantsRef}>
          <QueryCard
            title={
              focus === ''
                ? 'Which merchants take the most?'
                : `Where exactly does ${focusLabel} go?`
            }
            info="Merchants summed over the selected months, largest first."
            query={merchants}
            empty={merchantItems.length === 0 ? 'No merchant spending in this selection.' : false}
            content
            actions={
              focus === '' ? undefined : (
                <Button variant="default" onClick={() => setFocus('')}>
                  All categories
                </Button>
              )
            }
            facts={
              focused === undefined && focus !== ''
                ? undefined
                : {
                    value: eur(focused?.total ?? grandTotal),
                    unit: 'spent',
                    period: `${focusLabel}, ${range === null ? '' : `${monthTick(range.from)} to ${monthTick(range.to)}`}`,
                  }
            }
          >
            <BarList
              label={`Top merchants of ${focusLabel}, in euros`}
              items={merchantItems}
              format={eur}
              loading={merchants.isPending}
              loadingRows={MERCHANTS_SHOWN}
            />
          </QueryCard>
        </Box>
      </Box>
      <QueryCard
        title={`How did ${focusLabel} move month by month?`}
        info="Spending per budget month; the line is the average month of the selection."
        query={cats}
        empty={series.every((m) => m.spent === 0) ? 'No spending in the selected months.' : false}
        ghost="bars"
        facts={[
          { value: eur(seriesAvg), unit: 'a month', period: `average, ${series.length} months` },
          ...(complete < 2
            ? []
            : [
                {
                  value: deltaEur(lastChange),
                  unit: `${monthTick(months[complete - 1] ?? '')} vs the month before`,
                  tone: gainTone(-lastChange) ?? ('muted' as const),
                },
              ]),
        ]}
      >
        <Bars<MonthTotal, string>
          data={series}
          ariaLabel={`Spending on ${focusLabel} per month, in euros`}
          x={(m) => m.month}
          formatX={monthTick}
          xTicks={everyNth(
            series.map((m) => m.month),
            2,
          )}
          bars={BARS}
          y={{ format: eurCompact }}
          refLines={[{ value: seriesAvg, color: VX.muted, dashed: true, label: 'Average' }]}
          height={{ base: 220, regular: 280 }}
        />
      </QueryCard>
    </Box>
  )
}
