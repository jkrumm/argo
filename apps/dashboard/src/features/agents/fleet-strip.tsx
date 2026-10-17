import { Flex, Group, Text } from '@mantine/core'
import { Sparkline } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import { Meter } from 'basalt-ui'
import type { HistoryPoint, OverviewSummary } from '../../lib/queries/agents'
import {
  ABANDONED_AFTER_MS,
  ageAgo,
  fleetParts,
  formatWaitDuration,
  OLDEST_WAIT_WARN_MS,
  peakNeedsYou,
  trendSeries,
  type FleetState,
  type OldestWait,
} from './model'
import { Dot } from './status-chip'
import { StatStrip } from './stat-strip'

/** Neutral ink at stepped strengths for the calm states; a hue only for needs-you and stale. */
const FLEET_COLOR: Record<FleetState, string> = {
  working: VX.line,
  needs_you: VX.status.bad,
  idle: alpha(VX.line, 0.55),
  stale: VX.status.warn,
  done: alpha(VX.line, 0.28),
}

type Props = {
  summary: OverviewSummary | undefined
  history: HistoryPoint[] | undefined
  hours: number
  oldest: OldestWait | null
  /** Human-queue asks, which the agent count does not include. */
  queued: number
  now: number
}

function waitTone(ms: number): string | undefined {
  if (ms > ABANDONED_AFTER_MS) return VX.status.bad
  if (ms > OLDEST_WAIT_WARN_MS) return VX.status.warn
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

function peakFooter(
  history: HistoryPoint[] | undefined,
  hours: number,
  now: number,
  queued: number,
): string {
  const peak = peakNeedsYou(history)
  const trend =
    peak === null
      ? `no data in ${hours} h`
      : peak.value === 0
        ? `none in ${hours} h`
        : `peak ${peak.value} in ${hours} h`
  if (queued > 0) return `+${queued} queued · ${trend}`
  return peak !== null && peak.value > 0 ? `${trend} · ${ageAgo(now - peak.atMs)}` : trend
}

/**
 * The three joined cells under the page summary: needs-you trend, oldest wait against its two
 * thresholds, fleet by state. Replaces the three bare-integer tiles.
 */
export function FleetStrip({ summary, history, hours, oldest, queued, now }: Props) {
  const needsYou = summary?.needsYou
  const { parts, total } = fleetParts(summary)
  const working = parts[0]?.value ?? 0
  const oldestTone = oldest === null ? undefined : waitTone(oldest.ms)

  return (
    <StatStrip
      label="Agent fleet"
      cells={[
        {
          caption: 'Needs you · now',
          value: needsYou === undefined ? '—' : String(needsYou),
          ...(needsYou !== undefined && { unit: needsYou === 1 ? 'agent' : 'agents' }),
          ...(needsYou !== undefined && needsYou > 0 && { tone: VX.status.warn }),
          visual: <NeedsYouVisual history={history} hours={hours} />,
          footer: peakFooter(history, hours, now, queued),
        },
        {
          caption: oldest === null ? 'Oldest wait' : `Oldest wait · ${oldest.project}`,
          value: oldest === null ? 'None' : formatWaitDuration(oldest.ms),
          ...(oldest === null && { unit: 'agents waiting' }),
          ...(oldestTone !== undefined && { tone: oldestTone }),
          visual: (
            <Meter
              label="Oldest agent wait against the 24 h and 7 d marks"
              value={oldest?.ms ?? 0}
              max={ABANDONED_AFTER_MS}
              target={OLDEST_WAIT_WARN_MS}
              format={formatWaitDuration}
              startCaption="warn at 24 h"
              endCaption="abandoned at 7 d"
              {...(oldestTone !== undefined && { color: oldestTone })}
            />
          ),
        },
        {
          caption: `Fleet · ${total} agents`,
          value: String(working),
          unit: `working of ${total}`,
          visual: (
            <Meter
              label="Agents by state"
              max={total || 1}
              segments={parts.map((p) => ({
                value: p.value,
                label: p.label,
                color: FLEET_COLOR[p.key],
              }))}
              startCaption={null}
              endCaption={null}
              emptyText="No agents reported"
            />
          ),
          footer: (
            <Flex gap="xs" wrap="wrap">
              {parts
                .filter((p) => p.value > 0)
                .map((p) => (
                  <Group key={p.key} gap={4} wrap="nowrap">
                    <Dot color={FLEET_COLOR[p.key]} />
                    <Text size="sm" ff="monospace" c="dimmed" span>
                      {p.value} {p.label}
                    </Text>
                  </Group>
                ))}
            </Flex>
          ),
        },
      ]}
    />
  )
}
