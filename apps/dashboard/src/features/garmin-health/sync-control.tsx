import { useCallback, useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ActionIcon, Button, Loader, Tooltip } from '@mantine/core'
import { IconRefresh } from '@tabler/icons-react'
import {
  dailyMetricsQueries,
  triggerSyncRefresh,
  activitiesQueries,
} from '../../lib/queries/daily-metrics'
import { SYNC_POLL_INTERVAL_MS, SYNC_STALE_THRESHOLD_MS } from './constants'
import { formatRelativeTime, isStale } from './formulas'

// Eden type inference for the sync-status endpoint falls through to `{}` —
// declare the wire shape explicitly to keep the component typed.
type SyncStatus = {
  refresh_requested: boolean
  in_progress: boolean
  last_started_at: string | null
  last_completed_at: string | null
  last_status: string | null
  last_message: string | null
}

/**
 * Garmin sync UI — manual refresh button, spinner during in-progress,
 * last-sync tooltip, polling loop, and auto-trigger on mount when stale.
 */
export function SyncControl() {
  const queryClient = useQueryClient()
  const autoTriggered = useRef(false)
  const wasInProgress = useRef(false)

  const query = useQuery({
    ...dailyMetricsQueries.syncStatus(),
    // Poll while a sync is queued or running; otherwise lean on manual refetch.
    refetchInterval: (q) => {
      const s = q.state.data as SyncStatus | undefined
      if (s === undefined) return false
      return s.refresh_requested || s.in_progress ? SYNC_POLL_INTERVAL_MS : false
    },
  })
  const status = query.data as SyncStatus | undefined

  const refresh = useMutation({
    mutationFn: triggerSyncRefresh,
    onSuccess: (data) => {
      queryClient.setQueryData(dailyMetricsQueries.syncStatus().queryKey, data)
    },
  })

  // Auto-trigger once on mount if last sync is stale.
  useEffect(() => {
    if (status === undefined || autoTriggered.current) return
    if (
      !status.in_progress &&
      !status.refresh_requested &&
      isStale(status.last_completed_at, SYNC_STALE_THRESHOLD_MS)
    ) {
      autoTriggered.current = true
      refresh.mutate()
    }
  }, [status, refresh])

  // When in_progress transitions false → invalidate all garmin-health caches.
  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: dailyMetricsQueries.all() })
    void queryClient.invalidateQueries({ queryKey: activitiesQueries.all() })
  }, [queryClient])

  useEffect(() => {
    if (status === undefined) return
    if (status.in_progress) {
      wasInProgress.current = true
      return
    }
    if (wasInProgress.current && !status.refresh_requested) {
      wasInProgress.current = false
      invalidate()
    }
  }, [status, invalidate])

  const syncing = Boolean(status?.in_progress || status?.refresh_requested || refresh.isPending)
  const lastCompleted = status?.last_completed_at ?? null
  const errorState = status?.last_status === 'error'

  const tooltip = syncing
    ? 'Syncing Garmin Connect…'
    : `Last sync: ${formatRelativeTime(lastCompleted)}${errorState ? ' (error)' : ''}${
        status?.last_message !== null && status?.last_message !== undefined
          ? ` — ${status.last_message}`
          : ''
      }`

  return (
    <Tooltip label={tooltip} withArrow position="bottom">
      <Button
        size="xs"
        variant="default"
        leftSection={
          syncing ? (
            <Loader size={12} />
          ) : (
            <ActionIcon component="span" size="xs" variant="transparent" color="gray">
              <IconRefresh size={14} />
            </ActionIcon>
          )
        }
        onClick={() => refresh.mutate()}
        disabled={syncing}
      >
        {syncing ? 'Syncing…' : formatRelativeTime(lastCompleted)}
      </Button>
    </Tooltip>
  )
}
