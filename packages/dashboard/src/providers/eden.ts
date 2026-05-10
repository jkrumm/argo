import { treaty } from '@elysiajs/eden'
import type { App } from '@argo/api'

export const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'https://argo.jkrumm.com/api'

// parseDate: false — keep date strings as strings.
// Eden's default ISO-date reviver coerces "YYYY-MM-DD" (daily_metrics.date, workouts.date, …)
// into JS Date objects, which breaks the string-based sort/filter code throughout the app.
export const api = treaty<App>(API_URL, { parseDate: false })
