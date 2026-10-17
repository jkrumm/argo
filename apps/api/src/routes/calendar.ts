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
  location: z.string().optional(),
  organizer: z.object({ name: z.string(), email: z.string() }).optional(),
  attendees: z.array(AttendeeSchema),
  calendarName: z.string().describe('Source calendar name'),
  videoLink: z.string().describe('Google Meet or conference link').optional(),
})

/**
 * `from` for the calendar routes: an ISO date (`YYYY-MM-DD`, read as UTC midnight) or an ISO
 * datetime. Absent means "now", the original behaviour.
 */
export const CalendarFromSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T.+)?$/, 'from must be an ISO date or datetime')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'from is not a valid date')
  .describe(
    'Window start, ISO date (YYYY-MM-DD, UTC midnight) or ISO datetime. Default: now. `days` counts from here, so past events are reachable.',
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
