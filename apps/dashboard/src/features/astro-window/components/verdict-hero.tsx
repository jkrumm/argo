import { Badge, Card, Group, Stack, Text } from '@mantine/core'
import { VX } from 'basalt-ui/tokens'
import {
  dataHealthLine,
  fmtDegrees,
  fmtMinutes,
  fmtPercent,
  fmtWeekday,
  verdictLabel,
  verdictTone,
} from '../formulas'
import type { WindowResponse } from '../types'

/**
 * The headline. Top-level `verdict`/`score`/`bestWindow`/`killers` describe the BEST night in the
 * range, not tonight — `verdict === 'out'` is a hard-gate ruling, never rendered as a low score.
 */
export function VerdictHero({ data }: { data: WindowResponse }) {
  const { verdict, score, bestWindow, summary, killers, sources, location } = data
  const tone = verdictTone(verdict)
  const isOut = verdict === 'out'
  const bestNight = bestWindow ? data.nights.find((n) => n.date === bestWindow.date) : undefined
  const healthLine = dataHealthLine(sources, location.bortleSource)

  return (
    <Card py="xs" px="sm">
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xl">
        <Group gap="xl" wrap="nowrap" align="flex-start">
          <Stack gap={0} miw={110}>
            <Text
              fw={700}
              tt="uppercase"
              style={{ color: tone, fontSize: VX.text.kpi, lineHeight: 1.1 }}
            >
              {verdictLabel(verdict)}
            </Text>
            {!isOut && (
              <Text ff="monospace" size="sm" c="dimmed" mt={4}>
                {score}/100
              </Text>
            )}
          </Stack>

          {bestWindow && (
            <Stack gap={0}>
              <Text size="xs" c="dimmed">
                {fmtWeekday(bestWindow.date)} {bestWindow.date}
              </Text>
              <Text ff="monospace" fw={600} style={{ fontSize: VX.text.h1, lineHeight: 1.2 }}>
                {bestWindow.localStart}–{bestWindow.localEnd}
              </Text>
              <Text ff="monospace" size="xs" c="dimmed" mt={2}>
                {fmtMinutes(bestWindow.minutes)} · core {fmtDegrees(bestWindow.peakCoreAltitude)}
                {bestNight ? ` · moon ${fmtPercent(bestNight.moon.illumination)}` : ''}
              </Text>
            </Stack>
          )}
        </Group>

        {summary !== null && summary.length > 0 && (
          <Text size="sm" c="dimmed" maw={420} ta="right">
            {summary}
          </Text>
        )}
      </Group>

      {killers.length > 0 && (
        <Group gap={6} mt="sm">
          {killers.map((killer) => (
            <Badge key={killer.id} color="gray" variant="light" size="sm" tt="none" fw={500}>
              {killer.reason}
            </Badge>
          ))}
        </Group>
      )}

      {healthLine !== null && (
        <Text ta="right" mt="xs" c="dimmed" style={{ fontSize: VX.text.xs }}>
          {healthLine}
        </Text>
      )}
    </Card>
  )
}
