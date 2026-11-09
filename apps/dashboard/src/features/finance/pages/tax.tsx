import { Box, Button, Group, Text } from '@mantine/core'
import { BarList } from 'basalt-ui'
import { Bars } from 'basalt-ui/charts'
import type { BarsBar } from 'basalt-ui/charts'
import { FilterSet, SearchFilter, SelectFilter } from 'basalt-ui/controls'
import { fetchAllTransactions, useMeta, useTaxYear, useTransactions } from '../api/queries'
import { useEffect, useRef, useState } from 'react'
import { BulkModal } from '../components/bulk-modal'
import { reportWriteError, useCurate } from '../api/mutations'
import type { Category, TaxYearRow, TxRow } from '../api/types'
import { BookingAmount } from '../components/booking-row'
import { bookingName } from '../lib/booking'
import { TagPicker } from '../components/pickers'
import { date } from 'basalt-ui/format'
import { FinanceBar } from '../components/finance-bar'
import { NoDataState } from '../components/no-data-state'
import { QueryCard } from '../components/query-card'
import { categoryLabel, tagLabel, topLabel, topOf } from '../lib/categories'
import { eur, eurCompact } from '../lib/format'
import { MONTH_UNIVERSE, everyNth, monthTick } from '../lib/months'
import { FINANCE_SPLIT } from '../../../lib/series'
import { finStore } from '../../../lib/window-stores'
import classes from '../components/finance.module.css'
import { useField } from '../../../lib/use-field'

