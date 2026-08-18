# Astro & Marine Window Planner — Progress Log

Durable state for the build described in `docs/ASTRO-WINDOW-BRIEF.md`. Written so a
session with **none** of the original context can resume from here.

**Branch:** `feat/astro-window` (never `master` — `master` auto-deploys to production).

---

## Status at a glance

| Phase                                     | State                                      |
| ----------------------------------------- | ------------------------------------------ |
| 1 — scoring engine (pure)                 | **DONE**, every acceptance number verified |
| 2 — API (`/astro/window`, `/astro/sites`) | **DONE**, verified live + trace-checked    |
| 3 — dashboard page (gauntlet-loop)        | **DONE** — won blind in 2 of 2 rounds      |
| 4 — marine                                | **DONE** — API + page, verified live       |

## How to verify what exists

```bash
# Pure unit tests — no database, no network.
DATABASE_URL=postgres://x@localhost/x API_SECRET=x bun test --cwd apps/api src/lib

bun run --cwd apps/api typecheck
bunx oxlint apps/api/src/lib
```

At the last commit: **708 pass / 0 fail** across 42 files (`bun test:api`), typecheck
clean on both apps, `bun run lint` 0 errors (23 pre-existing warnings), `bun run
format:check` clean.

The integration tests need the dev stack up: `cd ~/SourceRoot/vps && make up`.

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

## Phase 2 — the API

### What was built

| File                                           | Role                                                                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/routes/astro.ts`                 | `GET /astro/window` and `GET /astro/sites`. Mounted in `src/app.ts` after `authGuard`.                                  |
| `apps/api/src/clients/astro-upstreams.ts`      | DWD ICON + Open-Meteo global + 7Timer, in parallel, cached, never throws.                                               |
| `apps/api/src/lib/astro-sites.ts`              | The four candidate sites. Bortle baselines until the map rebuild replaced them with measured sky + terrain — see below. |
| `apps/api/src/lib/geocode.ts`                  | Lifted out of `weather.ts` so both routes share one cache.                                                              |
| `…/astro.test.ts`, `…/astro-upstreams.test.ts` | 47 offline tests — injected clock, injected fetch, injected model.                                                      |

### The response shape, and the one thing to understand about it

Top-level `verdict` / `score` / `bestWindow` / `killers` describe the **best night
in the range**, not tonight. The question the feature exists to answer is _when
should I go_, and tonight being the answer is usually a coincidence. `nights[]`
carries every night for an at-a-glance strip; `detail.hourly` carries a 30-minute
series for exactly one night (the best one, or `?detailDate=`).

Location resolves `site` > `lat`+`lon` > `city` > Munich. A raw coordinate inherits
its sky darkness from the nearest known site **only within 150 km** — past that it
reports `darknessSource: 'unknown'`, sky darkness drops out of the score and
`coverage` falls. Returning Munich's sky for a request in Tenerife would have
been worse than admitting ignorance.

> **Superseded 2026-08-18 by the map rebuild** (`docs/ASTRO-MAP-RESEARCH.md`, branch
> `feat/astro-map`). This section originally read `bortle` / `bortleSource`. There is no
> `bortle` field anywhere in the code any more: sites carry measured
> `mpsas`/`lpi`/`zone`/`trend10yPercent`/`coreDirectionMpsas`/`domePenaltyMag`/`southHorizonDeg`/`siteElevationM`,
> the location block reports `coreDirectionMpsas` + `domePenaltyMag` + `darknessSource`, and
> `?bortle=` was replaced by `?coreMpsas=`. The dated decision log further down (D1–D10) is
> history and was **not** rewritten — read `bortle` there as "the sky-darkness factor", which is
> now `coreDarkness`, same weight and same ordering, scored on measured mag/arcsec² rather than a
> hand-typed class.

`verdict: 'out'` is not a low score. It means a hard gate failed and `killers` says
which; the API never conflates the two.

### Verified live, not just green

`bun dev`, then real requests against the real upstreams (2026-08-15):

| Site         | Verdict   | Score | Best window     | Generated sentence                                                                                       |
| ------------ | --------- | ----- | --------------- | -------------------------------------------------------------------------------------------------------- |
| Alpenvorland | excellent | 80.9  | Sat 22:35–23:30 | "Saturday 22:35 — core 11.6°, moon 13%, low cloud 0%; excellent, best window."                           |
| Munich       | good      | 71.6  | Sat 22:35–23:25 | "Saturday 22:35 — core 11°, moon 13%, low cloud 0%; best window this month."                             |
| Walchensee   | good      | 75.1  | Sat 22:35–23:30 | "Saturday 22:35 — core 11.9°, moon 12%, low cloud 0% but high 100%; mid 45% clouds threaten the window." |

The ten-night strip behaves the way the physics says it should: 2026-08-15 is a
new-moon night and scores highest; from 2026-08-19 the moon crosses 25% and every
remaining night returns `out` with killer `moon`, regardless of how clear it is.
2026-08-24 is completely cloudless and still `out` — which is the correct answer
and the reason gates exist separately from factors.

### Trace verified in ClickStack

One cold request, `TraceId 94e491d798cdae5f27da14c4df60aa36`:

| Span                                 | Kind                   | Start (epoch ms) | Duration |
| ------------------------------------ | ---------------------- | ---------------- | -------- |
| `GET /astro/window`                  | Server (the only root) | …602021          | 471.4 ms |
| `fetchAstroUpstreams`                | Internal               | …602022          | 432 ms   |
| `GET api.open-meteo.com/v1/dwd-icon` | Client                 | …602022          | 19.8 ms  |
| `GET api.open-meteo.com/v1/forecast` | Client                 | …602022          | 19.9 ms  |
| `GET www.7timer.info/bin/api.pl`     | Client                 | …602022          | 431.5 ms |

All three client spans start on the same millisecond — genuinely parallel, not a
waterfall. Every span name appears exactly once, so there is no N+1, and there are
no DB spans because the endpoint touches no database. 7Timer alone accounts for
essentially the whole request; with the 60-minute cache that cost is paid once an
hour per location. A warm request is ~50 ms.

The `/otel` MCP tool failed twice (`Session exited with code 1`), so this was
verified by querying ClickHouse directly at `http://localhost:8123` against
`default.otel_traces`. Recorded as a tool blocker, not a feature blocker.

