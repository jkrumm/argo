/**
 * Q1 of the top band: am I inside the rolling 30-day IU cap, and what can I spend today? A `Meter`
 * (tick at 80 %) in the state's ink, the can-spend and burn lines, and the next seven days'
 * drop-off as bars. The state words follow the shared vocabulary; a portal fetch past 8 h reads
 * stale, past 48 h dead (dimmed, with the login command), and no fetch at all is `No portal data
 * yet`, never a zeroed gauge.
 */
import { useQuery } from '@tanstack/react-query'
import { Box, Stack, Text } from '@mantine/core'
import { Meter } from 'basalt-ui'
import { Bars, ChartCard } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { withUnit } from '../../lib/format'
import { usageQueries, type IuBudget } from '../../lib/queries/usage'
import { shotState } from '../../lib/shot-state'
import { useNow } from '../../lib/use-now'
import {
  NO_PORTAL_DATA,
  budgetReading,
  burnLine,
  freesLine,
  freshnessBadge,
  loadFailure,
  type CapState,
} from './budget-model'
import { dayToDate } from './constants'
import { fmtUsdWhole, shortDay } from './model'
import classes from './usage.module.css'

const WARN_AT = 0.8

/** What `iu-budget` answers before the first portal fetch: no `fetchedAt`, zeroed figures. */
const EMPTY_BUDGET: IuBudget = {
  limitUsd: 500,
  windowDays: 30,
  fetchedAt: null,
  windowFrom: '',
  windowTo: '',
  rolling30Usd: 0,
  canSpendTodayUsd: 0,
  burn7dUsdPerDay: 0,
  projected7dUsd: 0,
  daily: [],
  dropoffNext7: [],
  topModels: [],
}

/** Verdict ink: `ok` keeps the neutral fill and ink, only `warn` and `over` earn a status colour. */
const STATE_INK: Record<CapState, string | undefined> = {
  ok: undefined,
  warn: VX.status.warn,
  over: VX.status.bad,
}
const STATE_FACT_TONE = { ok: undefined, warn: 'warn', over: 'bad' } as const
const BADGE_INK = { muted: undefined, warn: VX.status.warn, bad: VX.status.bad } as const

const INFO =
  'IU API spend over the rolling 30 days (today and the 29 days before) against the $500 cap, from the IU portal report. The tick marks 80 %. Bars: the portal cost each of the next seven days frees as it leaves the window.'

type DropoffRow = IuBudget['dropoffNext7'][number]

function Dropoff({ rows }: { rows: readonly DropoffRow[] }) {
  const total = rows.reduce((sum, r) => sum + r.freesUsd, 0)
  return (
    <Stack gap={4}>
      <Text fz={VX.text.micro} c="dimmed">
        {freesLine(total)}
      </Text>
      <Box data-shot-tooltip>
        <Bars
          ariaLabel="Portal cost freed per day over the next seven days"
          data={rows}
          height={92}
          x={(d: DropoffRow) => shortDay(dayToDate(d.day))}
          legend={false}
          y={{ ticks: [], grid: false }}
          bars={[
            {
              key: 'frees',
              label: 'Frees',
              color: VX.muted,
              getValue: (d: DropoffRow) => d.freesUsd,
              formatValue: fmtUsdWhole,
            },
          ]}
        />
      </Box>
    </Stack>
  )
}

export function CapGauge() {
  const query = useQuery(usageQueries.iuBudget())
  const now = useNow()
  const budget = shotState() === 'empty' ? EMPTY_BUDGET : query.data
  const reading = budget === undefined ? null : budgetReading(budget, now)
  const badge = budget === undefined ? null : freshnessBadge(budget.fetchedAt, now)
  const state = reading?.state ?? null
  const ink = state === null ? undefined : STATE_INK[state]
  const isEmpty = reading?.freshness === 'empty'
  const ready = budget !== undefined && reading !== null && state !== null

  return (
    <Box data-shot="cap-gauge" data-shot-states="empty" h="100%">
      <ChartCard
        className={classes.fill}
        title={`IU cap · ${withUnit('rolling 30', 'd')}`}
        info={INFO}
        placeholderHeight={300}
        stateNoun="the IU cap"
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        state={{
          pending: budget === undefined && query.isPending,
          error:
            budget === undefined && query.isError
              ? loadFailure(query.error, 'The IU budget did not load from the API.')
              : undefined,
          empty: isEmpty && NO_PORTAL_DATA,
        }}
        actions={
          badge === null ? undefined : (
            <Text fz={VX.text.micro} c={BADGE_INK[badge.tone] ?? 'dimmed'}>
              {badge.text}
            </Text>
          )
        }
        {...(ready
          ? {
              facts: {
                value: state,
                tone: STATE_FACT_TONE[state],
              },
            }
          : {})}
      >
        {ready ? (
          <Stack gap="sm">
            <Stack gap="sm" className={reading.freshness === 'dead' ? classes.dimmed : undefined}>
              <Meter
                label="IU API spend over the rolling 30 days against the cap"
                value={budget.rolling30Usd}
                max={budget.limitUsd}
                format={fmtUsdWhole}
                ticks={[{ at: budget.limitUsd * WARN_AT, label: withUnit(WARN_AT * 100, '%') }]}
                startCaption={reading.cap}
                readingAt="start"
                {...(ink === undefined ? {} : { color: ink })}
              />
              <Stack gap={2}>
                <Text size="sm">{reading.canSpend}</Text>
                <Text fz={VX.text.micro} c="dimmed">
                  {burnLine(budget.burn7dUsdPerDay, budget.projected7dUsd)}
                </Text>
              </Stack>
              <Dropoff rows={budget.dropoffNext7} />
            </Stack>
            {reading.freshness === 'dead' ? (
              <Text fz={VX.text.micro} c={VX.status.bad}>
                {reading.note}
              </Text>
            ) : null}
          </Stack>
        ) : null}
      </ChartCard>
    </Box>
  )
}
