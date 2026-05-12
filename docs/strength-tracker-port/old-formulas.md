# Strength Tracker — Old Formula Reference

Extracted verbatim from `argo-old/packages/dashboard/src/pages/strength-tracker/` at commit `328390f`. Source files: `utils.ts` (911 lines), `analytics.ts` (677 lines), `body-weight.ts`, `achievements.ts`, `constants.ts`.

This is the spec the API + new frontend must mirror. Anywhere this document conflicts with `STRENGTH-ANALYTICS.md`, the formulas here win (they ran in production).

---

## 1. Core per-set / per-session math (utils.ts)

### 1.1 Estimated 1RM

```
brzycki(W, R) = W × 36 / (37 − R)        — valid R ∈ [1, 10]
epley(W, R)   = W × (1 + R / 30)           — valid R ∈ [1, 12]

estimate1RM(W, R):
  if R < 1 || R > 12 → null
  if R ≤ 10          → (epley + brzycki) / 2
  else               → epley                 // R = 11..12
```

### 1.2 Eligibility gate per set

```
eligibleForE1RM(set, workoutRir):
  set.set_type ∈ {work, amrap}
  AND set.reps ∈ [1, 12]
  AND (workoutRir == null || workoutRir ≤ 3)
```

> `rir` is on the workout row in the old schema spec but **the old code does not actually pass it**; new schema also omits it. Treat as `null` everywhere — no behaviour change.

### 1.3 Per-workout aggregates

For each workout, compute (`computeWorkoutMetrics`):

```
isPullUps = exercise_id === 'pull_ups'
eligibleSets = sets.filter(s => eligible(s, workoutRir))
effective(s) = isPullUps ? s.weight_kg + bw : s.weight_kg

maxWeight     = max(effective(s)) over eligible sets, or 0
estimated1rm  = max(estimate1RM(effective(s), s.reps)) over eligible sets (rounded 1dp)
best1rmSet    = the set producing the maxima
totalVolume   = Σ effective(s) × s.reps over ALL sets (warmup + work + drop + amrap)
```

The API already implements an equivalent in `apps/api/src/lib/formulas.ts::computeMetrics` (matches numerically; the old code rounds intermediates differently but the final 1dp output agrees).

### 1.4 Effective weight & bodyweight resolver

```
bw(date):
  1. nearest weight_log entry on-or-before date
  2. otherwise earliest weight_log entry
  3. otherwise user_profile.goal_weight_kg
  4. otherwise 80 kg
```

API already has `loadBodyweightResolver()` in `formulas.ts` — keep using it.

### 1.5 Session INOL (Intensity × Number Of Lifts)

```
sessionInol(workout, bw):
  best1rm = workout.estimated_1rm
  if best1rm <= 0 → null
  isPullUps = workout.exercise_id === 'pull_ups'
  total = 0; count = 0
  for s in workout.sets:
    if s.set_type ∉ {work, amrap} → skip
    if s.reps < 1 || s.reps > 12  → skip
    ew  = isPullUps ? s.weight_kg + bw : s.weight_kg
    pct = clamp((ew / best1rm) × 100, 40, 99)
    total += s.reps / (100 − pct)
    count++
  return count > 0 ? total : null
```

INOL zones:

| INOL    | Zone      | Color (token)        |
| ------- | --------- | -------------------- |
| < 0.4   | Too light | `VX.series.acwr`     |
| 0.4–0.6 | Recovery  | `VX.warnSolid`       |
| 0.6–1.0 | Optimal   | `VX.goodSolid`       |
| 1.0–1.5 | Hard      | `VX.series.calories` |
| > 1.5   | Excessive | `VX.badSolid`        |

### 1.6 e1RM velocity (slope %/day)

