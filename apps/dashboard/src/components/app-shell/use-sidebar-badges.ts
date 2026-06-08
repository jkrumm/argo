import { useQuery } from '@tanstack/react-query'
import { calendarQueries } from '../../lib/queries/calendar'
import { m365Queries } from '../../lib/queries/m365'

/** Local YYYY-MM-DD key for "today" comparisons — matches the API's date-prefix wire format. */
function todayKey(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** True when an ISO timestamp or `YYYY-MM-DD` all-day string falls on `today`. */
function startsOn(start: string | null | undefined, today: string): boolean {
  return typeof start === 'string' && start.slice(0, 10) === today
}

export type SidebarBadges = { m365: number; calendar: number }

/**
 * Always-on counts for the sidebar nav badges. Read-only, low-frequency, and degrade to 0 on
 * error: under `bun dev` the Google/M365 upstreams return 503 (no local tokens), which surfaces
 * as a thrown error here and simply yields no badge instead of a crash (`retry: false` avoids
 * hammering). Counts resolve under `bun dev:prod-api` / prod where the tokens live.
 *
 * - `m365`: important messages received *today* across labeled sources (GET /m365/important).
 * - `calendar`: events starting *today* from Google + M365 (a `days=1` window, so effectively the
 *   events still to come today). TickTick tasks are intentionally excluded — counting them needs
 *   an N+1 projects→tasks fetch, disproportionate for a sidebar number.
 */
export function useSidebarBadges(): SidebarBadges {
  const today = todayKey()

  const important = useQuery({ ...m365Queries.important({ top: 10 }), retry: false })
  const google = useQuery({ ...calendarQueries.google(1) })
  const m365cal = useQuery({ ...calendarQueries.m365(1) })

  const m365 = important.data?.messages
    ? important.data.messages.filter((row) => startsOn(row.message.createdAt, today)).length
    : 0

  const googleToday = Array.isArray(google.data)
    ? google.data.filter((event) => startsOn(event.start, today)).length
    : 0
  const m365Today = Array.isArray(m365cal.data)
    ? m365cal.data.filter((event) => startsOn(event.start, today)).length
    : 0

  return { m365, calendar: googleToday + m365Today }
}
