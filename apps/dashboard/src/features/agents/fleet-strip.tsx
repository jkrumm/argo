import { alpha, VX } from 'basalt-ui/tokens'
import { Meter, StatGroup, type StatStripCell } from 'basalt-ui'
import {
  ABANDONED_AFTER_MS,
  fleetFact,
  itemNoun,
  formatWaitDuration,
  OLDEST_WAIT_WARN_MS,
  type FleetPart,
  type FleetState,
  type OldestWait,
} from './model'

/** Neutral ink at stepped strengths for the calm states; a hue only for needs-you and stale. */
export const FLEET_COLOR: Record<FleetState, string> = {
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
  /** The count split by kind (`2 agents · 1 ask`); `''` when nothing waits. */
  split: string
  oldest: OldestWait | null
  /** Longest-running working agent; `null` when none is working. */
  longestRunMs: number | null
}

function waitTone(ms: number): 'bad' | 'warn' | undefined {
  if (ms > ABANDONED_AFTER_MS) return 'bad'
  if (ms > OLDEST_WAIT_WARN_MS) return 'warn'
  return undefined
}

/**
 * The three joined cells under the page summary: needs-you count, oldest wait against its two
 * thresholds, fleet by state. Replaces the three bare-integer tiles.
 */
export function FleetStrip({ needsYou, fleet, split, oldest, longestRunMs }: Props) {
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
          ...(needsYou !== null && { unit: `${itemNoun(needsYou)} waiting` }),
          ...(needsYou !== null && needsYou > 0 && { tone: 'warn' as const }),
          ...(split !== '' && { footer: split }),
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
                { at: OLDEST_WAIT_WARN_MS, label: 'warn at 24\u00a0h' },
                { at: ABANDONED_AFTER_MS, label: 'abandoned at 7\u00a0d' },
              ]}
              format={formatWaitDuration}
              startCaption={null}
              endCaption={null}
              emptyText="No agent or ask is waiting"
              {...(oldestTone !== undefined && { color: VX.status[oldestTone] })}
            />
          ),
        },
        fleetCell(fleet, longestRunMs),
      ]}
    />
  )
}

function fleetCell(fleet: Props['fleet'], longestRunMs: number | null): StatStripCell {
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
    footer: fleetFact(longestRunMs, parts[0]?.value ?? 0),
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
