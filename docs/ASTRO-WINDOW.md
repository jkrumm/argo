# Astro & Marine Window Planner — Status

The one page for the window planner: what it is, what shipped, how to verify it, and every
decision that shaped it. It replaces the original build brief (`ASTRO-WINDOW-BRIEF.md`) and the
progress log (`ASTRO-WINDOW-PROGRESS.md`), both retired 2026-09-07 — the brief's phases are all
done and the log's measurements are summarised here. The two research documents stay authoritative
for their own subjects: `ASTRO-MAP-RESEARCH.md` (light pollution, the map, the weather layers) and
`ASTRO-HORIZON-RESEARCH.md` (terrain horizons, the annual visibility budget).

## What it answers

**"Is tonight (or this week) worth going out for?"** — first for Milky Way nightscapes, then for
surf. Built as an argo API surface plus one argo dashboard page, not a new service. Locationscout,
PhotoPills, Stellarium and Clear Outside stay for spots, on-site AR and the sky atlas; this is only
the decision layer, weighted for the operator's actual constraint (`brain` →
`Areas/Photography/Astro/Night Workflow.md` §1): Munich, 48.14°N, where the galactic core never
climbs past ~13°, a clear southern horizon matters more than a dark sky, low haze is the enemy,
anything past first quarter kills the core, and June gives minutes of astronomical night.

## Status at a glance

| Piece                                          | State                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scoring engine (`lib/window-score.ts`)         | **Shipped.** Domain-agnostic: hard gates that name _why_ a night is out plus weighted 0–1 factors → 0–100 + verdict. Knows nothing about the sky; marine is a second `WindowConfig`, not a second engine.                                                                                                                                                                             |
| Astro ephemeris + night resolution             | **Shipped.** `astro-ephemeris.ts` (galactic-core alt/az from first principles, zero deps, within 0.003° of an independent ephemeris), `astro-night.ts` (astronomical darkness, moon, the shooting window; `astronomy-engine` for sun/moon), `astro-score.ts` (the astro thresholds and weights).                                                                                  |
| API                                            | **Shipped, in production.** `GET /astro/window`, `/astro/sites`, plus the map-rebuild endpoints `/astro/light-pollution`, `/astro/skyglow`, `/astro/horizon`, `/astro/visibility` and the `/astro/tiles/lp/…` raster route. Upstreams (DWD ICON, Open-Meteo, 7Timer) are fetched in parallel, cached in memory, and never throw. `aiComplete()` writes one sentence about a finished verdict. |
| Dashboard page                                 | **Shipped.** `/astro-window` — hero, night strip, map + facts, two stacked charts on a shared x-scale, the sky panorama and the monthly budget chart. Won a blind A/B against PhotoPills' Planner twice, sides swapped between rounds.                                                                                                                                            |
| Marine                                         | **API only.** `/marine/window` and `/marine/spots` (`marine-score.ts`, `marine-spots.ts`, `clients/marine-upstreams.ts`) are tested and live; the `/marine-window` page was removed 2026-08-18 and gets rebuilt deliberately on top of those endpoints.                                                                                                                             |
| Alerting ("speaks first")                      | **Not built.** The verdict is deterministic and stable, so a cron re-scoring the range and pushing on a transition into `good`/`excellent` is a small addition — it just has not been made.                                                                                                                                                                                      |

## How to verify

```bash
# Pure unit tests — no database, no network
DATABASE_URL=postgres://x@localhost/x API_SECRET=x bun test --cwd apps/api src/lib

# Everything, including the offline route tests (dev Postgres up: cd ~/SourceRoot/vps && make up)
bun test:api
bun run --cwd apps/api typecheck && bun run --cwd apps/dashboard typecheck
```

Verified as behaviour, not just as green: every phase-1 acceptance number is asserted with committed
fixtures (core alt/az within 0.003° against an independent ephemeris — budget 0.5°; the ~13° Munich
ceiling; moon and sun rise/set within 0.5 min of USNO — bar 2 min); both APIs were exercised against
their real upstreams; the `/astro/window` trace was inspected in ClickStack (one root span, three
genuinely parallel client spans, no N+1).

