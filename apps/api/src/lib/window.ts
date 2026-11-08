import { z } from 'zod'
import { DATE_RE, addDays, isCalendarDate, localDate } from './local-date.js'

const DateParam = (what: string) =>
  z
    .string()
    .regex(DATE_RE, 'must be YYYY-MM-DD')
    .refine(isCalendarDate, 'must be a real calendar date')
    .describe(what)

export const WindowQuerySchema = z.object({
  window: z
    .enum(['7d', '30d', '90d', 'all'])
    .optional()
    .describe(
      'Rolling window of N calendar dates ending today (Europe/Berlin), both ends inclusive: 7d is today and the 6 days before. Default 30d. Ignored when `from` is given.',
    ),
  from: DateParam(
    'Window start, YYYY-MM-DD inclusive (Europe/Berlin calendar date). `to` defaults to today when omitted.',
  ).optional(),
  to: DateParam(
    'Window end, YYYY-MM-DD inclusive. Without `from` the window is `window` days ending at `to`.',
  ).optional(),
})

type WindowInput = z.infer<typeof WindowQuerySchema>

const WINDOW_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, all: 9999 }

/**
 * The calendar-date window (`YYYY-MM-DD`, both ends inclusive) every date-keyed route shares.
 * `to` defaults to today in Berlin; `from` defaults to `to` minus (N - 1) days, so `7d` spans
 * exactly 7 dates.
 */
export function parseDateWindow(
  input: WindowInput,
  now: Date = new Date(),
): { from: string; to: string } {
  const to = input.to ?? localDate(now)
  if (input.from) return { from: input.from, to }
  const days = WINDOW_DAYS[input.window ?? '30d'] ?? 30
  return { from: addDays(to, -(days - 1)), to }
}

/**
 * Instant window for timestamped rows (walking-pad sessions): explicit dates are UTC midnights,
 * otherwise a rolling N x 24 h ending now. `to` defaults to now when only `from` is given.
 */
export function parseWindow(input: WindowInput, now: Date = new Date()): { from: Date; to: Date } {
  const to = input.to ? new Date(input.to) : now
  if (input.from) return { from: new Date(input.from), to }
  const days = WINDOW_DAYS[input.window ?? '30d'] ?? 30
  return { from: new Date(to.getTime() - days * 86_400_000), to }
}
