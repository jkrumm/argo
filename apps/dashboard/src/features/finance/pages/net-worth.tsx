import { Box, Text } from '@mantine/core'
import { StatGroup } from 'basalt-ui'
import type { StatStripCell } from 'basalt-ui'
import { Lines, StackedArea } from 'basalt-ui/charts'
import type { ChartSeries } from 'basalt-ui/charts'
import { date } from 'basalt-ui/format'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/table'
import { VX } from 'basalt-ui/tokens'
import { useHoldings, useMeta, useNetWorth } from '../api/queries'
import type { AccountSeries, Holding, NetWorthMonth } from '../api/types'
import { FinanceBar } from '../components/finance-bar'
import { NoDataState } from '../components/no-data-state'
import { QueryCard } from '../components/query-card'
import { deltaEur, eur, eurCompact, gainTone, ratio } from '../lib/format'
import { dayMonth, monthName, monthTick } from '../lib/months'
import { financeAccountColor, FINANCE_SPLIT } from '../../../lib/series'
import classes from '../components/finance.module.css'

/** The window the growth fact compares against. */
const GROWTH_MONTHS = 12

/** A month is drawn as the first of that month, UTC, so the time axis reads whole months. */
const monthDate = (month: string): Date => new Date(`${month}-01T00:00:00Z`)
const dateTick = (d: Date): string => monthTick(d.toISOString().slice(0, 7))

type StackRow = { month: string; values: Record<string, number | null> }

/** One row per month with every account's month-end value; before an account's first value it has none (a gap), never 0. */
function stackRows(accounts: readonly AccountSeries[]): StackRow[] {
  const months = [...new Set(accounts.flatMap((a) => a.series.map((p) => p.month)))].toSorted()
  return months.map((month) => ({
    month,
    values: Object.fromEntries(
      accounts.map((a) => [
        a.account_id,
        a.series.find((p) => p.month === month)?.balance_cents ?? null,
      ]),
    ),
  }))
}

const TOTAL_SERIES: ChartSeries<NetWorthMonth>[] = [
  {
    key: 'total',
    label: 'Total',
    color: VX.ink,
    strokeWidth: 2.5,
    getValue: (m) => m.total_cents,
    formatValue: eur,
  },
  {
    key: 'cash',
    label: 'Cash',
    color: FINANCE_SPLIT.regular,
    getValue: (m) => m.cash_cents,
    formatValue: eur,
  },
  {
    key: 'depot',
    label: 'Depot',
    color: FINANCE_SPLIT.leftover,
    getValue: (m) => m.depot_cents,
    formatValue: eur,
  },
]

type HistoryPoint = { as_of: string; value_cents: number }

const DEPOT_SERIES: ChartSeries<HistoryPoint>[] = [
  {
    key: 'depot',
    label: 'Depot value',
    color: FINANCE_SPLIT.leftover,
    strokeWidth: 2.5,
    getValue: (p) => p.value_cents,
    formatValue: eur,
  },
]

type AccountLine = {
  id: string
  name: string
  kind: string
  balance: number
  as_of: string
  extrapolated: boolean
}
const accountCol = createColumnHelper<AccountLine>()
const positionCol = createColumnHelper<Holding>()

