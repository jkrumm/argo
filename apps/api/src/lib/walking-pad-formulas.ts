// WalkingPad analytics + achievements engine.
//
// All functions are pure — they take rows and return derived numbers. The
// route layer owns DB I/O and is responsible for persisting any unlocked
// achievements via `walking_pad_achievements`.

export type WalkingPadSessionRow = {
  uuid: string
  started_at: string
  ended_at: string
  duration_s: number
  distance_m: number
  steps: number
  avg_speed_kmh: number
  max_speed_kmh: number
  kcal: number
  pause_count: number
}

// ── Achievement types ───────────────────────────────────────────────────────

export type WalkingPadAchievementType =
  | 'first_walk'
  | 'longest_duration'
  | 'longest_distance'
  | 'most_steps'
  | 'fastest_avg_speed'
  | 'multi_walk_day'
  | 'streak_3'
  | 'streak_7'
  | 'streak_14'
  | 'streak_30'
  | 'distance_milestone_10_km'
  | 'distance_milestone_50_km'
  | 'distance_milestone_100_km'
  | 'distance_milestone_250_km'
  | 'distance_milestone_500_km'
  | 'distance_milestone_1000_km'
  | 'weekly_distance_pr'

export const ACHIEVEMENT_TYPES: ReadonlyArray<WalkingPadAchievementType> = [
  'first_walk',
  'longest_duration',
  'longest_distance',
  'most_steps',
  'fastest_avg_speed',
  'multi_walk_day',
  'streak_3',
  'streak_7',
  'streak_14',
  'streak_30',
  'distance_milestone_10_km',
  'distance_milestone_50_km',
  'distance_milestone_100_km',
  'distance_milestone_250_km',
  'distance_milestone_500_km',
  'distance_milestone_1000_km',
  'weekly_distance_pr',
]

export type DetectedAchievement = {
  type: WalkingPadAchievementType
  session_uuid: string | null
  value: number
  title: string
  description: string
  confetti: boolean
}

export type PriorAchievement = {
  type: WalkingPadAchievementType
  value: number | null
  unlocked_at: string
}

const DISTANCE_MILESTONES_KM = [10, 50, 100, 250, 500, 1000] as const
const STREAK_THRESHOLDS = [3, 7, 14, 30] as const
const STREAK_TYPE_BY_LEN: Record<number, WalkingPadAchievementType> = {
  3: 'streak_3',
  7: 'streak_7',
  14: 'streak_14',
  30: 'streak_30',
}
const MILESTONE_TYPE_BY_KM: Record<number, WalkingPadAchievementType> = {
  10: 'distance_milestone_10_km',
  50: 'distance_milestone_50_km',
  100: 'distance_milestone_100_km',
  250: 'distance_milestone_250_km',
  500: 'distance_milestone_500_km',
  1000: 'distance_milestone_1000_km',
}

// Minimum session length to count toward streaks/PRs. Below this we treat the
// row as a noise/calibration tap (a few seconds of pacing test, etc.).
const MIN_SESSION_S = 60
const MIN_SESSION_M = 50
// Avg speed PRs require enough sample to be meaningful — otherwise a 30-second
// warm-up at 6 km/h becomes the "fastest" forever.
const FAST_AVG_MIN_M = 500

function dateUtcKey(iso: string): string {
  return iso.slice(0, 10)
}

function isRealSession(s: WalkingPadSessionRow): boolean {
  return s.duration_s >= MIN_SESSION_S && s.distance_m >= MIN_SESSION_M
}

// ── Public: detect achievements for one newly-upserted session ─────────────
//
// Caller passes the full history INCLUDING the new session (since the
// upsert is already committed when this runs). We split it back inside.

