/**
 * The Quotas tab's four cards in one chart form: Claude subscriptions (the combined weekly quota, or
 * the accounts on their own), Claude API credit (the three pools in dollars), the IU personal key and the Athena team
 * key (each a rolling 30-day cap). Every card has a headline, a fixed-window subtitle, the chart, a compact
 * row per account or pool where there are several, and a one-line verdict. All of it is state ("now"),
 * so none of it follows the page Range. Each card fetches behind its own boundary.
 */
import { Suspense, type ReactNode } from 'react'
import { useSuspenseQueries, useSuspenseQuery } from '@tanstack/react-query'
import { Box, SimpleGrid, Stack, Table, Text } from '@mantine/core'
import { ChartCard } from 'basalt-ui/charts'
import { ViewTabs } from 'basalt-ui/controls'
import { CONTAINER_KEYS, VX } from 'basalt-ui/tokens'
import { usageQueries } from '../../lib/queries/usage'
import { useNow } from '../../lib/use-now'
import { usageStore } from '../../lib/window-stores'
import { IU_KEYS } from './accounts'
import { colorForPayer } from './constants'
import { DrainChart } from './drain-chart'
import { keyDrain, pctText } from './drain-model'
import { FlowBoundary } from './flow-boundary'
import { fmtUsd } from './flow-model'
import { QuotaChart } from './quota-chart'
import { creditDrain, QUOTA_WINDOW_HOURS, quotaDrain, quotaInputs } from './quotas-model'

const CHART_HEIGHT = 220
const CARD_HEIGHT = 420
const REFRESH_MS = 5 * 60_000

const fallback = <ChartCard state={{ pending: true }} placeholderHeight={CARD_HEIGHT} />

function Swatch({ color }: { color: string }) {
  return (
    <Box
      component="span"
      display="inline-block"
      mr={6}
      w={10}
      h={2}
      bg={color}
      style={{ verticalAlign: 'middle' }}
    />
  )
}

