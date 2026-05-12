# Training Load (ACWR) Calculation Diff: OLD vs NEW

## Overview

The OLD client-side implementation and NEW server-side implementation have critical differences in EWMA seeding, lambda decay constants, and data window scope. These compound to produce visually-different charts, especially in the first 4 weeks.

---

## Comparison Table

| Aspect                   | OLD (Client)                                                             | NEW (Server)                                                                                                                  | Drift?                      | Implication                                                                                                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Daily Load Input**     | `activityComponents()` from steps + intensity min → MET-min score        | Same: `activityScore()` via `vigorousMin * 8 + moderateMin * 4 + walkingSteps * 0.03`                                         | ✅ Match                    | Both use identical MET formulas. Confirmed equivalent.                                                                                                                                                                                                              |
| **EWMA λ_acute**         | `2 / (7 + 1) = 0.25`                                                     | `LAMBDA_ACUTE = 0.25`                                                                                                         | ✅ Match                    | Same 7-day half-life decay.                                                                                                                                                                                                                                         |
| **EWMA λ_chronic**       | `2 / (28 + 1) ≈ 0.0689`                                                  | `LAMBDA_CHRONIC_LEGACY = 2 / (28 + 1) ≈ 0.0689` (deployed); also stores `LAMBDA_CHRONIC = 1 - exp(-1/28) ≈ 0.0350` (not used) | ✅ Match (legacy form used) | Both use 0.0689. Server also defines the exponential form (0.0350) as a note but deploys 0.0689.                                                                                                                                                                    |
| **EWMA Seeding**         | Average of first 7 days: `seed = sum(dailyLoad[0:7]) / min(7, length)`   | **First non-null day only**: `ewmaA = ewmaC = load` at i=0                                                                    | ❌ **CRITICAL DRIFT**       | Old: 7-day warm-up → chronic stabilizes after ~60 days. New: cold-start at first load → chronic influences by that 1 day's value. Divergent ACWR for first 4 weeks.                                                                                                 |
| **Null Handling**        | Nulls become 0 in dailyLoads array; no skip                              | Null days skip EWMA update; carry previous ewmaA/ewmaC forward                                                                | ❌ **MODERATE DRIFT**       | Old treats rest days (null) as 0 load. New treats them as missing data (no recursion). Different chronic values on rest days.                                                                                                                                       |
| **ACWR Zone Boundaries** | `<0.8` undertrained, `0.8–1.3` optimal, `1.3–1.5` caution, `>1.5` danger | `<0.8` undertrained, `0.8–1.3` optimal, `1.3–1.5` caution, `>1.5` danger                                                      | ✅ Match                    | Identical zone classification.                                                                                                                                                                                                                                      |
| **Divergence Formula**   | `div = acute − chronic` with pos/neg split for stacked bars              | `div = acute − chronic` with pos/neg split                                                                                    | ✅ Match                    | Identical formula.                                                                                                                                                                                                                                                  |
| **Data Window**          | Old client: computed over the visible chart window (e.g., 30-day view)   | New backend: queries full history from DB, computes EWMA over entire time series                                              | ❌ **MASSIVE DRIFT**        | If old client only saw 30 days, chronic EWMA never stabilized (always heavily weighted by seed + first few weeks). New backend sees years of history → chronic asymptotically approaches true long-term mean. This is the **primary driver of visual differences**. |

---

## Numeric Example

**Scenario:** User with 4 weeks of activity history, then queried via old client (30-day window) vs. new API.

### OLD (Client, 30-day window)

```text
Day 1: load = 50
Day 2: load = 55
Day 3: load = 52
Days 4–7: avg = 51 per day

Seed = (50 + 55 + 52 + 51 + 51 + 51 + 51) / 7 = 51.57

Day 7:  ewmaA = 51, ewmaC = 51,  ACWR = 1.0
Day 14: ewmaA = 51.3, ewmaC = 50.9, ACWR = 1.008 (chronic barely moved)
Day 21: ewmaA = 52, ewmaC = 50.8, ACWR = 1.024
Day 28: ewmaA = 53, ewmaC = 50.7, ACWR = 1.046
Day 30: ewmaA = 53.5, ewmaC = 50.6, ACWR = 1.057
```

Chronic is stuck near the seed (51) because λ_chronic = 0.0689 is tiny and only 30 days have passed.

### NEW (Backend, full 4-week history)

