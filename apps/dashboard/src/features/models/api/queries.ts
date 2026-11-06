import { queryOptions } from '@tanstack/react-query'
import { apiBase } from '../../../lib/api-base'
import { getToken } from '../../../lib/auth'
import { shotFetcher, shotState } from '../../../lib/shot-state'
import type { EfficiencyResponse } from './types'

/** `status` is the HTTP status, so Argo's 401 handling (`isUnauthorizedError`) reads it as it does elsewhere. */
export class ModelsApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ModelsApiError'
    this.status = status
  }
}

/** The relay returns modelpick's raw response, so it is a plain fetch (like the finance pages), not Eden. */
async function fetchEfficiency(): Promise<EfficiencyResponse> {
  const token = getToken()
  const response = await shotFetcher(shotState())(`${apiBase}/models/efficiency`, {
    headers: token === null ? {} : { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null
    const text =
      typeof body?.error === 'string' ? body.error : `models/efficiency: ${response.status}`
    throw new ModelsApiError(response.status, text)
  }
  return (await response.json()) as EfficiencyResponse
}

/** The AA snapshot changes at most daily: five minutes is fresh, and the page's sync button refetches. */
const STALE_MS = 5 * 60_000

export const modelsQueries = {
  all: () => ['models'] as const,
  efficiency: () =>
    queryOptions({
      queryKey: [...modelsQueries.all(), 'efficiency'] as const,
      queryFn: fetchEfficiency,
      staleTime: STALE_MS,
    }),
}
