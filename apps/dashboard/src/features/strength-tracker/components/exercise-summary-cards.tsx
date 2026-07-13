import { Card, Group, SimpleGrid, Stack, Text } from '@mantine/core'
import { useSuspenseQuery } from '@tanstack/react-query'
import { alpha, VX } from 'basalt-ui/tokens'
import { workoutsQueries, type WorkoutWindowParams } from '../../../lib/queries/workouts'
import { EXERCISE_COLORS, type ExerciseKey } from '../constants'
import { exerciseLabel } from '../formulas'

type ExerciseSummaryItem = {
  exercise_id: string
  exercise_name: string
  currentE1RM: number | null
  bestE1RM: number | null
  prDate: string | null
  totalVolumeWindow: number
  sessionCountWindow: number
}

function fmtKg(v: number | null): string {
  if (v === null) return '—'
  return `${v % 1 === 0 ? v : v.toFixed(1)} kg`
}

function color(id: string): string {
  return EXERCISE_COLORS[id as ExerciseKey] ?? alpha(VX.neutral, 0.5)
}

export function ExerciseSummaryCards({ params }: { params: WorkoutWindowParams }) {
  const { data } = useSuspenseQuery(workoutsQueries.summaryStrength(params))
  const items = data.byExercise as ExerciseSummaryItem[]

  if (items.length === 0) {
    return (
      <Card padding="md">
        <Text size="sm" c="dimmed" ta="center">
          No workouts in this window
        </Text>
      </Card>
    )
  }

  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm">
      {items.map((item) => (
        <Card key={item.exercise_id} padding="md">
          <Group gap={6} mb={4}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: color(item.exercise_id),
              }}
            />
            <Text size="xs" c="dimmed" truncate>
              {item.exercise_name || exerciseLabel(item.exercise_id)}
            </Text>
          </Group>
          <Group gap={6} align="baseline" mb={8}>
            <Text size="xl" fw={700} style={{ lineHeight: 1 }}>
              {fmtKg(item.currentE1RM)}
            </Text>
            <Text size="xs" c="dimmed">
              e1RM
            </Text>
          </Group>
          <SimpleGrid cols={2} spacing={8}>
            <Stack gap={0}>
              <Text size="xs" c="dimmed">
                Best
              </Text>
              <Text size="sm">{fmtKg(item.bestE1RM)}</Text>
            </Stack>
            <Stack gap={0}>
              <Text size="xs" c="dimmed">
                Sessions
              </Text>
              <Text size="sm">{item.sessionCountWindow}</Text>
            </Stack>
            <Stack gap={0}>
              <Text size="xs" c="dimmed">
                Volume
              </Text>
              <Text size="sm">{Math.round(item.totalVolumeWindow / 1000)}k kg</Text>
            </Stack>
            <Stack gap={0}>
              <Text size="xs" c="dimmed">
                PR date
              </Text>
              <Text size="sm">{item.prDate ?? '—'}</Text>
            </Stack>
          </SimpleGrid>
        </Card>
      ))}
    </SimpleGrid>
  )
}