```
velocityPctPerDay(workouts, exId, windowDays=28):
  filter to workouts with estimated_1rm != null, sorted asc by date
  if < 2 points → null
  latest = last point
  windowStart = latest.date − windowDays
  inWindow = filter(date >= windowStart)
  if < 2 in window → null
  pairs = [(daysFromWindowStart, estimated_1rm)]
  slope = linear regression slope
  return slope / latest.estimated_1rm × 100
```

```
strengthDirection(velocity):
  velocity ==  null → 'stable'
  velocity >  0.1   → 'improving'
  velocity < -0.05  → 'declining'
  else              → 'stable'
```

### 1.7 Weekly tonnage (per exercise)

```
weeklyTonnageSeries(workouts, exId):
  filter to exId, sort asc
  bucket by isoWeek end date (Sun): sum total_volume
  fill missing weeks with 0 from first→last
  return [{ date: weekEnd, tonnage }]
```

`weeklyWorkVolume(workouts, exId, weekEndDate)` = sum of workout.total_volume over rolling 7-day window ending at `weekEndDate`.

### 1.8 ACWR per exercise

```
ewmaSeries(values, N):
  α = 2 / (N+1)
  seed = mean(first min(N, len) values)
  v[i] = α × values[i] + (1−α) × v[i−1]

computeAcwrSeries(workouts, exId):
  s = weeklyTonnageSeries(workouts, exId)
  if len < 2 → []
  acute   = ewmaSeries(s.tonnage, 4)
  chronic = ewmaSeries(s.tonnage, 16)
  for each week:
    acwr = chronic > 0 ? acute / chronic : null
    zone = acwr < 0.8 → 'undertrained'
           0.8..1.3   → 'optimal'
           1.3..1.5   → 'caution'
           > 1.5      → 'danger'
```

### 1.9 Volume landmarks (MEV/MAV/MRV) — 90-day window

```
volumeLandmarks(workouts, exId, windowDays=90):
  s = weeklyTonnageSeries(workouts, exId)
  inWindow = s.tonnage > 0 within last `windowDays`
  sorted = inWindow ascending
  return {
    mev: percentile(25),
    mav: percentile(50),
    mrv: percentile(90),
  }
```

Linear interpolation between sorted samples for percentile.

### 1.10 Tonnage growth ratio (per week, per exercise)

```
tonnageGrowthRatio(workouts, exId, date):
  ma28 = mean over last 4 weekly windows ending at `date - 0w, -1w, -2w, -3w`
  if ma28 <= 0 → null
  return weeklyWorkVolume(workouts, exId, date) / ma28
```

### 1.11 Weekly volume breakdown (per exercise)

```
buildWeeklyVolumeData(workouts, exId):
  per isoWeek end: { warmup, work, drop, amrap, total } summed across exId workouts
  effective_weight applies for pull-ups (s.weight_kg + 80)
  ma = 4-week rolling mean of `total` (requires ≥ 2 non-zero weeks)
  result: [{ date, warmup, work, drop, amrap, total, ma }]
```

### 1.12 e1RM chart data (multi-exercise)

```
buildOneRmChartData(workouts, exIds):
  per (date, exId): pick best estimated_1rm of that date's sessions, plus bestSet info
  per exId: dateBasedMA(values, windowDays=30) — date-based MA looking back 30 calendar days, requires ≥ 3 values
  per row: { date, e1rm: {exId → value|null}, ma: {exId → ma|null}, bestSets: {exId → {weight_kg, reps, e1rm}|null} }
```

### 1.13 INOL chart data (per exercise)

```
buildInolChartData(workouts, exId):
  for each workout (sorted asc): inol = sessionInol(workout)
  ma10 = 10-entry trailing mean of inol (requires ≥ 3 non-null in slice)
  result: [{ date, inol, ma10 }]
```

### 1.14 Momentum chart data (per exercise)

```
buildMomentumChartData(workouts, exId):
  for each workout with estimated_1rm != null (sorted asc):
    e1rmMA = 8-entry trailing mean of e1rm (requires ≥ 3)
    velocity = velocityAtDate(workouts, exId, date)
  result: [{ date, e1rm, e1rmMA, velocity }]
```

