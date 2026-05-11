import { treaty } from '@elysiajs/eden'
import type { App } from '@argo/api'

const baseUrl = import.meta.env.VITE_API_URL ?? '/api'
export const api = treaty<App>(baseUrl)

export function unwrap<T>({ data, error }: { data: T | null; error: unknown }): T {
  if (error) throw error
  if (data === null || data === undefined) throw new Error('Unexpected null response')
  return data
}
