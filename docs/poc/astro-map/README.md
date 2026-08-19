# Astro map — research POC scripts

Throwaway analysis scripts backing `docs/ASTRO-MAP-RESEARCH.md`. **Not application code** —
nothing that ships imports them. They pass `oxlint` with zero errors (warnings are expected:
these optimise for being read alongside the doc, not for house style) and are outside the
`format` script's `apps/**` / `packages/**` scope, though the pre-commit hook does format
staged files.

They exist so the numbers in the research doc can be re-derived rather than trusted. Run
order and prerequisites are in that doc under "Reproducing the numbers".

Downloads (atlas tiles, GeoNames dump, DEM tiles, the computed horizon profile) cache under
`.cache/`, which is gitignored. First run of anything touching terrain or the Walker-law fit
pulls a few hundred MB; every run after that is offline.

| File                                 | What it answers                                                                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `lorenz-lib.ts`                      | Shared: Lorenz binary-tile decode, LPI→mpsas, haversine, GeoNames loader                                                         |
| `lorenz.ts`                          | Per-site atlas values, all six years, plus external sanity references                                                            |
| `fit-walker.ts` / `fit-v2.ts`        | Fits the propagation kernel against the atlas; v2 adds spatial-block CV                                                          |
| `dome.ts` / `dome2.ts` / `dome3.ts`  | Directional light-dome estimators — v2 compares two independent ones, v3 puts it in absolute units against the core's real track |
| `sensitivity.ts`                     | Is the site ranking an artefact of the kernel's free parameters? (No.)                                                           |
| `horizon.py`                         | Terrain horizon profile per azimuth from terrarium DEM tiles → `.cache/horizon.json`                                             |
| `window.ts`                          | Minutes per night the core clears both the altitude gate and the ridge                                                           |
| `contrast.ts`                        | Core contrast vs sky background, and its sensitivity to aerosol load                                                             |
| `cloud-spread.ts` / `cloud-total.ts` | How far apart eight free NWP models are on night cloud                                                                           |
| `summary.ts`                         | Every measured quantity in one table                                                                                             |
| `map2.html`                          | Basemap × light-pollution × DWD radar combinations in MapLibre                                                                   |
| `relief.html`                        | Proves `color-relief` works on the shipped MapLibre 6.3.0                                                                        |
| `lp-tiles-gen.py`                    | Encodes the Lorenz grid as terrarium PNG tiles (`mpsas × 100`) — the tile format the API would serve                             |
| `ramp-compare.html`                  | Basemap × ramp comparison over those tiles; how §6.6 was decided                                                                 |
| `cloudmask.html`                     | Why the `raster-dem` custom encoding rendered a flat slab — a zero factor breaks MapLibre's repack (§9.8)                        |
| `rampcheck.html` / `verify.html`     | The LP alpha ladder side by side with its replacement, the OpenTopoMap base wash, and both cloud decodes at shipped values       |
| `irthresh.html`                      | Three IR thresholds against the `clm` mask as ground truth — why the EUMETSAT IR discs were dropped (§9.8)                       |
| `gibscheck.html`                     | GIBS Clean Infrared raw vs decoded — why `color-relief` is NOT applied to it (§9.8)                                              |

`horizon.py` needs `numpy` and `pillow`; everything else is plain Bun with no dependencies.

The five HTML pages above load MapLibre as an ES module from a **version-pinned** path under
`node_modules/.bun/maplibre-gl@6.3.0/`, so they need that exact version installed and they need an
HTTP origin — `file://` blocks module imports. Serve the repo root (`python3 -m http.server 8791`)
and open them from there. `rampcheck.html`/`verify.html` additionally read light-pollution tiles
from a gitignored `.cache/lp/{z}/{x}/{y}.png` mirror, because `/astro/tiles/lp/...` is bearer-
guarded and sends no CORS headers to a local origin; mirror a few tiles with `curl` and an
`Authorization: Bearer` header first.
