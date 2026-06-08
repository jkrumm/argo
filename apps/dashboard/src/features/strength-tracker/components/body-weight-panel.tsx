import { useEffect, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  Group,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Transition,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useSuspenseQuery } from '@tanstack/react-query'
import { IconCheck, IconMinus, IconTrendingDown, IconTrendingUp } from '@tabler/icons-react'
import { VX } from '@argo/charts'
import {
  useCreateWeightLog,
  weightLogQueries,
  type WeightLogWindowParams,
} from '../../../lib/queries/weight-log'
import BodyWeightChart from '../charts/body-weight-chart'

type WeightSummary = {
  current: number | null
  ma7: number | null
  ma30: number | null
  trend: 'up' | 'down' | 'flat'
  weeklyDelta: number | null
  monthlyDelta: number | null
  kgPerWeek: number | null
  phase: 'losing' | 'gaining' | 'maintaining'
  intensity: string
}

function fmtNum(v: number | null): string {
  return v === null ? '—' : String(Math.round(v))
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function phaseColor(phase: WeightSummary['phase']): string {
  switch (phase) {
    case 'losing':
      return 'blue'
    case 'gaining':
      return 'yellow'
    default:
      return 'gray'
  }
}

function WeightSummaryCards({ summary }: { summary: WeightSummary }) {
  const trendColor =
    summary.trend === 'flat' ? 'gray' : summary.trend === 'down' ? VX.goodSolid : VX.warnSolid

  const TrendIcon =
    summary.trend === 'up' ? (
      <IconTrendingUp size={16} color={trendColor} />
    ) : summary.trend === 'down' ? (
      <IconTrendingDown size={16} color={trendColor} />
    ) : (
      <IconMinus size={16} color={trendColor} />
    )

  return (
    <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }}>
      <Card padding="md" withBorder>
        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            Current
          </Text>
          <Badge size="xs" color={phaseColor(summary.phase)} variant="light">
            {summary.intensity}
          </Badge>
        </Group>
        <Group gap={6} align="baseline" mt={4}>
          <Text size="xl" fw={700} style={{ lineHeight: 1 }}>
            {fmtNum(summary.current)}
          </Text>
          <Text size="sm" c="dimmed">
            kg
          </Text>
          {TrendIcon}
        </Group>
      </Card>

      <Card padding="md" withBorder>
        <Text size="xs" c="dimmed" mb={4}>
          7d avg
        </Text>
        <Text size="xl" fw={700} style={{ lineHeight: 1 }}>
          {summary.ma7 !== null ? summary.ma7.toFixed(1) : '—'}
        </Text>
      </Card>

      <Card padding="md" withBorder>
        <Text size="xs" c="dimmed" mb={4}>
          30d avg
        </Text>
        <Text size="xl" fw={700} style={{ lineHeight: 1 }}>
          {summary.ma30 !== null ? summary.ma30.toFixed(1) : '—'}
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
              summary.weeklyDelta !== null && summary.weeklyDelta > 0 ? VX.warnSolid : VX.goodSolid,
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
                ? VX.warnSolid
                : VX.goodSolid,
          }}
        >
          {summary.monthlyDelta !== null
            ? `${summary.monthlyDelta > 0 ? '+' : ''}${summary.monthlyDelta.toFixed(1)}`
            : '—'}
        </Text>
      </Card>

      <Card padding="md" withBorder>
        <Text size="xs" c="dimmed" mb={4}>
          kg / week
        </Text>
        <Text size="xl" fw={700} style={{ lineHeight: 1, color: trendColor }}>
          {summary.kgPerWeek !== null
            ? `${summary.kgPerWeek > 0 ? '+' : ''}${summary.kgPerWeek.toFixed(2)}`
            : '—'}
        </Text>
      </Card>
    </SimpleGrid>
  )
}

function WeightEntryForm({ defaultWeight }: { defaultWeight: number | null }) {
  const [date, setDate] = useState(today())
  const [weight, setWeight] = useState<number | ''>(defaultWeight ?? '')
  const [justSaved, setJustSaved] = useState(false)
  const createWeightLog = useCreateWeightLog()

  useEffect(() => {
    if (weight === '' && defaultWeight !== null) setWeight(defaultWeight)
  }, [defaultWeight, weight])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const w = typeof weight === 'number' ? weight : Number(weight)
    if (Number.isNaN(w) || w < 30 || w > 300) return
    createWeightLog.mutate(
      { date, weight_kg: w },
      {
        onSuccess: () => {
          setJustSaved(true)
          notifications.show({
            color: 'green',
            icon: <IconCheck size={18} />,
            title: 'Weight logged',
            message: `${w.toFixed(1)} kg on ${date}`,
            autoClose: 2000,
          })
          setTimeout(() => setJustSaved(false), 1400)
        },
        onError: (err) => {
          notifications.show({
            color: 'red',
            title: 'Could not save weight',
            message: err instanceof Error ? err.message : 'Unknown error',
          })
        },
      },
    )
  }

  return (
    <Paper withBorder p="md">
      <form onSubmit={handleSubmit}>
        <Stack gap="sm">
          <Text fw={600} size="sm">
            Log Weight
          </Text>
          <Group align="flex-end" gap="sm">
            <TextInput
              type="date"
              label="Date"
              value={date}
              onChange={(e) => setDate(e.currentTarget.value)}
              size="md"
              style={{ flex: 1 }}
            />
            <NumberInput
              label="Weight (kg)"
              min={30}
              max={300}
              step={0.1}
              decimalScale={1}
              size="md"
              style={{ flex: 1 }}
              inputMode="decimal"
              value={weight}
              onChange={(v) => setWeight(typeof v === 'number' ? v : '')}
            />
            <Button
              type="submit"
              size="md"
              loading={createWeightLog.isPending}
              color={justSaved ? 'green' : undefined}
              leftSection={
                <Transition mounted={justSaved} transition="pop" duration={180}>
                  {(styles) => <IconCheck size={16} style={styles} />}
                </Transition>
              }
              styles={{
                root: { transition: 'background-color 180ms ease, transform 120ms ease' },
              }}
            >
              {justSaved ? 'Saved' : 'Save'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  )
}

export function BodyWeightPanel({ params }: { params: WeightLogWindowParams }) {
  const { data: summary } = useSuspenseQuery(weightLogQueries.summary(params))

  return (
    <Stack>
      <WeightSummaryCards summary={summary as WeightSummary} />
      <WeightEntryForm defaultWeight={(summary as WeightSummary).current} />
      <BodyWeightChart params={params} />
    </Stack>
  )
}