export function detectWalkingPadAchievements(
  newUuid: string,
  allSessions: WalkingPadSessionRow[],
  priorAchievements: ReadonlyArray<PriorAchievement>,
  now: Date = new Date(),
): DetectedAchievement[] {
  const incoming = allSessions.find((s) => s.uuid === newUuid)
  if (!incoming) return []
  if (!isRealSession(incoming)) return []

  const prior = allSessions.filter((s) => s.uuid !== newUuid && isRealSession(s))
  const realAll = allSessions.filter(isRealSession)
  const out: DetectedAchievement[] = []

  // Helpers over the prior achievement list.
  const maxValueOfType = (t: WalkingPadAchievementType): number => {
    let max = 0
    for (const a of priorAchievements) {
      if (a.type === t && a.value !== null && a.value > max) max = a.value
    }
    return max
  }
  const hasAnyOfType = (t: WalkingPadAchievementType): boolean =>
    priorAchievements.some((a) => a.type === t)
  const lastDateOfType = (t: WalkingPadAchievementType): string | null => {
    let latest: string | null = null
    for (const a of priorAchievements) {
      if (a.type === t && (latest === null || a.unlocked_at > latest)) latest = a.unlocked_at
    }
    return latest
  }

  // First walk — fires once ever.
  if (!hasAnyOfType('first_walk') && prior.length === 0) {
    out.push({
      type: 'first_walk',
      session_uuid: incoming.uuid,
      value: incoming.distance_m,
      title: 'First steps',
      description: `Logged your first WalkingPad session — ${(incoming.distance_m / 1000).toFixed(2)} km in ${Math.round(incoming.duration_s / 60)} min.`,
      confetti: true,
    })
  }

  // Per-session PRs — emit if incoming strictly beats the prior unlock value.
  // We compare against the stored achievement (not session history) because
  // the dashboard's mental model is the unlock event, not the raw row.
  const dur = incoming.duration_s
  const lastDur = maxValueOfType('longest_duration')
  if (dur > lastDur && dur > MIN_SESSION_S) {
    out.push({
      type: 'longest_duration',
      session_uuid: incoming.uuid,
      value: dur,
      title: 'New longest walk',
      description:
        lastDur > 0
          ? `${Math.round(dur / 60)} min — beat your previous best of ${Math.round(lastDur / 60)} min.`
          : `${Math.round(dur / 60)} min — longest walk so far.`,
      confetti: true,
    })
  }

  const dist = incoming.distance_m
  const lastDist = maxValueOfType('longest_distance')
  if (dist > lastDist) {
    out.push({
      type: 'longest_distance',
      session_uuid: incoming.uuid,
      value: dist,
      title: 'New distance PR',
      description:
        lastDist > 0
          ? `${(dist / 1000).toFixed(2)} km — beat your previous best of ${(lastDist / 1000).toFixed(2)} km.`
          : `${(dist / 1000).toFixed(2)} km — furthest single session so far.`,
      confetti: true,
    })
  }

  const steps = incoming.steps
  const lastSteps = maxValueOfType('most_steps')
  if (steps > lastSteps) {
    out.push({
      type: 'most_steps',
      session_uuid: incoming.uuid,
      value: steps,
      title: 'New step PR',
      description:
        lastSteps > 0
          ? `${steps.toLocaleString('en-US')} steps — past best ${lastSteps.toLocaleString('en-US')}.`
          : `${steps.toLocaleString('en-US')} steps in one session.`,
      confetti: true,
    })
  }

  if (incoming.distance_m >= FAST_AVG_MIN_M) {
    const lastFast = maxValueOfType('fastest_avg_speed')
    if (incoming.avg_speed_kmh > lastFast) {
      out.push({
        type: 'fastest_avg_speed',
        session_uuid: incoming.uuid,
        value: incoming.avg_speed_kmh,
        title: 'New pace PR',
        description:
          lastFast > 0
            ? `${incoming.avg_speed_kmh.toFixed(2)} km/h average — past best ${lastFast.toFixed(2)} km/h.`
            : `${incoming.avg_speed_kmh.toFixed(2)} km/h average.`,
        confetti: true,
      })
    }
  }

  // Multi-walk day — fires once per UTC date, the moment the day crosses 3+
  // real sessions. Dedup: skip if any prior `multi_walk_day` was unlocked on
  // this same UTC day.
  const todayKey = dateUtcKey(incoming.started_at)
  const sameDay = realAll.filter((s) => dateUtcKey(s.started_at) === todayKey)
  const lastMultiWalk = lastDateOfType('multi_walk_day')
  if (sameDay.length >= 3 && (lastMultiWalk === null || dateUtcKey(lastMultiWalk) !== todayKey)) {
    const sortedSameDay = sameDay.toSorted((a, b) => a.started_at.localeCompare(b.started_at))
    if (sortedSameDay[2]?.uuid === incoming.uuid) {
      out.push({
        type: 'multi_walk_day',
        session_uuid: incoming.uuid,
        value: sameDay.length,
        title: 'Triple-walk day',
        description: `Three walks today — total ${(sameDay.reduce((s, x) => s + x.distance_m, 0) / 1000).toFixed(2)} km.`,
        confetti: true,
      })
    }
  }

  // Streaks — re-emittable per streak instance. Dedup: don't fire the same
  // tier twice within the same anchor day (covers idempotent session upserts).
  const streakLen = currentStreakLength(realAll, todayKey)
  for (const len of STREAK_THRESHOLDS) {
    if (streakLen !== len) continue
    const type = STREAK_TYPE_BY_LEN[len]
    if (type === undefined) continue
    const last = lastDateOfType(type)
    if (last !== null && dateUtcKey(last) === todayKey) continue
    out.push({
      type,
      session_uuid: incoming.uuid,
      value: len,
      title: `${len}-day streak`,
      description:
        len === 3
          ? 'Three days in a row on the WalkingPad.'
          : len === 7
            ? 'Full week — seven consecutive days walking.'
            : len === 14
              ? 'Two weeks straight. Habit territory.'
              : 'Thirty days straight. Streak monk mode.',
      confetti: true,
    })
  }

  // Cumulative distance milestones — fire once ever per threshold.
  const totalKmBefore = prior.reduce((s, x) => s + x.distance_m, 0) / 1000
  const totalKmAfter = realAll.reduce((s, x) => s + x.distance_m, 0) / 1000
  for (const km of DISTANCE_MILESTONES_KM) {
    if (totalKmBefore >= km || totalKmAfter < km) continue
    const type = MILESTONE_TYPE_BY_KM[km]
    if (type === undefined || hasAnyOfType(type)) continue
    out.push({
      type,
      session_uuid: incoming.uuid,
      value: km,
      title: `${km} km lifetime`,
      description: `Crossed ${km} km total WalkingPad distance.`,
      confetti: true,
    })
  }

  // Weekly distance PR — emit when the current ISO-week distance strictly
  // beats every prior ISO-week AND beats the stored weekly-PR value. Requires
  // the incoming week to be complete and at least N complete prior weeks to
  // exist, so we never "award" a record against a single fragment-week.
  const weeklyPr = detectWeeklyDistancePr(realAll, incoming, now)
  if (weeklyPr !== null && weeklyPr.value > maxValueOfType('weekly_distance_pr')) {
    out.push(weeklyPr)
  }

  return out
}