### The reasoning-model trap, worth remembering

`aiComplete()` runs on DeepSeek V4 Flash, a **reasoning** model, and `max_tokens`
caps hidden reasoning tokens and visible content **together**. The first
implementation used `maxTokens: 90` — enough for a 25-word sentence, nowhere near
enough for the reasoning that precedes it. The call returned HTTP 200 with
`finish_reason: "length"` and `content: ""`. No error, no log, just a permanently
null `summary` that looked like the model being unhelpful.

Measured against the final prompt: 300 → 300 reasoning tokens and empty content;
600 → 288 reasoning + a good sentence; 1200 → 205 reasoning. Note that tightening
the _style_ instruction made it deliberate **more**, not less. Settled on 900, and
an empty completion now logs a warning naming the budget.

---

## Phase 3 — the dashboard page, run as a gauntlet

### The bar, and how it was obtained

PhotoPills' Planner, judged on **information density and scannability only** — the
brief pre-decided this, so gauntlet-loop's "offer two or three bars and wait" step
was skipped deliberately.

A bar has to be _fetchable_ or the critic invents the comparison. PhotoPills is a
native app and `photopills.com` returns 403 to a plain fetch, so the reference came
from the App Store's own metadata instead:
`https://itunes.apple.com/lookup?id=596026805` → `ipadScreenshotUrls`, with the
`552x414bb.jpg` suffix rewritten to `2048x2048bb.jpg` for the full-resolution
original. The second iPad screenshot is the Planner. It was cropped out of its
marketing frame with ffmpeg (`crop=1582:1186:233:348`) so the critic sees the UI and
not the yellow campaign background.

Reference and screenshots live in `.gauntlet/` (gitignored) and `/tmp/astro-gauntlet/`.

### What the bar actually teaches

Not its palette — a satellite basemap and saturated overlays are the opposite of
this app's law. What it does well is structural, and worth copying exactly:

