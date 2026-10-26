/**
 * A change against the prior period as a delta glyph: `▲ 12 %`, or the word `new` when there was next
 * to nothing before (a percentage from a near-zero base says nothing). Dollars rising is the worse
 * reading (`up-bad`); tokens carry no verdict (`neutral`).
 */
import { Text } from '@mantine/core'
import { DeltaBadge } from 'basalt-ui'
import { fmtPctChange, type Change } from './period-model'

export function ChangeBadge({
  change,
  polarity,
  period,
}: {
  change: Change | null
  polarity: 'up-bad' | 'neutral'
  period?: string | undefined
}) {
  if (change === null) return null
  if (change.kind === 'new') {
    return (
      <Text component="span" inherit c="dimmed">
        new{period === undefined ? '' : ` vs ${period}`}
      </Text>
    )
  }
  return <DeltaBadge value={change.pct} format={fmtPctChange} polarity={polarity} period={period} />
}
