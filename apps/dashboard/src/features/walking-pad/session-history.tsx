import { useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Badge, Box, Card, Group, Pagination, Stack, Table, Text } from '@mantine/core'
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

export function SessionHistoryTable() {
  const [page, setPage] = useState(1)
  const { data } = useSuspenseQuery(
    walkingPadQueries.list({ page, limit: PAGE_SIZE, order: 'desc' }),
  )

  if (data.total === 0) {
    return (
      <Card padding="md">
        <Text size="sm" c="dimmed">
          No sessions yet — the daemon will surface them here as they're synced.
        </Text>
      </Card>
    )
  }

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE))

  return (
    <Card padding={0}>
      <Group justify="space-between" px="md" py="sm">
        <Text fw={600} size="sm">
          Session history
        </Text>
        <Text size="xs" c="dimmed">
          {data.total} session{data.total === 1 ? '' : 's'} total
        </Text>
      </Group>
      <Box style={{ maxHeight: TABLE_BODY_MAX_HEIGHT, overflowX: 'auto', overflowY: 'auto' }}>
        <Table verticalSpacing="xs" striped highlightOnHover stickyHeader>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>When</Table.Th>
              <Table.Th>Distance</Table.Th>
              <Table.Th>Duration</Table.Th>
              <Table.Th>Avg pace</Table.Th>
              <Table.Th>Peak</Table.Th>
              <Table.Th>Steps</Table.Th>
              <Table.Th>Kcal</Table.Th>
              <Table.Th>Pauses</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {data.data.map((s) => (
              <SessionRow key={s.uuid} session={s as SessionRow} />
            ))}
          </Table.Tbody>
        </Table>
      </Box>
      {totalPages > 1 && (
        <Group justify="center" p="sm">
          <Pagination value={page} onChange={setPage} total={totalPages} size="sm" />
        </Group>
      )}
    </Card>
  )
}

function SessionRow({ session }: { session: SessionRow }) {
  const start = dateLabel(session.started_at)
  return (
    <Table.Tr>
      <Table.Td>
        <Stack gap={0}>
          <Text size="sm" fw={500}>
            {start.date}
          </Text>
          <Text size="xs" c="dimmed">
            {start.time}
          </Text>
        </Stack>
      </Table.Td>
      <Table.Td>
        <Text size="sm" fw={600} c="blue">
          {formatKm(session.distance_m)}
        </Text>
      </Table.Td>
      <Table.Td style={{ fontVariantNumeric: 'tabular-nums' }}>
        {formatDurationClock(session.duration_s)}
      </Table.Td>
      <Table.Td>{formatPace(session.avg_speed_kmh, 2)}</Table.Td>
      <Table.Td>{formatPace(session.max_speed_kmh, 2)}</Table.Td>
      <Table.Td>{formatSteps(session.steps)}</Table.Td>
      <Table.Td>{formatKcal(session.kcal)}</Table.Td>
      <Table.Td>
        {session.pause_count === 0 ? (
          <Text size="sm" c="dimmed">
            —
          </Text>
        ) : (
          <Badge size="sm" color="gray" variant="light">
            {session.pause_count}
          </Badge>
        )}
      </Table.Td>
    </Table.Tr>
  )
}
