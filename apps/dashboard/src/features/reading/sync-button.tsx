import { Button } from '@mantine/core'
import { IconRefresh } from '@tabler/icons-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
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
      notifications.show({
        title: 'Sync complete',
        message:
          result.errors > 0
            ? `Synced ${result.upserted} book(s) with ${result.errors} error(s) — check server logs.`
            : `Synced ${result.upserted} book(s) from Hardcover.`,
        color: result.errors > 0 ? 'yellow' : 'green',
      })
    },
    onError: () => {
      notifications.show({
        title: 'Sync failed',
        message: 'Could not run the Hardcover sync. Check the server logs.',
        color: 'red',
      })
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
