import { useCallback, useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  dailyMetricsQueries,
  triggerSyncRefresh,
  activitiesQueries,
} from '../../lib/queries/daily-metrics'
import { SYNC_POLL_INTERVAL_MS, SYNC_STALE_THRESHOLD_MS } from './constants'
import { isStale } from './formulas'

// Eden type inference for the sync-status endpoint falls through to `{}` —
// declare the wire shape explicitly to keep the hook typed.
type SyncStatus = {
  refresh_requested: boolean
  in_progress: boolean
  last_started_at: string | null
  last_completed_at: string | null
  last_status: string | null
  last_message: string | null
}

/** What `PageBar.sync` takes, minus the `scope` the bar fixes itself. */
export type GarminSync = {
  syncing: boolean
  lastCompletedAt: Date | null
  onSync: () => void
  error?: string
}

/**
 * The Garmin sync engine, headless: the status poll, the auto-trigger on a stale mount, the
 * invalidate on completion, and the manual trigger. The CHROME is basalt's `SyncButton` (law C12) —
 * hand this straight to `PageBar.sync`, which renders the spinner, the age and the error tone.
 */
export function useGarminSync(): GarminSync {
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

  const onSync = useCallback(() => {
    refresh.mutate()
  }, [refresh])

  const lastCompleted = status?.last_completed_at ?? null
  const errorMessage =
    status?.last_status === 'error' ? (status.last_message ?? 'Last sync failed.') : undefined

  return {
    syncing: Boolean(status?.in_progress || status?.refresh_requested || refresh.isPending),
    lastCompletedAt: lastCompleted !== null ? new Date(lastCompleted) : null,
    onSync,
    ...(errorMessage !== undefined && { error: errorMessage }),
  }
}
