# Astro horizon — making terrain a first-class input

The shipped scorer gates on `MIN_CORE_ALTITUDE = 8`, a flat number standing in for
"something is in the way". Measured against real terrain that gate is not conservative,
it is **wrong, and wrong in the direction that sends you to the worst spot**: it rates
eight Bavarian candidates inside a 1.8× spread of annual core hours, where the
terrain-aware gate spreads them 16×. A 1134 m summit — Wallberg — comes out one of the
worst Milky Way sites in the set, because the Alps stand 20° high directly south of it.
No amount of light-pollution modelling can see that.

This record covers what was measured, what it costs, and what the API and the two views
should therefore look like. Every number reproduces from `docs/poc/astro-horizon/`.

Scope note: `ASTRO-MAP-RESEARCH.md` is the record for light pollution and the map's
raster layers, and it stands. This one is about the other half of the sky budget.

## TLDR

| Claim                                         | Measured                                                    |
| --------------------------------------------- | ----------------------------------------------------------- |
| Our raymarch is PVGIS-grade                   | 0.20° RMS over the southern arc, ≤7 m elevation             |
| PVGIS is a reference, not a dependency        | keyless, but 48 azimuths and EU-only; ours is 72 and global |
| The horizon must be a profile, not a scalar   | terrain reorders the site ranking by 16×                    |
| Terrain blocks moonlight too                  | +21% usable core hours at Walchensee                        |
| Beyond 500 m the profile is resolution-stable | z11 vs z12 agree to ≤0.08°                                  |
| Within 500 m it is not                        | same sites disagree by up to 0.96°                          |
| Clearance is rasterable                       | 0.34 ms per cell, 8.3 M DEM samples/s                       |

## 1. The reference check — PVGIS

PVGIS 5.3 `printhorizon` is free, keyless, JSON, and returns a 49-point profile plus the
site's own SRTM elevation. It is the natural independent check on the raymarch already
shipped in `terrain-horizon.ts` (terrarium z11, 150 m step, 60 km range, refraction
k = 0.13).

`docs/poc/astro-horizon/validate.ts`, all four committed sites, 48 shared azimuths each:

| Site             | Elevation Δ | All-azimuth bias / RMS | South-arc bias / RMS | South max ours vs PVGIS |
| ---------------- | ----------- | ---------------------- | -------------------- | ----------------------- |
| Munich           | +1.1 m      | −0.78° / 1.09°         | −0.14° / 0.24°       | 0.91° vs 1.10°          |
| Alpenvorland     | +1.2 m      | −0.42° / 0.63°         | −0.03° / 0.21°       | 3.72° vs 3.80°          |
| Bayerischer Wald | +6.9 m      | −0.07° / 0.21°         | −0.00° / 0.13°       | 0.55° vs 0.80°          |
| Walchensee       | +3.2 m      | −0.07° / 0.42°         | −0.16° / 0.21°       | 5.68° vs 5.70°          |

Over the 150–215° arc the core actually crosses: **bias −0.08°, RMS 0.20°, worst single
azimuth 0.49°**. That is at or below the ±5–15 m DEM vertical noise floor, which is the
hard limit on any DEM-derived horizon regardless of tooling.

The whole-compass numbers are worse (RMS 0.67°, worst −2.80° at Munich looking north)
and the reason is instructive rather than alarming: SRTM is a surface model that keeps
buildings and canopy, so PVGIS sees an urban skyline in directions where terrarium's
blend does not. It happens where a Milky Way frame never points.

**Decision: serve horizons ourselves.** PVGIS becomes a committed validation fixture,
not a runtime dependency. It buys nothing we do not have and costs a rate limit, an EU
coverage boundary, a South=0 azimuth convention to normalise, and 48 azimuths instead
of 72.

## 2. What resolution actually buys

`sensitivity.ts` sweeps zoom, ray step and range against a z12 / 75 m / 60 km reference.
Compute is free — 1–20 ms for a whole 72-azimuth profile. The entire cost is DEM tiles.

Two things move the answer and one does not:

- **Range matters, but only where the far field is the horizon.** Munich's southern
  horizon _is_ the Alps at 54 km: cutting the march to 30 km loses 0.51°, extending it
  to 100 km gains 0.13°. At the other three sites 15 km already gives the final number.
  60 km stays.
