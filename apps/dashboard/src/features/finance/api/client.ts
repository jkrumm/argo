import { apiBase } from '../../../lib/api-base'
import { getToken } from '../../../lib/auth'

/** Query-key prefix of every vault data query; the layout drops or refreshes them as a family. */
export const FINANCE_DATA = ['finance', 'data'] as const
export const FINANCE_STATUS_KEY = ['finance', 'status'] as const

/** `status` is the HTTP status, so Argo's 401 handling (`isUnauthorizedError`) reads it as it does elsewhere. */
export class FinanceApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'FinanceApiError'
    this.status = status
  }
}

type Params = Record<string, string | number | undefined>

function buildUrl(path: string, params: Params): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue
    query.set(key, String(value))
  }
  const qs = query.toString()
  return `${apiBase}/finance${path}${qs === '' ? '' : `?${qs}`}`
}

const lockedListeners = new Set<() => void>()

/** Called with every 423 a data call sees (the vault locked itself); the layout drops to the unlock screen. */
export function onVaultLocked(listener: () => void): () => void {
  lockedListeners.add(listener)
  return () => lockedListeners.delete(listener)
}

const authHeaders = (): Record<string, string> => {
  const token = getToken()
  return token === null ? {} : { Authorization: `Bearer ${token}` }
}

/** The service's own `{ error }` text when it sent one, so a failure names its cause. */
async function failure(response: Response, path: string): Promise<FinanceApiError> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null
  const text = typeof body?.error === 'string' ? body.error : `${path}: ${response.status}`
  return new FinanceApiError(response.status, text)
}

/** One authenticated `GET /api/finance/api<path>` (the service's `/api/<path>`); a 423 also tells the layout the vault is locked. */
export async function financeGet<T>(path: string, params: Params = {}): Promise<T> {
  const response = await fetch(buildUrl(`/api${path}`, params), {
    headers: authHeaders(),
    cache: 'no-store',
  })
  if (response.status === 423) for (const listener of lockedListeners) listener()
  if (!response.ok) throw await failure(response, path)
  return (await response.json()) as T
}

/**
 * A POST to the vault service; resolves with the status and the parsed body (null when none), and
 * throws only on a network failure. The caller owns what each status means (409, 423, 429, …).
 * `body` is sent verbatim and never retained here.
 */
export async function financePost(
  path: string,
  body?: string,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(buildUrl(path, {}), {
    method: 'POST',
    headers: {
      ...authHeaders(),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body }),
    cache: 'no-store',
  })
  return { status: response.status, body: await response.json().catch(() => null) }
}

/**
 * One typed write (`POST /api/finance/api<path>`): resolves with the parsed body, throws a
 * `FinanceApiError` carrying the service's own `{ error }` text on any non-2xx (a 423 also tells the
 * layout the vault is locked). `body` is sent verbatim and never retained here or logged.
 */
export async function financeWrite<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(buildUrl(`/api${path}`, {}), {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  if (response.status === 423) for (const listener of lockedListeners) listener()
  if (!response.ok) throw await failure(response, path)
  return (await response.json().catch(() => null)) as T
}
