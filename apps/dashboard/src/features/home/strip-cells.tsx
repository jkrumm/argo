import { NBSP, glue, withUnit } from '../../lib/format'
import { Box, Text } from '@mantine/core'
import { DayAxis } from './strip-visuals'
import { Meter, type StatStripCell } from 'basalt-ui'
import { Sparkline } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import type { OverviewSummary } from '../../lib/queries/agents'
import type { WardenBudget } from '../../lib/queries/warden'
import { clockOf, noSnapshotText, type FleetPart } from '../agents/model'
import { FLEET_COLOR } from '../agents/fleet-strip'
import {
  ACWR_CAUTION_TO,
  ACWR_FLOOR,
  ACWR_METER_MAX,
  ACWR_OPTIMAL_TO,
  cadenceGap,
  chartEmpty,
  gapLine,
  plainGap,
  recoveryGap,
  type Gap,
  type GapForm,
} from '../garmin-health/model'
import { recoveryMeterProps } from '../garmin-health/recovery-meter'
import { acwrMeterZones, acwrZoneLabel } from '../garmin-health/formulas'
import {
  BUDGET_MISSING,
  BUDGET_NO_SNAPSHOT,
  deriveBudget,
  pollerAgeText,
} from '../warden/page-model'
import {
  countdownLabel,
  localKey,
  meetingState,
  classLabels,
  shortMeetingName,
  type Agenda,
  type LaterMeeting,
  weekdayTime,
  type AcwrReading,
  type Meeting,
  type RecoveryReading,
  recoveryFooter,
} from './model'
import classes from './home.module.css'

/** The budget track runs past the cap so an overrun is visible; the tick marks the cap itself. */
const BUDGET_HEADROOM = 1.25
/** The recovery sparkline's ink: a trend, not a verdict (`Meter` has `tone="muted"` for its own fill). */
const MUTED_FILL = alpha(VX.muted, 0.35)

// ── Agents working ───────────────────────────────────────────────────────────────────────────

