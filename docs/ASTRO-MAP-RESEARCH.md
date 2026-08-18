# Astro Map — Data Sources, Computations, Mappings

Research and quantitative POC session, **2026-08-18**. Nothing here is implemented.
This is the decision record the implementation session works from.

Everything below was **measured**, not read off a docs page: every URL was fetched from
this machine, every number produced by a script in `docs/poc/astro-map/` (see
[Reproducing the numbers](#reproducing-the-numbers)). Where a research report and a live
probe disagreed, the probe wins and the disagreement is called out.

---

## Verdict

| Question                | Answer                                                                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Light-pollution data    | **Lorenz Atlas 2025** — image tiles for the overlay, binary tiles for the numbers. Both keyless, both already decoded in a working POC.                              |
| Bortle                  | **Delete the field.** Store zenith `mpsas` + `lpi` instead. Bortle is a whole-sky subjective scale; a map cannot produce it (§1.3).                                  |
| The metric worth adding | **Core-direction sky brightness**, not zenith. It re-orders the four sites (§2.5) and costs one extra pass over atlas data we already fetch.                         |
| Transparency input      | **CAMS aerosol optical depth** via Open-Meteo air-quality API. Replaces 7Timer's 1–8 band with a physical number (§4).                                               |
| Cloud input             | Keep DWD ICON for the layered narrative, but **gate on multi-model consensus of total cloud**, not one model's `cloud_cover_low` (§5).                               |
| Radar                   | **DWD RV** (5-min, +105 min nowcast, keyless) inside Germany; RainViewer elsewhere — but RainViewer killed nowcast and satellite on 2026-01-01 (§5.1).               |
| Lightning               | **DWD Blitzdichte** + `Gewitterzellen` (Germany). Blitzortung has no tile endpoint and forbids third-party pulls (§5.1).                                             |
| Basemaps                | OpenFreeMap (5 styles, keyless, no limits) + VersaTiles as backup. **CARTO is licence-hostile since Oct 2025**; Esri imagery needs a dev account + 1M/mo cap (§6.1). |
| Overlay rendering       | Serve **our own terrarium-encoded LPI tiles** and colour them with MapLibre's `color-relief` layer. Verified working on the shipped 6.3.0 (§6.3).                    |
| Page shape              | Tabs on the Astro route — Tonight / Map / Forecast — with the map full-bleed.                                                                                        |

---

## 1. Light pollution

### 1.1 What actually exists

| Source                                                 | Public tiles              | Numbers                      | Licence                                                                                           | Verdict        |
| ------------------------------------------------------ | ------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------- | -------------- |
| **Lorenz Atlas** 2016/2020/2022/2023/2024/2025 + trend | yes, XYZ PNG              | yes, gzip binary grid        | none declared; author grants use on request, asks only that Bortle not be conflated with his maps | **Use it**     |
| EOG VIIRS VNL v2.2                                     | no                        | GeoTIFF, login-gated         | CC BY 4.0                                                                                         | Self-host only |
| NASA Black Marble VNP46A2/A3/A4                        | GIBS browse imagery only  | HDF-EOS5 via Earthdata       | open                                                                                              | Too heavy      |
| Falchi 2016 World Atlas                                | no                        | 2.9 GB GeoTIFF, request form | **CC BY-NC 4.0**                                                                                  | Reference only |
| lightpollutionmap.info                                 | private `QueryRaster` API | on request                   | Jurij Stare credit                                                                                | Don't scrape   |
| lightpollutionmap.app                                  | none published            | none                         | proprietary model over VIIRS                                                                      | Don't scrape   |

The two `.info` / `.app` sites are the obvious-looking answer and both are wrong: neither
publishes a tile endpoint, and using one anyway is leeching a service someone pays for.

### 1.2 The pick — Lorenz, both halves

**Overlay tiles** (measured, not documented anywhere official):

```
https://djlorenz.github.io/astronomy/image_tiles/tiles{YEAR}/tile_{z}_{x}_{y}.png
https://djlorenz.github.io/astronomy/lp/overlay/trend/tile_{z}_{x}_{y}.png
YEAR ∈ {2016, 2020, 2022, 2023, 2024, 2025}
```

- Standard XYZ indexing, **tileSize 1024**, so MapLibre needs `tileSize: 1024` (equivalent
  to Leaflet's `zoomOffset: -2`).
- His JS claims `maxNativeZoom: 8`. **Measured: z7 and above 404.** Real max is **z6**
  (~610 m/px at 1024 px), which matches the 30 arcsec source. Set `maxzoom: 6`.
- Tiles are fully opaque — they need `raster-opacity`, and they must be inserted **below the
  first symbol layer** or place names vanish.

**Numeric grid** — this is the part nobody documents, and it is the reason to use Lorenz
over anything else:

```
https://djlorenz.github.io/astronomy/binary_tiles/{YEAR}/binary_tile_{tx}_{ty}.dat.gz
```

5°×5° tiles, 600×600 points (1/120° = 30 arcsec), ~118 KB gzipped, coverage 65°S–75°N.
Decode (transcribed from `lp/overlay/dark.html`, implemented in
`docs/poc/astro-map/lorenz-lib.ts`):

```
lonFromDateLine = (lon + 180) mod 360
tx = floor(lonFromDateLine / 5) + 1        ty = floor((lat + 65) / 5) + 1
ix = round(120 · (lonFromDateLine − 5(tx−1) + 1/240))
iy = round(120 · (latFromStart   − 5(ty−1) + 1/240))

first  = 128·d[0] + d[1]                    // 2-byte anchor at the SW corner
value  = first + Σ d[600i+1] for i in 1..iy−1     // walk north …
               + Σ d[600(iy−1)+1+i] for i in 1..ix−1   // … then east; 1-byte signed deltas
lpi    = (5/195) · (exp(0.0195 · value) − 1)
```

One tile covers all of southern Bavaria. Decoding it into a dense `Float32Array(360000)`
once makes every subsequent point lookup O(1) — which is what makes the ray-march in §2
cheap enough to run per request.

### 1.3 Units, and why the `bortle` field has to go

`astro-sites.ts` currently stores a hand-assigned `bortle: number` per site and
`astro-score.ts` scores against `WORST_BORTLE_CLASS = 9`. That is the weakest input in the
engine, and the atlas author argues directly against it:

> The Bortle Scale is subjective and about the entire sky. Zenith Brightness is objective
> and just about zenith. […] The 2015 atlas was too optimistic so people reporting Bortle 4
> from a map were most likely Bortle 5 instead.
> — `djlorenz.github.io/astronomy/lp/bortle.html`

He backs it with NPS Night Sky Team data (397 nights, hundreds of sites, all-sky photometry
plus a visual Bortle call): within one Bortle class the measured zenith brightness spans
several atlas zones, skewed dark, because Bortle is driven by **light domes near the
horizon** — exactly what a zenith map cannot see.

The units to store instead:

| Quantity                                 | Definition                             | Conversion                                           |
| ---------------------------------------- | -------------------------------------- | ---------------------------------------------------- |
| **LPI** (Lorenz "Light Pollution Index") | artificial / natural zenith brightness | native output of the grid above                      |
| **mpsas**                                | total zenith brightness, mag/arcsec²   | `22.0 − 5·log₁₀(1 + LPI) / log₁₀(100)`               |
| Zone                                     | Lorenz's 0…7b bands                    | each step = ×3 in LPI, each sub-step = ×√3           |
| mcd/m² (Falchi)                          | artificial zenith radiance             | natural background = 0.174 mcd/m² ≡ 22.0 mag/arcsec² |

The natural baseline of 22.0 mag/arcsec² is a _convention_, not a constant — airglow varies
night to night and rises at solar maximum (which is where we are). Treat any absolute mpsas
as ±0.2 mag before the model's own error.

### 1.4 Measured, for the four shipped sites

Lorenz 2025, zenith, and the 2016→2025 trend (`docs/poc/astro-map/lorenz.ts`):

| Site                    | mpsas 2025 | LPI 2025 | Zone | LPI 2016→2025 | static `bortle` today |
| ----------------------- | ---------- | -------- | ---- | ------------- | --------------------- |
| Munich                  | 18.44      | 25.5     | 6b   | +8 %          | 8                     |
| Alpenvorland (Bad Tölz) | 21.14      | 1.22     | 4a   | **+27 %**     | 4                     |
| Bayerischer Wald        | 21.57      | 0.48     | 3a   | +6 %          | 3                     |
| Walchensee              | 21.55      | 0.51     | 3a   | **+25 %**     | 4                     |

Sanity references from the same run: Mauna Kea 21.86, Times Square 16.74, Westhavelland
IDSP 21.53, Nationalpark Eifel 21.04. All plausible.

Two things fall out immediately:

- The stored Bortle numbers are **not consistent** with the atlas. Bayerischer Wald and
  Walchensee measure the same zenith brightness (21.57 vs 21.55) but carry Bortle 3 vs 4.
- The two nearby sites are brightening ~25 % per decade while Bayerischer Wald is flat.
  A **static** per-site constant silently rots. The trend tile exists; so does the yearly
  grid — recompute, don't hard-code.

---

## 2. The metric that is actually missing: direction

### 2.1 Why zenith is the wrong number here

From 48.1°N the galactic core peaks at **12–13.4°** altitude, due south, every night of the
season. Every photograph points at the 8–14° band in the S/SSE–SSW arc. Zenith brightness
describes the part of the sky that is never in frame.

### 2.2 Two independent estimators

Both implemented in `dome2.ts`, deliberately sharing no input data:

**A — population kernel.** GeoNames `cities500` (235 408 places), Walker's-law falloff,
Plummer softening `√(d² + r_city²)` so a city is not a point source at short range, spread
in azimuth by the city's angular width and in altitude by a scattering-height Gaussian.

**B — atlas ray-march.** March the Lorenz LPI field outward along each azimuth, weighting
ground brightness by how much of it scatters into a line of sight at that elevation:

```
W(r, alt) = exp(−r·tan(alt) / H_scat) / (1 + (r/10)^1.5)     H_scat = 5 km
glow(az, alt) = k · Σ_r LPI(r, az) · W(r, alt)
k = LPI(site) / glow(0°, 90°)     // calibrate so the zenith ray reproduces the atlas exactly
```

Model B uses **no population data at all** — only tiles we already fetch — and the
calibration makes every direction commensurable with the atlas point value.

Agreement of dominant dome azimuth at 10° altitude:

| Site             | Kernel   | Ray-march | Δ      | Profile correlation |
| ---------------- | -------- | --------- | ------ | ------------------- |
| Walchensee       | 20° NNE  | 20° NNE   | **0°** | **0.94**            |
| Alpenvorland     | 20° NNE  | 10° N     | 10°    | **0.97**            |
| Bayerischer Wald | 240° WSW | 190° S    | 50°    | 0.68                |
| Munich           | 350° N   | 20° NNE   | 30°    | 0.72                |

The two dark sites agree almost exactly — both put the dome on Munich (63 km NNE from
Walchensee, 37 km NNE from Bad Tölz). Bayerischer Wald has no single dominant polluter
(largest contributor is Spiegelau at 9.7 %), so "which azimuth is worst" is genuinely
ill-posed there and both methods only agree on the half-sky. Munich is the degenerate case:
inside a city the glow is omnidirectional and the ray-march says so — every azimuth lands
between 0.75 and 0.99 of the maximum, so its "dominant" azimuth is noise, not a dome.

**Recommendation: ship model B, drop model A.** A exists to justify the kernel constants and
to bound the error; it needs a 13 MB GeoNames dump and breaks inside cities.

### 2.3 Calibrating the falloff (`fit-walker.ts`, `fit-v2.ts`)

Fitted the population kernel against the Lorenz 2025 atlas on a 0.1° grid over
47.0–50.5°N / 9.0–14.0°E — **1 836 atlas samples, 31 693 cities**:

```
LPI_pred(x) = C · Σ_i P_i^β · max(d_i, d₀)^(−α) · exp(−d_i / H)
```

Grid-searched α ∈ [1.4, 3.0], β ∈ {0.7…1.1}, H ∈ {50, 75, 100, 150, 250, ∞} km, scored by
**5-fold spatial-block cross-validation** (1° longitude stripes) in mag/arcsec²:

| α       | β       | H      | C            | CV-RMS        | in-RMS | R² (log LPI) |
| ------- | ------- | ------ | ------------ | ------------- | ------ | ------------ |
| 2.1     | 1.1     | ∞      | 1.214e-4     | **0.207 mag** | 0.198  | 0.788        |
| **2.1** | **1.0** | **∞**  | **3.198e-4** | **0.207 mag** | 0.200  | 0.785        |
| 2.0     | 1.0     | 250 km | 3.045e-4     | 0.208         | 0.198  | 0.791        |
| 1.9     | 1.0     | 150 km | 2.582e-4     | 0.209         | 0.199  | 0.789        |
| 3.8     | 1.0     | ∞      | 1.176e-2     | —             | 0.658  | −1.99        |

**The simplest kernel wins.** Sub/super-linear population scaling and an extinction cutoff
buy nothing — the top four are within 0.002 mag of each other, so take the two-parameter
form (`β = 1`, `H = ∞`). Fitted **α = 2.1** sits at the clear-atmosphere end of the
published 2.0–3.0 range for Walker's law — expected, since summing many cities over a wide
domain flattens the effective single-source exponent of 2.5 (Cinzano & Falchi 2012 fit
α = 2.3·(1 + d/1000), i.e. distance-dependent).

`H_scat = 5 km` in model B is not arbitrary either: the aerosol scale height (~1–2 km) pulls
a light dome's peak toward the horizon, the Rayleigh scale height (~8 km) pushes it up, and
the observed compromise for a city at ~50 km is **10–20° elevation** — which 5 km reproduces.

### 2.4 Sensitivity (`sensitivity.ts`)

Nine variants of the ray-march kernel — H ∈ {2, 5, 8} km, falloff exponent ∈ {1.0, 1.5, 2.5},
range ∈ {60, 120, 200} km, core radius ∈ {5, 10, 20} km:

- **Site ranking is invariant across all nine.** Walchensee > Bayerischer Wald > Bad Tölz >
  Munich, every time.
- Absolute dome penalty moves 0.73–1.73 mag depending on parameters. Treat the number as
  **±0.35 mag**; treat the ordering as solid.
- **60 km and 200 km give identical answers.** Everything that matters is inside 60 km — so
  one Lorenz binary tile is usually enough, and the request never leaves memory.

### 2.5 The result — the ranking flips (`summary.ts`)

| Site             | drive   | static Bortle | zenith mag | core-direction mag | dome penalty | S-horizon max/mean |
| ---------------- | ------- | ------------- | ---------- | ------------------ | ------------ | ------------------ |
| Munich           | 0 min   | 8             | 18.44      | 17.31              | 1.09         | 1.0° / 0.7°        |
| Alpenvorland     | 45 min  | 4             | 21.14      | 19.70              | 1.04         | 3.8° / 2.6°        |
| Bayerischer Wald | 150 min | 3             | **21.57**  | 19.76              | 1.34         | 0.6° / 0.2°        |
| Walchensee       | 70 min  | 4             | 21.55      | **19.98**          | 1.03         | 5.7° / 4.5°        |

```
by static Bortle : Bayer. Wald > Alpenvorland > Walchensee > Munich
by zenith        : Bayer. Wald > Walchensee > Alpenvorland > Munich
by core direction: Walchensee > Bayer. Wald > Alpenvorland > Munich
```

(`summary.ts` also prints a ranking by _core contrast_, which folds in each site's live AOD
and so moves night to night. The three rankings above are all AOD-free and static.)

**Bayerischer Wald has the darkest zenith of the four and loses that lead entirely in the
direction that matters.** Its glow — Spiegelau, Grafenau and Neuschönau, all within 9 km —
sits in the S/SSW, exactly where the core is, so it pays the largest dome penalty of the set
(1.34 mag) and ends up 0.22 mag behind Walchensee where the camera points. Walchensee's glow
is Munich in the NNE, i.e. behind the camera, and it pays only 1.03 mag.

At 70 minutes versus 150, that is a **decision the current scorer cannot make**, because it
compares a hand-typed Bortle 3 against a hand-typed Bortle 4.

The dome penalty of ~1.0–1.35 mag also quantifies a claim in the existing brief ("low haze is
the enemy rather than the light dome"): haze is indeed the bigger lever (§4, up to 1.7 mag),
but the dome is not negligible, and unlike haze it is **directional and permanent**.

---

## 3. Terrain (`horizon.py`)

At 8–13° altitude, the ground itself is a candidate gate. Horizon profiles computed from AWS
terrarium DEM tiles at z11 (~76 m/px), 5° azimuth steps, 150 m range steps out to 60 km, with
Earth curvature and standard refraction (k = 0.13):

```
elevation = (R·256 + G + B/256) − 32768
horizon(az) = max_r atan((h(r) − h₀ − r²/(2·R_eff)) / r)
```

| Site             | DEM elev. | highest horizon                         | southern arc 150–215°     |
| ---------------- | --------- | --------------------------------------- | ------------------------- |
| Munich           | 525 m     | 1.4° NNW                                | mean 0.66°, max 0.97°     |
| Alpenvorland     | 599 m     | 3.8° S (Benediktenwand, 1299 m @ 10 km) | mean 2.59°, max 3.83°     |
| Bayerischer Wald | 809 m     | 7.8° NE (1363 m @ 4 km)                 | **mean 0.19°, max 0.61°** |
| Walchensee       | 801 m     | **34.2° NW** (1412 m @ 1 km)            | mean 4.54°, max **5.72°** |

Findings:

1. **The existing `MIN_CORE_ALTITUDE = 8` already covers terrain** at all four sites — the
   worst southern ridge is 5.7°. Lowering the gate to 3° costs Walchensee 44 min/night (12 %)
   and Bad Tölz 4 min; the other two lose nothing (`window.ts`).
2. Walchensee is walled to the N/NW at 24–34°. That is _good_ for the Munich dome (the ridge
   eats the brightest part of it) and bad for foreground composition — worth surfacing, not
   worth gating on.
3. The repo note "Bayerischer Wald … the horizon is treed" is a **field observation the DEM
   contradicts**: terrain-wise it has by far the most open southern horizon of the four. Trees
   are a ~2–5° canopy the DEM cannot see. Keep the note, label it as canopy not terrain.

Terrain belongs in the model as a **per-site constant** computed once, plus a map layer —
not a per-request computation.

---

## 4. Atmosphere — retire 7Timer

`astro-upstreams.ts` pulls 7Timer's `transparency` as an integer band 1–8 with no stated
units. Open-Meteo's air-quality API serves **CAMS aerosol optical depth at 550 nm**, keyless,
hourly, 5-day horizon, plus a separate `dust` field for Saharan intrusions:

```
https://air-quality-api.open-meteo.com/v1/air-quality
  ?latitude=..&longitude=..&hourly=aerosol_optical_depth,dust&forecast_days=5
```

That converts straight into the extinction the core actually suffers:

```
k_tot = k_Rayleigh + 1.086 · AOD₅₅₀        k_Rayleigh ≈ 0.16 mag/airmass at 600–800 m
X     = 1 / (sin(alt) + 0.50572·(alt + 6.07995)^−1.6364)     Kasten & Young 1989
core_observed = 21.0 mag/arcsec² + k_tot · X
```

At 13° altitude X ≈ 4.3, so **every 0.1 of AOD costs 0.47 mag on the core**. Measured spread
for the Walchensee arc (`contrast.ts`):

| AOD₅₅₀              | k_tot | sky bg | core after extinction | contrast |
| ------------------- | ----- | ------ | --------------------- | -------- |
| 0.05 (alpine clear) | 0.21  | 20.43  | 21.91                 | −1.47    |
| 0.20 (typical)      | 0.38  | 20.78  | 22.60                 | −1.82    |
| 0.50 (haze)         | 0.70  | 21.47  | 23.97                 | −2.51    |
| 0.80 (Saharan dust) | 1.03  | 22.15  | 25.35                 | −3.20    |

**A 1.7 mag swing from aerosols alone** — larger than the entire spread between the four
sites. The brief's instinct was right; this makes it a number.

Two caveats to carry into implementation:

- Contrast is negative at every site. That is correct and not a bug: at 48°N through 4.3
  airmasses the core is always fainter than the sky behind it. It is a stacking target, never
  a naked-eye one. Use contrast as a **relative** score, and say so in the UI copy.
- The model currently extinguishes artificial skyglow over half the path (`×0.5`) as a
  first-order fudge, and does not apply the aerosol **amplification** of skyglow (more
  aerosol = more scattering = brighter dome _and_ dimmer stars, a double penalty). Both terms
  need the Garstang/Cinzano primaries before they are worth hard-coding — the research run
  could not retrieve them (IOP captcha).

Also worth pulling from the same endpoint family and currently unused: `relative_humidity_2m`
(dew/lens-fogging risk — models agree on it to ±6–19 %RH, far better than cloud) and
`freezing_level_height`.

---

## 5. Clouds — the uncomfortable finding

`cloud-spread.ts` compares eight free NWP models over the night hours (21–03 UTC) at four
sites, by forecast lead day. Median inter-model spread of `cloud_cover_low`:

| Lead | Walchensee | Bayer. Wald | Hossegor | Peniche |
| ---- | ---------- | ----------- | -------- | ------- |
| +0 d | 97 pp      | 89 pp       | 60 pp    | 58 pp   |
| +1 d | 100 pp     | 39 pp       | 97 pp    | 78 pp   |
| +2 d | 56 pp      | 69 pp       | 100 pp   | 100 pp  |

Eight models — ICON-D2, ICON-EU, ICON global, ECMWF IFS, GFS, AROME-HD, HARMONIE-AROME,
UKMO — disagree by **60–100 percentage points on tonight's low cloud**. Concrete hour, all
eight models, Walchensee 2026-08-18T22:00Z: `21 / 72 / 81 / 0 / 100 / 0 / 100 / 50`.

Most of that is definitional, not predictive. `cloud-total.ts` re-runs the same window on
total cloud cover:

| Variable               | Walchensee | Bayer. Wald | Hossegor |
| ---------------------- | ---------- | ----------- | -------- |
| `cloud_cover` (total)  | 44 pp      | 42 pp       | 45 pp    |
| `cloud_cover_low`      | 94 pp      | 69 pp       | 97 pp    |
| `relative_humidity_2m` | 16 %RH     | 6 %RH       | 19 %RH   |

Layer boundaries differ per model; total cloud roughly halves the spread; humidity is
tight enough to trust outright.

**What this means for the scorer.** `CLOUD_RUINS_AT = { low: 55, mid: 80, high: 100 }` is a
hard gate applied to one model's number that seven other models disagree with by ±50 pp.
Replace it with:

1. Gate on the **median total cloud** across ≥4 models.
2. Emit **model agreement** (IQR, or share of models under the threshold) as a first-class
   confidence field — a "60 % cloud, 8/8 models agree" night is a different decision from
   "60 %, 4 models say clear and 4 say overcast".
3. Keep DWD ICON's layered split for the _narrative_ only ("high cirrus, low deck clearing"),
   never for the gate.

### 5.1 Overlay sources — all verified live from this machine

| Layer             | Endpoint                                                                                                                                                     | Cadence                                                                   | Key      | Notes                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **DWD radar RV**  | `maps.dwd.de/geoserver/dwd/wms` `layers=dwd:Radar_rv_product_1x1km_ger`                                                                                      | 5 min, **+0…+105 min nowcast**                                            | none     | 1 km. Verified frames at +0/+30/+60/+90 all differ; +120 empty. Germany + neighbours (≈45.7–55.9°N, 1.5–18.7°E).                |
| DWD radar WN      | `dwd:Radar_wn-product_1x1km_ger`                                                                                                                             | 5 min                                                                     | none     | Reflectivity variant.                                                                                                           |
| **DWD lightning** | `dwd:Blitzdichte` (NowCastMIX)                                                                                                                               | 5 min, ~1 y archive                                                       | none     | Verified: 0.67 % coverage on 2026-08-17T15:00Z, empty when there are no strikes.                                                |
| DWD storm cells   | `dwd:Gewitterzellen`, `dwd:Gewittercluster`                                                                                                                  | 5 min                                                                     | none     | Cell polygons + tracks.                                                                                                         |
| DWD warnings      | `dwd:Autowarn_Analyse` / `_Vorhersage`                                                                                                                       | 5 min                                                                     | none     | Official warning polygons.                                                                                                      |
| DWD Meteosat RGB  | `dwd:Satellite_meteosat_1km_euat_rgb_day_hrv_and_night_ir108_3h`                                                                                             | **3 h only**                                                              | none     | 1 km Europe, day HRV + night IR10.8. Verified 15 469 distinct colours.                                                          |
| **EUMETSAT**      | `view.eumetsat.int/geoserver/wms` — `msg_fes:clm` cloud mask, `msg_fes:cth` cloud-top height, `mtg_fd:rgb_cloudtype`, `mtg_fd:li_afa` (MTG Lightning Imager) | clm/cth **PT15M** (archive to 2020), rgb_cloudtype PT10M, li_afa **PT5M** | **none** | Full Europe disc. `clm` verified 100 % coverage, 6 357 colours; `li_afa` verified 1.9 % flash coverage.                         |
| RainViewer        | `api.rainviewer.com/public/weather-maps.json` → `{host}{path}/{size}/{z}/{x}/{y}/2/1_1.png`                                                                  | 10 min, 2 h past                                                          | none     | **Nowcast and satellite IR discontinued 2026-01-01** — verified empty arrays. Max zoom 7, colour scheme 2 only, 100 req/IP/min. |
| NASA GIBS         | `gibs.earthdata.nasa.gov/wmts/epsg3857/best/{Layer}/default/{Time}/GoogleMapsCompatible_Level{N}/{z}/{y}/{x}.{ext}`                                          | daily / 10 min (GOES)                                                     | none     | 1 338 layers. No Meteosat — GOES + Himawari only, so weak over Europe.                                                          |

Two corrections to the research reports, from direct probes:

- A report concluded "no free keyless EUMETSAT endpoint was confirmed". **It is keyless** —
  `msg_fes:clm` and `mtg_fd:li_afa` both returned real imagery with no credentials.
- The same report concluded "no DWD lightning layers were found". **`dwd:Blitzdichte` exists**
  and works, along with the storm-cell layers.

Blitzortung stays out: no public XYZ endpoint (`tiles.blitzortung.org` does not resolve), raw
JSON needs a participant login, and the terms require third parties to proxy through their own
infrastructure. DWD + EUMETSAT LI cover it.

### 5.2 One physical rule worth encoding

Kocifaj et al. 2025 (PNAS): low cloud **amplifies** artificial zenith radiance by up to ~27×
over a city (300 m cloud base, low aerosol), but **screens** it far away, dropping sky
brightness below the clear-sky value. For a Milky Way frame cloud is fatal either way — but
the sign flip is worth a sentence in the narrative, and it matters for the "partly cloudy,
worth a gamble?" case: partly cloudy 40 km from Munich is worse than partly cloudy 150 km away
by more than the cloud fraction implies.

---

## 6. The map

### 6.1 Basemaps — verified

| Provider              | Style URLs                                                                                               | Key           | Limits                                                             | Verdict                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| **OpenFreeMap**       | `tiles.openfreemap.org/styles/{liberty,bright,positron,dark,fiord}`                                      | none          | **none stated**                                                    | Default. `fiord` is undocumented but live.                                               |
| **VersaTiles**        | `tiles.versatiles.org/assets/styles/{colorful,eclipse,graybeard,shadow,neutrino,satellite}/style.json`   | none          | none                                                               | Backup / second dark option. Verified.                                                   |
| Esri World Imagery    | `server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`                  | works keyless | free dev account + <1 M/mo + non-commercial, per Esri's own terms  | Satellite mode, with `Powered by Esri` + `Sources: Esri, Vantor, Earthstar Geographics…` |
| **EOX s2cloudless**   | `tiles.maps.eox.at/wmts/1.0.0/s2cloudless-{2016…2025}_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg` | none          | CC BY-NC-SA 4.0 for 2018+                                          | Verified. Cleaner licence story than Esri for a personal app.                            |
| MapTiler              | `api.maptiler.com/maps/{id}/style.json?key=`                                                             | yes           | 100 k requests/mo; **logo mandatory**                              | Skip                                                                                     |
| Stadia                | `tiles.stadiamaps.com/styles/alidade_smooth_dark.json`                                                   | domain auth   | 200 k credits/mo, non-commercial                                   | Skip — style JSON carries no `attribution`, so MapLibre won't credit it automatically.   |
| **CARTO Dark Matter** | keyless in practice                                                                                      | —             | **Enterprise-only since 2025-10-16**, non-profit grantees excepted | **Do not use.** The repo LICENSE was amended three times in late 2025 to say so.         |

The existing comment in `site-map.tsx` ("CARTO requires an Enterprise licence") is correct and
now has a date and a commit behind it.

### 6.2 What the browser actually showed

Rendered in a live Chrome, zero style errors. The overlay/basemap combinations ran on
MapLibre 5.6.1 (`map2.html` — v6 is ESM-only, see §6.4, and the CDN copy of 6.3.0 needs a
module loader); the `color-relief` proof in §6.3 ran on the shipped 6.3.0 (`relief.html`).
Nothing in this section depends on the difference — raster sources, layer ordering and
`raster-resampling` are identical across both.

- **Lorenz + OpenFreeMap `dark` = mud.** The atlas palette is designed for a black
  background; OFM dark has coloured landuse and the two greens fight. Legible only below
  ~0.35 opacity, at which point the data is gone.
- **Lorenz + Esri satellite = unusable.** Both are green/brown. Satellite imagery and the LP
  overlay must be **mutually exclusive modes**, or the LP layer needs a different ramp when
  imagery is on.
- **Lorenz + `positron` at z10.5 with `raster-resampling: nearest` = the good one.** Walchensee
  sits visibly in the dark pocket, Bad Tölz / Geretsried / Penzberg are the bright blobs, and
  `nearest` shows the true 30 arcsec granularity instead of pretending to a resolution the
  data does not have.
- Rasters must be inserted **below the first `symbol` layer** or labels disappear.
- Both WMS overlays (DWD, EUMETSAT) render as MapLibre raster sources with a
  `{bbox-epsg-3857}` template and compose their attribution automatically:
  `DWD | EUMETSAT | Light Pollution Atlas 2025, David J. Lorenz | OpenFreeMap © OpenMapTiles Data from OpenStreetMap`.

### 6.3 Rendering LP in Argo's own palette

Argo's design law says one earned accent and `--vx-*` tokens, never a foreign rainbow. Two
ways out, and the second is verified working:

- **`raster-color` / `raster-color-mix` do not exist in MapLibre.** Those are Mapbox GL JS
  properties; grepping the shipped 6.3.0 bundle finds zero occurrences.
- **MapLibre's equivalent is the `color-relief` layer type** (`color-relief-color`,
  `color-relief-opacity`) over a `raster-dem` source. Verified end-to-end in Chrome against
  6.3.0 (`relief.html`): an arbitrary `interpolate` ramp over `["elevation"]` renders smoothly,
  per-pixel, no banding.

So the architecture is: **Argo's API decodes the Lorenz binary grid and re-emits it as
terrarium-encoded PNG tiles**; the dashboard adds them as a `raster-dem` source and colours
them with a ramp built from `VX.*` tokens. One source, our palette, no third-party colour
scheme, and the same source doubles as the input for a numeric point query.

The same `raster-dem` mechanism gives terrain for free (AWS terrarium tiles,
`s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, verified) — which is what
§3's horizon profile already consumes.

### 6.6 Decided: the basemap and the ramp

These were settled by building the real thing — 209 terrarium-encoded LPI tiles generated
from the Lorenz grid (`lp-tiles-gen.py`), served locally and rendered through `color-relief`
in MapLibre 6.3.0 against four basemaps and six candidate ramps (`ramp-compare.html`). Not
a preference; a comparison.

**Basemap — OpenFreeMap `fiord` for dark, `positron` for light.**

| Candidate            | Why not / why                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `ofm-dark`           | Its road network renders near-black and heavy: the roads read louder than the data they sit under. Reject.                   |
| `versatiles-eclipse` | Orange roads collide directly with the warm half of the ramp. Reject.                                                        |
| `ofm-positron`       | Correct for light mode; the ramp needs its light-scheme hexes there (see below).                                             |
| **`ofm-fiord`**      | Cool blue-grey, quiet roads, legible terrain shading in the Alps. The domes are the only loud thing on the map. **Take it.** |

Note this replaces the current `dark`/`positron` pair in `site-map.tsx` with `fiord`/`positron`.

**Ramp — diverging, cool for clean sky, warm for polluted.** Encoded value is
`mpsas × 100`; stops ascend, which `interpolate` requires:

```ts
'color-relief-color': ['interpolate', ['linear'], ['elevation'],
  1800, VX.series.lpCity,      // 18.00 mag — inner city
  1960, VX.series.lpUrban,     // 19.60
  2060, VX.series.lpSuburban,  // 20.60
  2130, VX.series.lpRural,     // 21.30
  2155, VX.series.lpDark,      // 21.55  ← the band our sites live in
  2180, VX.series.lpDarker,    // 21.80
  2200, VX.series.lpPristine]  // 22.00 — natural sky
```

with the tested dark-scheme values `rgba(231,106,110,.90) / (235,104,71,.62) /
(236,154,60,.40) / (240,183,38,.20) / (142,197,255,.14) / (142,197,255,.30) /
(142,197,255,.44)`.

Four ramps were rendered on the same view. A pure severity ramp (neutral→gold→orange→red)
tints the whole frame warm, because most of Bavaria genuinely sits at 20.8–21.5 — honest, but
it makes "dark" look like "no data". A single-hue sky ramp and a mono white ramp both read as
generic heatmaps and lose the good/bad distinction. **The diverging version wins on the only
question the map has to answer: is the marker sitting in the blue?** Munich reads as a red
core, the Alps and the Bayerischer Wald pocket read blue, and the site markers can be judged
at a glance.

Two rules that come with it:

- The dark end is **not** transparent, which looks like a violation of "ink earns its colour".
  It isn't: this is a diverging scale, so the cool end is carrying the _signal_ "go here", not
  decoration. That is the categorical-separation case DESIGN.md already allows.
- Register the seven stops through `defineSeries` as a `lp-` prefixed group with `{light,dark}`
  pairs. The values above are the dark-scheme set; on `positron` they wash out and need the
  light-scheme shade (one step deeper), which is exactly what `groupTokens` is for.

**Imagery mode is exclusive.** When the base is EOX s2cloudless or Esri, drop the LP layer or
switch it to the warm-only variant at half alpha — §6.2 showed that any full ramp over imagery
is unreadable.

### 6.4 MapLibre v6 facts worth not rediscovering

- **ESM-only, no UMD build, no default export.** `dist/maplibre-gl.mjs`, named exports only.
  unpkg 404s on 6.3.0; jsDelivr serves it.
- **WebGL2 required** (v5 had a WebGL1 fallback).
- `setPremultiplyAlpha(false)` on `RasterTileSource` matters if a radar tile encodes data in
  the alpha channel.
- 6.4.0 is out; the repo is on 6.3.0.

### 6.5 Animating radar frames

Three patterns, in ascending smoothness:

1. `ImageSource.updateImage({url})` — simplest, single georeferenced image, no tile cache.
2. `RasterTileSource.setTiles([...])` — the right one for XYZ radar; full re-request per frame.
3. **N sources, one per frame, crossfaded with `setPaintProperty(id, 'raster-opacity', v)`** —
   smoothest, and the frames stay in the tile cache. `raster-opacity` is transitionable; at
   opacity 0 the layer is skipped entirely in render.

For DWD's WMS the frame is a `&time=` parameter, so pattern 3 means N sources with N
timestamps — 12 frames × 5 min covers the last hour, 21 covers +105 min of nowcast.

---

## 7. Proposed shape

### API

| Route                                        | Returns                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /astro/lightpollution?lat&lon&year`     | `{ lpi, mpsas, zone, year, trend10y, source }` — one binary-tile lookup                                |
| `GET /astro/skyglow?lat&lon`                 | azimuth×altitude glow profile + `{ coreAz, coreAlt, coreDirectionMpsas, domePenalty, topPolluters[] }` |
| `GET /astro/horizon?lat&lon`                 | terrain horizon profile, 5° steps (cacheable ~forever)                                                 |
| `GET /astro/tiles/lp/{year}/{z}/{x}/{y}.png` | terrarium-encoded LPI, our own palette applied client-side                                             |
| `GET /astro/layers`                          | the layer catalogue below, so the settings menu is server-driven                                       |

`astro-sites.ts` changes: drop `bortle`, add `mpsas` / `lpi` / `coreDirectionMpsas` /
`southHorizonDeg`, all computed by a script and committed as data with the date they were
computed — not typed by hand.

### Layer catalogue for the settings menu

Grouped, each with opacity + a mutual-exclusion group:

- **Base** (exclusive): OFM dark · OFM positron · OFM fiord · VersaTiles eclipse · Esri imagery · EOX s2cloudless
- **Light pollution** (exclusive): 2016 · 2020 · 2022 · 2023 · 2024 · 2025 · trend 2013→2025 · off
- **Sky** (multi): core-direction glow rose · terrain horizon shading
- **Weather now** (multi): DWD radar RV (animated) · DWD lightning · DWD storm cells · EUMETSAT cloud mask · DWD Meteosat RGB
- **Sites** (always): candidate markers, drive-time isochrones

Rules learned in §6.2: selecting an imagery base auto-drops LP opacity or switches its ramp;
LP always mounts below the first symbol layer; `nearest` resampling above z6.

### Page

Astro route gets tabs — **Tonight** (verdict, keeps today's layout) / **Map** (full-bleed,
settings drawer) / **Forecast**. The map stops being a 400 px card wedged beside the facts
panel, which is where this session started.

---

## 8. What was not settled

- **No ground-truth validation.** Nothing here was checked against a real SQM or a real
  photograph. Globe at Night publishes naked-eye limiting magnitudes through an SPA with no
  data endpoint, and those are the wrong quantity anyway. The honest fallback is that the
  Lorenz atlas itself is validated against NPS all-sky photometry — our layer on top of it is
  not.
- **The skyglow extinction and aerosol-amplification terms are fudges** (§4). Garstang 1986/1989
  and Cinzano & Falchi 2012 have the real functional forms; both PDFs were blocked during the
  research run.
- **`H_scat = 5 km` is a single number standing in for two scale heights.** Defensible, cited,
  but a two-component (Rayleigh + aerosol) kernel driven by the live AOD would be strictly
  better and is not much more code.
- **The Lorenz atlas has no licence.** The author grants use on request and asks only that
  Bortle not be conflated with his maps. Before shipping, mail `dlorenz@wisc.edu`; until then
  attribute as `Light Pollution Atlas 2025, David J. Lorenz` and honour the request — which
  §1.3 does anyway.
- **GitHub Pages bandwidth.** His tiles are on a personal GitHub Pages site with a soft
  100 GB/month cap. If the map gets used, mirror the binary tiles (they are small) rather than
  hot-linking the image tiles.
- **Marine.** Everything here is astro-only. The surf face needs the same treatment on
  different layers (swell, wind, tide) and none of it was researched.

---

## Reproducing the numbers

Scripts live in `docs/poc/astro-map/`. They are research artifacts — lint-clean but not
formatted or typed to app standard — and they cache downloads under `.cache/` (gitignored).

```bash
cd docs/poc/astro-map

# §1.4 — atlas values and the 10-year trend for every site
bun run lorenz.ts

# §2.3 — Walker-law fit against the atlas  (needs cities500, ~1 min / ~5 min)
curl -sL -o .cache/cities500.zip https://download.geonames.org/export/dump/cities500.zip
unzip -o .cache/cities500.zip -d .cache
bun run fit-walker.ts
bun run fit-v2.ts

# §2.2 — the two directional estimators, compared
bun run dome2.ts

# §2.4 — kernel sensitivity; ranking invariance
bun run sensitivity.ts

# §3 — terrain horizon profiles (writes .cache/horizon.json)
python3 -m pip install --break-system-packages numpy pillow
python3 horizon.py
bun run window.ts

# §4 — core contrast vs aerosol load (live Open-Meteo call)
bun run contrast.ts

# §5 — inter-model cloud disagreement (live Open-Meteo calls)
bun run cloud-spread.ts
bun run cloud-total.ts

# everything, one table
bun run summary.ts

# §6 — map rendering checks; open in a browser
#   map2.html   basemap × light-pollution × DWD radar combinations
#   relief.html color-relief over a terrarium DEM, MapLibre 6.3.0
```

## Sources

- Lorenz, D. J. — _Light Pollution Atlas_ — <https://djlorenz.github.io/astronomy/lp/>
  (`bortle.html`, `colors.html`, `overlay/dark.html`)
- Falchi, F. et al. (2016) _The new world atlas of artificial night sky brightness_,
  Science Advances 2, e1600377 — GFZ DOI 10.5880/GFZ.1.4.2016.001, CC BY-NC 4.0
- Cinzano, P. & Falchi, F. (2012) _The propagation of light pollution in the atmosphere_,
  MNRAS 427, 3337 — arXiv:1209.2031
- Garstang, R. H. (1986, 1989) PASP 98, 364 / 101, 306 — the single-scattering baseline
- Kocifaj, M. et al. (2025) _Cloud amplification of artificial night sky brightness_, PNAS 122
- Leinert, Ch. et al. (1998) A&AS 127, 1 — van Rhijn airglow, natural sky components
- Kasten, F. & Young, A. (1989) — relative optical airmass
- Bodhaine, B. A. et al. (1999) — Rayleigh optical depth
- Elvidge, C. et al. (2021) Remote Sensing 13, 922 — VIIRS VNL v2, CC BY 4.0
- NPS Night Sky Program — Walker's law, all-sky photometry
