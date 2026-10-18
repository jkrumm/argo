import { BarList, Section } from 'basalt-ui'
import { POLLER_SCALE_MIN, formatNumber, pollerStaleLabel, type PollerRow } from './page-model'

/**
 * `Pollers <n>` — collapsed by default. One bar per poller on a shared 0–30 min scale; the scale's
 * end is the stale mark (a poller at or past it is flagged in the secondary column).
 */
export function PollersList({ pollers }: { pollers: readonly PollerRow[] }) {
  if (pollers.length === 0) return null
  return (
    <Section title="Pollers" count={pollers.length} collapsible defaultOpen={false}>
      <BarList
        label={`Poller age in minutes, scale 0 to ${POLLER_SCALE_MIN}`}
        max={POLLER_SCALE_MIN}
        format={(value) => `${formatNumber(value)}\u00a0min`}
        items={pollers.map((poller) => ({
          key: poller.name,
          label: poller.name,
          value: poller.ageMin,
          secondary: pollerStaleLabel(poller) ?? undefined,
        }))}
      />
    </Section>
  )
}
