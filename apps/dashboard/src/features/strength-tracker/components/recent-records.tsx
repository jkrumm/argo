import { useState } from 'react'
import { Card, Group, ScrollArea, Select, Stack, Text } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { IconTrophy } from '@tabler/icons-react'
import { strengthQueries, type StrengthRecordsParams } from '../../../lib/queries/strength'
import { METRICS, EXERCISE_COLORS, type ExerciseKey } from '../constants'
import { exerciseLabel, metricLabel } from '../formulas'

type MetricFilter = StrengthRecordsParams['metric']

const FILTER_OPTIONS: { value: NonNullable<MetricFilter>; label: string }[] = [
  { value: 'all', label: 'All' },
  ...METRICS.filter((m) => m.value !== 'avg_intensity').map((m) => ({
    value: m.value as NonNullable<MetricFilter>,
    label: m.label,
  })),
]

export function RecentRecords({
  params,
  multiExercise,
}: {
  params: { window?: '7d' | '30d' | '90d' | 'all'; from?: string; to?: string; exercises?: string }
  multiExercise: boolean
}) {
  const [metricFilter, setMetricFilter] = useState<NonNullable<MetricFilter>>('all')

  const { data, isLoading } = useQuery(strengthQueries.records({ ...params, metric: metricFilter }))

  const records = (data?.records ?? []).slice(0, 30)

  return (
    <Card padding="md" withBorder>
      <Group justify="space-between" mb="sm">
        <Group gap={6}>
          <IconTrophy size={16} color="#faad14" />
          <Text fw={600} size="sm">
            Recent Records
          </Text>
        </Group>
        <Select
          size="xs"
          w={120}
          data={FILTER_OPTIONS}
          value={metricFilter}
          onChange={(v) => v !== null && setMetricFilter(v as NonNullable<MetricFilter>)}
          allowDeselect={false}
          comboboxProps={{ withinPortal: true }}
        />
      </Group>

      {isLoading && records.length === 0 ? (
        <Text size="xs" c="dimmed">
          Loading…
        </Text>
      ) : records.length === 0 ? (
        <Text size="xs" c="dimmed">
          No PRs in this window
        </Text>
      ) : (
        <ScrollArea h={320} type="hover">
          <Stack gap={4}>
            {records.map((r, i) => (
              <Group key={`${r.date}-${r.exercise_id}-${r.metric}-${i}`} gap={8} wrap="nowrap">
                {multiExercise && (
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor:
                        EXERCISE_COLORS[r.exercise_id as ExerciseKey] ?? 'rgba(128,128,128,0.5)',
                      flexShrink: 0,
                    }}
                  />
                )}
                <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                  <Group gap={6} wrap="nowrap">
                    <Text size="sm" fw={500} truncate>
                      {r.exercise_name || exerciseLabel(r.exercise_id)}
                    </Text>
                    <Text size="xs" c="dimmed">
                      · {metricLabel(r.metric)}
                    </Text>
                  </Group>
                  <Text size="xs" c="dimmed">
                    {r.date}
                  </Text>
                </Stack>
                <Text size="sm" fw={600}>
                  {r.value.toLocaleString(undefined, { maximumFractionDigits: 1 })} {r.unit}
                </Text>
              </Group>
            ))}
          </Stack>
        </ScrollArea>
      )}
    </Card>
  )
}
