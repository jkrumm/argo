import { useSuspenseQuery } from '@tanstack/react-query'
import { Group, Stack, Text } from '@mantine/core'
import { Meter } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import { strengthQueries, type StrengthQueryParams } from '../../../lib/queries/strength'
import { METRIC_TOOLTIPS } from '../constants'
import { type RatioStatus } from '../formulas'
import {
  bandOffset,
  bandRange,
  borderlineNote,
  bandTail,
  EM_DASH,
  isBorderline,
  ratioName,
  statusWord,
} from '../model'

/**
 * The under/over zones: one flat fill. `tone: 'muted'` steps lightness per zone, so the over zone
 * read as a value bar (docs/design/UPSTREAM.md § Wave 31).
 */
const OUTSIDE_FILL = alpha(VX.muted, 0.35)

type Ratio = {
  label: string
  ratio: number | null
  range: [number, number]
  status: RatioStatus | null
  scaleMax: number
}

function statusInk(status: RatioStatus | null): string {
  switch (status) {
    case 'balanced':
      return VX.status.good
    case 'imbalanced':
      return VX.status.warn
    case 'critical':
      return VX.status.bad
    default:
      return 'dimmed'
  }
}

/** Value, band and verdict on one row each: lift pair, ratio, the Meter with its band, then the
 *  status word and how far the ratio sits from the band. */
export default function StrengthRatiosChart({ params }: { params: StrengthQueryParams }) {
  const { data } = useSuspenseQuery(strengthQueries.heroes(params))
  const ratios = data.balance.ratios as Ratio[]
  const hasData = ratios.some((r) => r.ratio !== null)

  return (
    <ChartCard
      title="Strength balance"
      info={METRIC_TOOLTIPS.strengthRatios}
      subtitle={borderlineNote()}
      state={{ empty: !hasData && 'Need data for multiple lifts' }}
      placeholderHeight={180}
    >
      <Stack gap="md" p="md" data-shot="strength-balance" data-shot-absent="empty loading error">
        {ratios.map((pair) => {
          const [lo, hi] = pair.range
          const offset = bandOffset(pair.ratio, pair.range)
          return (
            <Stack key={pair.label} gap={4}>
              <Group justify="space-between" gap="sm" wrap="nowrap">
                <Text size="sm" fw={500}>
                  {ratioName(pair.label)}
                </Text>
                <Text size="sm" fw={600}>
                  {pair.ratio === null ? EM_DASH : pair.ratio.toFixed(2)}
                </Text>
              </Group>
              {pair.ratio === null ? null : (
                <Meter
                  label={`${ratioName(pair.label)} ratio against its ${bandRange(pair.range)} band`}
                  value={pair.ratio}
                  min={0}
                  max={pair.scaleMax}
                  format={(v) => v.toFixed(2)}
                  zones={[
                    { from: 0, to: lo, label: '', color: OUTSIDE_FILL },
                    { from: lo, to: hi, label: '', color: VX.good },
                    { from: hi, to: pair.scaleMax, label: '', color: OUTSIDE_FILL },
                  ]}
                  startCaption={null}
                  endCaption={null}
                />
              )}
              {pair.ratio === null ? (
                <Text size="xs" c="dimmed">
                  {`${bandRange(pair.range)} band · need both lifts`}
                </Text>
              ) : (
                <Text size="xs" c="dimmed">
                  <Text
                    span
                    size="xs"
                    c={isBorderline(pair.status, offset) ? 'dimmed' : statusInk(pair.status)}
                  >
                    {statusWord(pair.status, offset)}
                  </Text>
                  {bandTail(offset, pair.range)}
                </Text>
              )}
            </Stack>
          )
        })}
      </Stack>
    </ChartCard>
  )
}
