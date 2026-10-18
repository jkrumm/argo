import { withUnit } from '../../lib/format'
import { Text } from '@mantine/core'
import { DayAxis } from './strip-visuals'
import { Meter, type StatStripCell } from 'basalt-ui'
import { Sparkline } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import type { OverviewSummary } from '../../lib/queries/agents'
import type { WardenBudget } from '../../lib/queries/warden'
import { clockOf, type FleetPart } from '../agents/model'
import { FLEET_COLOR } from '../agents/fleet-strip'
import {
  ACWR_CAUTION_TO,
  ACWR_FLOOR,
  ACWR_METER_MAX,
  ACWR_OPTIMAL_TO,
  recoveryGap,
} from '../garmin-health/model'
import { recoveryMeterProps } from '../garmin-health/recovery-meter'
import { acwrMeterZones, acwrZoneLabel } from '../garmin-health/formulas'
import { BUDGET_MISSING, deriveBudget, pollerAgeText } from '../warden/page-model'
import {
  countdownLabel,
  localKey,
  meetingState,
  classLabels,
  shortMeetingName,
  GARMIN_SYNC_HOURS,
  type Agenda,
  type LaterMeeting,
  weekdayTime,
  type AcwrReading,
  type Meeting,
  type RecoveryReading,
  recoveryFooter,
} from './model'

/** The budget track runs past the cap so an overrun is visible; the tick marks the cap itself. */
const BUDGET_HEADROOM = 1.25
/** The recovery sparkline's ink: a trend, not a verdict (`Meter` has `tone="muted"` for its own fill). */
const MUTED_FILL = alpha(VX.muted, 0.35)

// ── Agents working ───────────────────────────────────────────────────────────────────────────

export function agentsCell(
  summary: OverviewSummary | undefined,
  fleet: { parts: FleetPart[]; total: number } | null,
): StatStripCell {
  const working = summary?.working
  if (fleet === null) {
    return {
      key: 'agents',
      caption: 'Agents working · now',
      value: null,
      visual: (
        <Meter label="Agents by state" value={null} emptyText="No fleet data in this snapshot" />
      ),
    }
  }
  return {
    key: 'agents',
    caption: 'Agents working · now',
    value: typeof working === 'number' ? String(working) : null,
    ...(typeof working === 'number' && {
      unit: `of ${fleet.total} ${fleet.total === 1 ? 'agent' : 'agents'}`,
    }),
    visual: (
      <Meter
        label="Agents by state"
        max={fleet.total || 1}
        segments={fleet.parts
          .filter((p) => p.value > 0)
          .map((p) => ({ value: p.value, label: p.label, color: FLEET_COLOR[p.key] }))}
        startCaption={null}
      />
    ),
  }
}

// ── Dispatch budget ──────────────────────────────────────────────────────────────────────────

export function budgetCell(
  budget: WardenBudget | undefined,
  poller: { name: string; ageMin: number; stale: boolean } | undefined,
): StatStripCell {
  const dispatch = deriveBudget(budget)[0]
  const used = dispatch?.used ?? null
  const max = dispatch?.max ?? null
  return {
    key: 'budget',
    caption: 'Dispatch · today',
    value: used === null ? null : String(used),
    ...(max !== null && { unit: `/ ${max}` }),
    visual:
      used !== null && max !== null && max > 0 ? (
        <Meter
          label="Dispatches today against the daily cap"
          value={used}
          max={max * BUDGET_HEADROOM}
          target={max}
          format={(v) => String(Math.round(v))}
          startCaption={null}
          endCaption={`cap ${max}`}
          {...(dispatch?.warn ? { color: VX.warn } : { tone: 'muted' as const })}
        />
      ) : (
        <Text size="sm" c="dimmed">
          {BUDGET_MISSING.short}
        </Text>
      ),
    footer: (
      <Text span size="sm" c={poller?.stale ? VX.status.warn : 'dimmed'}>
        {poller === undefined ? 'poller age unknown' : pollerAgeText(poller)}
      </Text>
    ),
  }
}

/** `{name} · {fact}`: which meeting the cell is about, in its shortest form; the fact alone with no name. */
const withName = (title: string, fact: string): string => {
  const name = shortMeetingName(title)
  return name === null ? fact : `${name} · ${fact}`
}

// ── Next meeting ─────────────────────────────────────────────────────────────────────────────