function currentStreakLength(sessions: WalkingPadSessionRow[], todayKey: string): number {
  const days = new Set(sessions.map((s) => dateUtcKey(s.started_at)))
  if (!days.has(todayKey)) return 0
  let len = 0
  const cursor = new Date(`${todayKey}T12:00:00Z`)
  for (;;) {
    const key = cursor.toISOString().slice(0, 10)
    if (!days.has(key)) break
    len += 1
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }
  return len
}

// ISO week of the given UTC date. Returns 'YYYY-Www'.
export function isoWeekKey(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  const dayNum = d.getUTCDay() === 0 ? 7 : d.getUTCDay()
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

// At least this many *completed* prior ISO weeks must exist before a weekly
// PR can be awarded — guarantees the record is set against a real baseline of
// fully-elapsed comparison weeks rather than a single fragment.
const MIN_COMPLETE_PRIOR_WEEKS_FOR_PR = 2

function detectWeeklyDistancePr(
  realAll: WalkingPadSessionRow[],
  incoming: WalkingPadSessionRow,
  now: Date,
): DetectedAchievement | null {
  // The incoming session's week must itself be complete — we don't crown a
  // PR mid-week, because additional sessions could still extend the total
  // and an in-progress week isn't comparable to fully-elapsed prior weeks.
  if (!isIsoWeekComplete(incoming.started_at, now)) return null

  const incomingWeek = isoWeekKey(incoming.started_at)
  // Bucket by ISO week; remember one session date per week so we can decide
  // whether each prior week is complete.
  const weeklyBuckets = new Map<string, { distance_m: number; sampleIso: string }>()
  for (const s of realAll) {
    const key = isoWeekKey(s.started_at)
    const cur = weeklyBuckets.get(key)
    if (cur === undefined) {
      weeklyBuckets.set(key, { distance_m: s.distance_m, sampleIso: s.started_at })
    } else {
      cur.distance_m += s.distance_m
    }
  }

  const currentTotal = weeklyBuckets.get(incomingWeek)?.distance_m ?? 0
  if (currentTotal <= 0) return null

  // Only complete prior weeks count toward the baseline.
  let priorMax = 0
  let completePriorCount = 0
  for (const [key, bucket] of weeklyBuckets) {
    if (key === incomingWeek) continue
    if (!isIsoWeekComplete(bucket.sampleIso, now)) continue
    completePriorCount += 1
    if (bucket.distance_m > priorMax) priorMax = bucket.distance_m
  }
  if (completePriorCount < MIN_COMPLETE_PRIOR_WEEKS_FOR_PR) return null
  if (priorMax === 0) return null
  if (currentTotal <= priorMax) return null

  return {
    type: 'weekly_distance_pr',
    session_uuid: incoming.uuid,
    value: currentTotal,
    title: 'Best week ever',
    description: `${(currentTotal / 1000).toFixed(2)} km this week — beat prior best of ${(priorMax / 1000).toFixed(2)} km.`,
    confetti: true,
  }
}

// True iff the ISO week containing `anyIsoInWeek` has fully elapsed — i.e.
// `now` is at or past the following Monday 00:00 UTC.
function isIsoWeekComplete(anyIsoInWeek: string, now: Date): boolean {
  const day = new Date(`${anyIsoInWeek.slice(0, 10)}T00:00:00Z`)
  const dayNum = day.getUTCDay() === 0 ? 7 : day.getUTCDay()
  // Days from this date forward to the start of the next ISO week (Monday).
  // dayNum=1 (Mon) → 7; dayNum=7 (Sun) → 1.
  const daysToNextMonday = 8 - dayNum
  const nextMondayMs = day.getTime() + daysToNextMonday * 86_400_000
  return now.getTime() >= nextMondayMs
}

// ── Heroes / smart abstractions ────────────────────────────────────────────

export type VolumeDirectionVerdict = 'increasing' | 'stable' | 'decreasing' | 'insufficient'
export type PaceDirectionVerdict = 'faster' | 'stable' | 'slower' | 'insufficient'

export type WalkingPadHeroes = {
  volume: {
    direction: VolumeDirectionVerdict
    currentDistanceM: number
    priorDistanceM: number
    deltaPct: number | null
  }
  pace: {
    direction: PaceDirectionVerdict
    currentAvgKmh: number | null
    priorAvgKmh: number | null
    deltaKmh: number | null
  }
  streak: {
    currentDays: number
    bestDays: number
    walkedToday: boolean
    momentum: 'accelerating' | 'steady' | 'cooling'
    sessionsThisWeek: number
  }
}

// Build a per-day map for fast lookup.
function dailyDistanceMap(sessions: WalkingPadSessionRow[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const s of sessions) {
    if (!isRealSession(s)) continue
    const key = dateUtcKey(s.started_at)
    m.set(key, (m.get(key) ?? 0) + s.distance_m)
  }
  return m
}

export function computeWalkingPadHeroes(
  windowSessions: WalkingPadSessionRow[],
  priorWindowSessions: WalkingPadSessionRow[],
  allSessionsForStreak: WalkingPadSessionRow[],
  now: Date,
): WalkingPadHeroes {
  // ── Volume ────────────────────────────────────────────────────────────
  const current = windowSessions.filter(isRealSession)
  const prior = priorWindowSessions.filter(isRealSession)
  const currentDistance = current.reduce((s, x) => s + x.distance_m, 0)
  const priorDistance = prior.reduce((s, x) => s + x.distance_m, 0)
  let volumeDirection: VolumeDirectionVerdict
  let volumeDelta: number | null
  if (prior.length === 0 && current.length === 0) {
    volumeDirection = 'insufficient'
    volumeDelta = null
  } else if (prior.length === 0) {
    volumeDirection = 'increasing'
    volumeDelta = null
  } else {
    volumeDelta = (currentDistance - priorDistance) / priorDistance
    if (Math.abs(volumeDelta) < 0.05) volumeDirection = 'stable'
    else if (volumeDelta > 0) volumeDirection = 'increasing'
    else volumeDirection = 'decreasing'
  }

  // ── Pace (distance-weighted avg km/h) ───────────────────────────────
  const paceCurrent = weightedAvgSpeed(current)
  const pacePrior = weightedAvgSpeed(prior)
  let paceDirection: PaceDirectionVerdict
  let paceDelta: number | null
  if (paceCurrent === null) {
    paceDirection = 'insufficient'
    paceDelta = null
  } else if (pacePrior === null) {
    paceDirection = 'faster'
    paceDelta = null
  } else {
    paceDelta = paceCurrent - pacePrior
    if (Math.abs(paceDelta) < 0.1) paceDirection = 'stable'
    else if (paceDelta > 0) paceDirection = 'faster'
    else paceDirection = 'slower'
  }

  // ── Streak ────────────────────────────────────────────────────────────
  const todayKey = now.toISOString().slice(0, 10)
  const yesterdayKey = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10)
  const daily = dailyDistanceMap(allSessionsForStreak)
  const walkedToday = (daily.get(todayKey) ?? 0) > 0
  // Anchor streak at the most recent walked day so a not-yet-walked-today day
  // doesn't reset a running streak (you still have until end of day).
  const anchor = walkedToday ? todayKey : (daily.get(yesterdayKey) ?? 0) > 0 ? yesterdayKey : null
  const currentStreak = anchor === null ? 0 : currentStreakLength(allSessionsForStreak, anchor)
  const bestStreak = computeBestStreak(daily)

  // Momentum: count walks in last 7 days vs prior 7.
  const last7 = countSessionsInDays(allSessionsForStreak, now, 7)
  const prev7 = countSessionsInDays(
    allSessionsForStreak,
    new Date(now.getTime() - 7 * 86_400_000),
    7,
  )
  let momentum: 'accelerating' | 'steady' | 'cooling'
  if (last7 > prev7) momentum = 'accelerating'
  else if (last7 < prev7) momentum = 'cooling'
  else momentum = 'steady'

  return {
    volume: {
      direction: volumeDirection,
      currentDistanceM: Math.round(currentDistance),
      priorDistanceM: Math.round(priorDistance),
      deltaPct: volumeDelta,
    },
    pace: {
      direction: paceDirection,
      currentAvgKmh: paceCurrent === null ? null : Math.round(paceCurrent * 100) / 100,
      priorAvgKmh: pacePrior === null ? null : Math.round(pacePrior * 100) / 100,
      deltaKmh: paceDelta === null ? null : Math.round(paceDelta * 100) / 100,
    },
    streak: {
      currentDays: currentStreak,
      bestDays: bestStreak,
      walkedToday,
      momentum,
      sessionsThisWeek: last7,
    },
  }
}

