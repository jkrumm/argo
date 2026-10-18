import { Box } from '@mantine/core'
import { Meter } from 'basalt-ui'
import { CORE_METER_MAX_DEG } from '../constants'
import { DecisionCard } from '../../../components/upstream/decision-card'
import {
  fmtDegrees,
  fmtShortDay,
  coreMeterReading,
  limitingFactor,
  verdictHeadline,
} from '../formulas'
import type { Night } from '../types'

/**
 * The verdict for the selected night: one line stating it, the night it is about and its score
 * (never a score for an `out` night — that is a gate ruling, not a low score). The core gap is drawn
 * once, here, as a length against the gate tick.
 */
export function VerdictCard({ night }: { night: Night }) {
  const out = night.verdict === 'out'
  const limiting = out ? null : limitingFactor(night)
  const facts = out
    ? [fmtShortDay(night.date)]
    : [
        `score ${night.score}/100`,
        limiting === null
          ? 'nothing limiting'
          : `limited by ${limiting.label.toLowerCase()} ${limiting.pct} %`,
      ]
  const core = coreMeterReading(night)

  return (
    <Box data-shot="verdict-card">
      <DecisionCard
        question={verdictHeadline(night)}
        facts={facts}
        evidence={
          core !== null ? (
            <Meter
              label="Core altitude against its gate"
              value={core.reading}
              max={CORE_METER_MAX_DEG}
              target={core.gate}
              tone="muted"
              format={fmtDegrees}
              startCaption={`core ${fmtDegrees(core.reading)} at closest`}
              endCaption={`gate ${fmtDegrees(core.gate)} · scale 0–${CORE_METER_MAX_DEG}°`}
            />
          ) : undefined
        }
      />
    </Box>
  )
}
