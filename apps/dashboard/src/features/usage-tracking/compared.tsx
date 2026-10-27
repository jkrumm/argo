/**
 * Claude Max, subscription against subscription: plan, price, what the usage would have cost at API
 * prices, the value multiple (list value over the price prorated to the range), the tokens, the
 * active days and the weekly quota peak; a summed row closes the table. The list value is never
 * charged: the subscription is flat.
 */
import { Box } from '@mantine/core'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/table'
import { withUnit } from '../../lib/format'
import { shotState } from '../../lib/shot-state'
import { EM_DASH, fmtMultiple, fmtTokens, fmtUsdWhole, periodNoun } from './model'
import type { ComparedRow } from './value-model'

const columnHelper = createColumnHelper<ComparedRow>()

/** A subscription with nothing in the range reads as a dash, not as a measured zero. */
const unused = (row: ComparedRow): boolean => row.listValue <= 0 && row.fresh <= 0

const columns = [
  columnHelper.accessor('title', {
    meta: { priority: 0, numeral: false },
    header: 'Subscription',
  }),
  columnHelper.accessor('plan', {
    meta: { priority: 4, numeral: false },
    header: 'Plan',
  }),
  columnHelper.accessor('price', {
    meta: { priority: 3 },
    header: 'Price / month',
    cell: (ctx) => fmtUsdWhole(ctx.getValue()),
  }),
  columnHelper.accessor('listValue', {
    meta: { priority: 1 },
    header: 'List value',
    cell: (ctx) => (unused(ctx.row.original) ? EM_DASH : fmtUsdWhole(ctx.getValue())),
  }),
  columnHelper.accessor('multiple', {
    meta: { priority: 2 },
    header: 'Value multiple',
    cell: (ctx) => fmtMultiple(ctx.getValue()),
  }),
  columnHelper.accessor('fresh', {
    meta: { priority: 5 },
    header: 'Fresh tokens',
    cell: (ctx) => (unused(ctx.row.original) ? EM_DASH : fmtTokens(ctx.getValue())),
  }),
  columnHelper.accessor('cacheRead', {
    meta: { priority: 6 },
    header: 'Cache-read',
    cell: (ctx) => (unused(ctx.row.original) ? EM_DASH : fmtTokens(ctx.getValue())),
  }),
  columnHelper.accessor('activeDays', {
    meta: { priority: 7 },
    header: 'Active days',
    cell: (ctx) => (unused(ctx.row.original) ? EM_DASH : ctx.getValue()),
  }),
  columnHelper.accessor('quotaPeak', {
    meta: { priority: 8 },
    header: 'Quota peak',
    cell: (ctx) => {
      const v = ctx.getValue()
      return v === null ? EM_DASH : withUnit(Math.round(v), '%')
    },
  }),
]

export function Compared({
  rows,
  sum,
  range,
}: {
  rows: readonly ComparedRow[]
  sum: ComparedRow
  range: '7d' | '30d' | '90d' | 'all'
}) {
  const data = shotState() === 'empty' ? [] : rows.length > 1 ? [...rows, sum] : [...rows]
  return (
    <Box data-shot="compared" data-shot-states="empty">
      <BasaltDataTable
        title={`Compared · ${periodNoun(range)}`}
        subtitle="List value is never charged · value multiple = list value ÷ plan price for the days held in the range · quota peak from the collector’s samples"
        data={data}
        columns={columns}
        enableSorting={false}
        getRowId={(row) => row.key}
        emptyState="No subscription usage in this window"
      />
    </Box>
  )
}
