import { Stack, Text } from '@mantine/core'
import { overlays } from 'basalt-ui/commands'
import { useSuspenseQuery } from '@tanstack/react-query'
import { IconTrash } from '@tabler/icons-react'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/table'
import { shotState } from '../../../lib/shot-state'
import { skinfoldLogQueries, useDeleteSkinfoldLog } from '../../../lib/queries/skinfold-log'
import { skinfoldSiteLabel } from '../formulas'
import { localDay } from '../charts/series-data'
import { format } from 'date-fns'

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
  const logged = (data?.data ?? []) as SkinfoldRow[]
  const readings: SkinfoldRow[] = shotState() === 'empty' ? [] : logged

  const deleteSkinfoldLog = useDeleteSkinfoldLog()

  // Rows are facts: with none, the page shows its empty row instead of an empty table.
  if (readings.length === 0) return null

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
    columnHelper.accessor('date', {
      header: 'Date',
      cell: (ctx) => format(localDay(ctx.getValue()), 'd MMM yyyy'),
    }),
    columnHelper.accessor((row) => skinfoldSiteLabel(row.site), {
      id: 'site',
      header: 'Site',
    }),
    columnHelper.accessor('value_mm', {
      header: 'Thickness (mm)',
      cell: (ctx) => ctx.getValue().toFixed(1),
      meta: { align: 'right' },
    }),
  ]

  return (
    <Stack gap="xs" data-shot="skinfold-history">
      <BasaltDataTable
        data={readings}
        columns={columns}
        rowActions={[
          {
            key: 'delete',
            label: 'Delete',
            icon: <IconTrash size={14} />,
            danger: true,
            loading: (r) => deleteSkinfoldLog.isPending && deleteSkinfoldLog.variables === r.id,
            onClick: handleDelete,
          },
        ]}
        striped
        highlightOnHover
      />
    </Stack>
  )
}
