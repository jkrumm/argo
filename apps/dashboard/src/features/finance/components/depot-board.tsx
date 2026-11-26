import { Group, Stack, Text } from '@mantine/core'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/table'
import { useBoards } from '../api/lists'
import { useDailyBars } from '../api/queries'
import type { MarketQuote, WatchList } from '../api/types'
import { priceText, signedPercent } from '../lib/depot-chart'
import { boardRows, figuresFromBars, unboarded } from '../lib/depot-board'
import type { BoardRow } from '../lib/depot-board'
import { clockTime, isRunning, liveFigures, quoteStatus } from '../lib/depot-live'
import { isoDayDe } from '../lib/depot-number'
import { DEPOT_TAB, GROUP_HEADER, kindGroup, splicedHistory } from '../lib/depot-nav'
import type { NavTab, SidebarItem } from '../lib/depot-nav'

const col = createColumnHelper<BoardRow>()

const unit = (currency: string | null): string => {
  if (currency === 'EUR') return '€'
  if (currency === 'USD') return '$'
  return ''
}

/** A year of daily bars and the end of the year before: what the changes of a running row are counted from. */
const RECENT_BARS = 400

/** The price a row is read at: the running one, else the last close. */
const priceOfRow = (row: BoardRow): string =>
  row.figures === null ? '—' : `${priceText(row.figures.last_close)} ${unit(row.currency)}`.trim()

/** What marks a row that is read at the running price, with when that price was made. */
function LiveMark({ quote }: { quote: MarketQuote | undefined }) {
  if (quote === undefined) return null
  const { label } = quoteStatus(quote)
  return (
    <Text
      size="xs"
      c="dimmed"
      data-shot="depot-board-live"
      title={quote.as_of === null ? undefined : `Stand ${clockTime(quote.as_of)}`}
    >
      {label}
    </Text>
  )
}

const sortable = (pick: (row: BoardRow) => number | null | undefined) => (row: BoardRow) =>
  pick(row) ?? Number.NEGATIVE_INFINITY