export function NetWorthPage() {
  const netWorth = useNetWorth()
  const holdings = useHoldings()
  const meta = useMeta()
  if (meta.isSuccess && meta.data.last_month === null) return <NoDataState />

  const months = netWorth.data?.net_worth ?? []
  const hasDepot = months.some((m) => m.depot_cents !== null)
  const totalSeries = hasDepot ? TOTAL_SERIES : TOTAL_SERIES.filter((s) => s.key !== 'depot')
  const latest = months.at(-1)
  const before = months.at(-1 - GROWTH_MONTHS) ?? months.at(0)
  const growth =
    latest !== undefined && before !== undefined && before.month !== latest.month
      ? latest.total_cents - before.total_cents
      : null

  // The first month the depot adds to the total: a step in the line there is the import, not saving.
  const depotStart = months.find(
    (m, i) => i > 0 && m.depot_cents !== null && months[i - 1]?.depot_cents == null,
  )
  const accountSeries = (netWorth.data?.accounts ?? [])
    .filter((a) => a.series.length > 0)
    .toSorted(
      (a, b) => (b.series.at(-1)?.balance_cents ?? 0) - (a.series.at(-1)?.balance_cents ?? 0),
    )
  const rows = stackRows(accountSeries)
  const lines: AccountLine[] = accountSeries.map((a) => {
    const last = a.series.at(-1)
    return {
      id: a.account_id,
      name: a.name,
      kind: a.kind,
      balance: last?.balance_cents ?? 0,
      as_of: last?.month ?? '',
      extrapolated: last?.extrapolated === 1,
    }
  })
  const positive = lines.reduce((sum, l) => sum + Math.max(l.balance, 0), 0)

  const positions = holdings.data?.positions ?? []
  const depotValue = positions.reduce((sum, p) => sum + (p.value_cents ?? 0), 0)
  const history = holdings.data?.history ?? []
  const depotTicks = [history.at(0), history.at(Math.floor(history.length / 2)), history.at(-1)]
    .filter((p) => p !== undefined)
    .map((p) => new Date(`${p.as_of}T00:00:00Z`))
  const depotFirst = history.at(0)
  const depotLast = history.at(-1)
  const depotChange =
    depotFirst !== undefined && depotLast !== undefined && history.length > 1
      ? depotLast.value_cents - depotFirst.value_cents
      : null

  const loading = netWorth.isPending
  const failed =
    netWorth.error === null
      ? {}
      : {
          state: {
            kind: 'error' as const,
            error: netWorth.error,
            onRetry: () => void netWorth.refetch(),
          },
        }
  const cells: StatStripCell[] = [
    {
      key: 'total',
      caption: 'Net worth',
      qualifier: latest === undefined ? '' : `end of ${monthName(latest.month)}`,
      value: latest === undefined ? null : eur(latest.total_cents),
      ...(growth !== null &&
        before !== undefined && {
          delta: undefined,
          footer: `${deltaEur(growth)} since ${monthName(before.month)}`,
        }),
      loading,
      ...failed,
    },
    {
      key: 'cash',
      caption: 'Cash',
      qualifier: 'accounts',
      value: latest === undefined ? null : eur(latest.cash_cents),
      ...(latest?.extrapolated === 1 && {
        footer: 'Balance estimated from bookings after the last statement',
      }),
      loading,
      ...failed,
    },
    {
      key: 'depot',
      caption: 'Depot',
      qualifier:
        holdings.data?.as_of == null ? 'no import yet' : `as of ${date(holdings.data.as_of)}`,
      value: latest?.depot_cents == null ? null : eur(latest.depot_cents),
      loading,
      ...failed,
    },
  ]

  const accountColumns = [
    accountCol.accessor('name', { header: 'Account' }),
    accountCol.accessor('balance', {
      header: 'Balance',
      sortFn: 'basic',
      meta: { align: 'right' },
      cell: (c) => (
        <Text span inherit {...(c.getValue() < 0 && { c: VX.status.bad })}>
          {eur(c.getValue())}
          {c.row.original.extrapolated ? ' ~' : ''}
        </Text>
      ),
    }),
    accountCol.accessor((l) => (l.balance > 0 && positive > 0 ? l.balance / positive : 0), {
      id: 'share',
      header: 'Share',
      sortFn: 'basic',
      meta: { align: 'right', priority: 2 },
      cell: (c) => (c.getValue() === 0 ? '—' : ratio(c.getValue())),
    }),
    accountCol.accessor('as_of', {
      header: 'Month end',
      meta: { priority: 3 },
      cell: (c) => (c.getValue() === '' ? '—' : monthTick(c.getValue())),
    }),
  ]

  const positionColumns = [
    positionCol.accessor((p) => p.name ?? p.isin, {
      id: 'name',
      header: 'Position',
      cell: (c) => (
        <Box>
          <Text size="sm" fw={500} lineClamp={1}>
            {c.getValue()}
          </Text>
          <Text size="xs" c="dimmed">
            {c.row.original.isin}
          </Text>
        </Box>
      ),
    }),
    positionCol.accessor((p) => Number(p.quantity), {
      id: 'quantity',
      header: 'Units',
      meta: { align: 'right', priority: 3 },
      cell: (c) => c.getValue().toLocaleString(undefined, { maximumFractionDigits: 4 }),
    }),
    positionCol.accessor((p) => p.price_cents ?? 0, {
      id: 'price',
      header: 'Price',
      meta: { align: 'right', priority: 2 },
      cell: (c) => (c.row.original.price_cents === null ? '—' : eur(c.getValue())),
    }),
    positionCol.accessor((p) => p.value_cents ?? 0, {
      id: 'value',
      header: 'Value',
      sortFn: 'basic',
      meta: { align: 'right' },
      cell: (c) => (c.row.original.value_cents === null ? '—' : eur(c.getValue())),
    }),
    positionCol.accessor((p) => (depotValue > 0 ? (p.value_cents ?? 0) / depotValue : 0), {
      id: 'share',
      header: 'Share',
      sortFn: 'basic',
      meta: { align: 'right', priority: 1 },
      cell: (c) => ratio(c.getValue()),
    }),
    positionCol.accessor('as_of', {
      header: 'As of',
      meta: { priority: 4 },
      cell: (c) => date(c.getValue()),
    }),
  ]

  return (
    <Box className={classes.page}>
      <FinanceBar />
      <StatGroup variant="strip" label="Net worth at a glance" cols={3} cells={cells} />
      <Box className={`${classes.split} ${classes.splitHalf}`}>
        <QueryCard
          title="Am I getting wealthier?"
          info="Sum of the account balances at each month end, the depot from its imports where there is one."
          query={netWorth}
          empty={months.length === 0 ? 'No balances recorded yet.' : false}
          ghost="line"
          facts={
            latest === undefined
              ? undefined
              : [
                  {
                    value: eur(latest.total_cents),
                    period:
                      depotStart === undefined
                        ? monthName(latest.month)
                        : [
                            monthName(latest.month),
                            `depot counted from ${monthTick(depotStart.month)}`,
                          ],
                  },
                  ...(growth === null || before === undefined
                    ? []
                    : [
                        {
                          value: deltaEur(growth),
                          unit: `since ${monthName(before.month)}`,
                          tone: gainTone(growth) ?? ('muted' as const),
                        },
                      ]),
                ]
          }
        >
          <Lines<NetWorthMonth, Date>
            data={months}
            ariaLabel="Net worth, cash and depot per month, in euros"
            x={(m) => monthDate(m.month)}
            formatX={dateTick}
            series={totalSeries}
            y={{ format: eurCompact }}
            height={{ base: 240, regular: 300 }}
          />
        </QueryCard>
        <QueryCard
          title="Which accounts hold it?"
          info="The month-end value of each account, depot included, stacked to the total."
          query={netWorth}
          empty={rows.length === 0 ? 'No account balances recorded yet.' : false}
          ghost="line"
        >
          <StackedArea<StackRow, Date>
            data={rows}
            ariaLabel="Value per account and month, stacked, in euros"
            x={(r) => monthDate(r.month)}
            formatX={dateTick}
            series={accountSeries.map((a, index) => ({
              key: a.account_id,
              label: a.name,
              color: financeAccountColor(index),
              getValue: (r: StackRow) => r.values[a.account_id] ?? null,
              formatValue: eur,
            }))}
            y={{ format: eurCompact }}
            height={{ base: 240, regular: 300 }}
          />
        </QueryCard>
      </Box>
      <Box className={`${classes.split} ${classes.splitHalf}`}>
        <BasaltDataTable
          title="Accounts"
          subtitle="Latest month-end value. ~ marks a balance estimated from bookings after the last statement."
          data={lines}
          columns={accountColumns}
          getRowId={(l) => l.id}
          query={netWorth}
          skeletonRows={4}
          emptyState="No accounts with a balance yet."
          initialSorting={[{ id: 'balance', desc: true }]}
        />
        <QueryCard
          title="How did the depot move?"
          info="Total depot value on each import day."
          query={holdings}
          empty={history.length === 0 ? 'No depot import yet.' : false}
          ghost="line"
          facts={
            depotLast === undefined
              ? undefined
              : [
                  { value: eur(depotLast.value_cents), period: date(depotLast.as_of) },
                  ...(depotChange === null || depotFirst === undefined
                    ? []
                    : [
                        {
                          value: deltaEur(depotChange),
                          unit: `since ${date(depotFirst.as_of)}`,
                          tone: gainTone(depotChange) ?? ('muted' as const),
                        },
                      ]),
                ]
          }
        >
          <Lines<HistoryPoint, Date>
            data={history}
            ariaLabel="Depot value per import day, in euros"
            x={(p) => new Date(`${p.as_of}T00:00:00Z`)}
            formatX={(d) => dayMonth(d.toISOString().slice(0, 10))}
            xTicks={depotTicks}
            series={DEPOT_SERIES}
            y={{ format: eurCompact }}
            height={{ base: 200, regular: 240 }}
          />
        </QueryCard>
      </Box>
      <BasaltDataTable
        title="Depot positions"
        {...(holdings.data?.as_of != null && {
          subtitle: `As of the latest import, ${date(holdings.data.as_of)}.`,
        })}
        data={positions}
        columns={positionColumns}
        getRowId={(p) => `${p.account_id}-${p.isin}`}
        query={holdings}
        skeletonRows={5}
        emptyState="No depot positions imported yet."
        initialSorting={[{ id: 'value', desc: true }]}
        renderCard={(p) => (
          <Box className={classes.booking}>
            <Text size="sm" fw={500} className={classes.merchant}>
              {p.name ?? p.isin}
            </Text>
            <Text size="sm" className={classes.amount}>
              {p.value_cents === null ? '—' : eur(p.value_cents)}
            </Text>
            <Text size="xs" c="dimmed" className={classes.meta}>
              {Number(p.quantity).toLocaleString(undefined, { maximumFractionDigits: 4 })} units ·{' '}
              {depotValue > 0 ? ratio((p.value_cents ?? 0) / depotValue) : '—'} of the depot
            </Text>
          </Box>
        )}
      />
    </Box>
  )
}
