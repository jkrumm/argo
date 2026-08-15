import { Box, Card, SimpleGrid, Stack, Text, UnstyledButton } from '@mantine/core'
import { VX } from 'basalt-ui/tokens'
import { fmtDayLabel, fmtPercent, killerLabel, verdictTone } from '../formulas'
import type { Night } from '../types'

/**
 * One cell per night, tight top-to-bottom: weekday/day, a verdict-tone bar (the at-a-glance
 * layer), score, window start, moon %. `out` nights de-emphasise but keep every number visible —
 * the point is to see WHY the week is dead, not to hide it.
 */
export function NightStrip({
  nights,
  selectedDate,
  onSelect,
}: {
  nights: Night[]
  selectedDate: string
  onSelect: (date: string) => void
}) {
  return (
    <Card py="xs" px="sm">
      <SimpleGrid cols={{ base: 5, md: 10 }} spacing={4}>
        {nights.map((night) => {
          const selected = night.date === selectedDate
          const isOut = night.verdict === 'out'
          const { weekday, day } = fmtDayLabel(night.date)

          return (
            <UnstyledButton
              key={night.date}
              onClick={() => onSelect(night.date)}
              px={4}
              py={6}
              style={{
                borderRadius: VX.radiusCard,
                background: selected ? VX.surface.subtle : 'transparent',
                opacity: isOut ? 0.55 : 1,
              }}
            >
              <Stack gap={2} align="center">
                <Text
                  ff="monospace"
                  size="xs"
                  fw={selected ? 700 : 500}
                  c={selected ? undefined : 'dimmed'}
                >
                  {weekday} {day}
                </Text>
                <Box h={4} w="100%" bg={verdictTone(night.verdict)} />
                {/*
                  Every row keeps ONE meaning down the whole strip: score, window
                  start, then the moon. A ruled-out night reads `OUT` in the score
                  slot rather than a reason, because a column that means "score"
                  for four cells and "why not" for six is unreadable across. The
                  reason lands in the last row instead, where it displaces the
                  moon reading it would otherwise have duplicated.
                */}
                <Text ff="monospace" size="sm" fw={600}>
                  {isOut ? 'OUT' : night.score}
                </Text>
                <Text ff="monospace" size="xs" c="dimmed">
                  {night.window?.localStart ?? '—'}
                </Text>
                <Text ff="monospace" size="xs" c="dimmed">
                  {isOut ? killerLabel(night) : fmtPercent(night.moon.illumination)}
                </Text>
              </Stack>
            </UnstyledButton>
          )
        })}
      </SimpleGrid>
    </Card>
  )
}
