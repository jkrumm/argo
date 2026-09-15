import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { emit } from 'basalt-ui/notifications'
import {
  enqueueWardenAction,
  type WardenActionVerb,
  type WardenBoardItem,
} from '../../lib/queries/warden'
import { reconcilePendingActions, withPendingAction, type PendingActions } from './model'

// Reconciliation also runs on this timer, not only when the snapshot's `items` array reference
// changes — React Query's structural sharing keeps the same reference across a poll that returns a
// structurally-identical board, which would otherwise leave a timed-out pending action stuck
// "Queued" forever with nothing to trigger `reconcilePendingActions`.
const RECONCILE_INTERVAL_MS = 30_000

/**
 * Owns the owner-action mutation and the client-side "queued → applied" pending state for the
 * GitHub-issues section (`issues-section.tsx`) — pulled out of `WardenPage` so page composition
 * doesn't carry mutation/reconciliation logic, mirroring `model.ts`'s ownership of the board/issue
 * derivations themselves.
 */
export function useWardenActions(
  machine: string | undefined,
  boardItems: WardenBoardItem[] | undefined,
) {
  const [pending, setPending] = useState<PendingActions>({})
  const boardItemsRef = useRef(boardItems)
  boardItemsRef.current = boardItems

  useEffect(() => {
    const id = setInterval(() => {
      setPending((prev) => reconcilePendingActions(prev, boardItemsRef.current ?? []))
    }, RECONCILE_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!boardItems) return
    setPending((prev) => reconcilePendingActions(prev, boardItems))
  }, [boardItems])

  const { mutate } = useMutation({
    mutationFn: (params: {
      eventId: number
      verb: WardenActionVerb
      payload?: Record<string, unknown>
    }) => {
      if (!machine) throw new Error('No warden snapshot loaded yet')
      return enqueueWardenAction({ machine, ...params })
    },
    onMutate: (params) => {
      const queuedAt = Date.now()
      setPending((prev) => withPendingAction(prev, params.eventId, params.verb, queuedAt))
      return { queuedAt }
    },
    onSuccess: () => {
      emit(
        'warden:action-queued',
        { message: 'Warden will apply it on its next poll.' },
        { title: 'Action queued' },
      )
    },
    onError: (error, params, context) => {
      setPending((prev) => {
        // Only clear the entry this specific mutation instance set — a fresh action queued for
        // the same event after this one failed (or after this one timed out of `pending`) must
        // never be wiped out by this instance's late/stale rejection.
        const current = prev[params.eventId]
        if (!current || current.queuedAt !== context?.queuedAt) return prev
        const { [params.eventId]: _dropped, ...rest } = prev
        return rest
      })
      emit(
        'warden:action-error',
        { message: error instanceof Error ? error.message : 'Unknown error' },
        { title: 'Could not queue action' },
      )
    },
  })

  const handleAction = useCallback(
    (eventId: number, verb: WardenActionVerb, payload?: Record<string, unknown>) => {
      mutate({ eventId, verb, ...(payload !== undefined && { payload }) })
    },
    [mutate],
  )

  return { pending, handleAction }
}
