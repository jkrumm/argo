import { useQuery } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { getToken } from '../../lib/auth'
import { shotFetcher, shotState } from '../../lib/shot-state'

/** A `/paper/*` file as a Blob. The API wants the bearer, which an `<img src>` cannot send. */
export function usePaperBlob(path: string | null, version: string | number = '') {
  return useQuery({
    queryKey: ['paper', 'blob', path, version] as const,
    enabled: path !== null,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    retry: 1,
    queryFn: async () => {
      // Lazy: `api-base` reads `window` at import, which the component tests do not have.
      const { apiBase } = await import('../../lib/api-base')
      const token = getToken()
      const response = await shotFetcher(shotState())(`${apiBase}${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!response.ok) {
        // The API's own words, and the status for Argo's 401 handling.
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        throw Object.assign(new Error(body?.error ?? `HTTP ${response.status}`), {
          status: response.status,
        })
      }
      return response.blob()
    },
  })
}

type UrlEntry = { url: string; users: number }
const urlEntries = new WeakMap<Blob, UrlEntry>()

/**
 * An object URL for the blob, alive while a component shows it. A store, not an effect with state:
 * StrictMode mounts, unmounts and mounts again, and a URL revoked in between must be made anew.
 */
export function useObjectUrl(blob: Blob | undefined): string | null {
  return useSyncExternalStore(
    (onChange) => {
      if (!blob) return () => undefined
      const entry = urlEntries.get(blob) ?? { url: URL.createObjectURL(blob), users: 0 }
      entry.users += 1
      urlEntries.set(blob, entry)
      onChange()
      return () => {
        entry.users -= 1
        // Later, so a StrictMode remount in between keeps the URL.
        setTimeout(() => {
          if (entry.users > 0 || urlEntries.get(blob) !== entry) return
          URL.revokeObjectURL(entry.url)
          urlEntries.delete(blob)
        }, 0)
      }
    },
    () => (blob ? (urlEntries.get(blob)?.url ?? null) : null),
    () => null,
  )
}
