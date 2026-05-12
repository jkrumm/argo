# Argo Garmin Health — Backend Coverage Audit

**Generated:** 2026-05-12  
**Scope:** Compare old client formulas (argo-old dashboard) vs. new backend implementation (argo API)

## Summary Table

| #   | Required for                      | Computation/Endpoint                                                                     | Status           | Where (file:line)                                                                                       | Gap Notes                                                                                                                                                     |
| --- | --------------------------------- | ---------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Recovery Score (snapshot)         | Weighted composite: HRV (40%) + Sleep (35%) + RHR (25%) + strain-debt penalty            | ❌ MISSING       | —                                                                                                       | Needs `/daily-metrics/recovery` or `/daily-metrics/summary` extension; must compute 90th-percentile activity ceiling + yesterday's score for penalty          |
| 2   | Recovery Trend series             | Daily recovery score for date range                                                      | ❌ MISSING       | —                                                                                                       | Needs `/daily-metrics/recovery/series` endpoint; returns date + recovery score for each day in window                                                         |
| 3   | Fitness Direction                 | RHR + HRV 14-day slopes, 3-level signal (Improving/Stable/Declining) + VO2/delta summary | ❌ MISSING       | —                                                                                                       | Needs `/daily-metrics/fitness-direction` endpoint; requires linear regression on 14d trailing window                                                          |
| 4   | Training Load / ACWR              | EWMA acute (λ=0.25) + chronic (λ≈0.069) + ratio + zone classification                    | ❌ MISSING       | —                                                                                                       | Needs `/daily-metrics/training-load` or `/training-load/series` endpoint; must return daily_load, acute, chronic, acwr, zone, divergence                      |
| 5   | Load Divergence series            | Daily (acute − chronic) divergence with pos/neg split for stacked bar                    | ❌ MISSING       | —                                                                                                       | Can be derived from Training Load series (see #4); divergence = acute − chronic                                                                               |
| 6   | Activity Score / MET-min series   | Daily score (vig×8 + mod×4 + walking×0.03) for date range                                | 🟡 PARTIAL       | `activities.ts` (line 66–100); `daily-metrics.ts`                                                       | Raw data available (vigorous_intensity_min, moderate_intensity_min, steps) but not pre-computed; dashboard must compute locally                               |
| 7   | Activities (workouts per day)     | Date-bucketed list (type, duration, HR, TE, TL) grouped by start_time_local              | ✅ PRESENT       | `activities.ts` (GET /activities); pagination + date filtering                                          | Full activity records available via pagination; dashboard can bucket client-side; `trainng_load` and aerobic/anaerobic TE are present                         |
| 8   | Body Battery series               | Charged, drained, net daily                                                              | ✅ PRESENT (raw) | `daily-metrics.ts` (GET /daily-metrics) returns bb_charged, bb_drained, bb_highest, bb_lowest           | Data available in `/daily-metrics/` but not returned in `/daily-metrics/series`; need to add to series endpoint (line 162–186)                                |
| 9   | Sleep Breakdown series            | Deep/light/REM/awake hours + score daily                                                 | ✅ PRESENT (raw) | `daily-metrics.ts` returns deep_sleep_sec, light_sleep_sec, rem_sleep_sec, awake_sleep_sec, sleep_score | Data available in `/daily-metrics/` but not returned in `/daily-metrics/series`; need to add sleep stage fields to series endpoint                            |
| 10  | Stress series                     | Avg daily + overnight stress                                                             | ✅ PRESENT (raw) | `daily-metrics.ts` returns avg_stress, max_stress, avg_sleep_stress                                     | Data available but avg_sleep_stress not in `/daily-metrics/series`; need to extend series endpoint                                                            |
| 11  | Fitness Trends (7d MA + z-scores) | RHR 7d MA, HRV 7d MA, VO2 Max, z-scores (RHR flipped)                                    | 🟡 PARTIAL       | `daily-metrics.ts` returns raw resting_hr, hrv_last_night_avg, vo2_max                                  | Raw data available; 7-day MA and z-scores must be computed client-side or added to `/daily-metrics/fitness-trends` backend endpoint                           |
| 12  | Window/range filtering            | 5 presets (7d, 30d, 3m, 1y, all) + custom range (from/to)                                | ✅ PRESENT       | `window.ts` (all routes); validates window=X or from/to params                                          | All routes accept ?window=7d\|30d\|90d\|all or ?from=YYYY-MM-DD&to=YYYY-MM-DD; window.ts parseWindow() handles logic                                          |
| 13  | Garmin sync trigger + status      | POST /daily-metrics/refresh to queue sync; GET /daily-metrics/sync-status for state      | ✅ PRESENT       | `daily-metrics.ts` (lines 250–275); syncControl table (schema.ts 111–120)                               | Endpoints exist; cron (garmin-sync.ts) monitors refresh*requested flag and updates in_progress, last*\* fields                                                |
| 14  | Data visibility floor             | VISIBLE_DATE_MIN ≈ 2026-04-15; HIDE_TODAY_BEFORE_HOUR = 22                               | 🟡 PARTIAL       | No explicit enforcement in API; constants only in old client code                                       | Backend must implement or document these rules; for now, client enforces via data filtering. API should optionally support ?hide_incomplete_today query param |

---

## Endpoint Inventory

### Existing ✅

| Route                        | Method | Query Params                                 | Returns                                                                                       | Notes                                                             |
| ---------------------------- | ------ | -------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `/daily-metrics`             | GET    | page, limit, order, date_from, date_to       | paginated all fields                                                                          | Full raw daily metrics (50 fields); one row per calendar day      |
| `/daily-metrics/summary`     | GET    | window, from, to                             | current, ma7, ma30, trend for hrv, restingHr, sleep, stress                                   | Pre-computed rolling stats; ready for display                     |
| `/daily-metrics/series`      | GET    | window, from, to                             | date + 8 fields (hrv, restingHr, sleepScore, stress, steps, activeKcal, sleepDurationSec)     | Raw time series; dashboard can compute charts from this           |
| `/daily-metrics/sync-status` | GET    | —                                            | refresh_requested, in_progress, last_started_at, last_completed_at, last_status, last_message | Single object; updated by cron every ~30s when sync runs          |
| `/daily-metrics/refresh`     | POST   | —                                            | (same as sync-status)                                                                         | Queues manual refresh; cron picks up within ~30s                  |
| `/activities`                | GET    | page, limit, sort, order, date_from, date_to | paginated activity records (34 fields each)                                                   | Full Garmin activity data; client groups by date for stacked bars |
| `/activities/summary`        | GET    | window, from, to                             | weeklyMinutes, weeklyByType, totalsWindow                                                     | Summary stats; does not break down by activity type separately    |

---

## Missing Endpoints (❌)

These must be implemented before the dashboard can fully port. Sorted by priority.

### 1. `/daily-metrics/recovery` (Priority: HIGH)

**Purpose:** Snapshot recovery score for the current or last date in window.

**Request:**

```
GET /daily-metrics/recovery?window=30d
  or GET /daily-metrics/recovery?from=2026-05-01&to=2026-05-12
```

**Response:**

```json
{
  "date": "2026-05-12",
  "recovery": 73,
  "components": {
    "hrv": 42,
    "sleep": 25,
    "rhr": 6
  },
  "yesterdayActivityScore": 480,
  "ceiling": 625,
  "strainDebt": 0.768,
  "penalty": 0.23
}
```

**Logic:** See `old-formulas.md` — Recovery Score section. Requires:

- Daily metrics for HRV, sleep, RHR (with min/max for percentile)
- Yesterday's Activity Score (to compute strain-debt penalty)
- Strain-debt ceiling (90th percentile of Activity Scores in window)

---

### 2. `/daily-metrics/recovery/series` (Priority: HIGH)

**Purpose:** Daily recovery score for charting a trend line.

**Request:**

```
GET /daily-metrics/recovery/series?window=30d
```

**Response:**

```json
{
  "points": [
    { "date": "2026-04-13", "recovery": 62, "sleepScore": 78, "bbHigh": 45 },
    { "date": "2026-04-14", "recovery": 58, "sleepScore": 72, "bbHigh": 42 },
    ...
  ]
}
```

**Logic:** Compute recovery score for each day in window (same formula as #1, but as a series). Include sleep score and body battery high for additional context.

---

### 3. `/daily-metrics/fitness-direction` (Priority: HIGH)

**Purpose:** 3-level fitness signal + supporting metrics.

**Request:**

```
GET /daily-metrics/fitness-direction?window=30d
```

**Response:**

```json
{
  "signal": "▲",
  "label": "Improving",
  "color": "#00c853",
  "rhrDelta": -2.3,
  "hrvDelta": 8.5,
  "vo2max": 45.2,
  "chronicFirst": 285,
  "chronicLast": 310
}
```

**Logic:** See `old-formulas.md` — Fitness Direction section.

- Compute 14-day linear regression on RHR and HRV
- Apply thresholds (RHR < -0.05 bpm/day is positive; HRV > 0.1 ms/day is positive)
- Return 3-level signal + supporting metrics (VO2 Max latest, RHR delta, HRV delta, chronic load trend)

---

### 4. `/daily-metrics/training-load` or `/training-load/series` (Priority: HIGH)

**Purpose:** ACWR time series with zones and divergence.

**Request:**

```
GET /daily-metrics/training-load?window=90d
```

**Response:**

```json
{
  "points": [
    {
      "date": "2026-03-14",
      "dailyLoad": 425.5,
      "acute": 380.2,
      "chronic": 350.8,
      "acwr": 1.08,
      "zone": "optimal",
      "divergence": 29.4,
      "divPos": 29.4,
      "divNeg": 0
    },
    ...
  ]
}
```

**Logic:** See `old-formulas.md` — Training Load section.

- Daily load = Activity Score (vigorous×8 + moderate×4 + walking×0.03)
- EWMA acute (λ=0.25, ~7-day half-life) and chronic (λ≈0.069, ~28-day half-life)
- ACWR ratio, zone classification, divergence (acute − chronic) with pos/neg split
- Return full series for charting (ACWR line, divergence diverging bar, zone fill)

---

## Partial Endpoints (🟡) — Expansion Needed

### `/daily-metrics/series` (Current → Extended)

**Current returns (lines 162–186):**

- date, hrv, restingHr, sleepScore, stress, steps, activeKcal, sleepDurationSec

**Missing fields that should be added:**

- `bb_charged`, `bb_drained`, `bb_net` (body battery)
- `deep_sleep_sec`, `light_sleep_sec`, `rem_sleep_sec`, `awake_sleep_sec` (sleep stages)
- `avg_sleep_stress` (overnight stress)
- `vo2_max` (for fitness trends)
- `hrv_weekly_avg` (for trends)
- `max_hr` (for activity intensity context)

**Rationale:** Series endpoint should be the one-stop shop for time-series charting. Avoid forcing dashboard to call both `/daily-metrics` (paginated) and `/daily-metrics/series` for the same data.

---

### `/daily-metrics/summary` (Current → Consider Extension)

**Current returns:**

- hrv, restingHr, sleep, stress (current, ma7, ma30, trend for each)

**Missing summaries (optional, but good to have):**

- `activityScore`: current, ma7, ma30, trend (Activity Score MET-min)
- `recovery`: current snapshot (instead of separate endpoint if lightweight)
- `bodyBattery`: current charged/drained/net, ma7 trend

**Rationale:** If dashboard calls `/daily-metrics/summary?window=30d`, it should get all the key summary stats without additional calls. Currently must call `/daily-metrics/series` separately to compute Activity Score.

---

## Activity Score Computation (Semi-Missing)

**Current state:** Raw data available in `/daily-metrics/` (vigorous_intensity_min, moderate_intensity_min, steps), but **not pre-computed**.

**Options:**

1. **Add computed field to `/daily-metrics/series`** (recommended):

   ```json
   { "date": "...", "activityScore": 542.3, ... }
   ```

   Then client can use it directly without recomputing.

2. **New endpoint `/daily-metrics/activity-score/series`:**

   ```
   GET /daily-metrics/activity-score/series?window=30d
   Returns: { points: [{ date, score, scoreMA30 }, ...] }
   ```

3. **Keep client-side** (current state):
   Dashboard computes from raw intensity_min + steps. Simplest, but duplicates logic.

**Recommendation:** Add to `/daily-metrics/series` (option 1) as a computed derived field. Aligns with "server computes, client consumes" philosophy.

---

## Schema Check — Columns Present?

All required raw data **is present** in `daily_metrics` table (schema.ts 18–73):

| Old Formula Field      | DB Column              | Present? |
| ---------------------- | ---------------------- | -------- |
| steps                  | steps                  | ✅       |
| moderate_intensity_min | moderate_intensity_min | ✅       |
| vigorous_intensity_min | vigorous_intensity_min | ✅       |
| resting_hr             | resting_hr             | ✅       |
| min_hr, max_hr         | min_hr, max_hr         | ✅       |
| hrv_last_night_avg     | hrv_last_night_avg     | ✅       |
| hrv_weekly_avg         | hrv_weekly_avg         | ✅       |
| sleep_score            | sleep_score            | ✅       |
| sleep_duration_sec     | sleep_duration_sec     | ✅       |
| deep_sleep_sec         | deep_sleep_sec         | ✅       |
| light_sleep_sec        | light_sleep_sec        | ✅       |
| rem_sleep_sec          | rem_sleep_sec          | ✅       |
| awake_sleep_sec        | awake_sleep_sec        | ✅       |
| avg_stress             | avg_stress             | ✅       |
| avg_sleep_stress       | avg_sleep_stress       | ✅       |
| bb_charged, bb_drained | bb_charged, bb_drained | ✅       |
| bb_highest, bb_lowest  | bb_highest, bb_lowest  | ✅       |
| vo2_max                | vo2_max                | ✅       |

✅ **All raw data is available.** No schema changes needed; only endpoint + computation work.

---

## Sync Infrastructure

**Status:** ✅ **Present and working**

- Cron job: `apps/api/src/cron/garmin-sync.ts` — runs every ~30s, polls `sync_control.refresh_requested`
- Control table: `sync_control` (schema.ts 111–120) — single row (id=1) tracks state
- Endpoints:
  - `GET /daily-metrics/sync-status` — read current state
  - `POST /daily-metrics/refresh` — queue a manual sync
- Heartbeat: optional webhook ping on sync complete (env.GARMIN_HEARTBEAT_URL)

**No work needed here; fully functional.**

---

## Visibility Rules (Data Floor + Today Filtering)

**Current:** Not enforced at API level; client-side only (old dashboard).

**Constants from old code (constants.ts 10–18):**

```
VISIBLE_DATE_MIN        = '2026-04-15'  (hard floor)
HIDE_TODAY_BEFORE_HOUR  = 22            (hide today until 22:00 local)
```

**Recommendation:**

1. **Hard floor (VISIBLE_DATE_MIN):** Add to `.env` as `GARMIN_VISIBLE_DATE_MIN=2026-04-15`. API can optionally filter, or document that client must filter.

2. **Hide today before 22:00:** This is client-specific (local time zone). API cannot enforce. Client must:
   - Check current time
   - If hour < 22, exclude today from aggregates (summary/series)
   - Keep today visible only for Fitness Trends (RHR/HRV) and sleep, which lock in overnight

**No changes strictly required, but document in API comments.**

---

## Test Coverage

**Current tests (present):**

- `daily-metrics.summary.test.ts` — Tests `/daily-metrics/summary` endpoint
- Seed sample daily_metrics rows, call endpoint, assert response schema

**Tests needed for new endpoints:**

- `/daily-metrics/recovery` — assert recovery score formula (HRV + sleep + RHR weights)
- `/daily-metrics/recovery/series` — assert daily recovery for window
- `/daily-metrics/fitness-direction` — assert 14-day slope logic, 3-level signal
- `/daily-metrics/training-load` — assert EWMA recursion, zone thresholds, divergence
- `/daily-metrics/series` (extended) — assert new fields returned

---

## Priority Build Order

1. **P0 (Block dashboard from charting):**
   - Add missing fields to `/daily-metrics/series` (bb\_\*, sleep stages, vo2, hrv_weekly)
   - Implement `/daily-metrics/training-load` (ACWR series)
   - Implement `/daily-metrics/recovery/series` (recovery trend)

2. **P1 (Block hero cards from displaying):**
   - Implement `/daily-metrics/recovery` (snapshot)
   - Implement `/daily-metrics/fitness-direction` (direction signal)

3. **P2 (Nice to have, chart polish):**
   - Add Activity Score pre-computed to `/daily-metrics/series`
   - Extend `/daily-metrics/summary` with activity + recovery + battery summaries
   - Document VISIBLE_DATE_MIN and HIDE_TODAY_BEFORE_HOUR enforcement

4. **P3 (Documentation / future):**
   - Add inline tests for all new computation functions
   - Document magic numbers (weights, thresholds, decay rates) in code comments
   - Create shared `lib/garmin-formulas.ts` for all Garmin-specific math

---

## Known Issues / Gotchas

### 1. Null Handling in Weighted Averages

Recovery Score skips null metrics and re-distributes weight:

```
if HRV is null, skip 0.4 weight → rest share 0.6 (sleep 35/60, RHR 25/60)
```

**Gotcha:** Don't just divide by 3; re-weight the valid components.

### 2. Strain-Debt Ceiling is Dynamic

The "hard day" threshold is the 90th percentile of Activity Scores **in the current window**, not a fixed 1000.

**Gotcha:** Ceiling changes as window changes. Snapshot recovery score depends on which window was used to compute ceiling.

### 3. RHR Z-Score is Flipped

Lower RHR is better, so z-score is negated: `z = -(value - mean) / sd`

**Gotcha:** Allows z-score chart to show "up = improving" across all three metrics (RHR, HRV, VO2).

### 4. Activity Score De-Double-Counts Steps

Each intensity minute is assumed to consume ~100 steps. Those steps must be subtracted before adding walking MET-min.

```
walking_steps = max(0, total_steps - (moderate_min + vigorous_min) * 100)
```

**Gotcha:** If walking_steps goes negative, clamp to 0 (don't double-count in negative).

### 5. EWMA Initialization with Partial Data

Chronic load EWMA takes 28 days to stabilize. Before ~day 28, chronic will be influenced by the first few days' seeding average.

**Gotcha:** Display caveats for early data (first 2–4 weeks) where ACWR is noisy.

### 6. 14-Day Regression on Short Windows

Fitness Direction uses 14-day linear regression. If window < 14 days, only use available days.

**Gotcha:** Slope is unreliable with <3 valid points. Return null if insufficient data.

---

## Files to Create / Modify

### New Files

- `apps/api/src/lib/garmin-formulas.ts` — All Garmin-specific math (recovery, acwr, fitness direction, etc.)
- `apps/api/src/routes/garmin-health-recovery.ts` — `/daily-metrics/recovery`, `/daily-metrics/recovery/series`
- `apps/api/src/routes/garmin-health-training-load.ts` — `/daily-metrics/training-load`
- `apps/api/src/routes/garmin-health-fitness.ts` — `/daily-metrics/fitness-direction`
- Tests for each: `*.test.ts` alongside route files

### Modify Existing

- `apps/api/src/routes/daily-metrics.ts` — Extend `/daily-metrics/series` response schema, add new fields to SELECT
- `apps/api/src/db/schema.ts` — (no changes needed; all columns present)
- `apps/api/src/lib/formulas.ts` — (optionally add Garmin formulas here or separate file)

---

## Deliverables Checklist

- [ ] All raw data available in `/daily-metrics/` and `/activities/` ✅
- [ ] Sync control & cron functional ✅
- [ ] Window filtering (7d/30d/90d/all + custom) implemented ✅
- [ ] `/daily-metrics/series` extended with bb, sleep stages, vo2, hrv_weekly
- [ ] `/daily-metrics/recovery` endpoint (snapshot)
- [ ] `/daily-metrics/recovery/series` endpoint (trend)
- [ ] `/daily-metrics/fitness-direction` endpoint
- [ ] `/daily-metrics/training-load` endpoint (ACWR + divergence)
- [ ] Formulas documented & tested in `lib/garmin-formulas.ts`
- [ ] Dashboard fully ported (no client-side formula duplication)
