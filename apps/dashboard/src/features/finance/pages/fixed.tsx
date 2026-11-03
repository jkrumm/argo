import { Stack, Text } from '@mantine/core'
import { BarList, Meter, StatGroup } from 'basalt-ui'
import type { StatStripCell } from 'basalt-ui'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/table'
import { VX } from 'basalt-ui/tokens'
import { useMemo } from 'react'
import { useMeta, useRecurring, useReport } from '../api/queries'
import type { RecurringRow } from '../api/types'
import { FinanceBar } from '../components/finance-bar'
import { NoDataState } from '../components/no-data-state'
import { QueryCard } from '../components/query-card'
import { categoryLabel } from '../lib/categories'
import { eur, eurExact, ratio, toneProp } from '../lib/format'
import { monthTick } from '../lib/months'
import { useRange } from '../lib/use-range'

const MONTHS_PER_YEAR = 12

const CADENCE: Record<RecurringRow['cadence'], string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
}

const isActive = (r: RecurringRow): boolean => r.active === true || r.active === 1

/** Same payee, different amounts: the price moved. */
const priceMoved = (r: RecurringRow): boolean => r.min_cents !== r.max_cents

const col = createColumnHelper<RecurringRow>()

export function FixedPage() {
  const { range, noData } = useRange()
  const report = useReport(range)
  const recurring = useRecurring()
  const meta = useMeta()
  const categories = meta.data?.categories

  const columns = useMemo(
    () => [
      col.accessor('merchant', { header: 'Payee' }),
      col.accessor('category', {
        header: 'Category',
        cell: (c) => categoryLabel(categories, c.getValue()),
      }),
      col.accessor('cadence', { header: 'Paid', cell: (c) => CADENCE[c.getValue()] }),
      col.accessor((r) => Math.abs(r.monthly_cents), {
        id: 'monthly',
        header: 'Per month',
        sortFn: 'basic',
        meta: { align: 'right' },
        cell: (c) => eur(c.getValue()),
      }),
      col.accessor((r) => Math.abs(r.monthly_cents) * MONTHS_PER_YEAR, {
        id: 'annual',
        header: 'Per year',
        sortFn: 'basic',
        meta: { align: 'right' },
        cell: (c) => eur(c.getValue()),
      }),
      col.accessor('first_month', { header: 'Since', cell: (c) => monthTick(c.getValue()) }),
      col.accessor((r) => Number(priceMoved(r)), {
        id: 'price',
        header: 'Price',
        sortFn: 'basic',
        cell: (c) => {
          const r = c.row.original
          return priceMoved(r) ? (
            <Text span c={VX.status.warn}>
              ▲ {eurExact(Math.abs(r.min_cents))} to {eurExact(Math.abs(r.max_cents))}
            </Text>
          ) : (
            'Steady'
          )
        },
      }),
      col.accessor((r) => (isActive(r) ? 'Active' : 'Stopped'), { id: 'status', header: 'Status' }),
    ],
    [categories],
  )
  if (noData) return <NoDataState />

  const fixed = report.data?.fixed
  const total = fixed === undefined ? 0 : Math.abs(fixed.total_cents)
  const items = (fixed?.items ?? [])
    .toSorted((a, b) => a.monthly_cents - b.monthly_cents)
    .map((i) => ({
      key: i.category,
      label: i.label,
      value: Math.abs(i.monthly_cents),
      secondary: `${eur(Math.abs(i.monthly_cents) * MONTHS_PER_YEAR)} a year`,
    }))
  const rows = (recurring.data ?? []).toSorted(
    (a, b) => Number(isActive(b)) - Number(isActive(a)) || a.monthly_cents - b.monthly_cents,
  )
  const activeMonthly = rows.filter(isActive).reduce((sum, r) => sum + Math.abs(r.monthly_cents), 0)
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

  const cells: StatStripCell[] = [
    {
      key: 'fixed',
      caption: 'Fixed costs',
      qualifier: 'per month',
      info: 'Current value of every fixed category, rent and insurance changes included.',
      value: fixed === undefined ? null : eur(total),
      footer:
        fixed?.share_of_income == null
          ? undefined
          : `${ratio(fixed.share_of_income)} of typical income`,
      visual:
        fixed === undefined ? undefined : (
          <Meter
            label="Fixed costs against typical income"
            value={total}
            max={Math.max(fixed.typical_income_cents, total, 1)}
            format={eur}
            startCaption={null}
            endCaption={`Income ${eur(fixed.typical_income_cents)}`}
          />
        ),
      loading,
      ...failed,
    },
    {
      key: 'free',
      caption: 'Left after fixed costs',
      qualifier: 'per month, typical',
      info: 'Typical income minus the fixed costs: what variable spending has to fit into.',
      value: fixed === undefined ? null : eur(fixed.free_budget_cents),
      ...(fixed !== undefined && toneProp(fixed.free_budget_cents)),
      footer:
        fixed === undefined
          ? undefined
          : `Typical variable spending ${eur(Math.abs(fixed.typical_variable_cents))}`,
      loading,
      ...failed,
    },
    {
      key: 'annual',
      caption: 'Fixed costs',
      qualifier: 'per year',
      value: fixed === undefined ? null : eur(total * MONTHS_PER_YEAR),
      footer: `Of which recurring payments ${eur(activeMonthly * MONTHS_PER_YEAR)}`,
      loading,
      ...failed,
    },
  ]

  return (
    <Stack gap="sm">
      <FinanceBar />
      <StatGroup variant="strip" label="Fixed commitments" cols={3} cells={cells} />
      <QueryCard
        title="What am I committed to every month?"
        info="Fixed categories at their current monthly value. Changing what counts as fixed is `fin tx category set-fixed`."
        query={report}
        empty={items.length === 0 ? 'No fixed categories have bookings yet.' : false}
        content
        facts={
          fixed === undefined
            ? undefined
            : {
                value: eur(total),
                unit: 'a month',
                ...(fixed.share_of_income !== null && {
                  period: `${ratio(fixed.share_of_income)} of typical income`,
                }),
              }
        }
      >
        <BarList
          label="Fixed costs per month by category, in euros"
          items={items}
          format={eur}
          loading={loading}
          loadingRows={5}
        />
      </QueryCard>
      <BasaltDataTable
        title="Which payments recur?"
        subtitle="Payees paid in at least three months with a steady amount. Stopped ones are not seen in the last months."
        data={rows}
        columns={columns}
        getRowId={(r) => `${r.merchant}|${r.cadence}`}
        query={recurring}
        emptyState="No recurring payments detected yet."
      />
    </Stack>
  )
}