### 1.15 Composite (z-scored) chart data (per exercise)

```
buildCompositeData(workouts, exId):
  raw = per workout: { date, velocity=velocityAtDate, tonnageGrowth=tonnageGrowthRatio, inol=sessionInol }
  baseline window = last 90 days from latest
  zScore against {mean, sd} of each component over the 90d window
    - velocity SD floor = 0.05
    - tonnage SD floor  = 0.02
    - INOL SD floor     = 0.1
  velocityZma / tonnageZma / inolZma = 7-entry trailing mean over the z-series
  result: [{ date, *Raw, *Z, *Zma } × 3 components]
```

### 1.16 Generic metric extraction

`extractMetric(workout, metric)` — used for charts + PR detection:

```
max_weight:     max(effective_weight of work sets)
estimated_1rm:  workout.estimated_1rm
total_volume:   workout.total_volume
total_reps:     Σ s.reps over all sets
work_sets:      count of work sets
avg_intensity:  if !workout.estimated_1rm → null
                heaviest = max(work-set weights)
                ew = isPullUps ? heaviest + 80 : heaviest
                return ew / estimated_1rm × 100
```

### 1.17 Frequency by isoWeek

```
buildFrequencyData(workouts, exercises):
  for each workout: bucket by `${isoWeekYear}-W${isoWeek}` → exId counts
  result rows: { week, [exId]: count }
```

### 1.18 Summary stats (hero)

```
computeSummaryStats(workouts, exercises):
  best1rm           = max(workout.estimated_1rm) over filtered
  current1rmAvg     = mean of last 30 days estimated_1rm
  current1rmDelta   = pctChange(current vs prev 30d avg)
  weeklyVolume      = Σ total_volume over last 7d
  weeklyVolumeDelta = pctChange(last7d vs prev7d)
  avgIntensity      = mean(avg_intensity) over last 30d
  intensityDelta    = pctChange(last30 vs prev30 mean)
  sessionsLast30    = count workouts in last 30d
  freqPerWeek       = round(sessionsLast30 / (30/7), 1dp)
  *Delta            = (cur − prev) / prev × 100 (null if either zero)
```

### 1.19 PR detection (running-max)

```
findPRPoints(workouts, metric, exercises):
  for each exercise: walk asc by date, track runningMax; emit a PRPoint when value > runningMax (skip the very first session per metric → "first session isn't a PR")
  result: [{ date, exercise, value }]
```

---

## 2. Analytics composite signals (analytics.ts)

### 2.1 DOTS coefficient (IPF 2020)

Male: `A=-307.75076, B=24.0900756, C=-0.1918759221, D=0.0007391293, E=-1.093e-6`
Female: `A=-57.96288, B=13.6175032, C=-0.1126655495, D=0.0005158568, E=-1.0706e-6`

```
dotsCoefficient(bw, gender) = 500 / (A + B·bw + C·bw² + D·bw³ + E·bw⁴)
dotsAdjusted(e1rm, bw, g)   = e1rm × dotsCoefficient(bw, g)
```

### 2.2 Strength ratios + balance composite

```
ratios = {
  'DL / Squat':    [1.00, 1.25], DOTS-adjusted, scaleMax 2.0
  'Squat / Bench': [1.20, 1.50], DOTS-adjusted, scaleMax 2.2
  'DL / Bench':    [1.50, 2.00], DOTS-adjusted, scaleMax 3.0
  'Pull-up / BW':  [0.40, 0.70], maxPullUpAdded / bw, scaleMax 1.2 (NOT DOTS-adjusted; null if no added weight)
}

status(ratio, [lo, hi]):
  in-range            → 'balanced'
  deviation > 30%     → 'critical'
  deviation > 15%     → 'imbalanced'
  else                → 'balanced'

balance.status = worst of the 4 (critical > imbalanced > balanced)
```

