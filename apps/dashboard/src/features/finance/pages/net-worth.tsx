import { SimpleGrid, Stack } from '@mantine/core'
import { Lines, StackedArea } from 'basalt-ui/charts'
import type { ChartSeries } from 'basalt-ui/charts'
import { VX, CONTAINER_KEYS } from 'basalt-ui/tokens'
import { useMeta, useNetWorth } from '../api/queries'
import type { Account, BalanceMonth, NetWorthMonth } from '../api/types'
import { FinanceBar } from '../components/finance-bar'
import { QueryCard } from '../components/query-card'
import { eur, eurCompact, gainTone, signedEur } from '../lib/format'
import { monthName, monthTick } from '../lib/months'
import { financeAccountColor, FINANCE_SPLIT } from '../../../lib/series'

/** The window the growth fact compares against. */
const GROWTH_MONTHS = 12

/** A month is drawn as the first of that month, UTC, so the time axis reads whole months. */
const monthDate = (month: string): Date => new Date(`${month}-01T00:00:00Z`)
const dateTick = (d: Date): string => monthTick(d.toISOString().slice(0, 7))

type AccountRow = { month: string; balances: Record<string, number | null> }

/**
 * One row per month with every account's balance. A month an account has no statement for keeps its
 * previous known balance; before its first one the account has no value (a gap), never 0.
 */
function accountRows(balances: readonly BalanceMonth[]): AccountRow[] {
  const known = new Map<string, Map<string, number>>()
  const months = new Set<string>()
  for (const b of balances) {
    months.add(b.month)
    const byMonth = known.get(b.account_id) ?? new Map<string, number>()
    byMonth.set(b.month, b.balance_cents)
    known.set(b.account_id, byMonth)
  }
  const last = new Map<string, number>()
  return [...months].toSorted().map((month) => {
    const row: AccountRow = { month, balances: {} }
    for (const [id, byMonth] of known) {
      const value = byMonth.get(month)
      if (value !== undefined) last.set(id, value)
      row.balances[id] = last.get(id) ?? null
    }
    return row
  })
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

const accountBands = (accounts: readonly Account[], ids: readonly string[]) =>
  ids.map((id, index) => ({
    key: id,
    label: accounts.find((a) => a.id === id)?.name ?? id,
    color: financeAccountColor(index),
    getValue: (r: AccountRow) => r.balances[id] ?? null,
    formatValue: eur,
  }))

export function NetWorthPage() {
  const netWorth = useNetWorth()
  const meta = useMeta()

  const months = netWorth.data?.net_worth ?? []
  const hasDepot = months.some((m) => m.depot_cents !== null)
  const totalSeries = hasDepot ? TOTAL_SERIES : TOTAL_SERIES.filter((s) => s.key !== 'depot')
  const rows = accountRows(netWorth.data?.balances ?? [])
  const accountIds = [
    ...new Set((netWorth.data?.balances ?? []).map((b) => b.account_id)),
  ].toSorted()
  const latest = months.at(-1)
  const before = months.at(-1 - GROWTH_MONTHS) ?? months.at(0)
  const growth =
    latest !== undefined && before !== undefined ? latest.total_cents - before.total_cents : null

  return (
    <Stack gap="sm">
      <FinanceBar />
      <SimpleGrid type="container" cols={{ base: 1, [CONTAINER_KEYS.wide]: 2 }}>
        <QueryCard
          title="Am I getting wealthier?"
          info="Sum of the account balances per month, the depot from holdings where there is one."
          query={netWorth}
          empty={months.length === 0 ? 'No balances recorded yet.' : false}
          ghost="line"
          facts={
            latest === undefined
              ? undefined
              : [
                  { value: eur(latest.total_cents), period: monthName(latest.month) },
                  ...(growth === null || before === undefined || before.month === latest.month
                    ? []
                    : [
                        {
                          value: signedEur(growth),
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
            height={{ base: 260, regular: 320 }}
          />
        </QueryCard>
        <QueryCard
          title="Which accounts hold it?"
          info="The last known balance of each account per month, stacked to the total."
          query={netWorth}
          empty={rows.length === 0 ? 'No account balances recorded yet.' : false}
          ghost="line"
        >
          <StackedArea<AccountRow, Date>
            data={rows}
            ariaLabel="Balance per account and month, stacked, in euros"
            x={(r) => monthDate(r.month)}
            formatX={dateTick}
            series={accountBands(meta.data?.accounts ?? [], accountIds)}
            y={{ format: eurCompact }}
            height={{ base: 260, regular: 320 }}
          />
        </QueryCard>
      </SimpleGrid>
    </Stack>
  )
}