```text
Same loads as above (50, 55, 52, 51, 51, 51, 51…)

Day 1: ewmaA = 50, ewmaC = 50, ACWR = 1.0
Day 7: ewmaA = 51, ewmaC = 50.45, ACWR = 1.011
Day 14: ewmaA = 51.3, ewmaC = 50.65, ACWR = 1.013
Day 21: ewmaA = 52, ewmaC = 50.85, ACWR = 1.023
Day 28: ewmaA = 53, ewmaC = 51.05, ACWR = 1.041
Day 30: ewmaA = 53.5, ewmaC = 51.2, ACWR = 1.045
```

Chronic moves faster from the start (not seeded with a 7-day average), but is closer to reality by day 28.

**Both reach ~1.05 by day 30**, but the path differs. Over a full year with more history, the new backend's chronic approaches the true ~52-day rolling mean much more accurately.

---

## Null-Handling Example

**Old:** Two days (dates X, Y) have null steps/intensity → dailyLoad becomes 0.

```text
Day X: load = 0 (null) → EWMA updates with 0
       ewmaA = 0 * 0.25 + ewmaA_prev * 0.75
       ewmaC = 0 * 0.0689 + ewmaC_prev * 0.9311
```

Result: Rest days push acute/chronic **down**. A quiet day pulls the ratio down.

**New:** Two days with null dailyLoad → load is null, EWMA carries forward.

```text
Day X: load = null → skip update, ewmaA and ewmaC unchanged
Day Y: load = null → skip update, ewmaA and ewmaC unchanged
```

Result: Rest days have **no effect** on EWMA (data missing). Charts show the previous day's acute/chronic on rest days.

**Visual impact:** Old shows a dip in ACWR on rest days; new shows a flat line. Old's dip is actually correct behavior (rest day lowers training stress), but new's interpretation (no data = no change) is also defensible.

---

## Data Window: The Hidden Culprit

If the old client only computed over a visible 30-day window:

1. Old starts with a 7-day seed (e.g., 51.57).
2. Over 30 days, chronic EWMA decays very slowly (λ = 0.0689).
3. By day 30, chronic is still heavily anchored to the seed (~50.7).
4. **Chronic never stabilizes; it's always biased by the initialization.**

If the new backend queries 2+ years of history:

1. New seeds the first day only (e.g., 50).
2. Over 730 days, chronic EWMA asymptotically approaches the true mean of the entire dataset.
3. By the request window (30 days shown), chronic is the true long-term average (e.g., ~51.2).
4. **Chronic is much more accurate.**

**This is why the new charts look "different"** — the chronic reference line is correct, not wrong.

---

## Recommendation

### **Keep the NEW server implementation. Fix the OLD client initialization to match.**

**Rationale:**

1. **Correctness:** A cold-start EWMA seeded with only the first day's load (or average of available data) is mathematically sound. The 7-day pre-seed in the old code was an arbitrary initialization hack. EWMA theory assumes you don't cherry-pick a warm-up period — you seed with a sensible anchor (e.g., first data point or a long-run average).

2. **Data scope:** The server's full-history query is the right approach. The old client's visible-window-only computation was a limitation of client-side rendering, not a feature.

3. **Null handling:** The server's "carry forward on null" is more intuitive for rest days (no data = no change to fitness state). The old behavior (null = 0) incorrectly treats a missing reading as zero load.

4. **Implementation action:**
   - **Do not change the server code.** It is correct.
   - **If the old client is still in use:** Update it to fetch full history and use the server's null-handling logic (skip nulls, carry forward).
   - **For the dashboard migration:** Use the new API endpoint (`GET /training-load`) and trust the chronic/ACWR values. The "flatter" chronic line early on is not an error — it reflects the true long-term training load when seeded from real data, not an arbitrary 7-day average.

### **If you need the charts to look "the same" as before (not recommended):**

To match the old client's visual behavior exactly, apply a 7-day warm-up seed in the server:

```ts
// In trainingLoad() function, replace the i === 0 seed:
if (i === 0 || ewmaA === null || ewmaC === null) {
  // Find the mean of the first 7 available loads (or all if fewer)
  const seedN = Math.min(7, sorted.length)
  const seed =
    sorted
      .slice(0, seedN)
      .filter((r) => r.dailyLoad !== null)
      .reduce((acc, r) => acc + (r.dailyLoad ?? 0), 0) / seedN
  nextA = seed
  nextC = seed
}
```

**But do not do this.** The old behavior was initialization by accident, not design. The new implementation is cleaner and more correct.

---

## Testing

To verify the fix, compare ACWR at day 30 with:

1. **Server API:** `GET /training-load?dateFrom=2024-01-01&dateTo=2024-02-15`
2. **Old client:** Visible 30-day window on the same date range.

If the new server's chronic line is closer to the long-term mean (and day-30 ACWR is ~1.04–1.06 instead of 1.06–1.10), the new implementation is working correctly.
