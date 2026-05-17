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
  if (type.startsWith('distance_milestone')) return 'teal'
  if (type.startsWith('streak_')) return 'orange'
  if (type === 'weekly_distance_pr') return 'grape'
  if (type === 'multi_walk_day') return 'cyan'
  return 'green'
}

export function AchievementsGallery() {
  const { data } = useSuspenseQuery(walkingPadQueries.achievements({ limit: 50 }))
  if (data.data.length === 0) {
    return (
      <Card padding="md" withBorder>
        <Text size="sm" c="dimmed">
          No achievements yet — first walk unlocks one.
        </Text>
      </Card>
    )
  }
  return (
    <Card padding="md" withBorder>
      <Group justify="space-between" mb="xs">
        <Text fw={600} size="sm">
          Achievements
        </Text>
        <Badge size="sm" variant="light" color="gray">
          {data.data.length} unlocked
        </Badge>
      </Group>
      <ScrollArea h={320} type="auto" offsetScrollbars>
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
              <Stack gap={0} style={{ flex: 1 }}>
                <Text size="sm" fw={600}>
                  {a.title}
                </Text>
                <Text size="xs" c="dimmed">
                  {a.description}
                </Text>
                <Text size="xs" c="dimmed" mt={2}>
                  {relativeTime(a.unlocked_at)}
                </Text>
              </Stack>
            </Group>
          ))}
        </Stack>
      </ScrollArea>
    </Card>
  )
}
