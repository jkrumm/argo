import { Card, Stack, Text } from '@mantine/core'
import { IconBarbell } from '@tabler/icons-react'

/**
 * Page-level empty state for the Strength Tracker — rendered when the user has
 * zero workouts logged. Replaces the hero cards + chart sections so the page
 * still feels useful (header, filter, and form remain).
 */
export function EmptyState() {
  return (
    <Card padding="xl">
      <Stack align="center" justify="center" gap="xs" py="xl">
        <IconBarbell size={48} stroke={1.5} opacity={0.4} />
        <Text fw={600} size="lg">
          No workouts yet
        </Text>
        <Text size="sm" c="dimmed" ta="center" maw={420}>
          Log your first workout to see your strength dashboard come to life.
        </Text>
      </Stack>
    </Card>
  )
}
