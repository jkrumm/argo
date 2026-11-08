import type { CatchCallbackFn } from 'croner'
import { context, ROOT_CONTEXT, SpanKind, SpanStatusCode } from '@opentelemetry/api'
import { log, tracer } from '../telemetry.js'

/** Every cron schedule is read in this zone (croner would otherwise use the process-local one). */
export const CRON_TIMEZONE = 'Europe/Berlin'

/**
 * Wrap a cron tick in a fresh root span. Detaches from any ambient context
 * via ROOT_CONTEXT so each tick stands alone in the trace tree.
 */
export async function tracedTick(
  name: string,
  attributes: Record<string, string>,
  fn: () => Promise<unknown>,
): Promise<void> {
  await context.with(ROOT_CONTEXT, () =>
    tracer.startActiveSpan(name, { kind: SpanKind.INTERNAL, attributes }, async (span) => {
      try {
        await fn()
        span.setStatus({ code: SpanStatusCode.OK })
      } catch (err) {
        span.recordException(err as Error)
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
        throw err
      } finally {
        span.end()
      }
    }),
  )
}

/** Fire-and-forget tracedTick: a failing tick is logged, never an unhandled rejection. */
export function fireTick(
  name: string,
  attributes: Record<string, string>,
  fn: () => Promise<unknown>,
): void {
  tracedTick(name, attributes, fn).catch((e) => log.error(`${name} failed`, e))
}

/** Croner options shared by every job: the timezone plus a `catch` that logs a throwing handler. */
export function cronOptions(name: string): { timezone: string; catch: CatchCallbackFn } {
  return {
    timezone: CRON_TIMEZONE,
    catch: (e) => log.error(`cron ${name} handler failed`, e),
  }
}