**Still not verified:** no load or cost testing against the 10k/day free tiers (reasoned from the
cache TTL); the map's tile-server-down fallback only synthetically; the marine thresholds have never
met a real surfer; the four surf spots' `shoreNormal` bearings are read off a coastline, not measured.

## The response, and the one thing to understand about it

Top-level `verdict` / `score` / `bestWindow` / `killers` describe the **best night in the range**,
not tonight — the question is _when should I go_. `nights[]` carries every night for the strip;
`detail.hourly` carries a 30-minute series for one night (the best, or `?detailDate=`).
`verdict: 'out'` is not a low score: a hard gate failed and `killers` says which; the API never
conflates the two. Location resolves `site` > `lat`+`lon` > `city` > Munich; a raw coordinate
inherits sky darkness from the nearest known site only within 150 km, past that `darknessSource`
is `'unknown'` and the factor drops out.

Engine rules worth knowing: a missing factor is _no data_, not a bad factor — it leaves both
numerator and denominator and `coverage` (0–1) says how much configured weight had data behind it;
every gate is evaluated, not just the first failing one; cloud is not scored linearly to overcast
(`CLOUD_RUINS_AT = { low: 55, mid: 80, high: 100 }` percent — a 13° target dies to low cloud long
before overcast). Anything sourced from `factors[]` silently disappears exactly when a gate fires —
the marine page's four defects were all this.

## Decisions

Dated, in the order taken. Each reversal of the original brief is marked.

- **D1 · 2026-08-15 · Galactic-core geometry hand-rolled, no library.** ~60 lines, zero deps.
  IAU 1976 precession is not optional — skipping it costs 0.41° of RA by 2026, most of the 0.5° budget.
- **D2 · 2026-08-15 · `astronomy-engine` replaces `suncalc` for sun and moon — reverses the
  brief.** Against USNO at Munich, suncalc is 3–11 min off; astronomy-engine is inside 0.5 min. The
  falsifiable acceptance number beat the implementation hint. (`ASTRO-HORIZON-RESEARCH.md` later
  found `astronomy-engine` upstream-abandoned and `suncalc` 2.0 viable for sun/moon only.)
- **D3 · 2026-08-15 · Factor weights** `cloudLow 5 · transparency 3 · cloudMid 2 · coreDarkness
  1.5 · cloudHigh 1` and ruin thresholds `low 55% / mid 80% / high 100%`. Darkness below
  transparency per "low haze is the enemy rather than the light dome". `seeing` is absent, guarded
  by a test.
- **D4 · 2026-08-15 · Verdict bands** `excellent ≥80 · good ≥65 · marginal ≥45 · poor`, with `out`
  reserved for gated nights.
- **D5 · 2026-08-15 · Observer elevation is sea level.** A few hundred metres moves rise/set by
  ~2 min, inside the noise.
- **D6 · 2026-08-15 · Upstream cache is in-memory, not Valkey.** Single-instance deploy; 60-minute
  TTL, 200-entry FIFO keyed on `(source, lat@2dp, lon@2dp, days)`; a failed fetch is never cached.
  Move to Valkey if argo ever runs more than one instance.
- **D7 · 2026-08-15 · New OpenAPI tag `Astro & Marine`** rather than overloading `External Data` —
  a decision surface, not a data feed.
- **D8 · 2026-08-15 · Map: MapLibre GL JS 6.3.0 + OpenFreeMap tiles, lazy-loaded.** CARTO is ruled
  out (Enterprise licence). OpenFreeMap needs no key, states no request limits, requires the
  attribution `OpenFreeMap © OpenMapTiles Data from OpenStreetMap`; the trade is no SLA, so the map
  card degrades to an empty state. maplibre-gl is ~253 kB gzipped and only downloads on this page.
