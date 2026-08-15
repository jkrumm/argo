# Brief — Astro & Marine Window Planner

Autonomous build brief for a long-running agent. Read this file in full before
the first edit. Everything here is decided; where it says _decide_, decide and
record the choice in this file under "Decisions log".

---

## Goal

Answer one question, well, without being asked: **"is tonight (or this week)
worth going out for?"** — first for Milky Way nightscapes, then for surf/swell.

Ship it as an argo API surface plus an argo dashboard page. Not a new repo, not
a new gateway, not a separate PWA.

## Why this exists

Locationscout, PhotoPills, Stellarium and Clear Outside are all being paid for
and kept — they own curated spots, on-site AR, and the sky atlas. None of them
knows the operator's actual constraint, spans astro _and_ surf, or speaks first.
This builds only the decision-and-alerting layer.

The operator's constraint, which sets every weighting (from
`~/SourceRoot/brain/Areas/Photography/Astro/Night Workflow.md` §1):

> Munich, 48.14°N. The galactic core sits at declination −29°, so it never climbs
> past **~13°**. A clear southern horizon matters more than a dark sky, and low
> haze is the enemy rather than the light dome. Munich is Bortle 8; 45 min south
> into the Alpenvorland or east to the Bayerischer Wald buys Bortle 4. Anything
> past first quarter kills the core. At the solstice the sun only reaches −18.4°,
> so June gives minutes of astronomical night, not hours.

Read that whole file before designing the score. It is the spec.

---

## Non-negotiable guardrails

1. **Stay on `feat/astro-window`. Never push to `master`.** argo is
   direct-to-master and `master` auto-deploys to `argo.jkrumm.com` via RollHook.
   An autonomous loop on master means an autonomous loop in production. Commit
   freely on the branch — no PR, no approval gate — but the merge is the
   operator's, made awake, in the morning.
   1b. **Never invoke a skill that waits for a human** (`/commit`, `/check`,
   `/review`, `/pr`, `/ship`, `/implement`). Nobody is at the keyboard: they
   print a proposal, block on a confirmation that never comes, and you lose the
   work. Use raw `git add` + `git commit -m "..."`, and run validation as plain
   commands. `/gauntlet-loop` is the one deliberate exception — see phase 3,
   where its choice-point is pre-decided for you.
2. **Deterministic math stays deterministic.** The LLM never computes an
   altitude, a phase, a score, or a threshold. It writes the sentence that
   explains an already-computed verdict. An LLM doing astronomy is a bug factory.
3. **Secrets via `secrets-run`, never bare `op`.** This runs on the headless Mac
   mini where a direct `op read` hangs on a biometric prompt no one can answer.
4. **Docker only via `make` targets** (`cd ~/SourceRoot/vps && make up`).
5. **`DESIGN.md` is law**, and its restraint override supersedes
   `/frontend-design`. Calm, dark-first, data-dense. Zinc by default, one accent
   spent only when earned. No gradient meshes, no hover lifts, no showcase.
   Colors come from `--vx-*` / `VX.*` tokens — never a raw hex.
6. **No unrequested scope.** Astro ships first and completely. Marine is phase 4
   and only starts when phase 3 is signed off.
7. If a tool returns something unexpected, or a file isn't where this brief says
   it is — **stop and report**. Do not route around it silently.

---

## Execution model — you are an orchestrator, not a typist

You are running unattended for several hours. Nobody will unstick you, so the
discipline below is what replaces the human.

**Stay thin.** Hold the plan, the decisions and the verdicts. Push the volume
out: settled multi-file edits → an `@implementer` subagent with a complete brief
(exact paths, the change, acceptance criteria, scope limits); search across many
files → `Explore`. Grinding through reads and edits inline is the exception and
needs a reason. A subagent cannot see research you already did — bake resolved
signatures, endpoints and versions into its brief.

**Verify what comes back.** A subagent's report is a claim; the diff is the
proof. Read every line it says it changed before you commit it. This is the step
that decides whether you wake up to working code or plausible-looking code.

**Parallelise only on disjoint files.** Two implementers in the same file will
race and you will spend an hour chasing failures that vanish. The engine, the
route, and the dashboard feature are disjoint once their interfaces are fixed —
fix the interface first, then fan out.

**Keep a durable progress log.** Append to `docs/ASTRO-WINDOW-PROGRESS.md`
(create it) after every unit of work: what you did, what you verified, what you decided,
what broke. Commit it with the work. If the daemon dies at 03:00 this file is the
only thing that lets the next session resume instead of restart. Write it as if
the reader has none of your context, because they won't.

**Never wedge.** Two failed attempts at the same thing means stop attempting it:
record the blocker in the progress log with what you tried, move to the next
independent piece, and return at the end if time allows. A loop burning six hours
on one failing test is the primary failure mode of an overnight run — a blocked
sub-part must not block the rest.

