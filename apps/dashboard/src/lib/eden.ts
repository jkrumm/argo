import { treaty } from '@elysiajs/eden'
import type { App } from '@argo/api'
import { getToken } from './auth'
import { apiBase } from './api-base'
import { shotFetcher, shotState } from './shot-state'

export const api = treaty<App>(apiBase, {
  parseDate: false,
  fetcher: shotFetcher(shotState()),
  headers: () => {
    const token = getToken()
    return token ? { Authorization: `Bearer ${token}` } : {}
  },
})