/** A change as a signed percent, green up and red down; `—` where the history starts later than the reference day. */
function Change({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <>—</>
  return (
    <Text span inherit c={value >= 0 ? 'green' : 'red'}>
      {signedPercent(value)}
    </Text>
  )
}

const changeColumn = (
  id: string,
  header: string,
  pick: (row: BoardRow) => number | null | undefined,
) =>
  col.accessor(sortable(pick), {
    id,
    header,
    sortFn: 'basic',
    meta: { align: 'right' },
    cell: (c) => <Change value={pick(c.row.original)} />,
  })

const COLUMNS = [
  col.accessor('label', {
    header: 'Name',
    cell: (c) => (
      <Stack gap={0}>
        <Text size="sm" fw={500}>
          {c.getValue()}
        </Text>
        <Text size="xs" c="dimmed">
          {GROUP_HEADER[kindGroup(c.row.original.kind)]}
        </Text>
      </Stack>
    ),
  }),
  col.accessor(
    sortable((row) => row.figures?.last_close),
    {
      id: 'last_close',
      header: 'Last',
      sortFn: 'basic',
      meta: { align: 'right', kind: 'text' },
      cell: (c) => (
        <Stack gap={0}>
          <Text size="sm">{priceOfRow(c.row.original)}</Text>
          <LiveMark quote={c.row.original.live} />
        </Stack>
      ),
    },
  ),
  changeColumn('day', 'Day', (row) => row.figures?.day_pct),
  changeColumn('week', 'Week', (row) => row.figures?.week_pct),
  changeColumn('month', 'Month', (row) => row.figures?.month_pct),
  changeColumn('ytd', 'YTD', (row) => row.figures?.ytd_pct),
  changeColumn('year', '1Y', (row) => row.figures?.year_pct),
  col.accessor(
    sortable((row) => row.figures?.ath_pct),
    {
      id: 'ath',
      header: 'From high',
      sortFn: 'basic',
      meta: { align: 'right' },
      cell: (c) => {
        const figures = c.row.original.figures
        return figures === null ? '—' : <Change value={figures.ath_pct} />
      },
    },
  ),
]

/**
 * The active tab as a table of key figures, one row for every entry of the tab: a list in list order, In depot every held
 * row (largest value first), Crypto the coins. A list's own board route gives the figures of its entries; a held row that
 * sits on no list has no board route, so its figures are read off its daily bars. Columns sort; a row opens the chart.
 */
export function DepotBoard({
  tab,
  lists,
  items,
  quotes,
  onOpen,
}: {
  tab: NavTab
  lists: readonly WatchList[]
  /** The rows of the tab, as the sidebar lists them. */
  items: readonly SidebarItem[]
  /** The live quote of each row, by symbol. */
  quotes: ReadonlyMap<string, MarketQuote>
  onOpen: (symbol: string) => void
}) {
  const board = useBoards(tab.listId === null ? lists.map((list) => list.id) : [tab.listId])
  const boarded = new Map(board.entries.map((entry) => [entry.symbol, entry] as const))
  // Only once every board answered: a row is no "loose" row while its list's answer is still on the way.
  const loose = board.query.data === undefined ? [] : unboarded(items, boarded)
  const own = useDailyBars(
    // The instrument's own euro bars like a list row's (the board route), without a spliced index: a young fund's year and high are its own.
    loose.map((item) => ({ isin: item.symbol, interval: '1d' })),
  )
  const computed = new Map(
    loose.map((item) => [item.symbol, figuresFromBars(own.bars.get(item.symbol) ?? [])] as const),
  )
  const stored = boardRows(items, boarded, computed)
  // A row whose day is running is read at its live price: the figures that hang on the last close are counted again.
  const running = new Map(
    stored.flatMap((row) => {
      const quote = quotes.get(row.symbol)
      return isRunning(quote, row.figures?.last_day) &&
        (quote.currency === null || row.currency === null || quote.currency === row.currency)
        ? [[row.symbol, quote] as const]
        : []
    }),
  )
  const recent = useDailyBars(
    items
      .filter((item) => running.has(item.symbol) && boarded.has(item.symbol))
      .map((item) => ({
        isin: item.symbol,
        interval: '1d',
        limit: RECENT_BARS,
        splice: splicedHistory(item.quote) ? ('index' as const) : undefined,
      })),
  )
  const rows = stored.map((row) => {
    const quote = running.get(row.symbol)
    if (quote === undefined || row.figures === null) return row
    const bars = boarded.has(row.symbol) ? recent.bars.get(row.symbol) : own.bars.get(row.symbol)
    const figures = liveFigures(row.figures, bars ?? [], quote)
    return figures === null ? row : { ...row, figures, live: quote }
  })
  const dated = stored.find((row) => row.figures !== null)?.figures?.last_day
  const absent = tab.id === DEPOT_TAB ? 'Nothing is held.' : 'Nothing on this tab has a price yet.'
  const query = {
    ...board.query,
    data: board.query.data === undefined || own.pending ? undefined : rows,
  }

  return (
    <BasaltDataTable
      data-shot="depot-board"
      title={tab.label}
      subtitle={
        dated === undefined
          ? 'Key figures from the daily closes.'
          : `Key figures from the daily closes, latest ${isoDayDe(dated)}; a row with a status under its price is read at that live price. Click a row to open its chart.`
      }
      data={rows}
      columns={COLUMNS}
      getRowId={(row) => row.symbol}
      query={query}
      skeletonRows={4}
      minWidth={760}
      emptyState={absent}
      onRowActivate={(row) => onOpen(row.symbol)}
      rowLabel={(row) => `Open the chart of ${row.label}`}
      renderCard={(row) => (
        <Stack gap={2}>
          <Group justify="space-between" wrap="nowrap" gap="sm">
            <Text size="sm" fw={500}>
              {row.label}
            </Text>
            <Text size="sm">{priceOfRow(row)}</Text>
          </Group>
          <LiveMark quote={row.live} />
          <Group gap="sm" wrap="wrap">
            {(
              [
                ['Day', row.figures?.day_pct],
                ['Month', row.figures?.month_pct],
                ['Year', row.figures?.year_pct],
                ['High', row.figures?.ath_pct],
              ] as const
            ).map(([label, value]) => (
              <Text key={label} size="xs" c="dimmed">
                {label} <Change value={value} />
              </Text>
            ))}
          </Group>
        </Stack>
      )}
    />
  )
}
