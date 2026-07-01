import { ActionIcon, Group, Stack, Table, Text, Tooltip } from '@mantine/core'
import { modals } from '@mantine/modals'
import { useSuspenseQuery } from '@tanstack/react-query'
import { IconTrash } from '@tabler/icons-react'
import { skinfoldLogQueries, useDeleteSkinfoldLog } from '../../../lib/queries/skinfold-log'
import { skinfoldSiteLabel } from '../formulas'

type SkinfoldRow = {
  id: number
  date: string
  site: string
  value_mm: number
  created_at: string | null
}

export function SkinfoldHistoryTable() {
  const { data } = useSuspenseQuery(skinfoldLogQueries.list({ page: 1, limit: 20 }))
  const readings = (data?.data ?? []) as SkinfoldRow[]

  const deleteSkinfoldLog = useDeleteSkinfoldLog()

  function handleDelete(reading: SkinfoldRow) {
    modals.openConfirmModal({
      title: 'Delete reading',
      children: (
        <Text size="sm">
          Delete {skinfoldSiteLabel(reading.site)} reading of {reading.value_mm} mm on{' '}
          {reading.date}? This cannot be undone.
        </Text>
      ),
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteSkinfoldLog.mutate(reading.id),
    })
  }

  return (
    <Stack gap="xs">
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Date</Table.Th>
            <Table.Th>Site</Table.Th>
            <Table.Th>Thickness</Table.Th>
            <Table.Th style={{ width: 56 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {readings.map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td>{r.date}</Table.Td>
              <Table.Td>{skinfoldSiteLabel(r.site)}</Table.Td>
              <Table.Td>{r.value_mm.toFixed(1)} mm</Table.Td>
              <Table.Td>
                <Group gap={4} justify="flex-end">
                  <Tooltip label="Delete" withArrow>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      size="sm"
                      loading={deleteSkinfoldLog.isPending && deleteSkinfoldLog.variables === r.id}
                      onClick={() => handleDelete(r)}
                      aria-label="Delete"
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
          {readings.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={4}>
                <Text c="dimmed" ta="center" py="sm">
                  No skinfold readings logged yet
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </Stack>
  )
}