export function agentsCell(
  summary: OverviewSummary | undefined,
  fleet: { parts: FleetPart[]; total: number } | null,
  /** The overview feed itself: `none` = nothing pushed yet, `failed` = the read failed, `null` = a snapshot exists. */
  feed: 'none' | 'failed' | null = null,
): StatStripCell {
  const working = summary?.working
  if (fleet === null) {
    return {
      key: 'agents',
      caption: 'Agents working · now',
      value: null,
      state: {
        kind: 'empty',
        reason:
          feed === 'none'
            ? noSnapshotText()
            : feed === 'failed'
              ? 'Agents failed to load — reload to retry'
              : 'No fleet counts in this snapshot',
      },
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

/** The Warden read as the cell sees it: a snapshot, or why there is none (`sourceStatus`). */
export type WardenFeed = 'ready' | 'loading' | 'failed' | 'no-snapshot'

/** What the budget meter's slot says when there is no meter: the feed's own gap, else the budget's. */
const budgetGap = (feed: WardenFeed): string =>
  feed === 'no-snapshot'
    ? BUDGET_NO_SNAPSHOT
    : feed === 'failed'
      ? 'Warden failed to load — reload to retry'
      : feed === 'loading'
        ? 'Loading'
        : BUDGET_MISSING.short

type Poller = { name: string; ageMin: number; stale: boolean } | undefined

/** The cell shows its worded reason in the value's place: no count to show and the feed is not still loading. */
const budgetIsEmpty = (budget: WardenBudget | undefined, feed: WardenFeed): boolean =>
  (deriveBudget(budget)[0]?.used ?? null) === null && feed !== 'loading'

const pollerFact = (poller: Poller) => (
  <Text span size="sm" c={poller?.stale ? VX.status.warn : 'dimmed'}>
    {poller === undefined ? 'poller age unknown' : pollerAgeText(poller)}
  </Text>
)

export function budgetCell(
  budget: WardenBudget | undefined,
  poller: Poller,
  feed: WardenFeed,
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
      ) : used === null && feed === 'loading' ? (
        <Text size="sm" c="dimmed">
          {budgetGap(feed)}
        </Text>
      ) : undefined,
    // A cell with no count keeps the figure slot (`—`, like the Warden strip's not-reported cells) and
    // the reason rides its footer, so the strip's rows align. With no budget and no poller there is no
    // snapshot: the reason alone says what to wait for. A known count with no usable cap keeps its
    // value and says the cap is missing.
    ...(budgetIsEmpty(budget, feed)
      ? {
          footer: (
            <>
              <Text span size="sm" c="dimmed">
                {budgetGap(feed)}
              </Text>
              {feed !== 'no-snapshot' && (poller !== undefined || budget !== undefined) ? (
                <> {pollerFact(poller)}</>
              ) : null}
            </>
          ),
        }
      : (poller !== undefined || budget !== undefined) && {
          footer: (
            <>
              {used !== null && !(max !== null && max > 0) ? (
                <Text span size="sm" c="dimmed">
                  {BUDGET_MISSING.short}{' '}
                </Text>
              ) : null}
              {pollerFact(poller)}
            </>
          ),
        }),
  }
}

/** `{name} · {fact}`: which meeting the cell is about, in its shortest form; the fact alone with no name. */
const withName = (title: string, fact: string): string => {
  const name = shortMeetingName(title)
  return name === null ? fact : `${name}${NBSP}·${NBSP}${fact}`
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
      state: { kind: 'empty', reason: 'calendar unavailable' },
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
      state: {
        kind: 'empty',
        reason:
          agenda.unavailable.length === 0
            ? 'None in 7 days'
            : `None today · ${classLabels(agenda.unavailable)} unavailable`,
      },
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
        : withName(next.title, `${remaining}${NBSP}remaining`),
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

/** The pre-sync gap in Garmin Health's wording, from its one function (`recoveryGap`), verbatim. */
function noScoreGap(
  { date, last }: RecoveryReading,
  { settled, failed, windowDays }: SeriesState,
): Gap | null {
  return recoveryGap({
    date,
    settled,
    status: failed ? 'error' : 'success',
    last,
    ...(windowDays !== undefined && { windowDays }),
  }).line
}

/** The recovery series (source of the last scored day): settled on the window, or failed. */
export type SeriesState = { settled: boolean; failed: boolean; windowDays?: number }

/** What the recovery cell says without a score. Unsettled, no gap to state yet, only when a score can arrive. */
function noScoreCellGap(
  reading: RecoveryReading | null,
  loading: boolean,
  series: SeriesState,
): Gap {
  if (reading === null) {
    return plainGap(loading ? 'Loading Garmin data' : 'Garmin data not loaded; reload to retry')
  }
  return noScoreGap(reading, series) ?? cadenceGap
}

/** The recovery cell's gap for the screen's form allocation; `null` when the cell has a score. */
export const recoveryCellGap = (
  reading: RecoveryReading | null,
  loading: boolean,
  series: SeriesState,
): Gap | null =>
  reading !== null && reading.score !== null ? null : noScoreCellGap(reading, loading, series)

/** `today` only for today's own score; a previous figure names its own day, a figureless cell none. */
export function recoveryCaption({
  score,
  isToday,
  date,
  last,
}: Pick<RecoveryReading, 'score' | 'isToday' | 'date' | 'last'>): string {
  if (score !== null) {
    if (isToday) return 'Recovery · today'
    return `Recovery · ${recoveryDay(date)}`
  }
  if (last !== null) return `Recovery · ${recoveryDay(last.date)}`
  return 'Recovery'
}

/** The pre-sync fact the tile's figures cannot state: they show a previous day, and today has no score yet. */
const TODAY_UNSCORED = glue('No score for today yet')

/** The gap clause for the recovery footer: none with today's score; in the pre-sync gap the tile already prints the last score and its day, so only "today is unscored" and the cadence are left to say. */
function recoveryFooterGap(
  reading: RecoveryReading,
  gap: ReturnType<typeof noScoreCellGap>,
  form: GapForm,
): string | undefined {
  if (reading.score !== null) return undefined
  if (reading.last !== null && gap.full !== null) return `${TODAY_UNSCORED} — ${cadenceGap.short}`
  return gapLine(gap, form)
}

/** `loading` is the query still pending: a missing reading then is not yet a failure. */
export function recoveryCell(
  reading: RecoveryReading | null,
  loading: boolean,
  series: SeriesState,
  /** Which form of the Garmin gap this cell prints: the screen's one full form goes to the first gapped surface. */
  form: GapForm,
): StatStripCell {
  // A figure is today's score or, in the pre-sync gap, the last scored day's; a trend or mean alone cannot show one.
  const shown = reading === null ? null : (reading.score ?? reading.last?.value ?? null)
  const gap = noScoreCellGap(reading, loading, series)
  if (reading === null || shown === null) {
    const line = gapLine(gap, form)
    return {
      key: 'recovery',
      caption: 'Recovery · today',
      value: null,
      ...(reading === null && loading
        ? { footer: line }
        : { state: { kind: 'empty' as const, reason: line } }),
    }
  }
  const { trend } = reading
  const hasTrend = trend.length > 1
  const footerGap = recoveryFooterGap(reading, gap, form)
  return {
    key: 'recovery',
    caption: recoveryCaption(reading),
    value: String(Math.round(shown)),
    unit: '/100',
    visual: (
      <Box className={classes.composite}>
        <Meter
          {...recoveryMeterProps(shown)}
          value={Math.round(shown)}
          format={(v) => String(Math.round(v))}
        />
        {hasTrend ? (
          <Sparkline
            ariaLabel={`Recovery over the last ${trend.length} observed days`}
            data={trend}
            height={28}
            color={MUTED_FILL}
            emphasizeLast
          />
        ) : null}
      </Box>
    ),
    // Broken evenly, so the narrow footer splits between its phrases and never strands a word.
    footer: <span className={classes.balanced}>{recoveryFooter(reading, footerGap)}</span>,
  }
}

// ── Training load ────────────────────────────────────────────────────────────────────────────

/** What the load cell says without a ratio; `null` when it has one. */
export function acwrCellGap(
  reading: AcwrReading | null,
  /** The load read when there is no reading: still pending, or failed. */
  feed: 'loading' | 'error',
  /** The window the load was read over, for the settled-but-empty wording (Garmin's, one function). */
  windowDays: number,
  /** The reading is the previous window's while this one loads: no gap to state yet. */
  placeholder: boolean,
): Gap | null {
  if (reading !== null && reading.acwr !== null) return null
  if (reading === null) {
    return plainGap(
      feed === 'loading'
        ? 'loading training load'
        : 'training load failed to load; reload to retry',
    )
  }
  return placeholder ? plainGap('loading training load') : chartEmpty('training load', windowDays)
}

export function acwrCell(
  reading: AcwrReading | null,
  now: number,
  feed: 'loading' | 'error',
  windowDays: number,
  placeholder: boolean,
  /** Which form of the Garmin gap this cell prints: the screen's one full form goes to the first gapped surface. */
  form: GapForm,
): StatStripCell {
  const gap = acwrCellGap(reading, feed, windowDays, placeholder)
  const loadingGap = reading === null ? feed === 'loading' : placeholder
  if (reading === null || reading.acwr === null) {
    return {
      key: 'acwr',
      caption: `Training load · ${withUnit(7, 'd')} / ${withUnit(28, 'd')}`,
      value: null,
      ...(gap !== null &&
        (loadingGap
          ? { footer: gapLine(gap, form) }
          : { state: { kind: 'empty' as const, reason: gapLine(gap, form) } })),
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