- A narrow right rail of ~7 labelled micro-tables, each 2–4 rows of `label · value`,
  numerals mono and right-aligned so the eye drops one vertical line.
- Comparison by adjacency — Sun and Moon on the _same_ rows, not in two panels.
- A full-width time scrubber along the bottom with the altitude curves drawn over a
  twilight-banded background.
- Tellingly, it already has `Visibility GC` and `Galactic Center` azimuth/elevation
  rows. The bar is aimed at exactly this problem.

### Round 1

Built, validated (dashboard typecheck + `bun run lint` incl. the theme guard +
`format:check`, all clean) and screenshotted at 1600×1200 against the live API.

**Two map bugs that only a real browser could have found** — both invisible to a
passing typecheck, and worth remembering:

1. **Vite's dependency optimizer breaks MapLibre's worker.** It rewrites maplibre's
   ESM entry but cannot follow the sibling import the worker makes, so the worker
   request 503s. MapLibre does not surface this as an error — the map simply renders
   a black canvas with a working attribution bar, which looks like a styling problem.
   The fix is the documented one: `import workerUrl from
'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'` plus `setWorkerUrl(workerUrl)`
   before the first `new Map(...)`. A plain `?url` breaks the production build instead.
2. **Attribution printed twice.** OpenFreeMap's _style_ JSON carries no attribution —
   which is what the research said and why `customAttribution` was passed — but the
   _TileJSON_ the style points at (`/planet`) does, as linked HTML, and MapLibre
   renders it automatically. Dropping `customAttribution` leaves exactly one, and the
   canonical linked version at that.

A third defect, found in the same screenshot: the map canvas was built while the
lazy-loaded component's grid column was still settling, leaving a black gutter down
the right of the card. MapLibre has no internal resize observer; one was added.

### Round 1 — the blind critic's verdict

A separate agent with fresh context, given the two images as `design-a.png` /
`design-b.png` with no indication of which was which, and told explicitly that
palette, saturation and "liveliness" were out of scope.

**Verdict: ours.** Its reasoning, paraphrased: our right rail is one four-block
numeric ledger with values right-aligned in a single mono column, where the
reference's is eight loosely-boxed cards with inconsistent internal layouts and two
holding only `-` placeholders; and the reference _has no verdict at all_ — it shows
raw ephemeris and leaves "is tonight worth it" to the reader.

That last point is worth keeping: the thing this feature adds over the app it is
being measured against is the verdict, not the numbers.

The critic still returned five defects in ours, all real:

1. The map canvas filled only the left ~55% of its card.
2. Cloud chart — low cloud sat flat at 0% and was indistinguishable from the axis
   rule; mid and high were near-identical oranges that merged where they crossed.
3. The two charts used different x-scales (90-minute vs 30-minute ticks), so a cloud
   value could not be read against the shooting-window band above it.
4. The header stated the same five facts three times.
5. Six of the ten strip columns showed `—` and a grey bar: structurally present,
   informationally empty.

Plus two omissions the critic did not catch but the brief had asked for: the score
breakdown group, and the transparency + Bortle rows in the facts panel.

Round 2 fixes exactly those. `cloudHigh` moved from sepia to **neutral** in the
process — partly for legibility, but it is also the more correct reading of "ink
earns its colour": high cirrus costs a little contrast and nothing else, so it
should not carry a hue at all.

One of the two "omissions" turned out not to be one: the Score group and the
transparency/Bortle rows _were_ implemented in round 1 — they sat below a scroll
fold inside a fixed-height panel, so neither the screenshot nor the critic ever saw
them. That is its own density defect and the more interesting bug: the densest block
on the page was invisible. The panel now sizes to its content and the map matches it.

### Round 2 — the critic again, sides swapped

Same protocol, fresh agent, **A and B swapped** so a positional bias could not carry
over. **Ours won again.** Its reasoning this time: ours answers the question in the
first 200 px (verdict, score, window, limiting factor, sentence) and then gives a
strip whose columns align; the reference spends 75% of its area on a map and crams
every number into a rail of seven weakly-separated blocks, four of which are the same
Sun/Moon/twilight family with no hierarchy between them.

