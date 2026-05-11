import { treaty } from '@elysiajs/eden'
import type { App } from '@argo/api'

const baseUrl = import.meta.env.VITE_API_URL ?? '/api'
export const api = treaty<App>(baseUrl)
