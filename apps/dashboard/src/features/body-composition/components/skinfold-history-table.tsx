import { ActionIcon, Group, Stack, Text, Tooltip } from '@mantine/core'
import { overlays } from 'basalt-ui/commands'
import { useSuspenseQuery } from '@tanstack/react-query'
import { IconTrash } from '@tabler/icons-react'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/data/table'
import { skinfoldLogQueries, useDeleteSkinfoldLog } from '../../../lib/queries/skinfold-log'
import { skinfoldSiteLabel } from '../formulas'

type SkinfoldRow = {
  id: number
  date: string
  site: string
  value_mm: number
  created_at: string | null
}

const columnHelper = createColumnHelper<SkinfoldRow>()

export function SkinfoldHistoryTable() {
  const { data } = useSuspenseQuery(skinfoldLogQueries.list({ page: 1, limit: 20 }))
  const readings = (data?.data ?? []) as SkinfoldRow[]

  const deleteSkinfoldLog = useDeleteSkinfoldLog()

  function handleDelete(reading: SkinfoldRow) {
    void overlays.confirm({
      title: 'Delete reading',
      body: (
        <Text size="sm">
          Delete {skinfoldSiteLabel(reading.site)} reading of {reading.value_mm} mm on{' '}
          {reading.date}? This cannot be undone.
        </Text>
      ),
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      danger: true,
      onConfirm: () => deleteSkinfoldLog.mutate(reading.id),
    })
  }

  const columns = [
    columnHelper.accessor('date', { header: 'Date' }),
    columnHelper.accessor((row) => skinfoldSiteLabel(row.site), {
      id: 'site',
      header: 'Site',
    }),
    columnHelper.accessor('value_mm', {
      header: 'Thickness',
      cell: (ctx) => `${ctx.getValue().toFixed(1)} mm`,
    }),
    columnHelper.display({
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: (ctx) => {
        const r = ctx.row.original
        return (
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
        )
      },
    }),
  ]

  return (
    <Stack gap="xs">
      <BasaltDataTable
        data={readings}
        columns={columns}
        striped
        highlightOnHover
        emptyState={
          <Text c="dimmed" ta="center" size="sm" py="sm">
            No skinfold readings logged yet
          </Text>
        }
      />
    </Stack>
  )
}
