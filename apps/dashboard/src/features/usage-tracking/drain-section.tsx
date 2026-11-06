/**
 * The Flow verdict's drain section: one card per payer, all in the same chart form. Three
 * subscriptions (the seven-day quota window), three credit pools (the billing cycle) and the IU
 * personal key (a rolling 30-day cap), each showing what is left, how fast it drains and when it runs
 * out or resets. Fetches, builds the seven models (`drain-model.ts`) and lays the cards out.
 */
import { Suspense } from 'react'
import { useSuspenseQueries } from '@tanstack/react-query'
import { Box, SimpleGrid, Stack, Text } from '@mantine/core'
import { ChartCard } from 'basalt-ui/charts'
import { CONTAINER_KEYS } from 'basalt-ui/tokens'
import { usageQueries } from '../../lib/queries/usage'
import { useNow } from '../../lib/use-now'
import { USAGE_ACCOUNTS } from './accounts'
import { DrainChart } from './drain-chart'
import { keyDrain, poolDrain, subDrain, type DrainModel } from './drain-model'
import { FlowBoundary } from './flow-boundary'
import { poolPayer, poolTitle } from './flow-model'

const HEIGHT = 220
const QUOTA_HOURS = 360
const REFRESH_MS = 5 * 60_000

const COLS = { base: 1, [CONTAINER_KEYS.regular]: 2, [CONTAINER_KEYS.wide]: 3 }

function DrainCard({ model }: { model: DrainModel }) {
  return (
    <Box data-shot={`flow-drain-${model.kind}-${model.id}`}>
      <ChartCard
        title={model.title}
        subtitle={model.subtitle}
        info={model.info}
        placeholderHeight={HEIGHT}
        state={{ empty: model.empty ?? false }}
        facts={{ value: model.headline }}
      >
        <Stack gap="xs">
          <DrainChart model={model} height={HEIGHT} />
          <Text size="xs" c="dimmed">
            {model.verdict}
          </Text>
        </Stack>
      </ChartCard>
    </Box>
  )
}

function Group({ label, models }: { label: string; models: readonly DrainModel[] }) {
  return (
    <Stack gap="xs">
      <Text size="xs" fw={600} c="dimmed" tt="uppercase">
        {label}
      </Text>
      <SimpleGrid type="container" cols={COLS} spacing="md">
        {models.map((m) => (
          <DrainCard key={`${m.kind}-${m.id}`} model={m} />
        ))}
      </SimpleGrid>
    </Stack>
  )
}

function Drain() {
  const now = useNow()
  const [quota, latest, pace, budget] = useSuspenseQueries({
    queries: [
      { ...usageQueries.quota(QUOTA_HOURS), refetchInterval: REFRESH_MS },
      { ...usageQueries.quotaLatest(), refetchInterval: REFRESH_MS },
      { ...usageQueries.pace(), refetchInterval: REFRESH_MS },
      { ...usageQueries.iuBudget('personal'), refetchInterval: REFRESH_MS },
    ],
  })

  const subs = USAGE_ACCOUNTS.map((a) => {
    const reading = latest.data.accounts.find((x) => x.account === a.id)
    return subDrain({
      id: a.id,
      title: `${a.label} · ${a.plan === 'ultra' ? 'Ultra' : 'Max 5x'}`,
      payer: a.payer,
      points: quota.data.series.find((s) => s.account === a.id)?.points ?? [],
      resets: quota.data.resets
        .filter((r) => r.account === a.id && r.window === 'seven_day')
        .map((r) => r.at),
      nextResetAt: reading?.sevenDayResetsAt ?? null,
      sevenDayPct: reading?.sevenDayPct ?? null,
      now,
    })
  })
  const pools = USAGE_ACCOUNTS.map((a) =>
    poolDrain({
      id: a.id,
      title: poolTitle(a.id),
      payer: poolPayer(a.id),
      account: a.id,
      pace: pace.data,
      now,
    }),
  )
  const key = keyDrain({
    id: 'personal',
    title: 'IU personal key',
    payer: 'iu-api',
    budget: budget.data,
    now,
  })

  return (
    <Box data-shot="flow-drain">
      <Stack gap="lg">
        <Group label="Subscriptions · weekly window" models={subs} />
        <Group label="Credit pools · billing cycle" models={pools} />
        <Group label="IU key" models={[key]} />
      </Stack>
    </Box>
  )
}

export function DrainSection() {
  return (
    <FlowBoundary noun="the drain charts" height={1200}>
      <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={HEIGHT} />}>
        <Drain />
      </Suspense>
    </FlowBoundary>
  )
}