- **Ray step is irrelevant.** 300 m instead of 150 m costs ≤0.14°.
- **Zoom appeared to matter and does not.** Bayerischer Wald moves 0.65° between z11 and
  z12 while every other site moves ≤0.07°. Bilinear sampling does not close it
  (`nearfield.ts`: 0.62 vs 0.61). The z12 maximum sits at **0.1 km** — one pixel away.

That last point is the useful finding, and it generalises.

## 3. The near field is a different measurement

Split each ray at 500 m (`nearfield-share.ts`) and the resolution instability goes with
the near half:

| Site                   | Near wins / 72 az | South max, near band | South max, far band | Far band z11 → z12    |
| ---------------------- | ----------------- | -------------------- | ------------------- | --------------------- |
| Munich                 | 34                | −0.08°               | 0.97°               | 0.97 → 0.97 (0.00)    |
| Alpenvorland           | 11                | 1.40°                | 3.83°               | 3.83 → 3.90 (0.07)    |
| Bayerischer Wald       | 1                 | −1.58°               | 0.61°               | 0.61 → 0.65 (0.05)    |
| Walchensee             | 0                 | 0.66°                | 5.72°               | 5.72 → 5.73 (0.01)    |
| Eng / Karwendel valley | 45                | 3.98°                | 9.49°               | 9.49 → 10.45 (0.96)   |
| Sylvenstein            | 2                 | 1.46°                | 12.28°              | 12.28 → 12.23 (−0.05) |
| Herzogstand summit     | 0                 | −7.61°               | 2.61°               | 2.61 → 2.57 (−0.04)   |
| Wallberg summit        | 26                | 7.53°                | 20.09°              | 20.09 → 20.01 (−0.08) |

Bayerischer Wald's 0.65° anomaly collapses to 0.05°. Everything outside one alpine
valley floor lands inside 0.08°.

The physical reading: at 76 m per pixel, a sample 150 m away is two pixels of your own
hillside plus the model's vertical error. It is not a skyline. A real cliff at 300 m is
a real skyline, so the near band cannot simply be dropped either.

**Decision: the profile carries both bands per azimuth.** `farDeg` (>500 m) is the
skyline and the only thing the scorer reads. `nearDeg` (≤500 m) ships alongside it,
flagged as advisory local ground — the panorama draws it, no number depends on it.

## 4. What terrain does to the answer

`visibility.ts` and `binding.ts` integrate a whole year (2027, 10-minute grid) of
"the core is up, it is astronomically dark, and the moon is not in the way", under
progressively honest gates. Weather is deliberately absent: this is a property of the
place, not of the week.

### 4.1 The flat gate hides the ranking

`bind%` is the share of flat-gate minutes where the measured ridge, plus a 2° framing
margin, is the tighter floor.

| Candidate              | Elev   | South max | Flat 8° gate | Terrain gate | Δ        | bind% | Peak clearance |
| ---------------------- | ------ | --------- | ------------ | ------------ | -------- | ----- | -------------- |
| Munich                 | 525 m  | 1.0°      | 116.0 h/yr   | 116.0 h/yr   | 0%       | 0%    | 12.5°          |
| Alpenvorland           | 599 m  | 3.8°      | 128.0 h/yr   | 128.0 h/yr   | 0%       | 0%    | 10.5°          |
| Bayerischer Wald       | 809 m  | 0.6°      | 77.7 h/yr    | 77.7 h/yr    | 0%       | 0%    | 11.9°          |
| Walchensee             | 801 m  | 5.7°      | 136.0 h/yr   | 136.0 h/yr   | 0%       | 0%    | 8.5°           |
| Eng / Karwendel valley | 1956 m | 9.5°      | 143.5 h/yr   | 121.7 h/yr   | −15%     | 40%   | 10.9°          |
| Sylvenstein            | 746 m  | 12.3°     | 137.5 h/yr   | 67.8 h/yr    | −51%     | 100%  | 3.9°           |
| Herzogstand summit     | 1594 m | 2.6°      | 135.3 h/yr   | 135.3 h/yr   | 0%       | 0%    | 11.8°          |
| Wallberg summit        | 1134 m | 20.1°     | 134.7 h/yr   | 8.7 h/yr     | **−94%** | 96%   | 3.3°           |