### 2.3 Load Quality (Hero #2)

```
inolZoneScore(inol):
  < 0.4       → 0
  0.4..0.6    → (inol − 0.4)/0.2 × 100
  0.6..1.0    → 100
  1.0..1.5    → (1.5 − inol)/0.5 × 100
  > 1.5       → 0

acwrZoneScore(acwr):
  < 0.8       → acwr/0.8 × 100
  0.8..1.3    → 100
  1.3..1.5    → (1.5 − acwr)/0.2 × 100
  > 1.5       → 0

volLandmarkScore(vol, mev, mav, mrv):
  mrv<=0 OR mav<=mev → 50
  vol < mev          → vol/mev × 100
  vol ≤ mav          → 100
  vol ≤ mrv          → (mrv − vol)/(mrv − mav) × 100
  else               → 0

Per-exercise: inolScore (last ma10 or last raw), acwrScore (last acwr), volScore (last weeklyTonnage)
Average across active exercises (use 50 when empty)

score = round(0.4 × avgInol + 0.4 × avgAcwr + 0.2 × avgVol)
verdict:  ≥75 'Quality', 50..74 'Adequate', <50 'Poor'
dragComponent = component with lowest score, only emit if < 90
```

### 2.4 Strength Direction (Hero #1)

```
For each exercise: vel = velocityPctPerDay
leader = exercise with highest vel
direction = strengthDirection(leader.vel)
leaderVelocityPctPerMonth = vel × 30
momentumSign:
  build momentum data for leader; compare latest vs prev velocity
    diff > 0.005  → 'accelerating'
    diff < -0.005 → 'decelerating'
    else          → 'linear'
```

### 2.5 Relative progression chart

```
For exercises and date range: per (date, exId) take best estimated_1rm.
Per exercise, baseline = first available e1RM in range; pct = (val − baseline)/baseline × 100
Result: [{ date, pct: {exId → number|null} }]
```

### 2.6 Readiness × Strain (depends on daily-metrics)

```
For each daily metric d:
  garminRecovery = recoveryScore(d, fieldAvg(hrv), fieldAvg(rhr), minRhr, maxRhr, yesterdayActivityScore, ceiling)
  recentWorkout  = workouts in [d − 2d, d), most recent by date
  yesterdayInol  = sessionInol(recentWorkout) if any
  fatigueDept    = clamp(yesterdayInol / fatigueCeiling, 0, 1) — fatigueCeiling = max(1.0, p90(all sessionInols))
  readiness      = garminRecovery × (1 − fatigueDept × 0.25)
  if yesterdayInol > 1.2: readiness × 0.9
  readiness      = round(clamp(readiness, 0, 100))
  driver         = explanation when fatigueDept > 0.25 or heavy session
```

### 2.7 Training–Recovery Alignment matrix

```
ROWS recoveryRow: 'high' (≥70), 'normal' (40..69), 'low' (<40)
COLS acwrCol:     'under' (<0.8), 'optimal' (0.8..1.3), 'caution' (>1.3)

cell verdict table (verdict + good/warn/bad type) — see analytics.ts:488 for the 3×3 matrix
isToday cell: today's recovery × today's avg-of-exercises ACWR (latest <= today)
sessionDates = workouts of active exercises; each session bucketed into its (row, col) cell
```

### 2.8 Deload Signal

Active signals (>=2 → deload, =1 → monitor, =0 → progress):

- **Stall**: ≥2 active lifts with velocity ≤ 0 AND a session in last 21d
- **Overload**: any active lift with last 2 ACWR points > 1.3
- **Fatigue**: avg INOL over last 10 sessions of active exercises > 1.1 (needs ≥5 sessions)
- **Physio** (only if daily metrics ≥ 7 entries): fitness direction = Declining, OR HRV 7d MA < 0.85 × HRV 28d MA

---

## 3. Achievements (achievements.ts)

After saving a workout, detect:

