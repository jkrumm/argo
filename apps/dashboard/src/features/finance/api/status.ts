/**
 * The vault service's own state and actions (finances `docs/service.md`, relayed 1:1 by Argo's
 * `/finance/*`): locked or unlocked, the last sync, and the unlock / lock / sync calls.
 */
import { queryOptions } from '@tanstack/react-query'
import { apiBase } from '../../../lib/api-base'
import { getToken } from '../../../lib/auth'
import { FINANCE_STATUS_KEY, FinanceApiError, financePost } from './client'

/** One account's outcome in a sync run; the service owns its shape and the UI only counts runs. */
export type SyncAccountResult = Record<string, unknown>

/** `last_sync` of the status; null before the first run. `finished_at` is null while it runs. */
export type SyncRun = {
  started_at: string
  finished_at: string | null
  ok: boolean | null
  error: string | null
  accounts: SyncAccountResult[]
}

export type LockedStatus = {
  locked: true
  /** ISO time until which unlock is refused after repeated wrong keys, else null. */
  unlock_blocked_until: string | null
}

export type UnlockedStatus = {
  locked: false
  unlocked_at: string
  idle_lock_at: string
  syncing: boolean
  last_sync: SyncRun | null
}

export type VaultStatus = LockedStatus | UnlockedStatus

const POLL_MS = 30_000
/** While a sync runs the strip follows it closely, so the data refreshes soon after it ends. */
const POLL_SYNCING_MS = 5_000

async function fetchStatus(): Promise<VaultStatus> {
  const token = getToken()
  const response = await fetch(`${apiBase}/finance/status`, {
    headers: token === null ? {} : { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null
    const text = typeof body?.error === 'string' ? body.error : `status: ${response.status}`
    throw new FinanceApiError(response.status, text)
  }
  return (await response.json()) as VaultStatus
}

/**
 * Polled only while a finance page is mounted (the layout is its sole observer); a refetch pauses in
 * a background tab. Retries stay off for a 503: the strip says the service is down and Retry asks again.
 */
export const statusOptions = queryOptions({
  queryKey: FINANCE_STATUS_KEY,
  queryFn: fetchStatus,
  staleTime: 0,
  refetchInterval: (query) => {
    const data = query.state.data
    return data !== undefined && !data.locked && data.syncing ? POLL_SYNCING_MS : POLL_MS
  },
  retry: (failures, error) => !(error instanceof FinanceApiError) && failures < 2,
})

export type UnlockOutcome =
  | { kind: 'unlocked' }
  | { kind: 'wrong-key' }
  | { kind: 'throttled'; blockedUntil: string | null }
  | { kind: 'unavailable' }

/**
 * Posts the vault key. The key is a parameter of this call and the body of one request: it is not
 * kept in a query, a mutation (their variables would outlive the call), a store or storage.
 */
export async function unlockVault(key: string): Promise<UnlockOutcome> {
  let result: Awaited<ReturnType<typeof financePost>>
  try {
    result = await financePost('/unlock', JSON.stringify({ key }))
  } catch {
    return { kind: 'unavailable' }
  }
  if (result.status === 204) return { kind: 'unlocked' }
  if (result.status === 401) return { kind: 'wrong-key' }
  if (result.status === 429) {
    const blocked = (result.body as { unlock_blocked_until?: unknown } | null)?.unlock_blocked_until
    return { kind: 'throttled', blockedUntil: typeof blocked === 'string' ? blocked : null }
  }
  return { kind: 'unavailable' }
}

export async function lockVault(): Promise<void> {
  const { status } = await financePost('/lock')
  if (status !== 204) throw new FinanceApiError(status, 'Could not lock the vault.')
}

export type SyncOutcome = 'started' | 'already-running'

export async function startSync(): Promise<SyncOutcome> {
  const { status } = await financePost('/sync')
  if (status === 202) return 'started'
  if (status === 409) return 'already-running'
  throw new FinanceApiError(
    status,
    status === 423 ? 'The vault is locked.' : 'Could not start a sync.',
  )
}
