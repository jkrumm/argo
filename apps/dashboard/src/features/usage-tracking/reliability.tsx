/**
 * Section G, reliability (collapsed by default): the error-rate band per day and the p95 latency
 * sparkline, scoped by source. The sessions feed (`agent-gateway-sessions`) logs sessions, not calls,
 * so the default scope leaves it out; the tabs switch to the feed alone or to every source. No KPI
 * cells: the band and the line are the whole section. Always per day, whatever the page grain.
 */
import { Suspense } from 'react'
import { useSuspenseQueries, useSuspenseQuery } from '@tanstack/react-query'
import { Box, Grid } from '@mantine/core'
import { Section } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { ViewTabs } from 'basalt-ui/controls'
import { CONTAINER_GRID_BREAKPOINTS } from 'basalt-ui/tokens'
import { useNow } from '../../lib/use-now'
import { usageQueries, type Range } from '../../lib/queries/usage'
import { usageStore, type UsageSourceScope } from '../../lib/window-stores'
import { dayToDate } from './constants'
import {
  SESSIONS_SOURCE,
  errorBandInfo,
  fmtSeconds,
  isFiltered,
  noUsageWindow,
  periodNoun,
  rangeWindowDays,
  reliabilitySources,
} from './model'
import type { PayerValue, WorkspaceValue } from './types'
import { ErrorBand, Trend } from './usage-visuals'

const SCOPE_NOTE: Record<UsageSourceScope, string> = {
  calls: `Excludes ${SESSIONS_SOURCE}, a sessions feed rather than call failures`,
  sessions: `${SESSIONS_SOURCE} only`,
  all: 'Every source',
}

type Props = {
  range: Range
  sourceScope: UsageSourceScope
  payer: PayerValue[] | undefined
  workspace: WorkspaceValue[] | undefined
}

/** Closed on load: the body (and its queries) mounts only once the reader opens the section. */
export default function Reliability(props: Props) {
  return (
    <Box data-shot="reliability">
      <Section
        title={`Reliability · errors and p95 · ${periodNoun(props.range)}`}
        collapsible
        defaultOpen={false}
        tabs={<ViewTabs field={usageStore.field.sourceScope} label="Source scope" />}
      >
        <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={160} />}>
          <ReliabilityBody {...props} />
        </Suspense>
      </Section>
    </Box>
  )
}

function ReliabilityBody(props: Props) {
  const { range, sourceScope, payer, workspace } = props
  // The window's own source list: the API filters by inclusion, so "every source but the feed"
  // needs the names first.
  const sourceList = useSuspenseQuery(
    usageQueries.timeseries({
      range,
      grain: 'day',
      payer,
      workspace,
      metric: 'errors',
      groupBy: 'source',
    }),
  )
  const sources = reliabilitySources(sourceScope, sourceList.data.groupKeys)
  if (sources?.length === 0) {
    return (
      <ChartCard
        placeholderHeight="content"
        title={`Error rate per day · ${periodNoun(range)}`}
        subtitle={SCOPE_NOTE[sourceScope]}
        state={{
          empty: noUsageWindow({
            filtered: isFiltered(payer, workspace),
            stripEmpty: false,
            leading: false,
            range,
          }),
        }}
      />
    )
  }
  return <ReliabilityCharts {...props} sources={sources} />
}

function ReliabilityCharts({
  range,
  sourceScope,
  payer,
  workspace,
  sources,
}: Props & { sources: string[] | undefined }) {
  const base = { range, grain: 'day' as const, payer, workspace, sources, groupBy: 'none' as const }
  const [latencyQ, ratesQ] = useSuspenseQueries({
    queries: [
      usageQueries.timeseries({ ...base, metric: 'latency_p95' }),
      usageQueries.timeseries({ ...base, metric: 'error_rate' }),
    ],
  })
  const windowOpts = { range, grain: 'day' as const, now: useNow() }
  // Window days only: the rolling window's partial leading day is left out, as everywhere on the page.
  const p95 = rangeWindowDays(
    latencyQ.data.buckets.map((b) => ({
      date: dayToDate(b.bucket),
      value: b.groups['value'] ?? null,
    })),
    windowOpts,
  )
  const rates = rangeWindowDays(
    ratesQ.data.buckets.map((b) => ({
      date: dayToDate(b.bucket),
      value: b.groups['value'] ?? null,
    })),
    windowOpts,
  )
  // The timeseries emits a null bucket for every empty day: a window has calls when any day has a rate.
  const empty =
    !rates.some((d) => d.value !== null) &&
    noUsageWindow({
      filtered: isFiltered(payer, workspace),
      stripEmpty: false,
      leading: false,
      range,
    })
  const subtitle = SCOPE_NOTE[sourceScope]

  return (
    <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
      <Grid.Col span={{ base: 12, lg: 6 }}>
        <ChartCard
          placeholderHeight="content"
          title={`Error rate per day · ${periodNoun(range)}`}
          info={errorBandInfo()}
          subtitle={subtitle}
          state={{ empty }}
        >
          <ErrorBand days={rates} />
        </ChartCard>
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 6 }}>
        <ChartCard
          placeholderHeight="content"
          title={`p95 latency per day · ${periodNoun(range)}`}
          subtitle={subtitle}
          state={{ empty }}
        >
          <Trend label="p95 latency per day" days={p95} loading={false} format={fmtSeconds} />
        </ChartCard>
      </Grid.Col>
    </Grid>
  )
}
