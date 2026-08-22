import { useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Badge, Card, Group, Stack, Text } from '@mantine/core'
import type { PaginationState } from '@tanstack/react-table'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/data/table'
import { walkingPadQueries } from '../../lib/queries/walking-pad'
import { formatDurationClock, formatKcal, formatKm, formatPace, formatSteps } from './formatters'

const PAGE_SIZE = 25
// Cap the table body so the history card doesn't blow out vertically. With
// PAGE_SIZE=25 the natural height is well over 1000px — capping at ~480 keeps
// the bottom row of the page balanced with the time-of-day heatmap beside it
// and the user scrolls within the card for the rest of the page.
const TABLE_BODY_MAX_HEIGHT = 480

type SessionRow = {
  uuid: string
  started_at: string
  ended_at: string
  duration_s: number
  distance_m: number
  steps: number
  avg_speed_kmh: number
  max_speed_kmh: number
  kcal: number
  pause_count: number
}

function dateLabel(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  return {
    date: d.toLocaleDateString('en-CA'), // YYYY-MM-DD
    time: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
  }
}

const columnHelper = createColumnHelper<SessionRow>()

// Every numeric accessor gets the mono-numeral cell style automatically, which is what the
// duration column used to hand-roll as `fontVariantNumeric: 'tabular-nums'`. The two columns that
// opt OUT are the two whose cell draws its own chrome: a weighted accent `Text` and a `Badge` both
// lose their typeface to the `td`'s monospace otherwise.
const columns = [
  columnHelper.accessor('started_at', {
    header: 'When',
    cell: (ctx) => {
      const start = dateLabel(ctx.getValue())
      return (
        <Stack gap={0}>
          <Text size="sm" fw={500}>
            {start.date}
          </Text>
          <Text size="xs" c="dimmed">
            {start.time}
          </Text>
        </Stack>
      )
    },
  }),
  columnHelper.accessor('distance_m', {
    header: 'Distance',
    meta: { numeral: false },
    cell: (ctx) => (
      <Text size="sm" fw={600} c="blue">
        {formatKm(ctx.getValue())}
      </Text>
    ),
  }),
  columnHelper.accessor('duration_s', {
    header: 'Duration',
    cell: (ctx) => formatDurationClock(ctx.getValue()),
  }),
  columnHelper.accessor('avg_speed_kmh', {
    header: 'Avg pace',
    cell: (ctx) => formatPace(ctx.getValue(), 2),
  }),
  columnHelper.accessor('max_speed_kmh', {
    header: 'Peak',
    cell: (ctx) => formatPace(ctx.getValue(), 2),
  }),
  columnHelper.accessor('steps', { header: 'Steps', cell: (ctx) => formatSteps(ctx.getValue()) }),
  columnHelper.accessor('kcal', { header: 'Kcal', cell: (ctx) => formatKcal(ctx.getValue()) }),
  columnHelper.accessor('pause_count', {
    header: 'Pauses',
    meta: { numeral: false },
    cell: (ctx) =>
      ctx.getValue() === 0 ? (
        <Text size="sm" c="dimmed">
          —
        </Text>
      ) : (
        <Badge size="sm" color="gray" variant="light">
          {ctx.getValue()}
        </Badge>
      ),
  }),
]

export function SessionHistoryTable() {
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })
  const { data } = useSuspenseQuery(
    walkingPadQueries.list({
      page: pagination.pageIndex + 1,
      limit: pagination.pageSize,
      order: 'desc',
    }),
  )

  if (data.total === 0) {
    return (
      <Card py="xs" px="sm">
        <Text size="sm" c="dimmed">
          No sessions yet — the daemon will surface them here as they're synced.
        </Text>
      </Card>
    )
  }

  return (
    // theme-allow card-inset — flush table card: header/body/footer manage their own px/py
    <Card padding={0}>
      <Group justify="space-between" px="md" py="sm">
        <Text fw={600} size="sm">
          Session history
        </Text>
        <Text size="xs" c="dimmed">
          {data.total} session{data.total === 1 ? '' : 's'} total
        </Text>
      </Group>
      <BasaltDataTable
        data={data.data}
        columns={columns}
        enableSorting={false}
        maxHeight={TABLE_BODY_MAX_HEIGHT}
        minWidth={640}
        stickyHeader
        striped
        highlightOnHover
        verticalSpacing="xs"
        withTableBorder={false}
        enablePagination
        manualPagination
        rowCount={data.total}
        initialPagination={{ pageIndex: 0, pageSize: PAGE_SIZE }}
        onPaginationChange={setPagination}
      />
    </Card>
  )
}
