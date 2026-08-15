# Astro & Marine Window Planner — Progress Log

Durable state for the build described in `docs/ASTRO-WINDOW-BRIEF.md`. Written so a
session with **none** of the original context can resume from here.

**Branch:** `feat/astro-window` (never `master` — `master` auto-deploys to production).

---

## Status at a glance

| Phase                                     | State                                      |
| ----------------------------------------- | ------------------------------------------ |
| 1 — scoring engine (pure)                 | **DONE**, every acceptance number verified |
| 2 — API (`/astro/window`, `/astro/sites`) | not started                                |
| 3 — dashboard page (gauntlet-loop)        | not started                                |
| 4 — marine                                | not started (gated on phase 3 sign-off)    |

## How to verify what exists

```bash
# Pure unit tests — no database, no network.
DATABASE_URL=postgres://x@localhost/x API_SECRET=x bun test --cwd apps/api src/lib

bun run --cwd apps/api typecheck
bunx oxlint apps/api/src/lib
```

At the last commit: **429 pass / 0 fail** across 21 lib files, typecheck clean,
0 lint errors in `apps/api/src/lib` (4 pre-existing `consistent-function-scoping`
warnings, none in the new files).

---

## Phase 1 — the scoring engine

### What was built

| File                                  | Role                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/lib/window-score.ts`    | Domain-agnostic engine: hard gates + weighted factors → 0–100 + verdict. Knows nothing about the sky.        |
| `apps/api/src/lib/astro-ephemeris.ts` | Galactic-core alt/az from first principles. Zero dependencies.                                               |
| `apps/api/src/lib/astro-night.ts`     | One night resolved: astronomical darkness, moon, the shooting window. Wraps `astronomy-engine` for sun/moon. |
| `apps/api/src/lib/astro-score.ts`     | The astro instantiation — thresholds and weights over the engine.                                            |
| `…/*.test.ts` (4 files)               | 93 tests covering all of the above, including every acceptance number in the brief.                          |

The split is deliberate. `window-score.ts` is the piece phase 4 reuses verbatim —
marine is a second `WindowConfig`, not a second engine. Nothing astro-specific
may leak into it.

### Design decisions taken inside the engine

- **A missing factor is not a bad factor.** `value()` returning `null` means _no
  data_; the factor drops out of both numerator and denominator, and the result
  carries a `coverage` field (0–1) saying how much of the configured weight
  actually had data behind it. Without this, one dead upstream would silently
  read as "terrible night" instead of "less confident".
- **Every gate is evaluated, not just the first failing one** — the operator
  wants to know the moon _and_ the cloud killed it. Two exceptions: the
  core-altitude and moon gates short-circuit when the darkness gate has already
  failed, because with no astronomical night there is no window for them to
  describe, and listing them is noise on a night that is already over.
- **Cloud is not scored linearly to 100%.** A 13° target dies to low cloud long
  before overcast: `CLOUD_RUINS_AT = { low: 55, mid: 80, high: 100 }` percent.
  Weight alone could not express that — 50% low cloud on a linear-to-100 ramp
  still scores 0.5 on the heaviest factor and lands the night in "good".

### Acceptance criteria — measured results

Every number below was measured, not assumed. Commands to reproduce are above.

| Brief's criterion                                                                                     | Result                                                                             | Verdict                     |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------- |
| Core alt/az within **0.5°** of a reference, three timestamps across a year                            | Five fixtures committed; worst deviation **0.0031°**                               | PASS, 160× inside tolerance |
| Core altitude never exceeds **~13°** at Munich across a full simulated year                           | **12.917°** apparent (12.846° geometric)                                           | PASS                        |
| Mid-August: core transits **~21:30 CEST**, dark begins **~22:30**, engine recommends the _first_ hour | transit **21:24**, dark **22:33**, window **22:35→23:25** (peak at the very start) | PASS                        |
| Moon phase and rise/set within **2 minutes** of a published reference                                 | Worst deviation vs USNO across five dates: **0.5 min**                             | PASS                        |
| June at 48.14°N returns **zero** astronomical-night hours                                             | **70 minutes**, not zero — see below                                               | **CRITERION IS WRONG**      |
| Pure unit tests, no DB                                                                                | 93 astro/engine tests, DB-free                                                     | PASS                        |

### The one criterion that had to be reversed — June is not zero

The brief asserts "June at 48.14°N returns **zero** astronomical-night hours (sun
peaks at −18.4°)" and calls it the single best regression test in the document.
It is internally contradictory: −18.4° _is_ below the −18° threshold, so there is
astronomical night — just barely.

The arithmetic, at the 2026 solstice, Munich:

- Sun's lower-culmination altitude = `dec + lat − 90` = `23.44 + 48.14 − 90` = **−18.42°**.
- It therefore spends **~70 minutes** below −18°, centred on solar midnight
  (00:40–01:50 CEST). Verified two ways: our engine, and the closed-form
  hour-angle solution for when the altitude crosses −18°.
- True zero starts at `90 − 23.44 − 18` = **48.56°N**, about 47 km north of Munich.

The operator's own note is the careful version and does not have this problem:
_"the sun only reaches −18.4° here, so June gives minutes of astronomical night,
not hours"_. 70 minutes is minutes-scale; the brief over-translated it to zero.

**What was done:** the regression test asserts both true facts —
~70 min at Munich, and exactly zero at 48.56°N and north. The sliver test catches
every bug the original criterion was aimed at (a sign error, a timezone error, or
an off-by-one on the twilight threshold each move this number by hours), and the
latitude sweep gives the literal zero the brief wanted, at the latitude where it
is real. See `astro-night.test.ts` → `June at 48.14°N — the twilight regression`.

**Consequence worth flagging to the operator:** June is not a write-off at Munich.
2026-06-21 yields a 65-minute window with the core at its full 12.9° ceiling —
short, but at maximum altitude. The engine will surface those nights.

### Reference data used, and why it is not circular

Two independent references, neither of which shares code with what it checks:

1. **`astronomy-engine`** validates the hand-rolled galactic-core ephemeris.
   Different precession implementation, different sidereal-time series,
   different refraction model — agreement is evidence, not tautology. Checked at
   five committed fixtures _and_ swept across a full year at 4-hourly intervals
   (worst deviation 0.01°).
2. **U.S. Naval Observatory** validates sun and moon, which _are_ computed with
   `astronomy-engine`, so an internal check would be circular.
   `https://aa.usno.navy.mil/api/rstt/oneday?date=<d>&coords=48.1374,11.5755&tz=0`
   — public, authoritative, no key. Rise/set at minute resolution, plus exact
   phase-event instants (new moon / quarters), which are unambiguous in a way a
   daily illumination percentage is not.

---

## Decisions log

Also recorded in `docs/ASTRO-WINDOW-BRIEF.md` → Decisions log, in short form.

### D1 — 2026-08-15 — Galactic-core geometry is hand-rolled, not a library

As the brief specifies. Sgr A\* is a fixed J2000 coordinate, so the whole problem
is precession + sidereal time + one rotation. ~60 lines, zero dependencies,
verified to 0.003°. **Precession is not optional**: skipping it costs 0.41° of RA
by 2026, which is close to the entire 0.5° acceptance budget on its own.

### D2 — 2026-08-15 — `astronomy-engine` replaces `suncalc` for sun and moon

**This reverses an explicit choice in the brief**, on evidence the brief could not
have had. The brief says "use `suncalc` (npm) for moon phase, moonrise/set and
astronomical twilight" _and_ sets an acceptance bar of "moon phase and rise/set
within 2 minutes of a published reference". Those two are not compatible.

Measured against USNO at Munich, five dates:

| Date                  | suncalc moonset Δ | astronomy-engine moonset Δ |
| --------------------- | ----------------- | -------------------------- |
| 2026-08-15            | +8.7 min          | −0.01 min                  |
| 2026-09-10            | +9.7 min          | −0.35 min                  |
| 2026-12-01 (moonrise) | −10.6 min         | −0.50 min                  |

suncalc misses the bar by 5×. `astronomy-engine` (MIT, zero runtime deps, pure
JS/TS, ~180 kB) lands inside one minute on every event tested, and also covers
twilight and illumination — so it is **one** dependency where the brief's route
needed two (suncalc + a validator). suncalc and `@types/suncalc` were removed.

When two instructions in the brief conflict, the falsifiable acceptance number
wins over the implementation hint. Recorded here rather than silently swapped.

### D3 — 2026-08-15 — Factor weights and cloud thresholds

The brief fixes the _ordering_ (low cloud heaviest, transparency second, mid
moderate, high light, Bortle static, seeing ignored) but not the numbers. Chosen:

```
cloudLow 5 · transparency 3 · cloudMid 2 · bortle 1.5 · cloudHigh 1
```

Bortle sits below transparency deliberately, following the operator's own
framing: _"a clear southern horizon matters more than a dark sky, and low haze is
the enemy rather than the light dome."_ The drive south buys darkness, but
darkness is not the binding constraint at 48°N.

`seeing` is **absent from the config entirely**, not weighted at zero — a test
asserts no factor with that id exists, so a future edit cannot quietly add it.

### D4 — 2026-08-15 — Verdict bands

`excellent ≥ 80 · good ≥ 65 · marginal ≥ 45 · poor` for scored nights, and a
separate `out` reserved for gated ones. A gated night can never be banded by
score — it is out for a _named physical reason_, which is different information
from "scored low", and the API keeps them distinct.

### D5 — 2026-08-15 — Observer elevation is sea level

`OBSERVER_HEIGHT_M = 0`. The API contract carries lat/lon only, and a few hundred
metres of elevation moves rise/set by a couple of minutes — inside the noise of
"is tonight worth driving for". Revisit only if per-site elevation is added.

---

## Open items / what the next session should pick up

1. **Phase 2 — the API.** Not started. The brief's plan holds: `apps/api/src/routes/astro.ts`,
   mounted in **`src/app.ts`** (NOT `src/index.ts` — both `apps/api/CLAUDE.md` and
   `.claude/rules/openapi.md` say `index.ts` and are **stale**; routes have moved to
   `app.ts`, and must go _after_ the `authGuard` `.use()` at `app.ts:243`).
2. **OpenAPI tag.** The allowed-tag enum has no home for this. Adding one requires
   three files in lockstep: the table in `apps/api/.claude/rules/openapi.md`, the
   `documentation.tags` array in `app.ts`, and the hardcoded `tags` string array in
   the discovery route in `app.ts`. (Note: `Usage Tracking` is already registered in
   `app.ts` but missing from `openapi.md`'s table — a pre-existing drift, don't
   "fix" it by deleting the tag.)
3. **Geocode cache.** `weather.ts` holds a module-scope `Map` pre-seeded with
   Munich. The clean share is to lift `ResolvedLocation` / `MUNICH` / `geocodeCache`
   / `geocodeCity` / `OPEN_METEO_GEOCODING` into `apps/api/src/lib/geocode.ts` — a
   pure move; nothing else in `weather.ts` depends on those symbols.
4. **No map dependency exists anywhere in the repo.** Phase 3's map is the one real
   new dependency, and `@visx/geo` is not in the pinned visx 4.0.0 set either.

## Blockers

None so far.
