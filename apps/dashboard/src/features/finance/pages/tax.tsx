import { SimpleGrid, Stack } from '@mantine/core'
import { BarList } from 'basalt-ui'
import { Bars } from 'basalt-ui/charts'
import type { BarsBar } from 'basalt-ui/charts'
import { FilterSet, SelectFilter } from 'basalt-ui/controls'
import { CONTAINER_KEYS } from 'basalt-ui/tokens'
import { useMeta, useTaxYear } from '../api/queries'
import type { TaxYearRow } from '../api/types'
import { NoDataState } from '../components/no-data-state'
import { FinanceBar } from '../components/finance-bar'
import { QueryCard } from '../components/query-card'
import { eur, eurCompact } from '../lib/format'
import { MONTH_UNIVERSE, monthTick } from '../lib/months'
import { FINANCE_SPLIT } from '../../../lib/series'
import { finStore } from '../../../lib/window-stores'

/** The tax tag the Gewerbe's costs carry. */
const BUSINESS_TAG = 'business'

type TagTotal = { tag: string | null; amount: number; n: number }
type CostMonth = { month: string; cost: number }

function tagTotals(rows: readonly TaxYearRow[]): TagTotal[] {
  const byTag = new Map<string | null, TagTotal>()
  for (const r of rows) {
    const row = byTag.get(r.tax_tag) ?? { tag: r.tax_tag, amount: 0, n: 0 }
    row.amount += r.amount_cents
    row.n += r.n
    byTag.set(r.tax_tag, row)
  }
  return [...byTag.values()].toSorted((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
}

/** Twelve months of the year, a month without business bookings reading zero. */
function businessCosts(rows: readonly TaxYearRow[], year: number): CostMonth[] {
  const months = MONTH_UNIVERSE.filter((m) => m.startsWith(`${year}-`))
  return months.map((month) => ({
    month,
    cost: -rows
      .filter((r) => r.tax_tag === BUSINESS_TAG && r.month === month)
      .reduce((sum, r) => sum + r.amount_cents, 0),
  }))
}

const COST_BARS: BarsBar<CostMonth>[] = [
  {
    key: 'cost',
    label: 'Business costs',
    color: FINANCE_SPLIT.regular,
    getValue: (m) => m.cost,
    formatValue: eur,
  },
]

export function TaxPage() {
  const meta = useMeta()
  const [selected] = finStore.field.year.use()
  const lastMonth = meta.data?.last_month ?? null
  const firstMonth = meta.data?.first_month ?? null
  const year =
    selected === '' ? (lastMonth === null ? null : Number(lastMonth.slice(0, 4))) : Number(selected)
  const tax = useTaxYear(year)
  if (meta.isSuccess && year === null) return <NoDataState />

  const years =
    firstMonth === null || lastMonth === null
      ? []
      : Array.from(
          { length: Number(lastMonth.slice(0, 4)) - Number(firstMonth.slice(0, 4)) + 1 },
          (_, i) => String(Number(lastMonth.slice(0, 4)) - i),
        ).map((value) => ({ value, label: value }))

  const rows = tax.data ?? []
  const totals = tagTotals(rows)
  const costs = year === null ? [] : businessCosts(rows, year)
  const businessTotal = costs.reduce((sum, m) => sum + m.cost, 0)
  const bookings = totals.reduce((sum, t) => sum + t.n, 0)
  const tagged = totals.filter((t) => t.tag !== null).reduce((sum, t) => sum + t.n, 0)
  const tagItems = totals.map((t) => ({
    key: t.tag ?? 'untagged',
    label: t.tag ?? 'Untagged',
    value: Math.abs(t.amount),
    secondary: `${t.n} bookings, ${t.amount < 0 ? 'out' : 'in'}`,
  }))

  return (
    <Stack gap="sm">
      <FinanceBar
        filters={
          <FilterSet>
            <SelectFilter label="Tax year" field={finStore.field.year} options={years} clearable />
          </FilterSet>
        }
      />
      <SimpleGrid type="container" cols={{ base: 1, [CONTAINER_KEYS.wide]: 2 }}>
        <QueryCard
          title="How was the tax year tagged?"
          info="Bookings of the tax year summed per tag. The bar is the size of the sum, the figure beside it keeps its sign. Facts, not tax advice."
          query={tax}
          empty={tagItems.length === 0 ? 'No bookings in this tax year.' : false}
          content
          facts={
            year === null
              ? undefined
              : bookings === 0
                ? { value: 'No bookings', period: `in ${year}`, tone: 'muted' }
                : {
                    value: `${tagged} of ${bookings}`,
                    unit: 'bookings carry a tax tag',
                    period: `in ${year}`,
                    tone: tagged === bookings ? 'good' : 'warn',
                  }
          }
        >
          <BarList
            label="Bookings per tax tag, in euros"
            items={tagItems}
            format={(v) => eur(v)}
            loading={tax.isPending}
            loadingRows={6}
          />
        </QueryCard>
        <QueryCard
          title="What did the business cost each month?"
          info="Bookings tagged business, shown as costs."
          query={tax}
          empty={rows.length === 0 ? 'No bookings in this tax year.' : false}
          facts={
            year === null
              ? undefined
              : businessTotal === 0
                ? { value: 'No business costs', period: `in ${year}`, tone: 'muted' }
                : { value: eur(businessTotal), unit: 'business costs', period: `in ${year}` }
          }
        >
          <Bars<CostMonth, string>
            data={costs}
            ariaLabel="Business costs per month of the tax year, in euros"
            x={(m) => m.month}
            formatX={monthTick}
            bars={COST_BARS}
            y={{ format: eurCompact }}
            height={{ base: 260, regular: 320 }}
          />
        </QueryCard>
      </SimpleGrid>
    </Stack>
  )
}
