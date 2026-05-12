# Argo Garmin Health — Old Client Formulas & Constants

**Source:** `/Users/jkrumm/SourceRoot/argo-old/packages/dashboard/src/pages/garmin-health/utils.ts`

These formulas were implemented client-side in the old dashboard. They are being ported to the backend for the new `apps/api` (Elysia + Postgres). Copy these exact values when implementing server-side computations.

## Activity Score / MET-Minutes

**File:** `utils.ts`, lines 206–257

MET multipliers from Compendium of Physical Activities (Ainsworth et al. 2011). Steps are de-double-counted.

```
ACTIVITY_TARGET_SCORE       = 600           # MET-min per day → "100% day"
STEPS_PER_INTENSITY_MIN     = 100           # Each intensity minute ≈ 100 steps
STEPS_MET_PER_STEP          = 0.03          # Walking MET contribution (3 MET / 100 steps)
MODERATE_MET                = 4             # Moderate intensity
VIGOROUS_MET                = 8             # Vigorous intensity

Formula:
  vigorousScore  = vigorous_min × 8
  moderateScore  = moderate_min × 4
  walkingSteps   = max(0, steps - (moderate_min + vigorous_min) × 100)
  walkingScore   = walkingSteps × 0.03
  Total Activity Score = vigorousScore + moderateScore + walkingScore
```

## Recovery Score

**File:** `utils.ts`, lines 85–155

Weighted composite: HRV (40%) + Sleep (35%) + RHR (25%), with optional strain-debt penalty from yesterday's Activity Score.

```
STRAIN_DEBT_MIN_CEILING     = 500           # Floor on strain-debt anchor (80% of 600)
STRAIN_DEBT_MAX_PENALTY     = 0.3           # Max proportional penalty (30% shave)

Weights:
  hrv_weight   = 0.40  (HRV vs personal average)
  sleep_weight = 0.35  (raw sleep score)
  rhr_weight   = 0.25  (RHR inverted via percentile: lower is better)

HRV component:
  IF hrv_last_night_avg ≠ null AND avgHrv ≠ null AND avgHrv > 0:
    score += min(100, (hrv / avgHrv) × 100) × 0.4

Sleep component:
  IF sleep_score ≠ null:
    score += sleep_score × 0.35

RHR component (inverted — lower RHR = higher recovery):
  IF rhr ≠ null AND minRhr ≠ null AND maxRhr ≠ null AND maxRhr > minRhr:
    rhrComp = (1 - (rhr - minRhr) / (maxRhr - minRhr)) × 100
    score += max(0, min(100, rhrComp)) × 0.25

Strain-debt penalty (optional, if yesterday_score known):
  strainDebt = clamp(0, 1, yesterday_score / ceiling)
  where ceiling = 90th percentile of Activity Scores (floored at STRAIN_DEBT_MIN_CEILING)

  recovery_final = round(raw_score × (1 - strainDebt × 0.3))

Return null if no data available (all three metrics null).
```

## Training Load (ACWR — Acute : Chronic Workload Ratio)

**File:** `utils.ts`, lines 453–528

EWMA (exponentially weighted moving average) with 7-day and 28-day half-lives.

```
λ_acute   = 2 / (7 + 1)   = 0.25     (~7-day half-life, from Hulin et al. 2017)
λ_chronic = 2 / (28 + 1)  ≈ 0.069   (~28-day half-life)

Daily load = Activity Score (see above)

Seeding: EWMA initialized with average of first min(N, 7) days.

Recursion:
  ewma_acute[i]   = load[i] × λ_A + ewma_acute[i-1] × (1 - λ_A)
  ewma_chronic[i] = load[i] × λ_C + ewma_chronic[i-1] × (1 - λ_C)
  acwr = ewma_acute / ewma_chronic (round to 2 decimals)
  divergence = acute - chronic (for Load Divergence chart)

ACWR Zones (Gabbett 2016, BJSM):
  <0.8           → undertrained (detraining risk)
  0.8–1.3        → optimal
  1.3–1.5        → caution (elevated injury risk)
  >1.5           → danger (overtraining risk)
```

## Fitness Trends (7-day Moving Average + Z-scores)

**File:** `utils.ts`, lines 315–365

Simple moving average over 7 days, plus personal z-scores (relative to the window mean/SD).

```
Moving average window = 7 days
Minimum values to compute MA = 3 (or window size if <3)
Rounding: round to 1 decimal

Z-score calculation (for RHR, HRV, VO2):
  mean = average of all valid values in window
  sd   = sample standard deviation (floor at 0.5 for RHR, 1.0 for HRV, 0.2 for VO2)
  z    = (value - mean) / sd

RHR z-score is FLIPPED (multiply by -1) so "improving" (lower RHR) = positive z-score.
```

