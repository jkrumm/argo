import { treaty } from '@elysiajs/eden'
import type { App } from '@argo/api'
import { getToken } from './auth'

const baseUrl = import.meta.env.VITE_API_URL ?? `${window.location.origin}/api`
export const api = treaty<App>(baseUrl, {
  parseDate: false,
  headers: () => {
    const token = getToken()
    return token ? { Authorization: `Bearer ${token}` } : {}
  },
})

export function unwrap<T>({ data, error }: { data: T | null; error: unknown }): T {
  if (error) throw error
  if (data === null || data === undefined) throw new Error('Unexpected null response')
  return data
}
