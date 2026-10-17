import { Box } from '@mantine/core'
import { Meter } from 'basalt-ui'
import { CORE_METER_MAX_DEG } from '../constants'
import { DecisionCard } from '../../../components/upstream/decision-card'
import { fmtDegrees, fmtMinutes, fmtShortDay, gapToGate, limitingFactor } from '../formulas'
import type { Night } from '../types'

/** `OUT · core 3.9° under the gate` / `GO · Sat 17, 23:10–01:40 · 2h 30m`. The API rules; this phrases. */
function headline(night: Night): string {
  if (night.verdict !== 'out') {
    const { window } = night
    return window === null
      ? `GO · ${fmtShortDay(night.date)}`
      : `GO · ${fmtShortDay(night.date)}, ${window.localStart}–${window.localEnd} · ${fmtMinutes(window.minutes)}`
  }
  const gap = gapToGate(night)
  if (gap !== null) return `OUT · core ${fmtDegrees(gap)} under the gate`
  const first = night.killers[0]
  return first === undefined ? 'OUT' : `OUT · ${first.label.toLowerCase()}`
}

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
        fmtShortDay(night.date),
        `score ${night.score}/100`,
        limiting === null
          ? 'nothing limiting'
          : `limited by ${limiting.label.toLowerCase()} ${limiting.pct} %`,
      ]
  const reading = night.gateCoreAltitude
  const gate = night.coreGateDeg

  return (
    <Box data-shot="verdict-card">
      <DecisionCard
        question={headline(night)}
        facts={facts}
        evidence={
          gapToGate(night) !== null && reading !== null && gate !== null ? (
            <Meter
              label="Core altitude against its gate"
              value={reading}
              max={CORE_METER_MAX_DEG}
              target={gate}
              tone="muted"
              format={fmtDegrees}
              startCaption={`core ${fmtDegrees(reading)} at closest`}
              endCaption={`gate ${fmtDegrees(gate)} · scale 0–${CORE_METER_MAX_DEG}°`}
            />
          ) : undefined
        }
      />
    </Box>
  )
}
