import { Box, Card, Group, ScrollArea, Stack, Text } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { IconTrophy } from '@tabler/icons-react'
import { WidgetHeader } from 'basalt-ui'
import { SelectFilter } from 'basalt-ui/controls'
import { createLocalStore, field } from 'basalt-ui/state'
import { alpha, VX } from 'basalt-ui/tokens'
import { APP_LOCALE } from '../../../lib/format'
import { strengthQueries } from '../../../lib/queries/strength'
import { METRICS, EXERCISE_COLORS, type ExerciseKey } from '../constants'
import { exerciseLabel, metricLabel } from '../formulas'
import { dayLabel, groupByDay } from '../model'

/** A static tuple, not `METRICS.map()`: `field.enum` closes over its values at definition, and a
 * derived array widens to `string[]`. `avg_intensity` is deliberately absent — a percentage has no
 * personal record. */
const METRIC_FILTER_VALUES = [
  'all',
  'estimated_1rm',
  'max_weight',
  'total_volume',
  'total_reps',
  'work_sets',
] as const

/** Per-card select → a local store field, not `useState` (law C3). Persisted per card. */
const local = createLocalStore({
  key: 'strength:recent-records',
  fields: { metric: field.enum(METRIC_FILTER_VALUES, 'all') },
}).labels({
  metric: {
    all: 'All',
    ...Object.fromEntries(METRICS.map((m) => [m.value, m.label])),
  },
})

export function RecentRecords({
  params,
  multiExercise,
}: {
  params: {
    window?: '7d' | '30d' | '90d' | 'all' | undefined
    from?: string | undefined
    to?: string | undefined
    exercises?: string | undefined
  }
  multiExercise: boolean
}) {
  const [metricFilter] = local.field.metric.use()

  const { data, isLoading } = useQuery(strengthQueries.records({ ...params, metric: metricFilter }))

  const records = (data?.records ?? []).slice(0, 30)

  return (
    <Card py="sm" px="md">
      {/* A real home (law C1/C8): the title row is a `WidgetHeader`, so its `actions` slot sizes
          the filter and no hand-rolled `Group` decides the heading's weight. */}
      <WidgetHeader
        tier="widget"
        title="Recent records"
        icon={<IconTrophy size={16} color={VX.status.warn} />}
        actions={<SelectFilter field={local.field.metric} label="Metric" />}
      />

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
          <Stack gap="sm">
            {groupByDay(records).map((day) => (
              <Stack key={day.date} gap={4}>
                <Text size="xs" c="dimmed">
                  {dayLabel(day.date)}
                </Text>
                {day.rows.map((r) => (
                  <Group key={`${r.exercise_id}-${r.metric}-${r.value}`} gap="xs" wrap="nowrap">
                    {multiExercise && (
                      <Box
                        component="span"
                        w={8}
                        h={8}
                        bdrs="50%"
                        bg={EXERCISE_COLORS[r.exercise_id as ExerciseKey] ?? alpha(VX.neutral, 0.5)}
                        style={{ flexShrink: 0 }}
                      />
                    )}
                    <Text size="sm" fw={500} truncate style={{ flex: 1, minWidth: 0 }}>
                      {r.exercise_name || exerciseLabel(r.exercise_id)}
                      <Text span size="xs" c="dimmed">
                        {' · '}
                        {metricLabel(r.metric)}
                      </Text>
                    </Text>
                    <Text size="sm" fw={600}>
                      {r.value.toLocaleString(APP_LOCALE, { maximumFractionDigits: 1 })} {r.unit}
                    </Text>
                  </Group>
                ))}
              </Stack>
            ))}
          </Stack>
        </ScrollArea>
      )}
    </Card>
  )
}