Two wins out of two, with the sides swapped, is the gauntlet's exit condition — three
of the allowed six rounds were used.

It named five residual defects in ours. Three were real and are fixed in round 3:

1. **Cloud layers: low cloud flat at 0% and indistinguishable from the axis.** Fixed
   by moving the story out of the plot: a series that holds one value all night now
   says so in the legend — "Low cloud — 0% all night", which for low cloud is the best
   news on the page and was previously the hardest thing to see.
2. **The window was stated twice in text** (hero + facts panel). The facts row now
   carries the window's _length_ instead of repeating its range.
3. **The strip's columns switched meaning mid-row** — score for four cells, "moon 48%"
   for six. Now every row keeps one meaning all the way across: a ruled-out night reads
   `OUT` in the score slot, and its reason lands in the last row, displacing the moon
   figure it would otherwise have duplicated.

One was out of scope (empty space in the app-shell sidebar — that is every argo page,
not this one).

**And one was wrong.** The critic claimed the two stacked charts had different left
gutters so you could not read straight down. Checked against the live DOM: both SVGs
render at the same left edge and width with an identical `translate(44, 12)`, the
first x-tick occupies pixels 298–331 in both and the last 1513–1546, and the y-tick
labels share a right edge. The impression comes from the y-label strings differing in
width (`-20°` vs `0%`) while right-anchored to the same line. Recorded in
`RALPH_NOTES.md` under "Rejected findings" rather than acted on — a critic is
evidence, not an oracle, and re-fixing a non-bug is how a loop like this burns a night.

### Verified working, not just green

- `bun run --cwd apps/dashboard test` → 114 pass; `bun test:api` → 708 pass; both
  typechecks clean; `bun run lint` (incl. the theme guard) and `format:check` clean.
- Loaded at 1600×1200 against the live API and screenshotted at every round.
- **Location switching genuinely re-queries**, checked in the live DOM rather than
  assumed: `?site=bayerischer-wald&nights=14` moves Bortle 4 → 3, the strip from 10 to
  14 columns, and the limiting factor from "high cloud 37%" to "sky darkness 75%".

---

## Phase 4 — marine

Started only after phase 3 signed off, per the brief's gate.

### The engine held

Marine is a second `WindowConfig`, not a second engine — which is the real test
of whether `window-score.ts` was generic or just astro wearing a generic name. It
held, at the cost of exactly two additions, both genuinely domain-agnostic:

- **`peakScore`** — swell height has a _sweet spot_, not a direction. 0.2 m is
  nothing to ride and 6 m closes out, and `linearScore` cannot express that in
  either orientation. Astro has no such factor; marine does.
- **`circularMean`** and **`angularDistance`** — bearings. See the bug below.

Nothing astro-specific leaked into the engine, and a test asserts the astro
factor list so a regression would be caught.

### The physics the thresholds encode

Unlike astro, whose every weighting traces to the operator's own field notes,
**there is no surf note in the vault** — so these are mine, and recorded as
provisional (decision D9):

- **Period is the quality axis, not height.** 1 m at 14 s carries far more energy
  and breaks far better than 1 m at 5 s, which is local chop that happens to be
  the same height. Under 8 s is gated out as windsea rather than scored low.
- **Direction beats speed.** 15 kn offshore grooms a wave; 15 kn onshore destroys
  it. The gate is on direction, speed is only a factor — with a glassy exemption
  under 5 kn so a 2-knot onshore drift does not rule out a still dawn.
- **`shoreNormal` is the load-bearing number** — the bearing you face looking out
  to sea. Offshore wind arrives _from_ `shoreNormal + 180`, which is where the
  sign errors live, so `classifyWind` owns it and nothing computes it by hand.

The four spots are real, well-documented European breaks ordered by drive time
from Munich, with approximate shore normals. `/marine/window` also takes a raw
lat/lon plus `shoreNormal`, so the list never constrains it. The Eisbach — the
actual home break of every Munich surfer — is deliberately absent: a river wave
has no swell or wind to score, and including it would produce confident nonsense.

