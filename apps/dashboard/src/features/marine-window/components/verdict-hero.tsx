import { Badge, Card, Group, Stack, Text } from '@mantine/core'
import { VX } from 'basalt-ui/tokens'
import {
  dataHealthLine,
  fmtMinutes,
  fmtWeekday,
  limitingFactor,
  verdictLabel,
  verdictTone,
} from '../formulas'
import type { WindowResponse } from '../types'

/**
 * The headline. Top-level `verdict`/`score`/`bestWindow`/`killers` describe the BEST day in the
 * range, not today — `verdict === 'out'` is a hard-gate ruling, never rendered as a low score. On
 * a flat week (`out`) the killer chips below are the most readable thing on the page — they are
 * the answer to "why not".
 */
export function VerdictHero({ data }: { data: WindowResponse }) {
  const { verdict, score, bestWindow, summary, killers, sources } = data
  const tone = verdictTone(verdict)
  const isOut = verdict === 'out'
  // `SessionWindow` carries no `date` of its own — match it back to its owning day by its
  // start/end instants, which are unique per day.
  const bestDay = bestWindow
    ? data.days.find(
        (d) =>
          d.window !== null &&
          d.window.start === bestWindow.start &&
          d.window.end === bestWindow.end,
      )
    : undefined
  const limiting = bestDay ? limitingFactor(bestDay) : null
  // One home per fact: the hero owns verdict/score/window range only. The limiting factor (or,
  // when nothing is limiting, the duration) is the one thing not shown anywhere else.
  const secondaryLine =
    bestWindow === null
      ? null
      : limiting !== null
        ? `limited by: ${limiting.label.toLowerCase()} ${limiting.pct}%`
        : fmtMinutes(bestWindow.minutes)
  const healthLine = dataHealthLine(sources)

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
              {bestDay && (
                <Text size="xs" c="dimmed">
                  {fmtWeekday(bestDay.date)} {bestDay.date}
                </Text>
              )}
              <Text ff="monospace" fw={600} style={{ fontSize: VX.text.h1, lineHeight: 1.2 }}>
                {bestWindow.localStart}–{bestWindow.localEnd}
              </Text>
              {secondaryLine !== null && (
                <Text ff="monospace" size="xs" c="dimmed" mt={2}>
                  {secondaryLine}
                </Text>
              )}
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