export function meetingCell(
  agenda: Pick<Agenda, 'meetings' | 'loaded' | 'unavailable'> | null,
  next: Meeting | null,
  later: LaterMeeting | null,
  now: number,
): StatStripCell {
  if (agenda === null) {
    return {
      key: 'meeting',
      caption: 'Next meeting',
      value: null,
      footer: 'calendar unavailable',
    }
  }
  if (agenda.meetings.length === 0) {
    // Nothing today: say when the next one is, from the 7 days Calendar already fetched.
    if (agenda.unavailable.length === 0 && later !== null) {
      return {
        key: 'meeting',
        caption: 'Next meeting',
        value: weekdayTime(later.startMs),
        footer: withName(later.title, countdownLabel(later.startMs - now)),
      }
    }
    return {
      key: 'meeting',
      caption: 'Next meeting',
      value: null,
      footer:
        agenda.unavailable.length === 0
          ? 'none in 7 days'
          : `none today · ${classLabels(agenda.unavailable)} unavailable`,
    }
  }
  const remaining = agenda.meetings.filter((m) => m.startMs > now).length
  const current = agenda.meetings.find((m) => meetingState(m, now) === 'now')
  return {
    key: 'meeting',
    caption: next === null ? 'Next meeting' : `Next meeting · ${clockOf(next.startMs)}`,
    value:
      next === null ? (current === undefined ? null : 'now') : countdownLabel(next.startMs - now),
    visual: <DayAxis meetings={agenda.meetings} next={next} now={now} />,
    footer:
      next === null
        ? current === undefined
          ? 'no more meetings today'
          : `in a meeting until ${clockOf(current.endMs)}`
        : withName(next.title, `${remaining} remaining`),
  }
}

// ── Recovery ─────────────────────────────────────────────────────────────────────────────────

/** `Fri 16 Oct` for a `YYYY-MM-DD` score day; `last scored day` when the snapshot names none. */
function recoveryDay(date: string | null): string {
  if (date === null) return 'last scored day'
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(y, m - 1, d))
    .replace(',', '')
}

/** The pre-sync gap in Garmin Health's wording, from its one function (`recoveryGap`), lower-cased for a footer. */
function noScoreLine(
  { date, last }: RecoveryReading,
  { settled, failed }: SeriesState,
): string | null {
  const { line } = recoveryGap({ date, settled, status: failed ? 'error' : 'success', last })
  return line === null ? null : line.charAt(0).toLowerCase() + line.slice(1)
}

/** Whether the recovery series (the source of the last scored day) has settled on the window, or failed. */
export type SeriesState = { settled: boolean; failed: boolean }

/** `loading` is the query still pending: a missing reading then is not yet a failure. */
export function recoveryCell(
  reading: RecoveryReading | null,
  loading = false,
  series: SeriesState = { settled: true, failed: false },
): StatStripCell {
  if (reading === null || reading.score === null) {
    return {
      key: 'recovery',
      caption: 'Recovery · today',
      value: null,
      footer:
        reading === null
          ? loading
            ? 'loading Garmin data'
            : 'Garmin data not loaded; reload to retry'
          : [noScoreLine(reading, series), `Garmin syncs every ${withUnit(GARMIN_SYNC_HOURS, 'h')}`]
              .filter((part) => part !== null)
              .join(' · '),
    }
  }
  const { score, trend, date, isToday } = reading
  return {
    key: 'recovery',
    caption: isToday ? 'Recovery · today' : `Recovery · ${recoveryDay(date)}`,
    value: String(Math.round(score)),
    unit: '/100',
    visual: (
      <>
        <Meter
          {...recoveryMeterProps(score)}
          value={Math.round(score)}
          format={(v) => String(Math.round(v))}
        />
        {trend.length > 1 ? (
          <Sparkline
            ariaLabel={`Recovery over the last ${trend.length} observed days`}
            data={trend}
            height={28}
            color={MUTED_FILL}
            emphasizeLast
          />
        ) : null}
      </>
    ),
    footer: recoveryFooter(reading),
  }
}

// ── Training load ────────────────────────────────────────────────────────────────────────────

export function acwrCell(reading: AcwrReading | null, now: number): StatStripCell {
  if (reading === null || reading.acwr === null) {
    return {
      key: 'acwr',
      caption: `Training load · ${withUnit(7, 'd')} / ${withUnit(28, 'd')}`,
      value: null,
      footer: reading === null ? 'unavailable' : 'no training load observed',
    }
  }
  return {
    key: 'acwr',
    caption: `Training load · ${withUnit(7, 'd')} / ${withUnit(28, 'd')}`,
    value: reading.acwr.toFixed(2),
    ...(reading.zone !== null && { unit: acwrZoneLabel(reading.zone) }),
    visual: (
      <Meter
        label="Acute to chronic workload ratio"
        value={reading.acwr}
        min={0}
        max={ACWR_METER_MAX}
        format={(v) => v.toFixed(2)}
        zones={acwrMeterZones({
          floor: ACWR_FLOOR,
          optimalTo: ACWR_OPTIMAL_TO,
          cautionTo: ACWR_CAUTION_TO,
          max: ACWR_METER_MAX,
        })}
        startCaption={null}
        endCaption={null}
      />
    ),
    footer: `range ${ACWR_FLOOR}–${ACWR_OPTIMAL_TO}${
      reading.date === null || reading.date === localKey(now)
        ? ''
        : ` · ${recoveryDay(reading.date)}`
    }`,
  }
}
