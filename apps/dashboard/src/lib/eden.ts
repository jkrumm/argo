import { treaty } from '@elysiajs/eden'
import type { App } from '@argo/api'
import { getToken } from './auth'
import { apiBase } from './api-base'

export const api = treaty<App>(apiBase, {
  parseDate: false,
  headers: () => {
    const token = getToken()
    return token ? { Authorization: `Bearer ${token}` } : {}
  },
})