**Commit at every green point**, small and often, with a real message. Uncommitted
work is invisible work and dies with the process.

## Stack facts you do not need to rediscover

| Thing                                                                  | Where                                                              |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Existing weather route (Open-Meteo + geocode cache, Munich pre-seeded) | `apps/api/src/routes/weather.ts`                                   |
| Route conventions, Zod, `detail` block, tests                          | `apps/api/CLAUDE.md` → "Adding a Route"                            |
| Allowed OpenAPI tags (enum — extend deliberately)                      | `apps/api/.claude/rules/openapi.md`                                |
| Outgoing HTTP **must** go through this                                 | `apps/api/src/lib/traced-fetch.ts`                                 |
| AI inference seam (DeepSeek v4 Flash, IU endpoint)                     | `apps/api/src/routes/ai.ts` → `aiComplete()`                       |
| Dashboard page pattern (TanStack Router + Query + Eden)                | `apps/dashboard/CLAUDE.md` → "Adding a Page"                       |
| Charts (visx primitives)                                               | `basalt-ui/charts`; never import `@visx/*` outside a `charts/` dir |
| Import map when unsure                                                 | `node_modules/basalt-ui/llms.txt`                                  |
| Dev infra up                                                           | `cd ~/SourceRoot/vps && make up` (once per boot)                   |
| Validate                                                               | `bun test:api`, `bun run lint`, `bun run --cwd apps/api typecheck` |

**No map library is installed.** Adding one is the single real dependency
decision in this brief — see phase 3.

## Data sources — all resolved, do not re-research

| Need                                | Source                                                        | Auth | Notes                                                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cloud by layer, 2.2 km over Bavaria | `api.open-meteo.com/v1/dwd-icon` → `cloud_cover_low/mid/high` | none | CC BY 4.0. Attribute DWD + Open-Meteo                                                                                                            |
| Global fallback                     | `api.open-meteo.com/v1/forecast`                              | none | already wired in `weather.ts`                                                                                                                    |
| **Transparency** + seeing           | `7timer.info/bin/api.pl?product=astro&output=json`            | none | banded 1–8. The only free transparency source there is                                                                                           |
| Aurora                              | `services.swpc.noaa.gov/json/ovation_aurora_latest.json`      | none | public domain                                                                                                                                    |
| Swell (phase 4)                     | `marine-api.open-meteo.com/v1/marine`                         | none | `wave_height`, `swell_wave_height/period/direction`                                                                                              |
| Light pollution                     | EOG VNL v2.2 GeoTIFF (Colorado Mines), public domain          | none | **do not query lightpollutionmap.info** — its `QueryRaster` needs a reverse-engineered `qk` key and the owner asks commercial users to email him |

Open-Meteo's free tier is 10k calls/day and **non-commercial** — fine for
personal use, attribution required. Cache aggressively anyway: forecasts update
hourly at best, so a Valkey/Postgres cache keyed on `(lat,lon,hour)` should keep
real call volume in the dozens per day.

**Magicseaweed is dead** (May 2023). **Surfline has no public API** and its terms
forbid the reverse-engineered `services.surfline.com/kbyg/...` endpoints — do not
touch them.

---

## Phase 1 — the scoring engine (pure, no I/O)

`apps/api/src/lib/window-score.ts`. Domain-agnostic: a list of **hard gates**
(any fail ⇒ night is out, with a named reason) plus **weighted factors** (0–1
each) producing a 0–100 score. Astro and marine are two configs over one engine.

Galactic core needs no dependency. Sgr A\* is fixed at RA 17h45m40.04s,
Dec −29°00′28.1″; hour angle from local sidereal time, then standard alt/az
spherical trig — about 20 lines. Skyfield and Astropy are both correct and both
would drag Python into a Bun stack. Use `suncalc` (npm) for moon phase,
moonrise/set and astronomical twilight (`getTimes().night` / `.nightEnd`).

Astro config:

| Gate          | Threshold                                                                   |
| ------------- | --------------------------------------------------------------------------- |
| Core altitude | > 8° — below that it is inside the Munich light dome                        |
| Moon          | illumination < 25% **or** moon below horizon during the window              |
| Darkness      | true astronomical night (sun < −18°) must exist and overlap the core window |

| Factor                      | Weight          | Why                                                |
| --------------------------- | --------------- | -------------------------------------------------- |
| `cloud_cover_low`           | heaviest        | a 13° target dies to low cloud first               |
| 7Timer `transparency`       | second          | "low haze is the enemy rather than the light dome" |
| `cloud_cover_mid`           | moderate        |                                                    |
| `cloud_cover_high`          | light           | thin cirrus still hurts long subs                  |
| Bortle at the drive-to site | static per site |                                                    |
| 7Timer `seeing`             | **ignored**     | irrelevant at 12 mm — do not include it            |

