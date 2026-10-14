import type { BasaltEvent } from 'basalt-ui'

/**
 * `BasaltProvider telemetry` sink. A dev-console stub until Wave 4 maps `BasaltEvent` onto the
 * HyperDX/OTel pipeline (`docs/waves/PLAN.md`); production gets no events in the meantime.
 */
export function telemetry(event: BasaltEvent): void {
  if (!import.meta.env.DEV) return
  // oxlint-disable-next-line no-console
  console.debug('[basalt]', event.type, event.failed ? 'failed' : 'ok', event.attributes)
}
