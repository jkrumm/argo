import { Group, Stack, Text } from '@mantine/core'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/table'
import { useBoards } from '../api/lists'
import { useDailyBars } from '../api/queries'
import type { WatchList } from '../api/types'
import { priceText, signedPercent } from '../lib/depot-chart'
import { boardRows, figuresFromBars, unboarded } from '../lib/depot-board'
import type { BoardRow } from '../lib/depot-board'
import { isoDayDe } from '../lib/depot-number'
import { DEPOT_TAB, GROUP_HEADER, kindGroup } from '../lib/depot-nav'
import type { NavTab, SidebarItem } from '../lib/depot-nav'

const col = createColumnHelper<BoardRow>()

const unit = (currency: string | null): string => {
  if (currency === 'EUR') return '€'
  if (currency === 'USD') return '$'
  return ''
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
      header: 'Last close',
      sortFn: 'basic',
      meta: { align: 'right' },
      cell: (c) => {
        const { figures, currency } = c.row.original
        return figures === null ? '—' : `${priceText(figures.last_close)} ${unit(currency)}`.trim()
      },
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
  onOpen,
}: {
  tab: NavTab
  lists: readonly WatchList[]
  /** The rows of the tab, as the sidebar lists them. */
  items: readonly SidebarItem[]
  onOpen: (symbol: string) => void
}) {
  const board = useBoards(tab.listId === null ? lists.map((list) => list.id) : [tab.listId])
  const boarded = new Map(board.entries.map((entry) => [entry.symbol, entry] as const))
  // Only once every board answered: a row is no "loose" row while its list's answer is still on the way.
  const loose = board.query.data === undefined ? [] : unboarded(items, boarded)
  const own = useDailyBars(
    // The instrument's own bars, no spliced index: its high and its year then read as the chart header's do.
    loose.map((item) => ({ isin: item.symbol, interval: '1d' })),
  )
  const computed = new Map(
    loose.map((item) => [item.symbol, figuresFromBars(own.bars.get(item.symbol) ?? [])] as const),
  )
  const rows = boardRows(items, boarded, computed)
  const dated = rows.find((row) => row.figures !== null)?.figures?.last_day
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
          : `Key figures from the daily closes, latest ${isoDayDe(dated)}. Click a row to open its chart.`
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
            <Text size="sm">
              {row.figures === null
                ? '—'
                : `${priceText(row.figures.last_close)} ${unit(row.currency)}`.trim()}
            </Text>
          </Group>
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
