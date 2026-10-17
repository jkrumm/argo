import { useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Badge, Stack, Text, Tooltip } from '@mantine/core'
import type { PaginationState } from '@tanstack/react-table'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/table'
import { durationClock } from 'basalt-ui/format'
import { APP_LOCALE, relativeTime } from '../../lib/format'
import { walkingPadQueries } from '../../lib/queries/walking-pad'
import type { SessionRow } from './model'

const PAGE_SIZE = 25
const TABLE_BODY_MAX_HEIGHT = 480

const dateFormat = new Intl.DateTimeFormat(APP_LOCALE, { dateStyle: 'medium', timeStyle: 'short' })
const shortDate = new Intl.DateTimeFormat(APP_LOCALE, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

const columnHelper = createColumnHelper<SessionRow>()

// Units live in the headers; cells carry the bare figure. Numeric accessors get the mono-numeral style.
const columns = [
  columnHelper.accessor('started_at', {
    header: 'When',
    cell: (ctx) => (
      <Tooltip label={dateFormat.format(new Date(ctx.getValue()))}>
        <Stack gap={0}>
          <Text size="sm" fw={500}>
            {relativeTime(ctx.getValue())}
          </Text>
          <Text size="xs" c="dimmed">
            {shortDate.format(new Date(ctx.getValue()))}
          </Text>
        </Stack>
      </Tooltip>
    ),
  }),
  columnHelper.accessor('distance_m', {
    header: 'Distance km',
    cell: (ctx) => (ctx.getValue() / 1000).toFixed(2),
  }),
  columnHelper.accessor('duration_s', {
    header: 'Duration',
    cell: (ctx) => durationClock(ctx.getValue()),
  }),
  columnHelper.accessor('avg_speed_kmh', {
    header: 'Pace km/h',
    cell: (ctx) => ctx.getValue().toFixed(1),
  }),
  columnHelper.accessor('max_speed_kmh', {
    header: 'Peak km/h',
    cell: (ctx) => ctx.getValue().toFixed(1),
  }),
  columnHelper.accessor('steps', {
    header: 'Steps',
    cell: (ctx) => ctx.getValue().toLocaleString('en-GB'),
  }),
  columnHelper.accessor('kcal', {
    header: 'Energy kcal',
    cell: (ctx) => String(Math.round(ctx.getValue())),
  }),
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

export function HistoryTable() {
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
  return (
    // The TOTAL rides `subtitle`: under `manualPagination` the table's own count is this page's rows.
    <BasaltDataTable
      title="Session history"
      subtitle={`${data.total} ${data.total === 1 ? 'walk' : 'walks'}, newest first`}
      data={data.data}
      columns={columns}
      enableSorting={false}
      maxHeight={TABLE_BODY_MAX_HEIGHT}
      stickyHeader
      striped
      highlightOnHover
      verticalSpacing="xs"
      enablePagination
      manualPagination
      rowCount={data.total}
      initialPagination={{ pageIndex: 0, pageSize: PAGE_SIZE }}
      onPaginationChange={setPagination}
    />
  )
}
