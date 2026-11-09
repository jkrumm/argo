import { Box, Button, Stack, Text } from '@mantine/core'
import { IconWand } from '@tabler/icons-react'
import { PageSummary } from 'basalt-ui'
import { emit, overlays } from 'basalt-ui/commands'
import { FilterSet, SearchFilter, SelectFilter, ToggleFilter } from 'basalt-ui/controls'
import { date } from 'basalt-ui/format'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/table'
import { createElement, useEffect, useRef, useState } from 'react'
import { reportWriteError, useCurate } from '../api/mutations'
import { useMeta, useTransactions } from '../api/queries'
import type { Category, TxQuery, TxRow } from '../api/types'
import { BookingAmount, BookingRow } from '../components/booking-row'
import { bookingName } from '../lib/booking'
import { BulkModal, type BulkKind } from '../components/bulk-modal'
import { FinanceBar } from '../components/finance-bar'
import { NoDataState } from '../components/no-data-state'
import { CategoryPicker, TagPicker } from '../components/pickers'
import { useMonthOptions } from '../components/range-bar'
import { TAX_TAGS, tagLabel, topLabel, topOf } from '../lib/categories'
import { finStore, type FinanceFilters } from '../../../lib/window-stores'
import classes from '../components/finance.module.css'
import { useField } from '../../../lib/use-field'

const col = createColumnHelper<TxRow>()

/** Cents bounds of each amount band (spending is negative). */
const BANDS: Record<string, { min?: number; max?: number }> = {
  'out-100': { max: -10_000 },
  'out-20': { min: -10_000, max: -2_000 },
  'out-small': { min: -2_000, max: -1 },
  in: { min: 1 },
}

/** The server query a set of ledger filters stands for. */
export function ledgerQuery(f: FinanceFilters): TxQuery {
  const band = BANDS[f.amount]
  return {
    ...(f.from !== '' && { from: f.from }),
    ...(f.to !== '' && { to: f.to }),
    ...(f.search !== '' && { search: f.search }),
    ...(f.account !== '' && { account: f.account }),
    ...(f.category !== '' && { category: f.category }),
    ...(f.merchant !== '' && { merchant: f.merchant }),
    ...(f.tag !== '' && { tag: f.tag }),
    ...(band?.min !== undefined && { min: band.min }),
    ...(band?.max !== undefined && { max: band.max }),
    ...(f.uncategorized && { uncategorized: 1 as const }),
    ...(f.untagged && { untagged: 1 as const }),
    sort: f.sort,
    dir: f.dir,
    offset: f.page * Number(f.size),
    limit: Number(f.size),
  }
}

/** Every filter that changes which rows match; a change of any of them sends the table back to page one. */
const matchKey = (f: FinanceFilters): string =>
  JSON.stringify([
    f.from,
    f.to,
    f.search,
    f.account,
    f.category,
    f.merchant,
    f.tag,
    f.amount,
    f.uncategorized,
    f.untagged,
    f.size,
  ])

/** Category filter options: every top category as "all of it", then its leaves. */
function categoryOptions(categories: readonly Category[] | undefined) {
  const tops = [...new Set((categories ?? []).map((c) => topOf(c.id)))].toSorted()
  return tops.flatMap((top) => [
    { value: top, label: `${topLabel(categories, top)} (all)` },
    ...(categories ?? [])
      .filter((c) => c.id !== top && topOf(c.id) === top)
      .map((c) => ({ value: c.id, label: `${topLabel(categories, top)} · ${c.label}` })),
  ])
}