## Fitness Direction (3-level Signal)

**File:** `utils.ts`, lines 595–655

Linear regression slope over the last 14 days (last 2 weeks) of RHR and HRV.

```
Regression window = 14 days
Minimum points for slope = 3

RHR slope thresholds:
  positive (improving) if slope < -0.05 bpm/day
  negative (declining) if slope > +0.05 bpm/day

HRV slope thresholds:
  positive (improving) if slope > +0.1 ms/day
  negative (declining) if slope < -0.1 ms/day

Signal logic:
  IF (rhr_positive OR hrv_positive) AND NOT (rhr_negative OR hrv_negative)
    → 'Improving' (▲, green #00c853)
  ELSE IF (rhr_negative OR hrv_negative) AND NOT (rhr_positive OR hrv_positive)
    → 'Declining' (▼, red #ff3d00)
  ELSE
    → 'Stable' (►, gray #78909c)

Also includes summary metrics (VO2 Max, RHR/HRV deltas, chronic load direction).
```

## Body Battery

**File:** `utils.ts`, lines 171–181

Simple daily balance: charged − drained.

```
net = bb_charged − bb_drained

Both fields are nullable; if either is null, net = null.
```

## Sleep Breakdown

**File:** `utils.ts`, lines 157–169

Convert sleep stage seconds to hours (1 decimal).

```
Conversion: hours = round(seconds / 3600 × 10) / 10

Stages captured:
  - deep_sleep_sec
  - light_sleep_sec
  - rem_sleep_sec
  - awake_sleep_sec (not a "sleep" stage, but tracked)
  - sleep_score (0–100, Garmin composite)
```

## Stress

**File:** `utils.ts`, lines 195–204

Two time series: average daily stress and overnight (sleep) stress.

```
avg_stress        = HRV-based autonomic stress (0–100)
avg_sleep_stress  = Overnight stress specifically

Zones (stress-specific, not the same as HRV status):
  0–24   → Rest
  25–49  → Low
  50–74  → Moderate
  75+    → High
```

## Data Visibility / Filtering

**File:** `constants.ts`, lines 10–18

```
VISIBLE_DATE_MIN          = '2026-04-15'   # Hard floor; anything before dropped from charts
HIDE_TODAY_BEFORE_HOUR    = 22             # Hide today's aggregates until 22:00 local

Presets supported (constants.ts, lines 20–26):
  '7d'   → last 7 days
  '30d'  → last 30 days (default)
  '3m'   → last 3 months
  '1y'   → last 1 year
  'all'  → from 2000-01-01 to today

Custom range: from=YYYY-MM-DD, to=YYYY-MM-DD
```

---

## Helper Functions

### Percentile (nearest-rank)

```ts
percentile(values: number[], p: number): number | null
  sorted = sort(values)
  idx = clamp(ceil(p × length) - 1, 0, length - 1)
  return sorted[idx]
```

### Sample Standard Deviation

```ts
sampleStdDev(values: number[]): number | null
  if length < 2: return null
  mean = sum / length
  sq = sum of (v - mean)²
  return sqrt(sq / (length - 1))  # divide by n-1 for sample SD
```

### Moving Average

```ts
movingAverage(values: (number | null)[], window: number): (number | null)[]
  For each position i:
    slice = values[max(0, i-window+1) : i+1], filtered to non-null
    if slice.length >= min(3, window):
      return round(sum(slice) / length × 10) / 10
    else:
      return null
```

### Linear Regression Slope

```ts
linearSlope(values: (number | null)[]): number | null
  valid = [(index, value), ...] for all non-null values
  if valid.length < 3: return null

  n = length(valid)
  sumX, sumY, sumXY, sumX2 = standard sums
  denom = n × sumX2 - (sumX)²

  if denom = 0: return null
  slope = (n × sumXY - sumX × sumY) / denom
  return slope
```

---

## Notes for Implementation

1. **Null safety:** All formulas must handle nulls gracefully. If a component metric is null (e.g., no sleep data), it is skipped from the weighted average and the weight is redistributed.

2. **Rounding:** Most values round to 1–2 decimals. Use `Math.round(x × 10) / 10` for 1 decimal, `Math.round(x × 100) / 100` for 2 decimals.

3. **Date ordering:** Many calculations assume data is ordered chronologically (oldest first for sequences, newest first for "most recent" queries). Be explicit about sort order in implementation.

4. **Strain-debt ceiling:** This is computed dynamically per window (90th percentile of Activity Scores), not a hardcoded value. Allows the penalty to scale with each user's "hard day."

5. **Server vs. client:** The old code ran all of this client-side on fetch. For better UX and cacheability, compute on the server and return pre-computed summaries + series. Client only transforms for charting (e.g., z-scores for visualization).