function weightedAvgSpeed(sessions: WalkingPadSessionRow[]): number | null {
  let weightedSum = 0
  let totalDistance = 0
  for (const s of sessions) {
    if (s.avg_speed_kmh <= 0 || s.distance_m <= 0) continue
    weightedSum += s.avg_speed_kmh * s.distance_m
    totalDistance += s.distance_m
  }
  if (totalDistance === 0) return null
  return weightedSum / totalDistance
}

function computeBestStreak(daily: Map<string, number>): number {
  const dates = [...daily.keys()].toSorted()
  if (dates.length === 0) return 0
  let best = 1
  let cur = 1
  for (let i = 1; i < dates.length; i += 1) {
    const prev = new Date(`${dates[i - 1]}T12:00:00Z`)
    const here = new Date(`${dates[i]}T12:00:00Z`)
    const gap = (here.getTime() - prev.getTime()) / 86_400_000
    if (gap === 1) {
      cur += 1
      if (cur > best) best = cur
    } else {
      cur = 1
    }
  }
  return best
}

function countSessionsInDays(
  sessions: WalkingPadSessionRow[],
  endDate: Date,
  windowDays: number,
): number {
  const fromMs = endDate.getTime() - windowDays * 86_400_000
  return sessions.filter((s) => {
    const t = new Date(s.started_at).getTime()
    return t > fromMs && t <= endDate.getTime() && isRealSession(s)
  }).length
}

