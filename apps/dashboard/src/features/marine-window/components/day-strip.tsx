import { Box, Card, SimpleGrid, Stack, Text, UnstyledButton } from '@mantine/core'
import { VX } from 'basalt-ui/tokens'
import { fmtDayLabel, fmtSwellLine, fmtWindLine, killerTag, verdictTone } from '../formulas'
import type { Day } from '../types'

/**
 * One cell per day, tight top-to-bottom: weekday/day, a verdict-tone bar (the at-a-glance layer),
 * score, session start, swell, wind/killer-tag. `out` days de-emphasise but keep every number
 * visible — the point is to see WHY the week is dead, not to hide it. The swell row is always the
 * day's actual conditions, gated or not, so the column keeps one meaning down the whole strip even
 * in mid-August Europe, where every day is commonly gated.
 */
export function DayStrip({
  days,
  selectedDate,
  onSelect,
}: {
  days: Day[]
  selectedDate: string
  onSelect: (date: string) => void
}) {
  return (
    <Card py="xs" px="sm">
      <SimpleGrid cols={{ base: 4, md: 7 }} spacing={4}>
        {days.map((day) => {
          const selected = day.date === selectedDate
          const isOut = day.verdict === 'out'
          const { weekday, day: dayOfMonth } = fmtDayLabel(day.date)

          return (
            <UnstyledButton
              key={day.date}
              onClick={() => onSelect(day.date)}
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
                  {weekday} {dayOfMonth}
                </Text>
                <Box h={4} w="100%" bg={verdictTone(day.verdict)} />
                {/*
                  Every row keeps ONE meaning down the whole strip: score, session
                  start, swell, then wind. A ruled-out day reads `OUT` in the score
                  slot rather than a reason, because a column that means "score" for
                  four cells and "why not" for three is unreadable across. The swell
                  row is unconditional — it's the operator's actual question on a
                  flat week ("how close was it, and to what") — and the killer tag
                  in the last row is a short id-derived word, not the truncated
                  `reason` sentence, so it reads identically at this width.
                */}
                <Text ff="monospace" size="sm" fw={600}>
                  {isOut ? 'OUT' : day.score}
                </Text>
                <Text ff="monospace" size="xs" c="dimmed">
                  {day.window?.localStart ?? '—'}
                </Text>
                <Text ff="monospace" size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                  {fmtSwellLine(day.conditions)}
                </Text>
                <Text ff="monospace" size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                  {isOut ? killerTag(day) : fmtWindLine(day.conditions)}
                </Text>
              </Stack>
            </UnstyledButton>
          )
        })}
      </SimpleGrid>
    </Card>
  )
}