At the four committed sites the terrain gate changes nothing — their southern horizons
are all under 5.7°, so the 8° atmospheric floor swallows them whole. That is a property
of the pre-alpine plain, not a reason to skip the work: the moment the map lets you
click a valley or a summit, terrain becomes the binding constraint 40–100% of the time.

Note Herzogstand against Wallberg. Both summits, 460 m apart in height, 35 km apart on
the ground, indistinguishable on a light-pollution map. One keeps 135 h/yr; the other
keeps 8.7. Altitude is not the variable — which side of the range you are on is.

**Decision: the gate is `max(8°, farHorizon(coreAzimuth) + 2°)`, evaluated per sample**,
not once per night. The 8° term is atmospheric (extinction and the dome, no terrain
involved); the second is geometric, and the 2° is framing margin so the frame contains
sky rather than ridge. Clearance — core altitude minus the ridge at the core's own
azimuth — also becomes a continuous scoring factor, because "it clears by 0.5°" and
"it clears by 11°" are not the same night.

### 4.2 Terrain blocks moonlight, and nobody models it

`SearchRiseSet` assumes a flat horizon by construction, so every tool treats the moon as
up the instant it is above 0°. A mountain blocks moonlight exactly as well as the earth
does. Counting the moon as down when it sits below the measured ridge at its own
azimuth:

| Site             | Moon down at 0° | Moon down behind terrain | Gain       |
| ---------------- | --------------- | ------------------------ | ---------- |
| Munich           | 116.0 h/yr      | 118.5 h/yr               | +2.2%      |
| Alpenvorland     | 128.0 h/yr      | 135.0 h/yr               | +5.5%      |
| Bayerischer Wald | 77.7 h/yr       | 82.7 h/yr                | +6.4%      |
| Walchensee       | 136.0 h/yr      | 164.2 h/yr               | **+20.7%** |

The gain scales with how walled-in a site is, which is the correct behaviour and the
opposite sign to what terrain does to the core. Walchensee's 34° northern wall costs it
nothing to the south and earns it a fifth more usable time. That trade is invisible to
every other tool in this space.

### 4.3 The annual budget is worth serving on its own

Peak core altitude barely separates the sites (12.0–13.5°). Peak _clearance_ separates
them hard (3.3–12.5°), and the annual hour budget separates them harder still. The
monthly shape is the same everywhere in Bavaria — nothing in Oct–Feb, a March ramp, a
May peak — but the magnitude is a per-place fact:

| Site             | Mar | Apr | May | Jun | Jul | Aug | Sep |
| ---------------- | --- | --- | --- | --- | --- | --- | --- |
| Munich           | 3   | 15  | 30  | 24  | 27  | 15  | 3   |
| Alpenvorland     | 4   | 17  | 32  | 27  | 29  | 16  | 4   |
| Bayerischer Wald | 1   | 12  | 25  | 11  | 17  | 11  | 2   |
| Walchensee       | 4   | 17  | 33  | 29  | 31  | 18  | 5   |

Hours per month, terrain gate, moon-down-behind-terrain. June dipping below May and July
is real: astronomical darkness itself is shortest at the solstice.

**Decision: `GET /astro/visibility` serves this.** It is deterministic, weather-free,
cacheable forever, and it is the number that answers "is this spot worth the drive at
all" as opposed to "is tonight worth the drive".

## 5. The clearance field is rasterable

If terrain reorders the ranking, the map has to show it. `clearance-grid.ts` computes
core-transit altitude minus the southern-arc ridge on a 60 × 60 lattice over a
0.55° × 0.85° block of the pre-alpine edge:

- 3600 cells in 1220 ms — **0.34 ms/cell, 8.3 M DEM samples/s** in Bun
- 328 z11 tiles resident, ~64 MB of raw RGB, for a 60 km march skirt on every side
- field spread: min −58.9°, p10 −14.7°, median 5.6°, p90 11.0°, max 12.8°

At native 256×256 that is 22 s per tile, which is too slow to serve cold. It does not
need to be: terrain does not change, the field is smooth across the open north, and the
existing `/astro/tiles/lp/…` route already establishes the pattern — terrarium-encoded
PNG, hard cache, our own palette applied client-side as a `color-relief` layer. Computing
at 64×64 and upsampling puts a cold tile at ~1.4 s behind a 30-day cache.