// ── Series (chart data) ────────────────────────────────────────────────────

export type SeriesBucket = 'day' | 'week'

export type WalkingPadSeriesPoint = {
  date: string
  sessions: number
  duration_s: number
  distance_m: number
  steps: number
  kcal: number
  avg_speed_kmh: number | null
}

export function bucketSessions(
  sessions: WalkingPadSessionRow[],
  bucket: SeriesBucket,
  from: Date,
  to: Date,
): WalkingPadSeriesPoint[] {
  // Build empty buckets across the window so charts render gaps explicitly.
  const buckets = new Map<string, WalkingPadSeriesPoint>()

  if (bucket === 'day') {
    const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
    const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()))
    while (cursor.getTime() <= end.getTime()) {
      const key = cursor.toISOString().slice(0, 10)
      buckets.set(key, emptyPoint(key))
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
  } else {
    const cursor = isoWeekStart(from)
    const end = isoWeekStart(to)
    while (cursor.getTime() <= end.getTime()) {
      const key = isoWeekKey(cursor.toISOString())
      buckets.set(key, emptyPoint(key))
      cursor.setUTCDate(cursor.getUTCDate() + 7)
    }
  }

  for (const s of sessions) {
    const key = bucket === 'day' ? dateUtcKey(s.started_at) : isoWeekKey(s.started_at)
    const point = buckets.get(key) ?? emptyPoint(key)
    point.sessions += 1
    point.duration_s += s.duration_s
    point.distance_m += s.distance_m
    point.steps += s.steps
    point.kcal += s.kcal
    buckets.set(key, point)
  }

  // Compute distance-weighted avg speed per bucket.
  const result: WalkingPadSeriesPoint[] = []
  for (const [key, p] of buckets) {
    const matching = sessions.filter(
      (s) => (bucket === 'day' ? dateUtcKey(s.started_at) : isoWeekKey(s.started_at)) === key,
    )
    const avg = weightedAvgSpeed(matching)
    result.push({
      date: key,
      sessions: p.sessions,
      duration_s: p.duration_s,
      distance_m: Math.round(p.distance_m),
      steps: p.steps,
      kcal: Math.round(p.kcal * 10) / 10,
      avg_speed_kmh: avg === null ? null : Math.round(avg * 100) / 100,
    })
  }
  return result.toSorted((a, b) => a.date.localeCompare(b.date))
}

