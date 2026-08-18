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

`horizon.py` needs `numpy` and `pillow`; everything else is plain Bun with no dependencies.
