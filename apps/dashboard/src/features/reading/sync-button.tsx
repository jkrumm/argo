import { Button } from '@mantine/core'
import { IconRefresh } from '@tabler/icons-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { emit } from 'basalt-ui/notifications'
import { api, unwrap } from '../../lib/eden'
import { readingQueries } from '../../lib/queries/reading'

/**
 * Triggers an on-demand Hardcover shelf sync (the same job the daily cron runs)
 * and refetches the shelf on success. Lets you verify Hardcover changes without
 * waiting for the scheduled sync.
 */
export function SyncButton() {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async () => unwrap(await api.reading.sync.post()),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: readingQueries.all() })
      if (result.errors > 0) {
        emit(
          'reading:partial',
          {
            message: `Synced ${result.upserted} book(s) with ${result.errors} error(s) — check server logs.`,
          },
          { title: 'Sync complete' },
        )
      } else {
        emit(
          'reading:success',
          { message: `Synced ${result.upserted} book(s) from Hardcover.` },
          { title: 'Sync complete' },
        )
      }
    },
    onError: () => {
      emit(
        'reading:error',
        { message: 'Could not run the Hardcover sync. Check the server logs.' },
        { title: 'Sync failed' },
      )
    },
  })

  return (
    <Button
      variant="default"
      size="xs"
      leftSection={<IconRefresh size={16} />}
      loading={mutation.isPending}
      onClick={() => mutation.mutate()}
    >
      Sync now
    </Button>
  )
}
