# RALPH_NOTES

Things noticed while building the astro window planner (`docs/ASTRO-WINDOW-BRIEF.md`)
that were **not** fixed, because fixing them was outside the ask. Each is written so it
can be picked up cold. Nothing here is blocking.

---

## Pre-existing, untouched

**`bunx oxlint .` reports 23 warnings across the repo.** All are
`unicorn(consistent-function-scoping)` — a helper defined inside another function that
captures nothing from its parent. They sit in `apps/api/src/routes/ai.test.ts`,
`clients/{hardcover-sync,hardcover-reconcile,jira,google}.ts`, `cron/garmin-sync.ts`,
`lib/strength-formulas.ts` and the strength-tracker charts. None are in files this work
touched, so they were left alone per "fix errors in changed files only". They are
warnings, not errors, and the lint target passes.

**`apps/api/CLAUDE.md` and `apps/api/.claude/rules/openapi.md` both said routes mount in
`src/index.ts`.** They moved to `src/app.ts` some time ago — `index.ts` only boots the
listener now. The `openapi.md` reference was corrected in passing because that same
paragraph had to change anyway (the tag enum). **`apps/api/CLAUDE.md` still says
`index.ts`, in two places: the "Adding a Route → 3. Mount in `src/index.ts`" heading and
the test snippet that imports `app` from `../index.js`.** The second one is the more
expensive of the two — following it starts a real listener inside the test process.

**`openapi.md`'s tag table was missing `Usage Tracking`**, which `app.ts` has registered
for some time. Added, because leaving it out would have made the stated tag count wrong
in the same edit that added `Astro & Marine`.

**`mcp__sideclaw__otel` is down.** Two consecutive invocations failed with
`Session exited with code 1`. The trace verification in phase 2 was done by querying
ClickHouse over HTTP instead (`POST http://localhost:8123` with the SQL as the request
body — note `curl --data-urlencode` mangles `now()`, so use `--data-binary`). Not
investigated; it did not block anything.

---

## Introduced deliberately, and worth knowing

**`window-score.ts` has no marine config yet.** Phase 4 adds one. The engine is already
domain-agnostic and `linearScore(value, { good, bad })` inverts when `good > bad`, which
is how "more is better" quantities like swell period are meant to be expressed. Nothing
astro-specific has leaked into it — a test asserts the factor list, so a regression there
would be caught.

**The upstream cache is per-process and dies on redeploy.** Deliberate (decision D6), and
the house precedent, but it means the first request after every deploy pays the full
~450 ms of upstream latency. If argo ever runs more than one instance this becomes a
real cache-miss multiplier and should move to Valkey — `REDIS_URL` and `ioredis` are
already wired for Hermes.

**7Timer accounts for essentially the whole `/astro/window` latency** — 431 ms of a
471 ms cold request, against ~20 ms each for the two Open-Meteo calls. It is also the
least reliable of the three (a bare `api.pl` CGI endpoint). If transparency ever stops
being worth the wait, dropping it costs one factor's weight and the score degrades
through `coverage` rather than breaking.

**`transparencyAt` is a linear scan over the whole series per lookup.** At ten nights ×
~240 samples × ~160 slots it is a few hundred thousand comparisons per request, which is
nothing — but it is O(n·m) and would be the first thing to bite if the horizon grew a
lot. A sorted-array binary search is the obvious fix if it ever matters.

**`resolveNight` samples every night at 5-minute resolution even for the strip**, where
only the verdict and the window bounds are read. That is ~2 400 ephemeris evaluations per
10-night request. Measured cost is small (the request is dominated by 7Timer), so it was
left alone rather than optimised on speculation — but a coarser grid for non-detail
nights is the lever if the endpoint ever needs to be faster.

**The night strip's `out` cells put the killer reason in the row that otherwise shows the
moon.** For moon-killed nights those render identically, which is intended — but if a new
gate is ever added whose reason is long, that cell will need truncation.

**`maplibre-gl` cannot be tree-shaken** (single pre-bundled ESM file, ~253 kB gzipped).
It is `React.lazy`-loaded so it only downloads on this page, but if a second page ever
wants a map, check the bundle before assuming the cost is already paid.

**OpenFreeMap offers no SLA** and its operator says the service "may discontinue at any
time without notice". The map card degrades to an empty state rather than breaking the
page, which is the mitigation — but the fallback has never been exercised against a real
outage, only against a synthetic error.

---

## Rejected findings

The round-2 blind critic reported that the Night Timeline and Cloud Layers charts "sit in
separate cards with different left gutters, so the plot areas don't align". **This was
checked against the live DOM and is false**: both SVGs render at the same left edge and
width with an identical `translate(44, 12)`, both charts' first x-tick occupies pixels
298–331 and the last 1513–1546, and the y-tick labels share a right edge at 274. The
impression comes from the y-axis label _strings_ differing in width (`-20°` vs `0%`)
while being right-anchored to the same line. Recorded rather than acted on, so the next
reader does not re-fix a non-bug.
