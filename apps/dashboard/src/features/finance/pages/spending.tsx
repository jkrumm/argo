import { SimpleGrid, Stack } from '@mantine/core'
import { Link } from '@tanstack/react-router'
import { BarList } from 'basalt-ui'
import { CONTAINER_KEYS } from 'basalt-ui/tokens'
import { useMerchants, useReport } from '../api/queries'
import { CategoryTable } from '../components/category-table'
import { NoDataState } from '../components/no-data-state'
import { QueryCard } from '../components/query-card'
import { RangeBar } from '../components/range-bar'
import { NONE, categoryLabel, merchantFilter, merchantLabel } from '../lib/categories'
import { eur, ratio } from '../lib/format'
import { monthName } from '../lib/months'
import { FILTERS_CLEARED, finStore } from '../../../lib/window-stores'
import { useRange } from '../lib/use-range'

const MERCHANTS_SHOWN = 10

export function SpendingPage() {
  const { range, noData, meta } = useRange()
  const report = useReport(range)
  const filters = finStore.useValues()
  const [selected, select] = finStore.field.focus.use()
  const categories = meta.data?.categories

  const rows = (report.data?.categories ?? []).toSorted((a, b) => a.typical_cents - b.typical_cents)
  // The selected category drives the merchant card; before a choice the biggest one stands in.
  const first = rows[0]
  const focus =
    selected !== '' ? selected : first === undefined ? null : (first.top_category ?? NONE)
  const merchants = useMerchants(
    range === null || focus === null ? null : { ...range, category: focus },
  )
  if (noData) return <NoDataState />

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
          to="/finance/transactions"
          search={{
            ...FILTERS_CLEARED,
            from: filters.from,
            to: filters.to,
            category: focus ?? '',
            merchant: merchantFilter(m.merchant),
          }}
        >
          {m.n} bookings
        </Link>
      ),
    }))
  const focusLabel = categoryLabel(categories, focus)
  const levers = report.data?.levers ?? []
  const leverItems = levers.map((l) => ({
    key: l.top_category,
    label: categoryLabel(categories, l.top_category),
    value: l.cut20_yearly_cents,
    secondary: `${eur(l.typical_monthly_cents)} a month${l.top_merchants[0] === undefined ? '' : ` · mostly ${merchantLabel(l.top_merchants[0].merchant)}`}`,
  }))
  const leverTotal = levers.reduce((sum, l) => sum + l.cut20_yearly_cents, 0)
  const cashShare = report.data?.cash_share ?? null
  const to = range?.to

  return (
    <Stack gap="sm">
      <RangeBar />
      <SimpleGrid type="container" cols={{ base: 1, [CONTAINER_KEYS.wide]: 2 }}>
        <CategoryTable
          title="Where does my money go?"
          subtitle="Spending per top category, ranked by a typical month. Select a row to see its merchants."
          currentHeader={to === undefined ? 'Latest month' : monthName(to)}
          rows={rows}
          categories={categories}
          query={report}
          initialSort="typical"
          selected={focus}
          onActivate={(r) => select(r.top_category ?? NONE)}
        />
        <QueryCard
          title={`Where exactly does ${focusLabel} go?`}
          info="Merchants of the selected category, summed over the selected months."
          query={merchants}
          empty={
            merchantItems.length === 0 ? 'No merchant spending in this category and period.' : false
          }
          content
          actions={
            focus === null ? undefined : (
              <Link
                to="/finance/transactions"
                search={{ ...FILTERS_CLEARED, from: filters.from, to: filters.to, category: focus }}
              >
                All bookings
              </Link>
            )
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
      </SimpleGrid>
      <QueryCard
        title="What would a 20 % cut save?"
        info="The three variable categories with the highest typical monthly spend, and the yearly effect of cutting each by a fifth."
        query={report}
        empty={leverItems.length === 0 ? 'No variable spending to cut yet.' : false}
        content
        facts={[
          {
            value: eur(leverTotal),
            unit: 'a year',
            period: 'if the three biggest variable categories fall by 20 %',
            tone: 'good',
          },
          ...(cashShare === null
            ? []
            : [
                {
                  value: ratio(cashShare),
                  unit: 'of spending is cash',
                  period: 'untracked: no merchant to cut',
                  tone: cashShare > 0.1 ? ('warn' as const) : ('muted' as const),
                },
              ]),
        ]}
      >
        <BarList
          label="Yearly saving from a 20 % cut, by category, in euros"
          items={leverItems}
          format={(v) => `${eur(v)} a year`}
          loading={report.isPending}
          loadingRows={3}
        />
      </QueryCard>
    </Stack>
  )
}
