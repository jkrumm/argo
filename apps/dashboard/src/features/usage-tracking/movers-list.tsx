/**
 * Q3 of the top band: what changed most in dollars this week? Three ranked `(tool, model)` pairs,
 * API payers only (the API default), each with its change against the prior 7 days. A rise in spend
 * is the bad reading. Nothing above the API's floor reads as one sentence, not an empty list.
 */
import { useQuery } from '@tanstack/react-query'
import { Box, Group, Stack, Text } from '@mantine/core'
import { DeltaBadge } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { withUnit } from '../../lib/format'
import { usageQueries, type MoverRow, type MoversParams } from '../../lib/queries/usage'
import { shotState } from '../../lib/shot-state'
import { MOVERS_FLAT, deltaDirection, loadFailure, moverLabel } from './budget-model'
import { fmtUsdWhole } from './model'

const MOVERS: MoversParams = { window: '7d', limit: 3, payer: ['iu-api', 'me-api'] }
const NO_ROWS: readonly MoverRow[] = []
const PERIOD = `prior ${withUnit(7, 'd')}`

const INFO =
  'The (tool, model) pairs whose API spend changed most in dollars over the last 7 days against the 7 days before. Subscriptions are left out: their cost is list value, not spend. Pairs under $2 in both weeks are ignored.'

const fmtDeltaBadge = (v: number) => fmtUsdWhole(Math.abs(v))

function MoverItem({ row }: { row: MoverRow }) {
  // A change under a dollar rounds to flat: a glyph on it would claim a move.
  const delta = deltaDirection(row.deltaUsd) === 'flat' ? 0 : row.deltaUsd
  return (
    <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
      <Stack gap={0} flex={1} miw={0}>
        <Text size="sm">{moverLabel(row)}</Text>
        <Text size="xs" c="dimmed">
          {fmtUsdWhole(row.costUsd)} vs {fmtUsdWhole(row.priorCostUsd)}
        </Text>
      </Stack>
      <DeltaBadge value={delta} format={fmtDeltaBadge} polarity="up-bad" />
    </Group>
  )
}

export function MoversList() {
  const query = useQuery(usageQueries.movers(MOVERS))
  const empty = shotState() === 'empty'
  const rows = empty ? NO_ROWS : (query.data?.rows ?? NO_ROWS)

  return (
    <Box data-shot="movers" data-shot-states="empty">
      <ChartCard
        title={`Biggest movers · ${withUnit(7, 'd')} vs ${PERIOD}`}
        info={INFO}
        subtitle="API spend, change in dollars"
        placeholderHeight={140}
        stateNoun="the movers"
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        state={{
          pending: !empty && query.isPending,
          error:
            !empty && query.isError
              ? loadFailure(query.error, 'The movers did not load from the API.')
              : undefined,
        }}
      >
        {query.data === undefined && !empty ? null : rows.length === 0 ? (
          <Text size="sm" c="dimmed">
            {MOVERS_FLAT}
          </Text>
        ) : (
          <Stack gap="sm">
            {rows.map((row) => (
              <MoverItem key={`${row.subTool}\u0000${row.model}`} row={row} />
            ))}
          </Stack>
        )}
      </ChartCard>
    </Box>
  )
}