### Two bugs worth remembering

**Bearings were being averaged arithmetically.** The mean of 350° and 10° is
180° — it turns a north wind into a south one and inverts the offshore/onshore
verdict the entire endpoint hangs on. This was flagged by the implementer as a
known naivety and excused on the grounds that no _shore normal_ sits near the
wrap point; that reasoning is wrong, because it is the _wind_ that wraps, and it
does so routinely. `circularMean` now averages the unit vectors, and returns
`null` — rather than a confident wrong answer — when the day's wind boxed the
compass, at which point the factor drops out and `coverage` falls.

**The reasoning-model token cliff bit again, harder.** Phase 2's fix was to pick
a bigger number (900). That was not enough, because the budget needed is not a
constant: the more open-ended "tell them not to go" marine prompt blew past 900
on two spots out of three, while astro's tighter prompt used 288. The tighter the
style instruction, the _more_ the model deliberates — the opposite of the
intuition. Both routes now go through `lib/ai-sentence.ts`, which starts at 1200
and retries once at 3600 on empty content, so the failure is self-healing and
logged rather than silently producing a null summary forever.

Related: asking the model to "lead with the weekday and the session start" when
there is no session produced the fragment `"No usable day — 6."`. A flat range now
gets its own instruction and its own facts — the closest day, its numbers, and
why it is out.

### Verified live

Mid-August Europe is flat everywhere, which is a good test: all four spots gate on
`swell-period` at 4–5.5 s, exactly right for windsea, and each returns a sentence
naming that reason — e.g. _"Don't go to Hossegor: 0.8m at 5.5s is windsea, not
groundswell — the limiting reason."_ 763 API tests pass.

### The page

`/marine-window`, built as the astro page's sibling and deliberately structurally
identical — same hero, same strip, same map + facts split, same two stacked
charts on a shared x-scale. The astro layout survived three rounds of a blind
critic, so it is treated here as the specification rather than a starting point.

Loading it against the live API found four defects that **only appear when every
day in the range is gated** — which, in a flat European August, is every range,
so it is the common case rather than an edge case:

1. The day strip went nearly blank: `OUT`, `—`, and a truncated killer sentence,
   five times over. It now always carries the day's conditions (`0.8m 5.5s`) plus
   a short id-derived tag (`windsea`) instead of an ellipsised sentence.
2. "Off dead-offshore" was always `—`, because it read from `factors[]`, which the
   engine leaves **empty for a gated day**. It is now computed from the wind
   direction and the shore normal, which are always present. The general lesson:
   anything sourced from `factors[]` silently disappears exactly when a gate fires.
3. The Score group collapsed to a lone "Coverage 0%" row for the same reason; a
   gated day now renders a `RULED OUT` group listing each killer and its reason.
4. The swell timeline's right-hand axis (period, seconds) was clipped against the
   card edge — that chart carries a second axis the shared `VX.margin` does not
   budget for. Its `right` inset is now local, and its `left` deliberately is not,
   because that is what keeps it column-aligned with the wind chart below.

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

---

## Report on stopping

All four phases are done. The branch is `feat/astro-window`, pushed, nine commits,
**not merged** — that is the operator's call, awake, in the morning.

### What works and is verified

|                                                |                                                      |
| ---------------------------------------------- | ---------------------------------------------------- |
| `bun test:api`                                 | 763 pass / 0 fail                                    |
| `bun run --cwd apps/dashboard test`            | 114 pass / 0 fail                                    |
| Both typechecks                                | clean                                                |
| `bun run lint` (incl. `basalt-ui check-theme`) | 0 errors (23 pre-existing warnings, untouched files) |
| `bun run format:check`                         | clean                                                |

Verified as _behaviour_, not just as green:

- **Every phase-1 acceptance number measured**, with fixtures committed. Core alt/az
  within 0.003° against an independent ephemeris (budget: 0.5°); the ~13° Munich
  ceiling; the mid-August transit-before-darkness ordering; moon and sun rise/set
  within 0.5 min of USNO (bar: 2 min).