export function TransactionsPage() {
  const meta = useMeta()
  const filters = finStore.useValues()
  const [, setSort] = useField(finStore.field.sort)
  const [, setDir] = useField(finStore.field.dir)
  const [, setPage] = useField(finStore.field.page)
  const [, setSize] = useField(finStore.field.size)
  const [, setUncategorized] = useField(finStore.field.uncategorized)
  const curate = useCurate()
  const months = useMonthOptions()
  const [bulk, setBulk] = useState<{ kind: BulkKind; rows: TxRow[] } | null>(null)
  const [selection, setSelection] = useState<Record<string, true>>({})

  const ledger = useTransactions(ledgerQuery(filters))
  const uncategorized = useTransactions({ uncategorized: 1, limit: 1 })
  const key = matchKey(filters)

  // A new set of matches starts on page one; the first render keeps a page restored from history.
  const lastKey = useRef(key)
  useEffect(() => {
    if (lastKey.current === key) return
    lastKey.current = key
    if (filters.page !== 0) setPage(0)
    setSelection({})
  }, [key, filters.page, setPage])

  if (meta.isSuccess && meta.data.last_month === null) return <NoDataState />

  const categories = meta.data?.categories
  const accounts = meta.data?.accounts ?? []
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id
  const total = ledger.data?.total
  const queue = uncategorized.data?.total

  const columns = [
    col.accessor('booked_on', {
      header: 'Date',
      sortFn: 'basic',
      meta: { priority: 1 },
      cell: (c) => (
        <Text size="sm" truncate>
          {date(c.getValue())}
        </Text>
      ),
    }),
    col.accessor((r) => bookingName(r), {
      id: 'merchant',
      header: 'Merchant',
      sortFn: 'basic',
      cell: (c) => {
        const r = c.row.original
        const detail = [accountName(r.account_id), r.purpose].filter(Boolean).join(' · ')
        return (
          <Stack gap={0}>
            <Text size="sm" fw={500} lineClamp={1}>
              {c.getValue()}
            </Text>
            <Text size="xs" c="dimmed" lineClamp={1}>
              {detail}
            </Text>
          </Stack>
        )
      },
    }),
    col.accessor('category', {
      header: 'Category',
      enableSorting: false,
      cell: (c) => <CategoryPicker row={c.row.original} width={210} />,
    }),
    col.accessor('tax_tag', {
      header: 'Tax tag',
      enableSorting: false,
      meta: { priority: 3 },
      cell: (c) => <TagPicker row={c.row.original} width={130} />,
    }),
    col.accessor('amount_cents', {
      header: 'Amount',
      sortFn: 'basic',
      meta: { align: 'right' },
      cell: (c) => <BookingAmount cents={c.getValue()} />,
    }),
  ]

  const rowActions = [
    {
      key: 'rule',
      label: 'Always use this category for the merchant',
      icon: createElement(IconWand, { size: 16 }),
      disabled: (row: TxRow) => row.category === null,
      onClick: (row: TxRow) => {
        if (row.category === null) return
        const category = row.category
        const name = bookingName(row)
        void overlays.confirm({
          title: 'Make a rule from this merchant',
          body: (
            <Text size="sm">
              Every booking of “{name}” becomes “{topLabel(categories, topOf(category))} ·{' '}
              {categories?.find((c) => c.id === category)?.label ?? category}”, now and on future
              imports.
            </Text>
          ),
          confirmLabel: 'Make rule',
          cancelLabel: 'Cancel',
          onConfirm: () =>
            curate.addRule({ pattern: name, category }).then(
              (saved) =>
                emit('finance:info', {
                  message: `Rule saved: ${saved.changed} ${saved.changed === 1 ? 'booking' : 'bookings'} changed.`,
                }),
              reportWriteError,
            ),
        })
      },
    },
  ]

  const selected = (rows: TxRow[]): TxRow[] => rows

  return (
    <Box className={classes.page}>
      <FinanceBar
        filters={
          <FilterSet>
            <SearchFilter field={finStore.field.search} placeholder="Search bookings" />
            <SelectFilter label="From" field={finStore.field.from} options={months} clearable />
            <SelectFilter label="To" field={finStore.field.to} options={months} clearable />
            <SelectFilter
              label="Account"
              field={finStore.field.account}
              options={accounts.map((a) => ({ value: a.id, label: a.name }))}
              clearable
            />
            <SelectFilter
              label="Category"
              field={finStore.field.category}
              options={categoryOptions(categories)}
              clearable
            />
            <SelectFilter
              label="Tax tag"
              field={finStore.field.tag}
              options={TAX_TAGS.map((t) => ({ value: t, label: tagLabel(t) }))}
              clearable
            />
            <SelectFilter
              label="Amount"
              field={finStore.field.amount}
              options={[
                { value: 'out-100', label: 'Spent 100 € or more' },
                { value: 'out-20', label: 'Spent 20 € to 100 €' },
                { value: 'out-small', label: 'Spent under 20 €' },
                { value: 'in', label: 'Income and refunds' },
              ]}
              clearable
            />
            <ToggleFilter label="Uncategorized" field={finStore.field.uncategorized} />
            <ToggleFilter label="No tax tag" field={finStore.field.untagged} />
          </FilterSet>
        }
      />
      <PageSummary
        sentence={
          queue === undefined
            ? 'Reading the ledger'
            : queue === 0
              ? 'Every booking has a category.'
              : `${queue} ${queue === 1 ? 'booking has' : 'bookings have'} no category yet.`
        }
        facts={[
          total === undefined
            ? null
            : `${total.toLocaleString()} ${total === 1 ? 'match' : 'matches'} for these filters`,
        ]}
        {...(queue !== undefined &&
          queue > 0 && {
            aside: (
              <Button variant="default" onClick={() => setUncategorized(!filters.uncategorized)}>
                {filters.uncategorized ? 'Show all bookings' : 'Work through them'}
              </Button>
            ),
          })}
      />
      <BasaltDataTable
        key={key}
        title="Bookings"
        data={ledger.data?.rows ?? []}
        columns={columns}
        getRowId={(r) => r.id}
        query={ledger}
        skeletonRows={Number(filters.size)}
        emptyState="No bookings match these filters."
        enableSorting
        manualSorting
        initialSorting={[{ id: filters.sort, desc: filters.dir === 'desc' }]}
        onSortingChange={(sorting) => {
          const first = sorting[0]
          setSort(first?.id === 'amount' || first?.id === 'merchant' ? first.id : 'booked_on')
          setDir(first === undefined || first.desc ? 'desc' : 'asc')
          setPage(0)
        }}
        enablePagination
        manualPagination
        rowCount={total ?? 0}
        pageSizeOptions={[25, 50, 100]}
        initialPagination={{ pageIndex: filters.page, pageSize: Number(filters.size) }}
        onPaginationChange={(p) => {
          if (String(p.pageSize) !== filters.size) {
            setSize(String(p.pageSize) as '25' | '50' | '100')
            setPage(0)
          } else if (p.pageIndex !== filters.page) setPage(p.pageIndex)
        }}
        enableRowSelection
        rowSelection={selection}
        onRowSelectionChange={setSelection}
        bulkActions={(rows) => [
          {
            key: 'category',
            label: `Categorize ${rows.length}`,
            onClick: () => setBulk({ kind: 'category', rows: selected(rows) }),
          },
          {
            key: 'tag',
            label: `Tax tag ${rows.length}`,
            onClick: () => setBulk({ kind: 'tag', rows: selected(rows) }),
          },
        ]}
        rowActions={rowActions}
        rowLabel={bookingName}
        renderCard={(row) => <BookingRow row={row} tags />}
        stickyHeader
      />
      {bulk !== null && (
        <BulkModal
          kind={bulk.kind}
          rows={bulk.rows}
          onClose={() => setBulk(null)}
          onDone={() => {
            setBulk(null)
            setSelection({})
          }}
        />
      )}
    </Box>
  )
}
