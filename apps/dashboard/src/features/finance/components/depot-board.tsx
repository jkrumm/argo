import { Group, Stack, Text } from '@mantine/core'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/table'
import { useBoards } from '../api/lists'
import type { BoardEntry, WatchList } from '../api/types'
import { priceText, signedPercent } from '../lib/depot-chart'
import { isoDayDe } from '../lib/depot-number'
import { CRYPTO_TAB, DEPOT_TAB, GROUP_HEADER, kindGroup } from '../lib/depot-nav'
import type { NavTab } from '../lib/depot-nav'

type BoardRow = BoardEntry & { label: string }

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
  priority?: 2 | 3,
) =>
  col.accessor(sortable(pick), {
    id,
    header,
    sortFn: 'basic',
    meta: { align: 'right', ...(priority !== undefined && { priority }) },
    cell: (c) => <Change value={pick(c.row.original)} />,
  })

const COLUMNS = [
  col.accessor('label', {
    header: 'Name',
    meta: { kind: 'entity' },
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
  changeColumn('week', 'Week', (row) => row.figures?.week_pct, 2),
  changeColumn('month', 'Month', (row) => row.figures?.month_pct, 2),
  changeColumn('ytd', 'This year', (row) => row.figures?.ytd_pct, 3),
  changeColumn('year', '1 year', (row) => row.figures?.year_pct, 3),
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
 * The active tab as a table of key figures. A list shows its own entries; In depot shows the held ones and Crypto the coins,
 * read off every list that has them (the board route is per list). A row opens the chart.
 */
export function DepotBoard({
  tab,
  lists,
  held,
  onOpen,
}: {
  tab: NavTab
  lists: readonly WatchList[]
  /** The symbols of the rows the owner holds. */
  held: ReadonlySet<string>
  onOpen: (symbol: string) => void
}) {
  const board = useBoards(tab.listId === null ? lists.map((list) => list.id) : [tab.listId])
  const labels = new Map(
    lists.flatMap((list) =>
      list.entries.map((entry) => [entry.symbol, entry.display_name] as const),
    ),
  )
  const keep = (entry: BoardEntry): boolean => {
    if (tab.id === DEPOT_TAB) return held.has(entry.symbol)
    if (tab.id === CRYPTO_TAB) return entry.kind === 'coin'
    return true
  }
  const rows: BoardRow[] = board.entries.filter(keep).map((entry) => ({
    ...entry,
    label: entry.display_name ?? labels.get(entry.symbol) ?? entry.name ?? entry.symbol,
  }))
  const dated = rows.find((row) => row.figures !== null)?.figures?.last_day
  const absent =
    tab.id === DEPOT_TAB
      ? 'No held instrument is on a list.'
      : 'Nothing on this tab has a price yet.'

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
      query={board.query}
      skeletonRows={4}
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
