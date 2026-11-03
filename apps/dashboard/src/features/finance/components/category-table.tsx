import { Text } from '@mantine/core'
import { Sparkline } from 'basalt-ui/charts'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/table'
import { VX } from 'basalt-ui/tokens'
import type { UseQueryResult } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { Category, CategoryDelta } from '../api/types'
import { NONE, categoryLabel } from '../lib/categories'
import { eur, signedEur } from '../lib/format'

const col = createColumnHelper<CategoryDelta>()

type CategoryTableProps = {
  title: string
  subtitle: string
  /** Header of the compared figure: "June 2025", "Latest month". */
  currentHeader: string
  rows: readonly CategoryDelta[]
  categories: readonly Category[] | undefined
  query: UseQueryResult<unknown>
  initialSort: 'delta' | 'typical'
  onActivate?: (row: CategoryDelta) => void
  /** The row the page is focused on elsewhere: marked and bold. */
  selected?: string | null
}

/** Spending per top category: this period against the typical month, with the 12-month trend. */
export function CategoryTable({
  title,
  subtitle,
  currentHeader,
  rows,
  categories,
  query,
  initialSort,
  onActivate,
  selected = null,
}: CategoryTableProps) {
  const columns = useMemo(
    () => [
      col.accessor('top_category', {
        header: 'Category',
        cell: (c) =>
          (c.getValue() ?? NONE) === selected ? (
            <Text span fw={600}>
              ▸ {categoryLabel(categories, c.getValue())}
            </Text>
          ) : (
            categoryLabel(categories, c.getValue())
          ),
      }),
      col.accessor((r) => -r.typical_cents, {
        id: 'typical',
        header: 'Typical month',
        sortFn: 'basic',
        meta: { align: 'right' },
        cell: (c) => eur(c.getValue()),
      }),
      col.accessor((r) => -r.amount_cents, {
        id: 'current',
        header: currentHeader,
        sortFn: 'basic',
        meta: { align: 'right' },
        cell: (c) => eur(c.getValue()),
      }),
      // Spending is booked negative: a negative delta is more spent than typical.
      col.accessor((r) => -r.delta_cents, {
        id: 'delta',
        header: 'Against typical',
        sortFn: 'basic',
        meta: { align: 'right' },
        cell: (c) => <ExtraSpend cents={c.getValue()} />,
      }),
      col.display({
        id: 'trend',
        header: 'Last 12 months',
        cell: (c) => (
          <Sparkline
            ariaLabel={`${categoryLabel(categories, c.row.original.top_category)}, spending per month, last 12 months`}
            data={c.row.original.trend.map((t) => -t.amount_cents)}
            height={24}
            width={96}
            emphasizeLast
            format={eur}
          />
        ),
      }),
    ],
    [categories, currentHeader, selected],
  )
  return (
    <BasaltDataTable
      title={title}
      subtitle={subtitle}
      data={[...rows]}
      columns={columns}
      getRowId={(r) => r.top_category ?? 'uncategorized'}
      query={query}
      initialSorting={[{ id: initialSort, desc: true }]}
      emptyState="No spending in this period."
      {...(onActivate !== undefined && { onRowActivate: onActivate })}
    />
  )
}

/** Extra spend against typical, signed and toned: more than typical is the bad direction. */
function ExtraSpend({ cents }: { cents: number }) {
  if (cents === 0) return <Text span>—</Text>
  const bad = cents > 0
  return (
    <Text span c={bad ? VX.status.bad : VX.status.good}>
      {bad ? '▲' : '▼'} {signedEur(cents)}
    </Text>
  )
}
