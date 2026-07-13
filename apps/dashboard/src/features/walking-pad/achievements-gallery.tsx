import { useSuspenseQuery } from '@tanstack/react-query'
import { Badge, Card, Group, ScrollArea, Stack, Text, ThemeIcon } from '@mantine/core'
import {
  IconBolt,
  IconCalendarStats,
  IconFlame,
  IconShoe,
  IconMedal,
  IconRoute,
  IconTrophy,
} from '@tabler/icons-react'
import { walkingPadQueries } from '../../lib/queries/walking-pad'
import { relativeTime } from './formatters'

function iconFor(type: string) {
  if (type === 'first_walk') return <IconMedal size={16} />
  if (type === 'longest_duration') return <IconCalendarStats size={16} />
  if (type === 'longest_distance') return <IconRoute size={16} />
  if (type === 'most_steps') return <IconShoe size={16} />
  if (type === 'fastest_avg_speed') return <IconBolt size={16} />
  if (type.startsWith('distance_milestone')) return <IconTrophy size={16} />
  if (type.startsWith('streak_')) return <IconFlame size={16} />
  if (type === 'weekly_distance_pr') return <IconTrophy size={16} />
  if (type === 'multi_walk_day') return <IconCalendarStats size={16} />
  return <IconMedal size={16} />
}

function colorFor(type: string): string {
  if (type === 'first_walk') return 'blue'
  if (type.startsWith('distance_milestone')) return 'yellow'
  if (type.startsWith('streak_')) return 'orange'
  if (type === 'weekly_distance_pr') return 'red'
  if (type === 'multi_walk_day') return 'green'
  return 'gray'
}

export function AchievementsGallery({ matchHeight }: { matchHeight?: number }) {
  const { data } = useSuspenseQuery(walkingPadQueries.achievements({ limit: 50 }))
  if (data.data.length === 0) {
    return (
      <Card padding="md" h={matchHeight}>
        <Text size="sm" c="dimmed">
          No achievements yet — first walk unlocks one.
        </Text>
      </Card>
    )
  }
  // Card chrome eats ~64px of any matched height: ~32px (padding md, top+bot)
  // + ~22px header line + 8px mb=xs + 2px border. Subtract so ScrollArea +
  // chrome together fit the left column exactly. Below lg the prop drops,
  // and we fall back to a sensible default scroll height.
  const HEADER_RESERVE = 64
  const scrollHeight = matchHeight !== undefined ? Math.max(180, matchHeight - HEADER_RESERVE) : 320
  return (
    <Card padding="md" h={matchHeight}>
      <Group justify="space-between" mb="xs">
        <Text fw={600} size="sm">
          Achievements
        </Text>
        <Badge size="sm" variant="light" color="gray">
          {data.data.length} unlocked
        </Badge>
      </Group>
      <ScrollArea h={scrollHeight} type="auto" offsetScrollbars>
        <Stack gap={6}>
          {data.data.map((a) => (
            <Group
              key={a.id}
              gap="sm"
              wrap="nowrap"
              align="flex-start"
              p={8}
              style={{
                borderRadius: 8,
                background: 'var(--mantine-color-default-hover)',
              }}
            >
              <ThemeIcon variant="light" color={colorFor(a.type)} size="md" radius="md">
                {iconFor(a.type)}
              </ThemeIcon>
              <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                <Group gap={6} wrap="nowrap" justify="space-between" align="flex-start">
                  <Text size="sm" fw={600} style={{ flex: 1, minWidth: 0 }} truncate>
                    {a.title}
                  </Text>
                  <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                    {relativeTime(a.unlocked_at)}
                  </Text>
                </Group>
                <Text size="xs" c="dimmed">
                  {a.description}
                </Text>
              </Stack>
            </Group>
          ))}
        </Stack>
      </ScrollArea>
    </Card>
  )
}
