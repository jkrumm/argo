import { Text } from '@mantine/core'
import { AgentsBand, DayAxis } from './strip-visuals'
import { Meter, type StatStripCell } from 'basalt-ui'
import { Sparkline } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import type { HistoryPoint, OverviewSummary } from '../../lib/queries/agents'
import type { WardenBudget } from '../../lib/queries/warden'
import { hourlyWorking, peakWorking } from '../agents/model'
import {
  ACWR_CAUTION_TO,
  ACWR_FLOOR,
  ACWR_METER_MAX,
  ACWR_OPTIMAL_TO,
} from '../garmin-health/model'
import { deriveBudget } from '../warden/page-model'
import {
  countdownLabel,
  meetingState,
  noMeetingsLabel,
  type Agenda,
  type LaterMeeting,
  weekdayTime,
  type AcwrReading,
  type Meeting,
  type RecoveryReading,
} from './model'

const HISTORY_HOURS = 24
/** The budget track runs past the cap so an overrun is visible; the tick marks the cap itself. */
const BUDGET_HEADROOM = 1.25
/** The recovery sparkline's ink: a trend, not a verdict (`Meter` has `tone="muted"` for its own fill). */
const MUTED_FILL = alpha(VX.muted, 0.35)

const clock = (ms: number) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(ms)

// ── Agents working ───────────────────────────────────────────────────────────────────────────

export function agentsCell(
  summary: OverviewSummary | undefined,
  total: number | null,
  history: HistoryPoint[] | undefined,
  now: number,
): StatStripCell {
  const working = summary?.working
  const peak = peakWorking(hourlyWorking(history, HISTORY_HOURS, now))
  return {
    key: 'agents',
    caption: 'Agents working · 24 h',
    value: typeof working === 'number' ? String(working) : null,
    ...(typeof working === 'number' && total !== null && { unit: `of ${total} agents` }),
    visual: <AgentsBand history={history} fleetSize={total} now={now} />,
    footer:
      peak === null
        ? 'no snapshot in 24 h'
        : `peak ${peak.value}${total === null ? '' : ` of ${total}`} at ${clock(peak.hourMs)} · shade is share of the fleet`,
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
          Dispatch budget not reported by Warden
        </Text>
      ),
    footer: (
      <Text span size="sm" c={poller?.stale ? VX.status.warn : 'dimmed'}>
        {poller === undefined
          ? 'poller age unknown'
          : `${poller.name.replaceAll('_', ' ')} ${Math.round(poller.ageMin)} min since last run`}
      </Text>
    ),
  }
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
        footer: (
          <>
            <Text size="sm" lineClamp={2}>
              {later.title}
            </Text>
            {countdownLabel(later.startMs - now)}
          </>
        ),
      }
    }
    return {
      key: 'meeting',
      caption: 'Next meeting',
      value: null,
      footer:
        agenda.unavailable.length === 0 ? 'none in the next 7 days' : `${noMeetingsLabel(agenda)}.`,
    }
  }
  const remaining = agenda.meetings.filter((m) => m.startMs > now).length
  const current = agenda.meetings.find((m) => meetingState(m, now) === 'now')
  return {
    key: 'meeting',
    caption: next === null ? 'Next meeting' : `Next meeting · ${clock(next.startMs)}`,
    value:
      next === null ? (current === undefined ? null : 'now') : countdownLabel(next.startMs - now),
    visual: <DayAxis meetings={agenda.meetings} next={next} now={now} />,
    footer:
      next === null ? (
        current === undefined ? (
          'no more meetings today'
        ) : (
          `in a meeting until ${clock(current.endMs)}`
        )
      ) : (
        <>
          <Text size="sm" lineClamp={2}>
            {next.title}
          </Text>
          {remaining} remaining today
        </>
      ),
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

export function recoveryCell(reading: RecoveryReading | null): StatStripCell {
  if (reading === null || reading.score === null) {
    return {
      key: 'recovery',
      caption: 'Recovery · today',
      value: null,
      footer: reading === null ? 'unavailable' : 'not measured yet today',
    }
  }
  const { score, mean, days, trend, date, isToday } = reading
  return {
    key: 'recovery',
    caption: isToday ? 'Recovery · today' : `Recovery · ${recoveryDay(date)}`,
    value: String(Math.round(score)),
    unit: '/100',
    visual: (
      <>
        <Meter
          label="Recovery against its 7 day mean"
          value={score}
          min={0}
          max={100}
          {...(mean !== null && { ticks: [{ at: mean, label: `7 d mean ${Math.round(mean)}` }] })}
          format={(v) => String(Math.round(v))}
          startCaption={null}
          endCaption={null}
          tone="muted"
        />
        {trend.length > 1 ? (
          <Sparkline
            ariaLabel={`Recovery over the last ${trend.length} measured days`}
            data={trend}
            height={28}
            color={MUTED_FILL}
            emphasizeLast
          />
        ) : null}
      </>
    ),
    footer: isToday
      ? `${days} measured ${days === 1 ? 'day' : 'days'} of 7`
      : 'not scored yet today',
  }
}

// ── Training load ────────────────────────────────────────────────────────────────────────────

export function acwrCell(reading: AcwrReading | null): StatStripCell {
  if (reading === null || reading.acwr === null) {
    return {
      key: 'acwr',
      caption: 'ACWR · 7 d / 28 d',
      value: null,
      footer: reading === null ? 'unavailable' : 'no training load measured',
    }
  }
  return {
    key: 'acwr',
    caption: 'ACWR · 7 d / 28 d',
    value: reading.acwr.toFixed(2),
    ...(reading.zone !== null && { unit: reading.zone }),
    visual: (
      <Meter
        label="Acute to chronic workload ratio"
        value={reading.acwr}
        min={0}
        max={ACWR_METER_MAX}
        format={(v) => v.toFixed(2)}
        zones={[
          { from: 0, to: ACWR_FLOOR, label: 'Under', color: VX.warn },
          { from: ACWR_FLOOR, to: ACWR_OPTIMAL_TO, label: 'Optimal', color: VX.good },
          { from: ACWR_OPTIMAL_TO, to: ACWR_CAUTION_TO, label: 'Caution', color: VX.warn },
          { from: ACWR_CAUTION_TO, to: ACWR_METER_MAX, label: 'Danger', color: VX.bad },
        ]}
        startCaption={null}
        endCaption={null}
      />
    ),
    footer: `acute ÷ chronic load · optimal ${ACWR_FLOOR}–${ACWR_OPTIMAL_TO}`,
  }
}