/** A compact row table under a chart: `fz` xs, no borders. */
function Rows({
  head,
  rows,
}: {
  head: readonly string[]
  rows: ReadonlyArray<{ key: string; cells: ReactNode[] }>
}) {
  return (
    <Table fz="xs" verticalSpacing={4} horizontalSpacing={6} withRowBorders={false}>
      <Table.Thead>
        <Table.Tr>
          {head.map((h, i) => (
            <Table.Th key={h} fw={500} c="dimmed" ta={i === 0 ? 'left' : 'right'}>
              {h}
            </Table.Th>
          ))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((r) => (
          <Table.Tr key={r.key}>
            {r.cells.map((c, i) => (
              <Table.Td key={i} ta={i === 0 ? 'left' : 'right'}>
                {c}
              </Table.Td>
            ))}
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}

function SubscriptionsCard() {
  const now = useNow()
  const [quota, latest] = useSuspenseQueries({
    queries: [
      { ...usageQueries.quota(QUOTA_WINDOW_HOURS), refetchInterval: REFRESH_MS },
      { ...usageQueries.quotaLatest(), refetchInterval: REFRESH_MS },
    ],
  })
  const { subsView } = usageStore.useValues()
  const model = quotaDrain(quotaInputs(quota.data, latest.data), now)
  const byAccount = subsView === 'accounts'
  return (
    <Box data-shot="quotas-subscriptions">
      <ChartCard
        title="Claude subscriptions"
        subtitle={model.subtitle}
        info={model.info}
        placeholderHeight={CARD_HEIGHT}
        state={{ empty: model.empty ?? false }}
        facts={{ value: model.headline }}
        actions={<ViewTabs field={usageStore.field.subsView} label="Subscription view" />}
      >
        <Stack gap="xs">
          {byAccount ? (
            <QuotaChart model={model} height={CHART_HEIGHT} />
          ) : (
            <DrainChart model={model.pool} height={CHART_HEIGHT} />
          )}
          <Rows
            head={['Account', 'Left', 'Resets']}
            rows={model.accounts.map((a) => ({
              key: a.id,
              cells: [
                <>
                  {byAccount ? <Swatch color={colorForPayer(a.payer)} /> : null}
                  {a.label} · {a.plan}
                </>,
                a.leftPct === null ? '—' : pctText(a.leftPct),
                <>
                  {a.resetsText ?? '—'}
                  {a.note === null ? null : (
                    <Text span inherit c={VX.status.warn} display="block">
                      {a.note}
                    </Text>
                  )}
                </>,
              ],
            }))}
          />
          <Text size="xs" c="dimmed">
            {model.verdict}
          </Text>
        </Stack>
      </ChartCard>
    </Box>
  )
}

function CreditCard() {
  const now = useNow()
  const { data: pace } = useSuspenseQuery({ ...usageQueries.pace(), refetchInterval: REFRESH_MS })
  const { model, rows } = creditDrain(pace, now)
  return (
    <Box data-shot="quotas-credit">
      <ChartCard
        title={model.title}
        subtitle={model.subtitle}
        info={model.info}
        placeholderHeight={CARD_HEIGHT}
        state={{ empty: model.empty ?? false }}
        facts={{ value: model.headline }}
      >
        <Stack gap="xs">
          <DrainChart model={model} height={CHART_HEIGHT} />
          <Rows
            head={['Pool', 'Left', 'Renews', 'Needs']}
            rows={rows.map((r) => ({
              key: r.account,
              cells: [
                r.label,
                `${fmtUsd(r.leftUsd)} of ${fmtUsd(r.grantUsd)}`,
                <>
                  {r.renews}
                  {r.dryText === null ? null : (
                    <Text span inherit c="dimmed" display="block">
                      {r.dryText}
                    </Text>
                  )}
                </>,
                r.needed,
              ],
            }))}
          />
          <Text size="xs" c="dimmed">
            {model.verdict}
          </Text>
        </Stack>
      </ChartCard>
    </Box>
  )
}

function KeyCard({ iuKey }: { iuKey: (typeof IU_KEYS)[number]['id'] }) {
  const now = useNow()
  const { data: budget } = useSuspenseQuery({
    ...usageQueries.iuBudget(iuKey),
    refetchInterval: REFRESH_MS,
  })
  const { model, returns } = keyDrain({
    id: iuKey,
    title: iuKey === 'personal' ? 'IU personal key' : 'Athena team key',
    budget,
    now,
  })
  return (
    <Box data-shot={`quotas-key-${iuKey}`}>
      <ChartCard
        title={model.title}
        subtitle={model.subtitle}
        info={model.info}
        placeholderHeight={CARD_HEIGHT}
        state={{ empty: model.empty ?? false }}
        facts={{
          value: model.headline,
          ...(model.headlineTone === undefined ? {} : { tone: model.headlineTone }),
        }}
      >
        <Stack gap="xs">
          <DrainChart model={model} height={CHART_HEIGHT} />
          {returns.length === 0 ? null : (
            <Rows
              head={['Comes back', 'Amount', 'After']}
              rows={returns.map((r) => ({
                key: String(r.at),
                cells: [r.when, `+${fmtUsd(r.usd)}`, r.after],
              }))}
            />
          )}
          <Text size="xs" c="dimmed">
            {model.verdict}
          </Text>
        </Stack>
      </ChartCard>
    </Box>
  )
}

export function QuotasSection() {
  return (
    <SimpleGrid
      type="container"
      cols={{ base: 1, [CONTAINER_KEYS.regular]: 2 }}
      spacing="md"
      data-shot="quotas-grid"
    >
      <FlowBoundary noun="the subscription quota" height={CARD_HEIGHT}>
        <Suspense fallback={fallback}>
          <SubscriptionsCard />
        </Suspense>
      </FlowBoundary>
      <FlowBoundary noun="the API credit" height={CARD_HEIGHT}>
        <Suspense fallback={fallback}>
          <CreditCard />
        </Suspense>
      </FlowBoundary>
      <FlowBoundary noun="the IU personal key" height={CARD_HEIGHT}>
        <Suspense fallback={fallback}>
          <KeyCard iuKey="personal" />
        </Suspense>
      </FlowBoundary>
      <FlowBoundary noun="the Athena team key" height={CARD_HEIGHT}>
        <Suspense fallback={fallback}>
          <KeyCard iuKey="athena-team" />
        </Suspense>
      </FlowBoundary>
    </SimpleGrid>
  )
}
