import { formatDuration, withUnit } from '../../lib/format'
import { alpha, VX } from 'basalt-ui/tokens'
import { Meter, StatGroup, type StatStripCell } from 'basalt-ui'
import {
  ABANDONED_AFTER_MS,
  fleetFact,
  itemNoun,
  OLDEST_WAIT_WARN_MS,
  oldestWaitEmptyText,
  oldestWaitFooter,
  NO_SNAPSHOT_SHORT,
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

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

type Props = {
  /** Items the Needs-you section renders: agents plus human-queue asks. `null` when unknown. */
  needsYou: number | null
  fleet: { parts: FleetPart[]; total: number } | null
  /** The count split by kind (`2 agents · 1 ask`); `''` when nothing waits. */
  split: string
  oldest: OldestWait | null
  /** An overview snapshot has arrived; without one the cells wait for it. */
  hasSnapshot: boolean
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
export function FleetStrip({ needsYou, fleet, split, oldest, hasSnapshot, longestRunMs }: Props) {
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
          footer: hasSnapshot ? split || undefined : NO_SNAPSHOT_SHORT,
        },
        {
          key: 'oldest-wait',
          caption: 'Oldest wait',
          value: oldest === null ? null : formatDuration(oldest.ms),
          ...(oldestTone !== undefined && { tone: oldestTone }),
          footer: oldestWaitFooter(hasSnapshot, oldest),
          // No snapshot: the waiting line is the footer (as in the needs-you cell), so no empty meter.
          // A snapshot with no wait to plot says why in the value's place.
          ...(hasSnapshot &&
            needsYou !== null &&
            oldest === null && {
              state: { kind: 'empty' as const, reason: oldestWaitEmptyText(needsYou) },
            }),
          visual:
            needsYou === null || oldest === null ? undefined : (
              <Meter
                label="Oldest agent wait against the warn and abandoned marks"
                value={oldest.ms}
                max={ABANDONED_AFTER_MS}
                ticks={[
                  {
                    at: OLDEST_WAIT_WARN_MS,
                    label: `warn at ${withUnit(OLDEST_WAIT_WARN_MS / HOUR_MS, 'h')}`,
                  },
                  {
                    at: ABANDONED_AFTER_MS,
                    label: `abandoned at ${withUnit(ABANDONED_AFTER_MS / DAY_MS, 'd')}`,
                  },
                ]}
                format={formatDuration}
                startCaption={null}
                endCaption={null}
                {...(oldestTone !== undefined && { color: VX.status[oldestTone] })}
              />
            ),
        },
        fleetCell(fleet, longestRunMs, hasSnapshot),
      ]}
    />
  )
}

function fleetCell(
  fleet: Props['fleet'],
  longestRunMs: number | null,
  /** A snapshot exists: a missing fleet then means it carried no counts, not that none has arrived. */
  hasSnapshot: boolean,
): StatStripCell {
  if (fleet === null) {
    return {
      key: 'fleet',
      caption: 'Fleet',
      value: null,
      state: {
        kind: 'empty',
        reason: hasSnapshot ? 'No fleet counts in this snapshot' : NO_SNAPSHOT_SHORT,
      },
    }
  }
  const { parts, total } = fleet
  return {
    key: 'fleet',
    caption: 'Fleet',
    value: String(parts[0]?.value ?? 0),
    unit: `working of ${total} ${total === 1 ? 'agent' : 'agents'}`,
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