```
{ maxWeight, estimated1rm, totalVolume } = computeWorkoutMetrics(sets, exercise)
history = past workouts of this exercise (excluding the one just logged)

if history.length === 0:
  → 'first_workout' (always confetti)
else:
  prevMaxWeight  = max(workSet effective weight) across history (pull-ups: +80)
  prevMax1rm     = max(estimated_1rm) across history
  prevMaxVolume  = max(total_volume) across history

  step = isPullUps ? 5 : 10
  prevMilestone = floor(prevMaxWeight / step) × step
  newMilestone  = floor(maxWeight / step) × step
  if newMilestone > prevMilestone → 'weight_milestone' (confetti when newMilestone % 50 === 0)

  if maxWeight > prevMaxWeight && prevMaxWeight > 0 → 'max_weight_pr' (confetti)
  if estimated1rm > prevMax1rm && prevMax1rm > 0    → 'estimated_1rm_pr' (confetti)
  if totalVolume > prevMaxVolume && prevMaxVolume > 0 → 'volume_pr' (no confetti)
```

Achievements display as small celebration card + `canvas-confetti` burst when `confetti: true`.

---

## 4. Body Weight (body-weight.ts, body-weight-view.tsx)

### 4.1 Resolver — already implemented in API

`bodyWeight(date, { weightLog, profileDefault })` already lives in `apps/api/src/lib/formulas.ts::makeBodyweightResolver`. No change needed.

### 4.2 Body weight view analytics (~836 lines, mostly UI)

- **Centered 7-day moving average**: per entry, average of all entries within ±3 days.
- **Linear slope (kg/day)**: regression over entries; requires ≥2 points and ≥3-day span.
- **Trailing rate (kg/week)**: linear slope over trailing 28 days × 7. Falls back to all-time slope when sparse.
- **Phase classification**: `losing | gaining | maintaining` based on `|kgPerWeek|`:
  - `< 0.1` → Maintenance
  - lose 0.1..0.4 → Lean cut
  - lose 0.4..0.8 → Standard cut
  - lose > 0.8 → Aggressive cut
  - gain 0.1..0.25 → Lean bulk
  - gain 0.25..0.5 → Standard bulk
  - gain > 0.5 → Aggressive bulk

The new `/weight-log/summary` already exposes current/ma7/ma30/trend/weeklyDelta/monthlyDelta. Add a `phase` field + `kgPerWeek` field server-side to mirror the old hero behaviour. The chart needs the raw points + per-point MA (which the client can re-compute from points).

---

## 5. Constants & tokens (constants.ts)

- Exercises: `bench_press, deadlift, squat, pull_ups` with colors `VX.series.benchPress/.deadlift/.squat/.pullUps`.
- Date presets: `3m, 6m, 1y, ytd, all, custom` (current new UI uses `7d, 30d, 90d, all` — preserve old presets).
- METRIC_TOOLTIPS dict — 13 keys for each chart/hero, copy verbatim into new feature.
- ACWR zone colors: undertrained = `rgba(22,119,255,0.15)`, optimal = `VX.good`, caution = `VX.warn`, danger = `VX.bad`.

---

## 6. Schema fields used (postgres `argo.*`)

- `workouts(id, date, exercise_id, notes, created_at)`
- `workout_sets(id, workout_id, set_number, set_type, weight_kg, reps, created_at)`
- `exercises(id, name, category, muscle_group, is_bodyweight, display_order)`
- `weight_log(id, date, weight_kg, created_at)`
- `user_profile(id=1, height_cm, birth_date, gender, goal_weight_kg)`
- `daily_metrics(date, hrv_last_night_avg, resting_hr, sleep_score, steps, moderate_intensity_min, vigorous_intensity_min, … bb_*)` — used by readiness×strain and alignment matrix

No schema changes required for the port. (The old `STRENGTH-ANALYTICS.md` spec mentions `workouts.rir` but the old code does not use it.)
