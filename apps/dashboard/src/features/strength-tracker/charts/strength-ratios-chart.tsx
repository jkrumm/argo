import { useSuspenseQuery } from '@tanstack/react-query'
import { Box, Group, Stack, Text } from '@mantine/core'
import { alpha, ChartCard, VX } from 'basalt-ui/charts'
import { strengthQueries, type StrengthQueryParams } from '../../../lib/queries/strength'
import { METRIC_TOOLTIPS } from '../constants'
import { balanceColor, balanceLabel, balanceSymbol, type RatioStatus } from '../formulas'
import { ChartEmpty } from './empty'

type Ratio = {
  label: string
  ratio: number | null
  range: [number, number]
  status: RatioStatus | null
  scaleMax: number
}

function statusColor(status: RatioStatus | null): string {
  switch (status) {
    case 'balanced':
      return VX.goodSolid
    case 'imbalanced':
      return VX.warnSolid
    case 'critical':
      return VX.badSolid
    default:
      return alpha(VX.neutral, 0.5)
  }
}

function symbolFor(status: RatioStatus | null): string | null {
  if (status === null) return null
  return balanceSymbol(status)
}

function toPercent(v: number, scaleMax: number): number {
  return Math.max(0, Math.min(100, (v / scaleMax) * 100))
}

export default function StrengthRatiosChart({ params }: { params: StrengthQueryParams }) {
  const { data } = useSuspenseQuery(strengthQueries.heroes(params))

  const ratios = data.balance.ratios as Ratio[]
  const balanceStatus = data.balance.status
  const worstPair = data.balance.worstPair

  const headerExtra =
    balanceStatus !== null && worstPair !== null ? (
      <Text size="xs" fw={600} c={balanceColor(balanceStatus)}>
        {worstPair.label} · {balanceLabel(balanceStatus)} · {worstPair.ratio.toFixed(2)}
      </Text>
    ) : null

  const hasData = ratios.some((r) => r.ratio !== null)

  return (
    <ChartCard
      title="Strength Balance"
      subtitle="DOTS-adjusted lift ratios"
      info={METRIC_TOOLTIPS.strengthRatios}
      actions={headerExtra}
    >
      {!hasData ? (
        <ChartEmpty height={180} message="Need data for multiple lifts" />
      ) : (
        <Stack gap="sm" p="md">
          {ratios.map((pair) => {
            const color = statusColor(pair.status)
            const sym = symbolFor(pair.status)
            const lowPct = toPercent(pair.range[0], pair.scaleMax)
            const hiPct = toPercent(pair.range[1], pair.scaleMax)
            const ratioPct = pair.ratio !== null ? toPercent(pair.ratio, pair.scaleMax) : null

            return (
              <Group key={pair.label} justify="space-between" gap="sm" wrap="nowrap">
                <Text size="xs" c="dimmed" ta="right" style={{ width: 100, flexShrink: 0 }}>
                  {pair.label}
                </Text>
                <Box
                  style={{
                    flex: 1,
                    height: 10,
                    position: 'relative',
                    background: alpha(VX.neutral, 0.08),
                  }}
                  bdrs={3}
                >
                  <Box
                    style={{
                      position: 'absolute',
                      left: `${lowPct}%`,
                      width: `${Math.max(0, hiPct - lowPct)}%`,
                      top: 0,
                      bottom: 0,
                      background: VX.good,
                    }}
                    bdrs={3}
                  />
                  {ratioPct !== null && (
                    <Box
                      style={{
                        position: 'absolute',
                        left: `${ratioPct}%`,
                        top: -2,
                        bottom: -2,
                        width: 3,
                        background: color,
                        transform: 'translateX(-50%)',
                      }}
                      bdrs={2}
                    />
                  )}
                </Box>
                <Group gap={4} wrap="nowrap" style={{ width: 70, flexShrink: 0 }}>
                  <Text size="xs" fw={600} style={{ minWidth: 40 }}>
                    {pair.ratio !== null ? pair.ratio.toFixed(2) : '—'}
                  </Text>
                  {sym !== null && (
                    <Text size="sm" fw={700} c={color}>
                      {sym}
                    </Text>
                  )}
                </Group>
              </Group>
            )
          })}
        </Stack>
      )}
    </ChartCard>
  )
}
