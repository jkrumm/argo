/**
 * The detail of the router node: picks per day by target, the reason mix and the refusals, IU spend per
 * day by cause (Claude work on IU in the status inks) and the cache hit per caller and target. The
 * totals are `routerTotals`, the same function the column's cards read.
 */
import { useSuspenseQuery } from '@tanstack/react-query'
import { Grid, Stack, Text } from '@mantine/core'
import { BarList } from 'basalt-ui'
import { Bars, ChartCard } from 'basalt-ui/charts'
import { alpha, CONTAINER_GRID_BREAKPOINTS, VX } from 'basalt-ui/tokens'
import { usageQueries, type Range } from '../../lib/queries/usage'
import { shotState } from '../../lib/shot-state'
import { colorForPayer, dayToDate } from './constants'
import {
  IU_CAUSE_LABEL,
  cacheRows,
  fmtAxisUsd,
  fmtUsd,
  iuByCause,
  iuPerDay,
  picksByReason,
  picksByTarget,
  picksPerDay,
  routerNotes,
  routerTotals,
  targetLabel,
  type DayCounts,
  type IuCause,
} from './flow-model'
import { targetColor } from './flow-ink'
import { CACHE_INFO, IU_INFO, PICKS_INFO } from './flow-copy'
import { periodNoun, shortDay } from './model'

const HEIGHT = 220
const NUMBER = new Intl.NumberFormat('en-GB')

/** Greys for the by-design causes, the status inks for Claude work that reached IU. */
const CAUSE_COLOR: Record<IuCause, string> = {
  design: colorForPayer('iu-api'),
  eval: alpha(colorForPayer('iu-api'), 0.5),
  forced: alpha(colorForPayer('iu-api'), 0.3),
  'claude-code': VX.status.warn,
  'credit-fallback': VX.status.bad,
  'route-fallback': alpha(VX.status.bad, 0.55),
}

type DayRow = DayCounts & { at: Date }
const dayRows = (days: readonly DayCounts[]): DayRow[] =>
  days.map((d) => ({ ...d, at: dayToDate(d.day) }))

export function RouterDetail({ range }: { range: Range }) {
  const { data } = useSuspenseQuery(usageQueries.router(range))
  const empty = shotState() === 'empty'
  const router = empty ? { ...data, picks: [], iu: [], cache: [] } : data
  const totals = routerTotals(router)
  const picks = dayRows(picksPerDay(router.picks))
  const targets = picksByTarget(router.picks).map((t) => t.target)
  const iuDays = dayRows(iuPerDay(router.iu))
  const causes = iuByCause(router.iu).filter((c) => c.usd > 0 || c.requests > 0)
  const refusals = picksByReason(router.picks, 'refused')
  const notes = routerNotes(router)
  const noun = periodNoun(range)

  return (
    <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS} data-shot="flow-router-detail">
      <Grid.Col span={{ base: 12, lg: 6 }}>
        <ChartCard
          title="Picks per day"
          subtitle={`by target · ${NUMBER.format(totals.picks)} picks · ${noun}`}
          info={PICKS_INFO}
          placeholderHeight={HEIGHT}
          state={{ empty: picks.length === 0 && 'No gateway traffic in this range' }}
        >
          <Bars<DayRow, Date>
            ariaLabel="Gateway picks per day, by target"
            data={picks}
            height={HEIGHT}
            x={(d) => d.at}
            formatX={(d) => shortDay(d)}
            layout="stacked"
            cursorGroup="usage-flow-router-picks"
            bars={targets.map((t) => ({
              key: t,
              label: targetLabel(t),
              color: targetColor(t),
              getValue: (d: DayRow) => d.values[t] ?? 0,
              formatValue: (v: number) => `${NUMBER.format(v)} picks`,
            }))}
            tooltip={{ formatHeader: (d) => shortDay(d) }}
          />
        </ChartCard>
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 6 }}>
        <ChartCard
          title="IU spend per day"
          subtitle={`by cause · ${fmtUsd(totals.iuUsd)} · ${noun}`}
          info={IU_INFO}
          placeholderHeight={HEIGHT}
          state={{ empty: iuDays.length === 0 && 'Nothing reached IU in this range' }}
        >
          <Stack gap="xs">
            <Bars<DayRow, Date>
              ariaLabel="IU spend per day, by cause"
              data={iuDays}
              height={HEIGHT}
              x={(d) => d.at}
              formatX={(d) => shortDay(d)}
              layout="stacked"
              cursorGroup="usage-flow-router-iu"
              y={{ format: fmtAxisUsd }}
              bars={causes.map((c) => ({
                key: c.cause,
                label: IU_CAUSE_LABEL[c.cause],
                color: CAUSE_COLOR[c.cause],
                getValue: (d: DayRow) => d.values[c.cause] ?? 0,
                formatValue: (v: number) => fmtUsd(v),
              }))}
              tooltip={{ formatHeader: (d) => shortDay(d) }}
            />
            {notes.map((n) => (
              <Text key={n} size="xs" c="dimmed">
                {n}
              </Text>
            ))}
          </Stack>
        </ChartCard>
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 6 }}>
        <ChartCard
          title="Refusals by reason"
          subtitle={`${NUMBER.format(totals.refused)} refused · ${noun}`}
          info="Requests the gateway refused (no pool had room and IU was not allowed), by the pick’s reason. A refused request is the agw route-fallback trigger: agw retries it on GPT."
          placeholderHeight="content"
        >
          <BarList
            label={`Refused gateway picks by reason, ${noun}`}
            variant="thin"
            emptyText="Nothing was refused in this range"
            format={(v) => NUMBER.format(v)}
            items={refusals.map((r) => ({ key: r.reason, label: r.reason, value: r.n }))}
          />
        </ChartCard>
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 6 }}>
        <ChartCard
          title="Cache hit per caller and target"
          subtitle={noun}
          info={CACHE_INFO}
          placeholderHeight="content"
        >
          <BarList
            label={`Prompt cache hit per caller and target, ${noun}`}
            variant="thin"
            max={100}
            emptyText="No gateway requests in this range"
            format={(v) => `${Math.round(v)} %`}
            items={cacheRows(router.cache).map((r) => ({
              key: r.key,
              label: `${r.caller} → ${targetLabel(r.target)}`,
              value: r.hitRate === null ? 0 : r.hitRate * 100,
              secondary: (
                <Text span size="xs" c="dimmed">
                  {r.hitRate === null ? 'no input · ' : ''}
                  {NUMBER.format(r.requests)} requests
                </Text>
              ),
            }))}
          />
        </ChartCard>
      </Grid.Col>
    </Grid>
  )
}