**Acceptance — falsifiable, from the operator's own notes:**

- Galactic-core alt/az within **0.5°** of Stellarium/PhotoPills for Munich at
  three fixed timestamps spread across a year. Commit them as fixtures.
- Core altitude for Munich never exceeds **~13°** across a full simulated year.
- Mid-August: core transits **~21:30 CEST**, astronomical dark begins **~22:30**
  — so the engine must recommend the _first_ hour of darkness, not the last.
- June at 48.14°N returns **zero** astronomical-night hours (sun peaks at −18.4°).
  This is the single best regression test in the brief; it catches sign errors,
  timezone errors, and off-by-one twilight bugs at once.
- Moon phase and rise/set within **2 minutes** of a published reference.
- Pure unit tests, no DB:
  `DATABASE_URL=postgres://x@localhost/x API_SECRET=x bun test --cwd apps/api src/lib`

Do not proceed to phase 2 until every one of these passes.

## Phase 2 — the API

`apps/api/src/routes/astro.ts`, mounted in `src/index.ts` after the auth guard.

```
GET /astro/window?lat&lon&nights=10   → { verdict, score, bestWindow, killers[], hourly[] }
GET /astro/sites                      → the candidate drive-to sites with their Bortle baseline
```

Share the geocode cache in `weather.ts` rather than duplicating it — refactor it
into `lib/` if that's the clean way, and say so in the PR.

Store 3–4 candidate sites (Munich, Alpenvorland, Bayerischer Wald, plus one the
operator can extend) with VNL radiance baked in as a static constant for now.
Deriving Bortle live from the GeoTIFF is explicitly out of scope for v1 — light
pollution changes yearly, not hourly.

Reuse the existing `detail` / tag / security conventions exactly. Integration
tests hit real Postgres per `apps/api/CLAUDE.md`. Every upstream call goes
through `tracedFetch`.

**Then use the AI seam, narrowly.** `aiComplete()` turns an already-scored window
into one sentence: _"Saturday 21:40 — core 12°, moon 8%, low cloud 5% from the
Alpenvorland. Best window this month."_ Deterministic input, prose output. If the
model is unavailable the endpoint still returns the full verdict; the sentence is
an enhancement, never a dependency.

**Optimize before moving on:** cache upstreams, collapse the fan-out, and confirm
in ClickStack that a `/astro/window` request produces a sane trace — one parent
span, parallel client spans, no N+1. `.claude/rules/observability.md` has the
verification checklist.

## Phase 3 — the UI, run as a gauntlet

`apps/dashboard/src/routes/astro-window.tsx` + `src/features/astro-window/`.

Must have: a map with the candidate sites and the ability to add/move one; a
10-night strip showing verdict per night at a glance; an hourly detail for the
selected night (core altitude curve, cloud layers, moon); the recommendation
sentence; and location switching that actually re-queries.

The map is the one new dependency. **MapLibre GL JS** is the default choice —
BSD, no token, works with free raster tiles. Confirm the tile source's terms
before wiring it, and if a lighter approach covers it (static tiles behind the
existing chart primitives), prefer that. Record the decision below.

**Run this phase with gauntlet-loop.** Install it first:

```bash
git clone https://github.com/robonuggets/gauntlet-loop /tmp/gauntlet-loop
cp -r /tmp/gauntlet-loop/.claude/skills/gauntlet-loop \
      ~/SourceRoot/argo/.claude/skills/
```

Then `/gauntlet-loop` the page. **The bar is already chosen: PhotoPills' Planner,
judged on information density and scannability.** Gauntlet-loop normally offers
two or three candidate bars and waits for a human to pick — do not stop for that,
the decision is made here. Its builder-critic structure is what you want: the
critic runs with fresh context, compares blind with labels removed, and returns a
binary judgment; the loop exits when the work wins, not after N rounds.

Cap it at **six rounds**. If it hasn't won by then, stop, commit the best
version, and write down in the progress log what the critic kept rejecting. An
unbounded aesthetic loop is the second-most-likely way to burn the whole night.

One override the critic must respect: `DESIGN.md`'s restraint clause beats the
reference's visual flourish every time. If PhotoPills is louder, we still don't
get louder. Density and clarity are what's being copied, not decoration.

Screenshot at each iteration (`/browse` or the `run` skill) — a critic judging
from code instead of pixels is not a critic.

## Phase 4 — marine (only after phase 3 is signed off)

Second config over the same engine. Gates on swell period and offshore wind
direction; same endpoint shape (`GET /marine/window`), same page pattern. If
phase 3 took longer than expected, stop and hand back rather than starting this.

---

## Exit criteria

