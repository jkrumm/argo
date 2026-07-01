import { Badge, Card, Group, SimpleGrid, Stack, Text } from '@mantine/core'
import { useSuspenseQuery } from '@tanstack/react-query'
import { IconMinus, IconTrendingDown, IconTrendingUp } from '@tabler/icons-react'
import {
  skinfoldLogQueries,
  type SkinfoldSite,
  type SkinfoldWindowParams,
} from '../../../lib/queries/skinfold-log'
import {
  fmtMm,
  skinfoldDirectionColor,
  skinfoldDirectionLabel,
  skinfoldSiteLabel,
  skinfoldTrendColor,
  type SkinfoldDirection,
  type SkinfoldTrend,
} from '../formulas'
import { SkinfoldEntryForm } from './skinfold-entry-form'
import { SkinfoldHistoryTable } from './skinfold-history-table'
import SkinfoldChart from '../charts/skinfold-chart'

type SkinfoldSummary = {
  current: number | null
  ma7: number | null
  ma30: number | null
  trend: SkinfoldTrend
  weeklyDelta: number | null
  monthlyDelta: number | null
  mmPerWeek: number | null
  direction: SkinfoldDirection
  perSite: { site: SkinfoldSite; current: number | null }[]
}

function SkinfoldSummaryCards({ summary }: { summary: SkinfoldSummary }) {
  const trendColor = skinfoldTrendColor(summary.trend)

  const TrendIcon =
    summary.trend === 'up' ? (
      <IconTrendingUp size={16} color={trendColor} />
    ) : summary.trend === 'down' ? (
      <IconTrendingDown size={16} color={trendColor} />
    ) : (
      <IconMinus size={16} color={trendColor} />
    )

  return (
    <Stack gap="sm">
      <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }}>
        <Card padding="md" withBorder>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              Current
            </Text>
            <Badge size="xs" color={skinfoldDirectionColor(summary.direction)} variant="light">
              {skinfoldDirectionLabel(summary.direction)}
            </Badge>
          </Group>
          <Group gap={6} align="baseline" mt={4}>
            <Text size="xl" fw={700} style={{ lineHeight: 1 }}>
              {fmtMm(summary.current)}
            </Text>
            <Text size="sm" c="dimmed">
              mm
            </Text>
            {TrendIcon}
          </Group>
        </Card>

        <Card padding="md" withBorder>
          <Text size="xs" c="dimmed" mb={4}>
            7d avg
          </Text>
          <Text size="xl" fw={700} style={{ lineHeight: 1 }}>
            {fmtMm(summary.ma7)}
          </Text>
        </Card>

        <Card padding="md" withBorder>
          <Text size="xs" c="dimmed" mb={4}>
            30d avg
          </Text>
          <Text size="xl" fw={700} style={{ lineHeight: 1 }}>
            {fmtMm(summary.ma30)}
          </Text>
        </Card>

        <Card padding="md" withBorder>
          <Text size="xs" c="dimmed" mb={4}>
            Weekly Δ
          </Text>
          <Text
            size="xl"
            fw={700}
            style={{
              lineHeight: 1,
              color:
                summary.weeklyDelta !== null && summary.weeklyDelta > 0
                  ? skinfoldTrendColor('up')
                  : skinfoldTrendColor('down'),
            }}
          >
            {summary.weeklyDelta !== null
              ? `${summary.weeklyDelta > 0 ? '+' : ''}${summary.weeklyDelta.toFixed(1)}`
              : '—'}
          </Text>
        </Card>

        <Card padding="md" withBorder>
          <Text size="xs" c="dimmed" mb={4}>
            Monthly Δ
          </Text>
          <Text
            size="xl"
            fw={700}
            style={{
              lineHeight: 1,
              color:
                summary.monthlyDelta !== null && summary.monthlyDelta > 0
                  ? skinfoldTrendColor('up')
                  : skinfoldTrendColor('down'),
            }}
          >
            {summary.monthlyDelta !== null
              ? `${summary.monthlyDelta > 0 ? '+' : ''}${summary.monthlyDelta.toFixed(1)}`
              : '—'}
          </Text>
        </Card>

        <Card padding="md" withBorder>
          <Text size="xs" c="dimmed" mb={4}>
            mm / week
          </Text>
          <Text size="xl" fw={700} style={{ lineHeight: 1, color: trendColor }}>
            {summary.mmPerWeek !== null
              ? `${summary.mmPerWeek > 0 ? '+' : ''}${summary.mmPerWeek.toFixed(2)}`
              : '—'}
          </Text>
        </Card>
      </SimpleGrid>

      <Group gap="xs">
        {summary.perSite.map((s) => (
          <Badge key={s.site} variant="light" color="gray" size="lg">
            {skinfoldSiteLabel(s.site)}: {fmtMm(s.current)} mm
          </Badge>
        ))}
      </Group>
    </Stack>
  )
}

export function SkinfoldPanel({ params }: { params: SkinfoldWindowParams }) {
  const { data: summary } = useSuspenseQuery(skinfoldLogQueries.summary(params))

  return (
    <Stack>
      <SkinfoldSummaryCards summary={summary as SkinfoldSummary} />
      <SkinfoldEntryForm />
      <SkinfoldChart params={params} />
      <SkinfoldHistoryTable />
    </Stack>
  )
}
