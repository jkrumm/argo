# Strength Tracker Port — Backend Audit

**Date:** 2026-05-12
**Old code:** `argo-old/packages/dashboard/src/pages/strength-tracker/` (commit `328390f`)
**Current API:** `apps/api/src/routes/workouts.ts`, `apps/api/src/lib/formulas.ts`
**Goal:** Move analytics math server-side (mirror the Garmin port pattern). Frontend becomes display-only.

---

## Decision

Move **all** strength analytics into `apps/api/src/lib/strength-formulas.ts` + new `apps/api/src/routes/strength.ts` (or extend `workouts.ts`). The user's brief overrides `STRENGTH-ANALYTICS.md` lesson #1 ("API returns raw rows, dashboard derives everything"). Reasons:

1. Mirror Garmin port — single mental model.
2. Composite hero stats need DOTS, per-exercise ACWR, percentile landmarks — heavy and pure, perfect server fit.
3. PR detection + achievement evaluation requires reading the whole history; doing it server-side enables a future write-side trigger.

Keep on the client (presentation only):

- VX color mapping, INOL/ACWR zone color choice, direction arrows, "Push/Normal/Rest" verdict text.
- Local hover sync (`HoverContext`).
- The set-editor / workout-form UI state.

---

## Existing API surface (relevant to strength)

| Route                            | Status | Returns                                                                                | Notes                                                    |
| -------------------------------- | ------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `GET /workouts`                  | ✅     | Paginated workouts with sets + computed metrics                                        | Keep as-is.                                              |
| `GET /workouts/:id`              | ✅     | Workout + sets + metrics                                                               | Keep.                                                    |
| `POST /workouts`                 | ✅     | `{ id }`                                                                               | Keep; extend response with achievements (see §3.1).      |
| `PATCH /workouts/:id`            | ✅     | `{ id }`                                                                               | Keep.                                                    |
| `DELETE /workouts/:id`           | ✅     | `{ id }`                                                                               | Keep.                                                    |
| `GET /workouts/summary/strength` | ✅     | `byExercise: [{currentE1RM, bestE1RM, prDate, totalVolumeWindow, sessionCountWindow}]` | Useful baseline — keep, used by exercise summary cards.  |
| `GET /workouts/summary/series`   | ✅     | `byExercise: [{points: [{date, e1rm, volume, maxWeight}]}]`                            | Keep, but add `ma30` + `bestSet` + `inol` fields → §2.2. |
| `GET /weight-log`                | ✅     | Raw entries                                                                            | Keep.                                                    |
| `GET /weight-log/summary`        | ✅     | `{current, ma7, ma30, trend, weeklyDelta, monthlyDelta}`                               | Extend with `kgPerWeek` + `phase` (§2.7).                |
| `GET /weight-log/series`         | ✅     | `points: [{date, weightKg}]`                                                           | Keep; client computes centered MA from points.           |
| `GET /exercises`                 | ✅     | Reference table                                                                        | Keep.                                                    |
| `GET /user-profile`              | ✅     | gender, goal_weight_kg, height, birth_date                                             | Already exists.                                          |

---

## Gap inventory — what we need to add

### Tier A — required for hero cards + most-used charts (Phase 2 must-have)

| #   | Endpoint                                       | Returns                                                                                                                              | Formula source                     | Notes                                                                                                                                                                 |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `GET /workouts/summary/heroes`                 | `{ strengthDirection, loadQuality, balance, readiness? }`                                                                            | `analytics.ts` §2.3–§2.6           | Needs `daily-metrics` lookup for readiness; omit `readiness` when < 7 daily-metric rows. Accepts `?window=` + `?exercises=bench_press,squat,...` (defaults to all 4). |
| 2   | `GET /workouts/summary/series-detailed`        | `byExercise: [{ points: [{date, e1rm, ma30, volume, maxWeight, inol, bestSet:{weight_kg,reps,e1rm}\|null}] }]`                       | utils.ts §1.12–§1.14               | Single endpoint serves e1RM trend, momentum (latest velocity is in `heroes`), and INOL chart data.                                                                    |
| 3   | `GET /workouts/summary/weekly-volume`          | `byExercise: [{ landmarks:{mev,mav,mrv}, points:[{date, warmup, work, drop, amrap, total, ma}] }]`                                   | utils.ts §1.7, §1.9, §1.11         | One endpoint, mirrors `buildWeeklyVolumeData`.                                                                                                                        |
| 4   | `GET /workouts/summary/training-load`          | `byExercise: [{ points:[{date, acute, chronic, acwr, zone}] }]`                                                                      | utils.ts §1.8                      | ACWR EWMA(4)/EWMA(16) per exercise.                                                                                                                                   |
| 5   | `GET /workouts/summary/records`                | `records: [{date, exercise_id, metric, value, unit}]`                                                                                | utils.ts §1.16, §1.19              | Running-max PRs over `max_weight \| estimated_1rm \| total_volume \| total_reps \| work_sets`.                                                                        |
| 6   | `GET /workouts/summary/composite/:exercise_id` | `points: [{date, velocityRaw, tonnageGrowthRaw, inolRaw, velocityZ, tonnageGrowthZ, inolZ, velocityZma, tonnageGrowthZma, inolZma}]` | utils.ts §1.15                     | Strength composite chart; per single exercise (chart shows one).                                                                                                      |
| 7   | `GET /workouts/summary/relative-progression`   | `points: [{date, pct:{bench_press, deadlift, squat, pull_ups}}]`                                                                     | analytics.ts §2.5                  | Per-exercise relative progression.                                                                                                                                    |
| 8   | `GET /workouts/summary/sparklines`             | `byExercise: [{ exercise_id, e1rm:number[], volume:number[], inol:number[], vel, dir }]`                                             | utils.ts §1.6, §1.12, §1.11, §1.13 | Compact arrays for the sparkline grid view.                                                                                                                           |