function emptyPoint(key: string): WalkingPadSeriesPoint {
  return {
    date: key,
    sessions: 0,
    duration_s: 0,
    distance_m: 0,
    steps: 0,
    kcal: 0,
    avg_speed_kmh: null,
  }
}

function isoWeekStart(d: Date): Date {
  // Monday start.
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = out.getUTCDay() === 0 ? 7 : out.getUTCDay()
  out.setUTCDate(out.getUTCDate() - (day - 1))
  return out
}

// ── Time-of-day histogram (hour-of-day × day-of-week) ──────────────────────

export type HourDowCell = {
  hour: number // 0-23 UTC
  dow: number // 0-6 (0=Sunday)
  sessions: number
  distance_m: number
}

// A session that starts at 14:00 and runs for 2h should colour 14:00, 15:00,
// and the partial overlap at 16:00 — not just the start hour. We walk each
// session forward in hour-sized slices, incrementing `sessions` by 1 for
// every hour the session touched, and apportioning `distance_m` by the
// fraction of the session spent in that hour. The "sessions touched this
// hour" semantic means the cell sum is greater than the unique session
// count — the heatmap is "when am I active", not "where did I press start".
export type HourOfDayMatrix = {
  cells: HourDowCell[]
  /** Unique real-session count for the window (NOT a sum of cell sessions —
   *  each session contributes to every hour it touched). */
  totalSessions: number
}