The ASCII dump in the POC output is legible without any colour work: the Alpenvorland
plain is uniformly open, a transition band runs across the middle, and the Alps are a
speckle of blocked valleys and open summits. That structure is the entire point of a
scouting map.

## 6. What this means for the two views

**Map — find a spot.** Terrain becomes a real layer rather than a basemap texture:
hillshade and optional 3D terrain off the same AWS terrarium source the horizon march
reads (MapLibre 6.3.0 ships `raster-dem` with `encoding: 'terrarium'`, a `hillshade`
layer with `hillshade-method`, and `setTerrain` — all verified against the installed
`.d.ts`, not from memory). Then click-anywhere scouting: any coordinate returns mpsas,
skyglow, the horizon profile and the annual budget, so the four committed sites stop
being the only answerable places. The clearance raster is the layer that makes the map
answer the question by itself.

**Forecast — plan the shoot.** One azimuth × altitude panorama carrying all three
fields at once: the measured terrain silhouette, the skyglow rose behind it, and the
tracks the sun, moon and core walk across it tonight, on a time scrub. Each of those
exists separately somewhere — PeakFinder has the terrain, lightpollutionmap has the
dome, PhotoPills has the tracks. Putting them on one pair of axes is the whole idea,
because the question — can I shoot the core, and what is behind it — is a statement
about all three at the same coordinate. `panorama.ts` renders it; it reads at a glance.

## 7. Deliberately not done

- **Ground truth.** Nothing here is checked against a photograph or an SQM reading.
  PVGIS agreement is model-to-model.
- **Vegetation and buildings.** Terrarium's blend is not consistently a surface model.
  A tree line 200 m south is real and invisible here — which is exactly why the near
  band ships flagged rather than scored.
- **Refraction beyond the standard k = 0.13.** Terrestrial refraction varies with the
  temperature gradient, and on a cold clear night over a lake it is not 0.13. Correcting
  it properly needs a profile we do not have.
- **The 2° framing margin** is a photographic judgement, not a measurement.

## 8. Library landscape, re-verified 2026-08-18

Checked because the ephemeris underneath all of the above is a dependency, not a
calculation we own.

**`astronomy-engine` 2.1.19 is abandoned by its author.** Don Cross, on issue #404
(2026-04-14): _"I have mostly abandoned this repo … I am open to someone else taking
this project over."_ Last npm release 2023-12-14, last commit 2025-01-27, no milestones,
35+ open issues, 9 unmerged PRs, no fork positioned as a successor.

That is a supply-chain fact, not a correctness one, and it changes nothing today. The
package is pure arithmetic with no network or filesystem surface, it is pinned exactly,
and `ASTRO-WINDOW-PROGRESS.md` decision D2 already validated its moonrise/set against
USNO to inside a minute. Swapping a validated ephemeris in the middle of a terrain
feature would be the wrong trade. Two things to hold:

- **The reason D2 chose it has weakened.** D2 rejected suncalc because its moonrise/set
  ran 3–11 minutes off USNO at Munich. That was v1. suncalc 2.0.0 (2026-06-18) is a
  precision rewrite on higher-order Meeus with ΔT, validated in-repo against JPL Horizons
  and USNO across 14 locations × 13 days, claiming ~15 s rise/set and ~0.09° moon
  position. It is actively maintained and dependency-free. It also has **no galactic
  frame and no `SearchAltitude`**, so it cannot replace the whole surface — only the
  sun/moon half, with `astro-ephemeris.ts` continuing to hand-roll the core.
- **Two open bugs are in our path.** Issue #411: refraction keeps being applied well
  below −1°, where Skyfield stops — this touches the moon-behind-terrain test whenever
  the ridge sits near 0°. Issue #347: `VectorObserver` intermittently fails to converge;
  we do not call it.

**PVGIS confirms the reference-only decision.** 30 calls/s per IP, CORS blocked so it is
server-side only, coverage 75°N–60°S, and the south-zero azimuth convention
(`0 = S, 90 = W, −90 = E`) that the POC normalises. Its v6 docs declare north-zero — a
different codebase, and conflating the two would silently rotate every profile by 180°.

**Nothing else is worth adopting.** No npm package computes a terrain horizon; the good
implementations are Python (`HORAYZON` over Embree, `topocalc`, `pvlib`'s PVGIS wrapper)
and dragging Python into a Bun stack to replace 60 lines of raymarch is not a trade.
