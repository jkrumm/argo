/**
 * Which account served each lane over time: one `BandStrip` per lane (busiest first), time across,
 * one cell per bin. A cell is the account of its last pick in that account's payer shade; a cell in
 * which no account had room is the failure ink, and a pick an account only took as the overflow of
 * the lane's own account keeps the account's shade with a warn marker over it. BandStrip is the
 * basalt form for exactly this (a state per slot, legend and tooltip derived from `states`); a
 * scatter would need a lane axis it does not have. The strips share the cursor, so one hover reads
 * the same instant in every lane.
 */
import { Box, Group, Stack, Text } from '@mantine/core'
import { BandStrip, ChartCard, type BandSpan } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import { formatMinutes } from '../../lib/format'
import { shotState } from '../../lib/shot-state'
import type { AccountPick } from '../../lib/queries/usage'
import { shortDay, shortHour } from './model'
import {
  IDLE_STATE,
  NONE_STATE,
  SPILLED_STATE,
  accountColor,
  accountTitle,
  binMsFor,
  cellState,
  laneRows,
  reasonSummary,
  servedAccounts,
  snapshotText,
  stripTickLabel,
  stripTicks,
  type Lane,
  type LaneCell,
} from './routing-model'

/** Lanes drawn; the rest is counted under the card. */
const LANE_CAP = 8
const BAND_HEIGHT = 30
const AXIS_HEIGHT = 22
const CURSOR_GROUP = 'usage-routing-lanes'

const INFO =
  'Each row is a lane (who asked: interactive sessions, waves, dispatches), busiest first; each cell is a stretch of time, filled in the shade of the account whose pick came last in it. A warn bar over a cell means the account only took the pick as overflow of the lane’s own account; a red cell means no account had room. Hover for the reason and the quota the picker saw (5 h/weekly percent used per account).'

const getBand = (d: LaneCell): BandSpan => {
  const { state, overflow } = cellState(d.picks)
  return overflow ? { state, marker: { state: SPILLED_STATE, inset: 9 } } : { state }
}

const readingOf = (d: LaneCell): string | null =>
  d.picks.length === 0 ? null : reasonSummary(d.picks)

function laneStates(picks: readonly AccountPick[]) {
  const accounts = servedAccounts(picks)
  const flags = new Set(picks.map((p) => cellStateOfPick(p)))
  return [
    ...accounts.map((a) => ({
      key: a,
      label: accountTitle(a),
      color: accountColor(a),
      formatValue: readingOf,
    })),
    ...(flags.has(SPILLED_STATE)
      ? [{ key: SPILLED_STATE, label: 'Overflow of the lane’s account', color: VX.status.warn }]
      : []),
    ...(flags.has(NONE_STATE)
      ? [
          {
            key: NONE_STATE,
            label: 'No account had room',
            color: VX.status.bad,
            formatValue: readingOf,
          },
        ]
      : []),
    {
      key: IDLE_STATE,
      label: 'No pick',
      color: alpha(VX.line, 0.08),
      legend: false,
      tooltip: false,
    },
  ]
}

const cellStateOfPick = (p: AccountPick): string => {
  const { state, overflow } = cellState([p])
  return state === NONE_STATE ? NONE_STATE : overflow ? SPILLED_STATE : state
}

function LaneStrip({
  lane,
  ticks,
  last,
  hours,
  states,
}: {
  lane: Lane
  ticks: readonly number[]
  last: boolean
  hours: number
  states: ReturnType<typeof laneStates>
}) {
  return (
    <Stack gap={2}>
      <Group gap="xs" align="baseline">
        <Text size="xs" fw={600}>
          {lane.lane}
        </Text>
        <Text size="xs" c="dimmed">
          {lane.total} {lane.total === 1 ? 'pick' : 'picks'}
        </Text>
      </Group>
      <BandStrip<LaneCell, number>
        ariaLabel={`Accounts that served the ${lane.lane} lane over the last ${hours} hours`}
        data={lane.cells}
        x={(d) => d.at.getTime()}
        xTicks={last ? ticks : []}
        formatX={(ms) => stripTickLabel(ms, shortDay)}
        states={states}
        getBand={getBand}
        height={BAND_HEIGHT + (last ? AXIS_HEIGHT : 0)}
        cursorGroup={CURSOR_GROUP}
        legend={last ? { toggle: false } : false}
        fold={{
          merge: (group) => ({ at: group[0]!.at, picks: group.flatMap((c) => c.picks) }),
        }}
        tooltip={{
          formatHeader: (_, d) =>
            d.picks.length === 1
              ? shortHour(new Date(d.picks[0]!.ts))
              : `${shortHour(d.at)}${d.picks.length > 1 ? ` · ${d.picks.length} picks` : ''}`,
          rows: (d) => {
            const latest = d.picks.at(-1)
            if (latest === undefined) return []
            return [
              { label: 'Lane', value: lane.lane },
              {
                label: d.picks.length > 1 ? 'Snapshot (last pick)' : 'Snapshot',
                value: snapshotText(latest.snapshot),
              },
              ...(latest.stale ? [{ label: 'Reading', value: 'stale (over 10 min old)' }] : []),
            ]
          },
        }}
      />
    </Stack>
  )
}

export function PicksTimeline({
  picks,
  now,
  hours,
  fromMs,
  firstMs,
}: {
  picks: readonly AccountPick[]
  now: number
  hours: number
  fromMs: number
  /** The first pick ever read in the range, or `null`: where the data begins. */
  firstMs: number | null
}) {
  const shown = shotState() === 'empty' ? [] : picks
  const binMs = binMsFor(hours)
  const { lanes, hidden } = laneRows(shown, fromMs, now, binMs, LANE_CAP)
  const states = laneStates(shown)
  const ticks = stripTicks(lanes[0]?.cells ?? [], hours)
  const startsInside = firstMs !== null && firstMs > now - hours * 3_600_000

  return (
    <Box data-shot="routing-picks" data-shot-states="empty">
      <ChartCard
        title="Who served each lane"
        info={INFO}
        subtitle={`One cell = ${formatMinutes(binMs / 60_000)}, filled by the last pick in it${hidden > 0 ? ` · ${hidden} quieter ${hidden === 1 ? 'lane' : 'lanes'} not drawn` : ''}`}
        placeholderHeight={240}
        state={{ empty: shown.length === 0 && 'No picker decisions in this range' }}
        facts={{
          value: String(shown.length),
          unit: shown.length === 1 ? 'pick' : 'picks',
          period: [
            `last ${hours / 24} d`,
            ...(startsInside ? [`since ${shortDay(new Date(firstMs))}`] : []),
          ],
        }}
      >
        <Stack gap="xs">
          {lanes.map((lane, i) => (
            <LaneStrip
              key={lane.lane}
              lane={lane}
              ticks={ticks}
              last={i === lanes.length - 1}
              hours={hours}
              states={states}
            />
          ))}
        </Stack>
      </ChartCard>
    </Box>
  )
}
