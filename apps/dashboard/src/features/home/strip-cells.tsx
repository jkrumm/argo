import { Text } from '@mantine/core'
import { AgentsBand, DayAxis } from './strip-visuals'
import { Meter } from 'basalt-ui'
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
  type AcwrReading,
  type Meeting,
  type RecoveryReading,
} from './model'
import type { StripCellModel } from './today-strip'

const EM_DASH = '—'
const HISTORY_HOURS = 24
/** The budget track runs past the cap so an overrun is visible; the tick marks the cap itself. */
const BUDGET_HEADROOM = 1.25
/** A reading that is not a verdict: `Meter`'s neutral fill (`VX.line`) is near-white in dark mode. */
const MUTED_FILL = alpha(VX.muted, 0.35)

const clock = (ms: number) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(ms)

// ── Agents working ───────────────────────────────────────────────────────────────────────────

export function agentsCell(
  summary: OverviewSummary | undefined,
  total: number | null,
  history: HistoryPoint[] | undefined,
  now: number,
): StripCellModel {
  const working = summary?.working
  const peak = peakWorking(hourlyWorking(history, HISTORY_HOURS, now))
  return {
    id: 'agents',
    caption: 'Agents working · 24 h',
    value: typeof working === 'number' ? String(working) : EM_DASH,
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
): StripCellModel {
  const dispatch = deriveBudget(budget)[0]
  const used = dispatch?.used ?? null
  const max = dispatch?.max ?? null
  return {
    id: 'budget',
    caption: 'Dispatch · today',
    value: used === null ? EM_DASH : String(used),
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
          color={dispatch?.warn ? VX.warn : MUTED_FILL}
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
  agenda: { meetings: readonly Meeting[] } | null,
  next: Meeting | null,
  now: number,
): StripCellModel {
  if (agenda === null) {
    return {
      id: 'meeting',
      caption: 'Next meeting',
      value: EM_DASH,
      footer: 'calendar unavailable',
    }
  }
  if (agenda.meetings.length === 0) {
    return { id: 'meeting', caption: 'Next meeting', value: EM_DASH, footer: 'No meetings today.' }
  }
  const remaining = agenda.meetings.filter((m) => m.startMs > now).length
  const current = agenda.meetings.find((m) => meetingState(m, now) === 'now')
  return {
    id: 'meeting',
    caption: next === null ? 'Next meeting' : `Next meeting · ${clock(next.startMs)}`,
    value:
      next === null
        ? current === undefined
          ? EM_DASH
          : 'now'
        : countdownLabel(next.startMs - now),
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

export function recoveryCell(reading: RecoveryReading | null): StripCellModel {
  if (reading === null || reading.score === null) {
    return {
      id: 'recovery',
      caption: 'Recovery · today',
      value: EM_DASH,
      footer: reading === null ? 'unavailable' : 'not measured yet today',
    }
  }
  const { score, mean, days, trend, date, isToday } = reading
  return {
    id: 'recovery',
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
          {...(mean !== null && { target: mean })}
          format={(v) => String(Math.round(v))}
          startCaption={null}
          endCaption={mean === null ? null : `7 d mean ${Math.round(mean)}`}
          color={MUTED_FILL}
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

export function acwrCell(reading: AcwrReading | null): StripCellModel {
  if (reading === null || reading.acwr === null) {
    return {
      id: 'acwr',
      caption: 'ACWR · 7 d / 28 d',
      value: EM_DASH,
      footer: reading === null ? 'unavailable' : 'no training load measured',
    }
  }
  return {
    id: 'acwr',
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
