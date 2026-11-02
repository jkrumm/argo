import { z } from 'zod'

// Pure pieces of the homelab reading link (no DB, no process): the stat payload
// schema, the pulled-body validation and the throttle. Wiring lives in reading-store.ts.

export const StatInputSchema = z.object({
  bookKey: z
    .string()
    .describe('Unique key for the book in the source system (e.g. file path or UUID)'),
  title: z.string().optional().nullable().default(null),
  author: z.string().optional().nullable().default(null),
  totalReadSeconds: z.number().int().default(0),
  pagesRead: z.number().int().default(0),
  currentPercent: z.number().min(0).max(100).default(0),
  sessions: z.number().int().default(0),
  lastReadAt: z.string().optional().nullable().default(null).describe('ISO 8601 timestamp'),
  raw: z.unknown().optional().nullable().default(null).describe('Original payload from the source'),
})

export type StatInput = z.infer<typeof StatInputSchema>

// An empty list is legitimate for a pull (nothing read yet); the POST route keeps min(1).
export const PulledStatsSchema = z.object({ stats: z.array(StatInputSchema).max(1000) })

/** Parse a command's stdout (`{"stats":[...]}`) into validated stat rows; throws on bad JSON or shape. */
export function parsePulledStats(stdout: string): StatInput[] {
  let json: unknown
  try {
    json = JSON.parse(stdout)
  } catch {
    throw new Error('stats command did not print valid JSON')
  }
  const parsed = PulledStatsSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(`stats command output rejected: ${parsed.error.message}`)
  }
  return parsed.data.stats
}

/**
 * At most one run per `minIntervalMs`; concurrent callers share the in-flight run.
 * `run()` resolves true only for the call that started `fn` and saw it resolve true,
 * so a caller can tell "I refreshed the data" from "throttled" / "someone else did".
 */
export function createThrottle(
  fn: () => Promise<boolean>,
  minIntervalMs: number,
  now: () => number = Date.now,
): () => Promise<boolean> {
  let lastStart: number | null = null
  let inflight: Promise<boolean> | null = null

  return () => {
    if (inflight) return inflight.then(() => false)
    if (lastStart !== null && now() - lastStart < minIntervalMs) return Promise.resolve(false)

    lastStart = now()
    const run = fn()
      .catch(() => false)
      .finally(() => {
        inflight = null
      })
    inflight = run
    return run
  }
}

/** Concurrent callers share the in-flight run; a call after it settles starts a new one. */
export function createSingleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let inflight: Promise<T> | null = null
  return () => {
    inflight ??= fn().finally(() => {
      inflight = null
    })
    return inflight
  }
}

/**
 * Single-flight with a trailing run: calls made while `fn` runs coalesce into exactly
 * one more run after it settles. Fire-and-forget; `fn` is expected not to throw.
 */
export function createCoalescer(fn: () => Promise<void>): () => void {
  let running = false
  let pending = false

  const drain = async (): Promise<void> => {
    running = true
    try {
      do {
        pending = false
        await fn().catch(() => undefined)
      } while (pending)
    } finally {
      running = false
    }
  }

  return () => {
    if (running) {
      pending = true
      return
    }
    void drain()
  }
}