### Tier B — depends on Garmin daily-metrics (degrades gracefully)

| #   | Endpoint                              | Returns                                                           | Formula source    | Notes                                                     |
| --- | ------------------------------------- | ----------------------------------------------------------------- | ----------------- | --------------------------------------------------------- |
| 9   | `GET /workouts/summary/readiness`     | `points:[{date, readiness, garminRecovery, fatigueDept, driver}]` | analytics.ts §2.6 | Reuse `garmin-formulas.ts::recoveryScore`.                |
| 10  | `GET /workouts/summary/alignment`     | `grid: AlignmentCellData[3][3]`                                   | analytics.ts §2.7 | 3×3 matrix per active exercises set; `?exercises=` query. |
| 11  | `GET /workouts/summary/deload-signal` | `{ verdict, activeSignals[], physioAvailable }`                   | analytics.ts §2.8 | Combines workouts + daily-metrics.                        |

### Tier C — write-side (Phase 2 nice-to-have)

| #   | Change                                                               | Notes                                                                                                                               |
| --- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 12  | Augment `POST /workouts` response with `achievements: Achievement[]` | Implementation in `strength-formulas.ts::detectAchievements`. Frontend triggers confetti when any achievement has `confetti: true`. |

### Tier D — out of scope for the port

- `workouts.rir` schema column — not used by old code, deferred.
- DOTS gender autodetect — `user_profile.gender` may be null; default to `male` and surface a console warning (old behaviour, preserved client-side).

---

## Server-side shared lib

`apps/api/src/lib/strength-formulas.ts` will be the home of:

1. **Per-set helpers** (already in `formulas.ts`): `estimate1RM`, `computeMetrics`, `loadBodyweightResolver`. Re-export, do not duplicate.
2. **Per-workout helpers**: `sessionInol`, `bestSet`, `effectiveWeight`.
3. **Series builders** (pure, take an array of `{ workout + sets }`): `buildOneRmSeries`, `buildInolSeries`, `buildMomentumSeries`, `buildWeeklyVolumeSeries`, `buildAcwrSeries`, `volumeLandmarks`, `buildCompositeSeries`, `buildRelativeProgression`, `buildSparklineRow`.
4. **Hero composites**: `computeStrengthDirectionHero`, `computeLoadQuality`, `computeStrengthRatios` + `computeBalanceComposite`, `dotsAdjusted`.
5. **Readiness/alignment/deload** (take both workouts + daily-metrics arrays).
6. **Achievement detection** (pure): `detectAchievements(exercise, newSets, history)`.

A single `loadWorkoutsForRange(from, to)` helper reduces SQL duplication across the 11 endpoints (returns `[{ workout, sets, exercise_name, exercise_is_bodyweight }]` already joined).

Tests live alongside in `strength-formulas.test.ts` — pure unit tests, no DB.
Integration smoke tests live in `routes/workouts.summary.detailed.test.ts` and `routes/strength.heroes.test.ts`.

---

## Frontend implications

After Phase 2 the dashboard only needs:

- `workoutsQueries.heroes`, `seriesDetailed`, `weeklyVolume`, `trainingLoad`, `records`, `composite(exId)`, `relativeProgression`, `sparklines`, `readiness`, `alignment`, `deloadSignal`.
- Per-page concurrent loader via `Promise.all(...ensureQueryData)`.
- Body weight stays as-is (the existing summary endpoint covers it; chart computes centered MA from points).

No `@argo/charts` API changes anticipated — the existing primitives + `ZonedLine` / `Bars` cover everything in the old visx-charts.tsx. The bespoke `StrengthRatiosChart` (horizontal range bars with thresholds), `StrengthCompositeChart` (z-score multi-line), `WeeklyVolumeChart` (stacked bar + ref-lines), `TrainingLoadChart` (multi-line with zone shading), and `TrainingRecoveryAlignmentChart` (3×3 matrix) need bespoke compositions in `features/strength-tracker/charts/` using re-exported visx primitives.

---

## Risks / decisions

- **`user_profile.gender` may be null** → keep old behaviour: default `male` for DOTS, log a one-time console warning client-side.
- **No `rir` column** → all eligibility gates treat workoutRir as `null` (matches old behaviour where the value was never threaded through).
- **`/summary/strength` overlap with `/summary/heroes`** — keep both. `summary/strength` gives the per-exercise cards used in the right column today. `summary/heroes` gives the three top hero composites.
- **PR endpoint window**: old code computed PRs across `workouts` filtered by the page's window. To match, `/summary/records` accepts the same `?window=` / `from`/`to` params and runs `findPRPoints` on workouts within window. Listing absolute-best-ever PRs is a future enhancement.
- **Composite chart per single exercise** — old code rendered one composite chart picking one "leader". The new endpoint accepts `:exercise_id`; the page calls it for whichever exercise the user picks from a select. Defaulting to the strength-direction leader.

Phase 2 completion criteria: 11 new endpoints + 1 extended endpoint + 1 augmented POST response, all with Zod schemas, OpenAPI summaries, and unit tests for the pure formulas.