- `bun test:api`, `bun run lint`, `bun run --cwd apps/api typecheck`,
  `bun run --cwd apps/dashboard typecheck` all clean — run as commands, not via
  `/check`.
- Every phase-1 acceptance number verified, with the fixtures committed.
- **Proven working locally, not just green.** `bun dev`, load the page, exercise
  a location change, screenshot it. A passing test suite is not evidence the
  feature works.
- Self-review each group's own diff before committing it: read every changed
  line, and record anything you'd have flagged in `RALPH_NOTES.md` rather than
  leaving it silent.
- Branch `feat/astro-window` left clean and pushed, with the decisions log below
  filled in, the gauntlet-loop reference chosen and the round count, and an
  explicit list of anything left undone.
- **Do not merge to `master`.** That is the one thing reserved for the morning.

## Report on stopping

Whatever the outcome — done, blocked, or partway — end with: what works and is
verified, what is unverified, what you'd do next, and every assumption you took
that the brief didn't decide for you.

## Decisions log

_(append as you go — date, decision, why. Full reasoning and the measurements
behind each one live in `docs/ASTRO-WINDOW-PROGRESS.md`.)_

- **2026-08-15 · D1 · Galactic-core geometry hand-rolled, no library.** As
  specified. ~60 lines, zero deps, verified to 0.003° against an independent
  ephemeris. IAU 1976 precession is _not_ optional — skipping it costs 0.41° of
  RA by 2026, most of the 0.5° budget.
- **2026-08-15 · D2 · `astronomy-engine` replaces `suncalc` for sun and moon —
  reverses this brief.** The brief names suncalc _and_ sets a 2-minute accuracy
  bar for moon rise/set. Measured against USNO at Munich, suncalc is 3–11 min
  off; astronomy-engine is inside 0.5 min. The falsifiable acceptance number
  wins over the implementation hint. One MIT, zero-dep library replaces two.
- **2026-08-15 · D3 · Factor weights** `cloudLow 5 · transparency 3 · cloudMid 2
· bortle 1.5 · cloudHigh 1`, and cloud ruin thresholds `low 55% / mid 80% /
high 100%` rather than a linear ramp to overcast. Bortle below transparency
  per "low haze is the enemy rather than the light dome". `seeing` is absent
  from the config entirely, guarded by a test.
- **2026-08-15 · D4 · Verdict bands** `excellent ≥80 · good ≥65 · marginal ≥45 ·
poor`, with `out` reserved for gated nights — "out for a named reason" is
  different information from "scored low" and the API keeps them distinct.
- **2026-08-15 · D5 · Observer elevation is sea level.** The contract carries
  lat/lon only; a few hundred metres moves rise/set by ~2 min, inside the noise.
- **2026-08-15 · D6 · Upstream cache is in-memory, not Valkey/Postgres.** The brief suggests
  either; argo is a single-instance deploy, `REDIS_URL` is unset in tests, and
  `routes/walking-pad.ts` is the house precedent. 60-minute TTL, 200-entry FIFO,
  keyed on `(source, lat@2dp, lon@2dp, days)`. A failed fetch is never cached.
- **2026-08-15 · D7 · New OpenAPI tag `Astro & Marine`**, expanded deliberately per
  the rule file rather than overloading `External Data` — this is a decision surface,
  not a data feed, and phase 4's `/marine/window` belongs in the same group.
- **2026-08-15 · D8 · Map: MapLibre GL JS 6.3.0 (BSD-3) + OpenFreeMap tiles, lazy-loaded.**
  The brief's default choice, confirmed after checking the terms — which changed the
  tile source. **CARTO is ruled out**: its basemaps need an Enterprise licence, and
  the only free non-commercial route is a CARTO grant we do not hold. OpenFreeMap
  needs no key and no signup, states "no limits on the number of map views or
  requests", and imposes no use-outside-our-products restriction; required
  attribution is `OpenFreeMap © OpenMapTiles Data from OpenStreetMap`, passed
  explicitly because the style JSON carries none. The trade accepted: OpenFreeMap
  offers no SLA and may vanish, so the map card degrades to an empty state rather
  than breaking the page. The lighter no-dependency approach was considered and
  rejected — picking a _new_ site by coordinates with no basemap is not usable, and
  that is an explicit phase-3 requirement. maplibre-gl is ~253 kB gzipped and cannot
  be tree-shaken, so it is `React.lazy`-loaded and only downloads on this page.
- **2026-08-15 · Correction to this brief's phase-1 acceptance list.** "June at
  48.14°N returns **zero** astronomical-night hours" is factually wrong and
  internally contradictory — −18.4° _is_ below the −18° threshold. Munich gets
  ~70 minutes at the solstice; true zero starts at 48.56°N. Both are now
  asserted as regression tests. See the progress log for the arithmetic.