export function hourOfDayMatrix(sessions: WalkingPadSessionRow[]): HourOfDayMatrix {
  const map = new Map<string, HourDowCell>()
  for (let dow = 0; dow < 7; dow += 1) {
    for (let h = 0; h < 24; h += 1) {
      map.set(`${dow}-${h}`, { dow, hour: h, sessions: 0, distance_m: 0 })
    }
  }
  let totalSessions = 0
  for (const s of sessions) {
    if (!isRealSession(s)) continue
    totalSessions += 1
    const startMs = new Date(s.started_at).getTime()
    if (!Number.isFinite(startMs)) continue
    // Derive end from duration_s rather than ended_at — duration_s is the
    // canonical "real walking time" used everywhere else (and tests rely on
    // it). ended_at can drift if a session paused for hours before close.
    const durationMs = s.duration_s * 1000
    if (durationMs <= 0) continue
    const endMs = startMs + durationMs

    let t = startMs
    while (t < endMs) {
      const d = new Date(t)
      const dow = d.getUTCDay()
      const hour = d.getUTCHours()
      const nextHourMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour + 1)
      const sliceMs = Math.min(nextHourMs, endMs) - t
      const cell = map.get(`${dow}-${hour}`)
      if (cell !== undefined) {
        cell.sessions += 1
        cell.distance_m += s.distance_m * (sliceMs / durationMs)
      }
      t = nextHourMs
    }
  }
  return { cells: [...map.values()], totalSessions }
}

// ── Session distribution histogram ─────────────────────────────────────────
//
// "How are my sessions distributed by <metric>?" — pure frequency histogram.
// X-axis = bucket of the chosen metric; y-axis = session count. The toggled
// metric on the dashboard picks the bucketing dimension; bucket width is
// metric-specific (5 min / 500 m / 1000 steps) and chosen to land 10-20
// visible buckets for typical personal usage.

export type SessionHistogramMetric = 'duration' | 'distance' | 'steps'

export type SessionHistogramBucket = {
  /** Lower bound of the bucket, in the metric's own native unit
   *  (minutes / meters / steps). */
  bucketStart: number
  /** Bucket width in the same unit, for the dashboard to label `X – X+W`. */
  bucketWidth: number
  /** Session count whose value falls into [bucketStart, bucketStart+bucketWidth). */
  sessions: number
}

type HistogramSpec = {
  pick: (s: WalkingPadSessionRow) => number
  bucketWidth: number
  maxBucket: number
}

const HISTOGRAM_SPECS: Record<SessionHistogramMetric, HistogramSpec> = {
  duration: { pick: (s) => s.duration_s / 60, bucketWidth: 5, maxBucket: 90 },
  distance: { pick: (s) => s.distance_m, bucketWidth: 500, maxBucket: 10_000 },
  steps: { pick: (s) => s.steps, bucketWidth: 1000, maxBucket: 20_000 },
}

export function sessionDistributionHistogram(
  sessions: WalkingPadSessionRow[],
  metric: SessionHistogramMetric,
): SessionHistogramBucket[] {
  const spec = HISTOGRAM_SPECS[metric]
  const buckets = new Map<number, number>()
  for (let b = 0; b <= spec.maxBucket; b += spec.bucketWidth) {
    buckets.set(b, 0)
  }
  for (const s of sessions) {
    if (!isRealSession(s)) continue
    const v = spec.pick(s)
    const bucketStart = Math.floor(v / spec.bucketWidth) * spec.bucketWidth
    const clamped = Math.min(bucketStart, spec.maxBucket)
    buckets.set(clamped, (buckets.get(clamped) ?? 0) + 1)
  }
  return [...buckets.entries()]
    .map(([bucketStart, sessions]) => ({
      bucketStart,
      bucketWidth: spec.bucketWidth,
      sessions,
    }))
    .toSorted((a, b) => a.bucketStart - b.bucketStart)
}