- **Both APIs exercised against their real upstreams**, not just fakes — three astro
  sites and four surf spots, with the verdicts sanity-checked against physics (the
  moon correctly kills 2026-08-19 onward; every European spot is windsea in August).
- **The `/astro/window` trace inspected in ClickStack**: one root span, three
  genuinely parallel client spans starting on the same millisecond, no N+1.
- **Both pages loaded in a real browser** and screenshotted at every round;
  location switching confirmed to re-query by reading the live DOM.
- **The astro page won a blind A/B against PhotoPills' Planner twice**, with the
  sides swapped between rounds, judged on information density and scannability.

### What is NOT verified

- **Nothing has run in production.** The branch is unmerged by design.
- **No load or cost testing.** The upstream-call arithmetic (dozens/day against a
  10k/day free tier) is reasoned from the cache TTL, not measured over a real day.
- **The map's tile-server-down fallback** has only been exercised synthetically,
  never against a real OpenFreeMap outage.
- **The marine thresholds have never met a real surfer.** They are defensible
  physics, but no session has been ridden against them (see D9).
- **The four surf spots' `shoreNormal` bearings are read off a coastline**, not
  measured. Every wind verdict at a spot is only as good as that one number.
- **Light mode** — the pages were built and judged dark-first, and only the dark
  basemap path was screenshotted.
- **No mobile viewport was checked.** The grids declare `base`/`md`/`lg` breakpoints
  but only the 1600×1200 desktop layout was looked at.

### What I would do next

1. **Correct the four `shoreNormal` values** against something authoritative. It is
   the cheapest available accuracy win in the whole marine surface.
2. **Screenshot both pages in light mode and at a phone width**, and run the critic
   again on whichever looks worse.
3. **Move the upstream cache to Valkey** if argo ever runs more than one instance —
   see `RALPH_NOTES.md`.
4. **An alerting layer.** The brief's stated goal was a system that "speaks first",
   and this build only answers when asked. Everything needed is in place: the
   verdict is deterministic and stable, so a cron that re-scores the range and
   pushes on a transition into `good`/`excellent` is a small addition.
5. ~~Derive Bortle live from the VNL raster, if the static classes ever feel wrong.~~ **Done 2026-08-18**, differently: the Lorenz atlas replaced the static classes with measured zenith and core-direction brightness, and the Bortle field is gone (`docs/ASTRO-MAP-RESEARCH.md` §1.3).

### Assumptions taken that the brief did not decide

Decisions D1–D10 in `docs/ASTRO-WINDOW-BRIEF.md` are the full list with reasoning.
The ones that would most change the work if wrong:

- **`astronomy-engine` replaces `suncalc`** — a direct reversal of the brief, taken
  because its own acceptance number said so (D2).
- **June is not zero astronomical night at Munich.** The brief's single best-loved
  regression test was factually wrong; the corrected facts are asserted instead.
- **In-memory caching rather than Valkey** (D6), a new `Astro & Marine` OpenAPI tag
  rather than overloading `External Data` (D7), and **OpenFreeMap over CARTO**,
  which the brief named as the default and whose terms rule it out (D8).
- **Marine thresholds and spots are mine and provisional** (D9), because unlike
  astro there is no operator note to anchor them.
- **`peakScore`, `angularDistance` and `circularMean` went into the engine**, not
  into the marine config (D10) — they are domain-agnostic, and marine was the first
  real test of whether that module was generic.

## Addendum — 2026-08-18: the marine page was removed

Building astro and marine in one run was too much at once. The **dashboard** side of
marine was reverted: `features/marine-window/`, `routes/marine-window.tsx`,
`lib/queries/marine.ts`, its sidebar entry and its three series
(`swellPeriod`/`swellHeight`/`windSpeed`) are gone, and `Outdoors` now holds Astro
alone.

The **API side stayed** — `/marine/window`, `/marine/spots`, `marine-score.ts`,
`marine-spots.ts`, `clients/marine-upstreams.ts` and their tests are untouched, so
nothing above about the engine, the thresholds or the two upstream-bug fixes is
stale. The surf face gets rebuilt deliberately on top of those endpoints later; this
document stays the record of what it looked like and which four defects a flat week
exposed.
