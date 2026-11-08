import { useCallback, useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  dailyMetricsQueries,
  triggerSyncRefresh,
  activitiesQueries,
  recoveryQueries,
  fitnessDirectionQueries,
  trainingLoadQueries,
} from '../../lib/queries/daily-metrics'
import { strengthQueries } from '../../lib/queries/strength'
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
  const lastCompletedRef = useRef<string | null | undefined>(undefined)

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

  // Every Garmin-derived query goes stale when a sync completes: the daily metrics plus the
  // recovery, fitness-direction and training-load views, and the strength readiness / load
  // views that read Garmin HRV and sleep.
  const invalidate = useCallback(() => {
    for (const queryKey of [
      dailyMetricsQueries.all(),
      activitiesQueries.all(),
      recoveryQueries.all(),
      fitnessDirectionQueries.all(),
      trainingLoadQueries.all(),
      [...strengthQueries.all(), 'readiness'],
      [...strengthQueries.all(), 'training-load'],
    ]) {
      void queryClient.invalidateQueries({ queryKey })
    }
  }, [queryClient])

  // Keyed on `last_completed_at`, not on seeing `in_progress`: a fast sync can go queued -> done
  // between two polls, and the first status seen after mount is only the baseline.
  useEffect(() => {
    if (status === undefined) return
    const previous = lastCompletedRef.current
    lastCompletedRef.current = status.last_completed_at
    if (previous === undefined || previous === status.last_completed_at) return
    invalidate()
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
