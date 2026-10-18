import { Box, Group, Text } from '@mantine/core'
import { Meter, StatusDot } from 'basalt-ui'
import { VX } from 'basalt-ui/tokens'
import { CORE_METER_MAX_DEG } from '../constants'
import { DecisionCard } from '../../../components/upstream/decision-card'
import {
  alsoFailed,
  coreMeterReading,
  fmtDegrees,
  fmtShortDay,
  limitingFactor,
  nextUsableText,
  verdictHeadline,
  verdictStatus,
} from '../formulas'
import type { Night } from '../types'

/**
 * The verdict for the selected night: a status dot + word, one line stating why, the night it is
 * about and its score (never a score for an `out` night — that is a gate ruling, not a low score).
 * An OUT night also says which other gates failed and when the next usable night is. The core gap
 * is drawn once, here, as a length against the gate tick.
 */
export function VerdictCard({ night, nights }: { night: Night; nights: readonly Night[] }) {
  const out = night.verdict === 'out'
  const limiting = out ? null : limitingFactor(night)
  const also = out ? alsoFailed(night) : null
  const facts = out
    ? [
        fmtShortDay(night.date),
        ...(also === null ? [] : [also]),
        nextUsableText(nights, night.date),
      ]
    : [
        `score ${night.score}/100`,
        limiting === null
          ? 'nothing limiting'
          : `limited by ${limiting.label.toLowerCase()} ${limiting.pct} %`,
      ]
  const core = coreMeterReading(night)
  const status = verdictStatus(night)

  return (
    <Box data-shot="verdict-card">
      <DecisionCard
        question={verdictHeadline(night)}
        status={
          <Group gap={6} wrap="nowrap">
            <StatusDot color={status.tone === 'good' ? VX.status.good : VX.muted} />
            <Text size="sm" fw={600}>
              {status.word}
            </Text>
          </Group>
        }
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