- **D9 · 2026-08-15 · Marine thresholds and spots are provisional.** There is no surf note in the
  vault to anchor them: period ≥ 8 s, wave height 0.5–4 m, wind within 60° of dead-offshore with a
  glassy exemption under 5 kn; weights `swellPeriod 5 · windDirection 3.5 · swellHeight 2.5 ·
  windSpeed 1.5 · swellAlignment 1.5`. Four real European breaks ordered by drive time from Munich;
  the Eisbach is excluded (a river wave has no swell or wind to score).
- **D10 · 2026-08-15 · `peakScore`, `angularDistance` and `circularMean` went into the engine**, not
  the marine config — domain-agnostic. `circularMean` exists because bearings were once averaged
  arithmetically: the mean of 350° and 10° is 180°, which inverts the offshore verdict the endpoint
  hangs on. It returns `null` when the day's wind boxed the compass.
- **D11 · 2026-08-18 · The `bortle` field is deleted, not refined — reverses the brief.** Bortle is
  a subjective whole-sky scale driven by light domes near the horizon, exactly what a zenith map
  cannot see, and the stored classes were wrong against measurement. Sites now carry measured
  `mpsas` / `lpi` / `zone` / `trend10yPercent`, `coreDirectionMpsas` + `domePenaltyMag`, and
  `southHorizonDeg` + `siteElevationM`; `?bortle=` became `?coreMpsas=`, `bortleSource` became
  `darknessSource`. Full reasoning: `ASTRO-MAP-RESEARCH.md`.
- **2026-08-18 · The core-altitude gate is no longer flat.** `resolveNight` takes the site's
  committed skyline and a 2° framing margin; each sample's floor is
  `max(8°, skyline(coreAzimuth) + 2°)`, and the moon counts as down behind terrain. A new factor
  `core-clearance` (weight 2) scores the degrees of clear sky above the ridge. At the four committed
  sites this changes nothing (their horizons are ≤5.7°); it binds once the map lets someone score a
  valley. `GET /astro/window` gained `location.southHorizonDeg`, `nights[].peakCoreClearanceDeg`,
  `detail.hourly[].coreClearance` / `moonBehindTerrain`. Full reasoning: `ASTRO-HORIZON-RESEARCH.md`.
- **Correction to the brief's acceptance list.** "June at 48.14°N returns zero astronomical-night
  hours" was wrong — −18.4° is below the −18° threshold. Munich gets ~70 minutes at the solstice;
  true zero starts at 48.56°N. Both are regression tests.

## Lessons kept

- **The reasoning-model token cliff.** The budget for the one explanatory sentence is not a
  constant: the tighter the style instruction, the _more_ the model deliberates. `lib/ai-sentence.ts`
  starts at 1200 tokens and retries once at 3600 on empty content, so the failure is self-healing
  and logged rather than a silent `null` summary. A flat range gets its own instruction and its own
  facts, or the model produces fragments like `"No usable day — 6."`.
- **The marine page's four defects only appear when every day in the range is gated** — in a flat
  European August that is every range, so it is the common case. They are recorded in git history
  (2026-08-18) for the rebuild.
- **7Timer is the whole latency budget** — 431 ms of a 471 ms cold `/astro/window` request, against
  ~20 ms each for the two Open-Meteo calls. It is also the least reliable of the three upstreams (a
  bare `api.pl` CGI endpoint). If transparency ever stops being worth the wait, dropping it costs one
  factor's weight and the score degrades through `coverage` rather than breaking.
- **Two spots in the engine are O(n·m) and cheap only because n and m are small.** `transparencyAt`
  linearly scans the whole series per lookup (~a few hundred thousand comparisons per request at ten
  nights × ~240 samples × ~160 slots) — a sorted-array binary search is the fix if the horizon ever
  grows a lot. `resolveNight` samples every night at 5-minute resolution even for the strip, where
  only the verdict and window bounds are read (~2,400 ephemeris evaluations per 10-night request) —
  a coarser grid for non-detail nights is the lever if the endpoint ever needs to be faster.

## Next

1. Correct the four `shoreNormal` values against something authoritative — the cheapest accuracy
   win in the marine surface.
2. Rebuild the surf page on the shipped endpoints, deliberately, one step at a time.
3. The alerting layer — the brief's stated goal was a system that speaks first.