/** The tax tag the Gewerbe's costs carry. */
const BUSINESS_TAG = 'business'
/** The tags one tap away in the queue; the rest are in the row's select. */
const QUICK_TAGS = ['business', 'tax', 'donation', 'private'] as const
const QUEUE_PAGE = 20

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
  return MONTH_UNIVERSE.filter((m) => m.startsWith(`${year}-`)).map((month) => ({
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

/** Money that moves between own accounts or into savings is never a tax question. */
const isCandidate = (row: TxRow): boolean =>
  row.tax_tag === null && row.category_kind !== 'transfer' && row.category_kind !== 'saving'

/**
 * One untagged booking of the queue: who, how much, when and which category (as text: this page is
 * for tags), then the one-tap tags and a select for the rarer ones. The chosen tag reads as pressed
 * until the row leaves the queue.
 */
function QueueRow({
  row,
  categories,
  onMerchant,
}: {
  row: TxRow
  categories: readonly Category[] | undefined
  /** Tag every untagged booking of this row's merchant in one go. */
  onMerchant: (row: TxRow) => void
}) {
  const curate = useCurate()
  const detail = [
    date(row.booked_on),
    categoryLabel(categories, row.category),
    row.purpose === null || row.purpose === '' ? null : row.purpose,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <Box className={classes.booking}>
      <Text size="sm" fw={500} className={classes.merchant} title={bookingName(row)}>
        {bookingName(row)}
      </Text>
      <Text size="sm">
        <BookingAmount cents={row.amount_cents} />
      </Text>
      <Text size="xs" c="dimmed" className={classes.meta}>
        {detail}
      </Text>
      <Box className={classes.queueActions}>
        {QUICK_TAGS.map((tag) => (
          <Button
            key={tag}
            size="xs"
            variant={row.tax_tag === tag ? 'filled' : 'default'}
            aria-pressed={row.tax_tag === tag}
            onClick={() => curate.setTag(row, tag).catch(reportWriteError)}
          >
            {tagLabel(tag)}
          </Button>
        ))}
        <TagPicker row={row} width={150} />
        {row.merchant !== null && (
          <Button
            size="xs"
            variant="subtle"
            title={`Tag every untagged booking of ${row.merchant}`}
            onClick={() => onMerchant(row)}
          >
            Same merchant
          </Button>
        )}
      </Box>
    </Box>
  )
}

export function TaxPage() {
  const meta = useMeta()
  const [selected] = useField(finStore.field.year)
  const filters = finStore.useValues()
  const [, setPage] = useField(finStore.field.page)
  const lastMonth = meta.data?.last_month ?? null
  const firstMonth = meta.data?.first_month ?? null
  const year =
    selected === '' ? (lastMonth === null ? null : Number(lastMonth.slice(0, 4))) : Number(selected)
  const tax = useTaxYear(year)
  const [bulk, setBulk] = useState<{ rows: TxRow[]; subject: string } | null>(null)
  const queue = useTransactions(
    year === null
      ? null
      : {
          from: `${year}-01`,
          to: `${year}-12`,
          untagged: 1,
          max: -1,
          sort: 'amount',
          dir: 'asc',
          offset: filters.page * QUEUE_PAGE,
          limit: QUEUE_PAGE,
          ...(filters.search !== '' && { search: filters.search }),
          ...(filters.category !== '' && { category: filters.category }),
        },
  )

  // A new year, search or category starts the queue on page one (the first render keeps a page restored from history).
  const matchKey = `${year}|${filters.search}|${filters.category}`
  const lastKey = useRef(matchKey)
  useEffect(() => {
    if (lastKey.current === matchKey) return
    lastKey.current = matchKey
    if (filters.page !== 0) setPage(0)
  }, [matchKey, filters.page, setPage])

  // Tagging the last rows of the last page shrinks the queue under the current page.
  const lastPage = Math.max(Math.ceil((queue.data?.total ?? 0) / QUEUE_PAGE) - 1, 0)
  useEffect(() => {
    if (queue.data !== undefined && filters.page > lastPage) setPage(lastPage)
  }, [queue.data, filters.page, lastPage, setPage])

  if (meta.isSuccess && year === null) return <NoDataState />

  /** Every untagged booking of the row's merchant in the tax year, handed to the bulk dialog. */
  async function tagMerchant(row: TxRow) {
    if (row.merchant === null || year === null) return
    try {
      const rows = await fetchAllTransactions({
        from: `${year}-01`,
        to: `${year}-12`,
        untagged: 1,
        merchant: row.merchant,
      })
      setBulk({ rows: rows.filter(isCandidate), subject: row.merchant })
    } catch (error) {
      reportWriteError(error)
    }
  }

  const years =
    firstMonth === null || lastMonth === null
      ? []
      : Array.from(
          { length: Number(lastMonth.slice(0, 4)) - Number(firstMonth.slice(0, 4)) + 1 },
          (_, i) => String(Number(lastMonth.slice(0, 4)) - i),
        ).map((value) => ({ value, label: value }))
  const categories = meta.data?.categories
  const tops = [...new Set((categories ?? []).map((c) => topOf(c.id)))].toSorted()

  const rows = tax.data ?? []
  const totals = tagTotals(rows)
  const costs = year === null ? [] : businessCosts(rows, year)
  const businessTotal = costs.reduce((sum, m) => sum + m.cost, 0)
  const bookings = totals.reduce((sum, t) => sum + t.n, 0)
  const tagged = totals.filter((t) => t.tag !== null).reduce((sum, t) => sum + t.n, 0)
  const tagItems = totals.map((t) => ({
    key: t.tag ?? 'untagged',
    label: t.tag === null ? 'Untagged' : tagLabel(t.tag),
    value: Math.abs(t.amount),
    secondary: `${t.n} bookings, ${t.amount < 0 ? 'out' : 'in'}`,
  }))

  const candidates = (queue.data?.rows ?? []).filter(isCandidate)
  const queueTotal = queue.data?.total ?? 0
  const pages = Math.max(Math.ceil(queueTotal / QUEUE_PAGE), 1)

  return (
    <Box className={classes.page}>
      <FinanceBar
        filters={
          <FilterSet>
            <SelectFilter label="Tax year" field={finStore.field.year} options={years} clearable />
            <SearchFilter field={finStore.field.search} placeholder="Search the queue" />
            <SelectFilter
              label="Category"
              field={finStore.field.category}
              options={tops.map((t) => ({ value: t, label: topLabel(categories, t) }))}
              clearable
            />
          </FilterSet>
        }
      />
      <Box className={`${classes.split} ${classes.splitHalf}`}>
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
          ghost="bars"
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
            xTicks={everyNth(
              costs.map((m) => m.month),
              2,
            )}
            bars={COST_BARS}
            y={{ format: eurCompact }}
            height={{ base: 200, regular: 240 }}
          />
        </QueryCard>
      </Box>
      <QueryCard
        title={`Which ${year ?? ''} spending is still untagged?`}
        info="Untagged spending of the tax year, largest first. One tap tags a booking and takes it off the list; Private marks it as not tax relevant. Transfers and savings are not listed."
        query={queue}
        empty={candidates.length === 0 ? 'Nothing left to tag in this selection.' : false}
        content
        facts={
          queue.data === undefined
            ? undefined
            : {
                value: queueTotal.toLocaleString(),
                unit: 'untagged spending bookings',
                period: year === null ? '' : String(year),
                tone: queueTotal === 0 ? 'good' : 'warn',
              }
        }
        actions={
          <Group gap="xs" wrap="nowrap">
            <Button
              variant="default"
              disabled={filters.page === 0}
              onClick={() => setPage(filters.page - 1)}
            >
              Previous
            </Button>
            <Text size="xs" c="dimmed">
              {filters.page + 1} / {pages}
            </Text>
            <Button
              variant="default"
              disabled={filters.page + 1 >= pages}
              onClick={() => setPage(filters.page + 1)}
            >
              Next
            </Button>
          </Group>
        }
      >
        <Box className={classes.bookings}>
          {candidates.map((row) => (
            <QueueRow key={row.id} row={row} categories={categories} onMerchant={tagMerchant} />
          ))}
        </Box>
      </QueryCard>
      {bulk !== null && bulk.rows.length > 0 && (
        <BulkModal
          kind="tag"
          rows={bulk.rows}
          subject={bulk.subject}
          onClose={() => setBulk(null)}
          onDone={() => setBulk(null)}
        />
      )}
    </Box>
  )
}
