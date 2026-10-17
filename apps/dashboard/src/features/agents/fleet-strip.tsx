import { Sparkline } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import { Meter, StatGroup, type StatStripCell } from 'basalt-ui'
import type { HistoryPoint } from '../../lib/queries/agents'
import {
  ABANDONED_AFTER_MS,
  ageAgo,
  formatWaitDuration,
  OLDEST_WAIT_WARN_MS,
  peakNeedsYou,
  trendSeries,
  type FleetPart,
  type FleetState,
  type OldestWait,
} from './model'

/** Neutral ink at stepped strengths for the calm states; a hue only for needs-you and stale. */
const FLEET_COLOR: Record<FleetState, string> = {
  working: VX.line,
  needs_you: VX.status.bad,
  idle: alpha(VX.line, 0.55),
  stale: VX.status.warn,
  done: alpha(VX.line, 0.28),
  unknown: alpha(VX.line, 0.18),
}

type Props = {
  /** Items the Needs-you section renders: agents plus human-queue asks. `null` when unknown. */
  needsYou: number | null
  fleet: { parts: FleetPart[]; total: number } | null
  history: HistoryPoint[] | undefined
  hours: number
  oldest: OldestWait | null
  now: number
}

function waitTone(ms: number): 'bad' | 'warn' | undefined {
  if (ms > ABANDONED_AFTER_MS) return 'bad'
  if (ms > OLDEST_WAIT_WARN_MS) return 'warn'
  return undefined
}

function NeedsYouVisual({ history, hours }: Pick<Props, 'history' | 'hours'>) {
  const trend = trendSeries(history, 'needsYou')
  if (trend.length <= 1) return null
  return (
    <Sparkline
      ariaLabel={`Agents needing you over the last ${hours} hours`}
      data={trend}
      height={32}
      color={VX.line}
      emphasizeLast
    />
  )
}

function peakFooter(history: HistoryPoint[] | undefined, hours: number, now: number): string {
  const peak = peakNeedsYou(history)
  const trend =
    peak === null
      ? `no data in ${hours} h`
      : peak.value === 0
        ? `none in ${hours} h`
        : `peak ${peak.value} in ${hours} h`
  const scope = `line is agents needing you, ${hours} h`
  return peak !== null && peak.value > 0
    ? `${trend} · ${ageAgo(now - peak.atMs)} · ${scope}`
    : `${trend} · ${scope}`
}

/**
 * The three joined cells under the page summary: needs-you trend, oldest wait against its two
 * thresholds, fleet by state. Replaces the three bare-integer tiles.
 */
export function FleetStrip({ needsYou, fleet, history, hours, oldest, now }: Props) {
  const oldestTone = oldest === null ? undefined : waitTone(oldest.ms)

  return (
    <StatGroup
      variant="strip"
      label="Agent fleet"
      cols={3}
      cells={[
        {
          key: 'needs-you',
          caption: 'Needs you · now',
          value: needsYou === null ? null : String(needsYou),
          ...(needsYou !== null && { unit: needsYou === 1 ? 'item' : 'items' }),
          ...(needsYou !== null && needsYou > 0 && { tone: 'warn' as const }),
          visual: <NeedsYouVisual history={history} hours={hours} />,
          footer: peakFooter(history, hours, now),
        },
        {
          key: 'oldest-wait',
          caption: 'Oldest wait',
          value: oldest === null ? null : formatWaitDuration(oldest.ms),
          ...(oldestTone !== undefined && { tone: oldestTone }),
          footer: oldest === null ? undefined : `in ${oldest.project}`,
          visual: (
            <Meter
              label="Oldest agent wait against the 24 h and 7 d marks"
              value={oldest?.ms ?? null}
              max={ABANDONED_AFTER_MS}
              ticks={[
                { at: OLDEST_WAIT_WARN_MS, label: 'warn at 24 h' },
                { at: ABANDONED_AFTER_MS, label: 'abandoned at 7 d' },
              ]}
              format={formatWaitDuration}
              startCaption={null}
              endCaption={null}
              emptyText="No agent or ask is waiting"
              {...(oldestTone !== undefined && { color: VX.status[oldestTone] })}
            />
          ),
        },
        fleetCell(fleet),
      ]}
    />
  )
}

function fleetCell(fleet: Props['fleet']): StatStripCell {
  if (fleet === null) {
    return {
      key: 'fleet',
      caption: 'Fleet',
      value: null,
      visual: (
        <Meter label="Agents by state" value={null} emptyText="No fleet data in this snapshot" />
      ),
    }
  }
  const { parts, total } = fleet
  return {
    key: 'fleet',
    caption: `Fleet · ${total} agents`,
    value: String(parts[0]?.value ?? 0),
    unit: `working of ${total}`,
    visual: (
      <Meter
        label="Agents by state"
        max={total || 1}
        segments={parts
          .filter((p) => p.value > 0)
          .map((p) => ({ value: p.value, label: p.label, color: FLEET_COLOR[p.key] }))}
        startCaption={null}
      />
    ),
  }
}
