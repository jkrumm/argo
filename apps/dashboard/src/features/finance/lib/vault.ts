import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { IconLock } from '@tabler/icons-react'
import type { PageBar } from 'basalt-ui'
import { emit } from 'basalt-ui/commands'
import { createElement, useEffect, useRef, type ComponentProps } from 'react'
import { FINANCE_DATA, FINANCE_STATUS_KEY, onVaultLocked } from '../api/client'
import {
  lockVault,
  startSync,
  statusOptions,
  type LockedStatus,
  type VaultStatus,
} from '../api/status'

const LOCKED_NOW: LockedStatus = { locked: true, unlock_blocked_until: null }

/**
 * Everything the lock decides, in one place: decrypted rows leave the cache the moment the vault
 * locks, and the status flips to locked so the layout shows the unlock screen.
 */
function useDropToLocked(): () => void {
  const queryClient = useQueryClient()
  return () => {
    queryClient.removeQueries({ queryKey: FINANCE_DATA })
    queryClient.setQueryData<VaultStatus>(FINANCE_STATUS_KEY, LOCKED_NOW)
  }
}

/**
 * The layout's one polling observer of the vault status (30 s, 5 s while a sync runs), plus the two
 * reactions to what it sees: a 423 from any data call drops to the unlock screen, and a sync that
 * finishes (the status stops syncing, or `last_sync.finished_at` moves) invalidates the data.
 */
export function useVaultStatus() {
  const queryClient = useQueryClient()
  const status = useQuery(statusOptions)

  useEffect(
    () =>
      onVaultLocked(() => {
        queryClient.removeQueries({ queryKey: FINANCE_DATA })
        queryClient.setQueryData<VaultStatus>(FINANCE_STATUS_KEY, LOCKED_NOW)
      }),
    [queryClient],
  )

  const data = status.data
  const marker =
    data === undefined || data.locked
      ? null
      : `${data.syncing}|${data.last_sync?.finished_at ?? ''}`
  const previous = useRef<string | null>(null)
  useEffect(() => {
    if (marker === null) {
      previous.current = null
      return
    }
    const before = previous.current
    previous.current = marker
    // The first sight of an unlocked vault only records the baseline; data fetched since is fresh.
    if (before !== null && before !== marker && !marker.startsWith('true|')) {
      void queryClient.invalidateQueries({ queryKey: FINANCE_DATA })
    }
  }, [marker, queryClient])

  return status
}

/** The page bar's `sync` + `actions` (bank sync, Lock) for the unlocked vault. */
export function useVaultBarProps(): Pick<ComponentProps<typeof PageBar>, 'actions' | 'sync'> {
  const queryClient = useQueryClient()
  const dropToLocked = useDropToLocked()
  const status = useQuery({ ...statusOptions, refetchInterval: false })
  const data = status.data?.locked === false ? status.data : undefined

  const sync = useMutation({
    mutationFn: startSync,
    onSuccess: (outcome) => {
      if (outcome === 'already-running') {
        emit('finance:info', { message: 'A sync is already running.' })
      }
      void queryClient.invalidateQueries({ queryKey: FINANCE_STATUS_KEY })
    },
    onError: (error) => {
      if (error.message === 'The vault is locked.') dropToLocked()
      else emit('finance:error', { message: error.message })
    },
  })
  const lock = useMutation({
    mutationFn: lockVault,
    onSuccess: dropToLocked,
    onError: (error) => emit('finance:error', { message: error.message }),
  })

  const lastRun = data?.last_sync
  const lastFinished = lastRun?.finished_at
  const failed = lastRun?.ok === false
  return {
    sync: {
      label: 'Sync now',
      syncing: sync.isPending || data?.syncing === true,
      lastCompletedAt: lastFinished == null || failed ? null : new Date(lastFinished),
      ...(failed && { error: lastRun.error ?? 'The last sync failed.' }),
      onSync: () => sync.mutate(),
    },
    actions: [
      {
        key: 'lock',
        label: 'Lock',
        icon: createElement(IconLock, { size: 16 }),
        primary: true,
        loading: lock.isPending,
        onClick: () => lock.mutate(),
      },
    ],
  }
}
