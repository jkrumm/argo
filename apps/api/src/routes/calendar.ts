import { Elysia } from 'elysia'
import { z } from 'zod'
import { listCalendarEvents } from '../clients/google.js'

const AttendeeSchema = z.object({
  name: z.string(),
  email: z.string(),
  status: z.string().describe('accepted | declined | tentative | needsAction | unknown'),
})

const CalendarEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  start: z.string().describe('ISO timestamp or YYYY-MM-DD for all-day'),
  end: z.string().describe('ISO timestamp or YYYY-MM-DD for all-day'),
  isAllDay: z.boolean(),
  isCancelled: z
    .boolean()
    .describe(
      'True when Google marks the event status cancelled (deleted events are not requested)',
    ),
  location: z.string().optional(),
  organizer: z.object({ name: z.string(), email: z.string() }).optional(),
  attendees: z.array(AttendeeSchema),
  calendarName: z.string().describe('Source calendar name'),
  videoLink: z.string().describe('Google Meet or conference link').optional(),
})

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const ISO_DATETIME = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/

/** `2026-02-31` parses (to Mar 3) in `Date`; a real calendar date survives the round trip. */
function isRealDate(day: string): boolean {
  const parsed = new Date(`${day}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day
}

/**
 * `from` for the calendar routes: a real calendar date (`YYYY-MM-DD`, read as UTC midnight) or an
 * ISO datetime with an explicit `Z` / `±hh:mm` offset (an offset-less one would be read in the
 * server's zone). Absent means "now", the original behaviour.
 */
export const CalendarFromSchema = z
  .string()
  .refine((value) => {
    if (ISO_DATE.test(value)) return isRealDate(value)
    const match = ISO_DATETIME.exec(value)
    return match !== null && isRealDate(match[1] ?? '') && !Number.isNaN(Date.parse(value))
  }, 'from must be a real ISO date (YYYY-MM-DD) or an ISO datetime with a Z or ±hh:mm offset')
  .describe(
    'Window start: ISO date (YYYY-MM-DD, UTC midnight) or ISO datetime with an explicit Z or ±hh:mm offset. Default: now. `days` counts from here, so past events are reachable.',
  )

export const calendarRoutes = new Elysia({ prefix: '/calendar' }).get(
  '',
  async ({ query, set }) => {
    try {
      return await listCalendarEvents(
        query.days ? Number(query.days) : undefined,
        query.from ? new Date(query.from) : undefined,
      )
    } catch (error) {
      set.status = 503
      return error instanceof Error ? error.message : 'Google API error'
    }
  },
  {
    query: z.object({
      days: z
        .string()
        .describe('Days window from `from` (default: 30; from defaults to now)')
        .optional(),
      from: CalendarFromSchema.optional(),
    }),
    response: { 200: z.array(CalendarEventSchema), 503: z.string() },
    detail: {
      tags: ['Productivity'],
      summary: 'List Google Calendar events',
      description:
        'Returns events from all personal Google calendars merged into a single list, sorted by start time ascending, within `[from, from + days)`. `from` defaults to now (upcoming events only); pass an earlier ISO date or datetime to include past events, e.g. the Monday of the current week. 422 on a malformed `from`. All-day events use YYYY-MM-DD for start/end; timed events use ISO timestamps. `videoLink` is the Google Meet URL when present. 503 if the upstream Google Calendar API errors — re-auth via /oauth/google/init if tokens have expired.',
      security: [{ BearerAuth: [] }],
    },
  },
)
