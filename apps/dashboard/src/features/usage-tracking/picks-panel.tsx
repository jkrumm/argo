/**
 * Section F, routing (collapsed by default): which account the picker chose per spawn lane, and why.
 * The pick history is days old, so the section states its coverage (`since 24 Oct · 89 picks`)
 * instead of drawing a 30 d axis, and under 20 picks it says there is not enough yet.
 */
import { Suspense } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box, Stack, Table, Text } from '@mantine/core'
import { Section } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { shotState } from '../../lib/shot-state'
import { usageQueries, type Range } from '../../lib/queries/usage'
import { ACCOUNT_LABELS } from './accounts'
import { periodNoun } from './model'
import {
  MIN_PICKS,
  NOT_ENOUGH_PICKS,
  SPILL,
  coverageLine,
  laneRows,
  orderPicked,
  rangeHours,
  type PicksResponse,
} from './quota-model'

const EMPTY: PicksResponse = { total: 0, bucketHours: 1, counts: [], pickedKeys: [], series: [] }

const INFO =
  'Picker decisions per spawn lane and chosen account, with why: home (the lane’s own account), expiring (an account whose week is about to reset), or spill (no Max account had headroom, so the caller fell back to its IU path).'

const pickedLabel = (key: string) =>
  key === SPILL ? 'spill (IU path)' : ((ACCOUNT_LABELS as Record<string, string>)[key] ?? key)

/** Lane × account pick counts with the reasons behind each lane's choices. */
function LanePicksTable({ range }: { range: Range }) {
  const query = useSuspenseQuery(usageQueries.pickSummary(rangeHours(range)))
  const data = shotState() === 'empty' ? EMPTY : query.data
  const keys = orderPicked(data.pickedKeys)
  const lanes = laneRows(data.counts)
  const coverage = coverageLine(data)
  const enough = data.total >= MIN_PICKS

  return (
    <Stack gap="xs">
      {coverage !== null && (
        <Text size="xs" c="dimmed">
          {coverage}
        </Text>
      )}
      <ChartCard
        placeholderHeight="content"
        title={`Picks by lane · ${periodNoun(range)}`}
        info={INFO}
        state={{ empty: !enough && NOT_ENOUGH_PICKS }}
      >
        <Table.ScrollContainer minWidth={320}>
          <Table withRowBorders={false} verticalSpacing={4} horizontalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Lane</Table.Th>
                {keys.map((k) => (
                  <Table.Th key={k} ta="right">
                    {pickedLabel(k)}
                  </Table.Th>
                ))}
                <Table.Th>Why</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {lanes.map((l) => (
                <Table.Tr key={l.lane}>
                  <Table.Td>{l.lane}</Table.Td>
                  {keys.map((k) => (
                    <Table.Td key={k} ta="right">
                      {l.byPicked[k] ?? 0}
                    </Table.Td>
                  ))}
                  <Table.Td c="dimmed">
                    {l.reasons.map((r) => `${r.reason} ${r.count}`).join(' · ')}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </ChartCard>
    </Stack>
  )
}

/** Closed on load: the body (and its query) mounts only once the reader opens the section. */
export default function Routing({ range }: { range: Range }) {
  return (
    <Box data-shot="routing">
      <Section
        title={`Routing · picks by lane · ${periodNoun(range)}`}
        collapsible
        defaultOpen={false}
      >
        <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={160} />}>
          <LanePicksTable range={range} />
        </Suspense>
      </Section>
    </Box>
  )
}
