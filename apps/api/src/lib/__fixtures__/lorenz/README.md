# Lorenz atlas tile fixtures

Real gzipped binary tiles from David J. Lorenz's Light Pollution Atlas, fetched on **2026-08-18**
from:

```
https://djlorenz.github.io/astronomy/binary_tiles/{year}/binary_tile_{tx}_{ty}.dat.gz
```

| File                            | Covers                                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `binary_tile_39_23.2025.dat.gz` | 45–50°N / 10–15°E — every shipped German site, latest atlas                                     |
| `binary_tile_39_23.2016.dat.gz` | the same block in the baseline year, for the decade trend                                       |
| `binary_tile_5_17.2025.dat.gz`  | Mauna Kea — the dark-sky sanity reference                                                       |
| `binary_tile_22_22.2025.dat.gz` | Times Square — the bright end, and the zone clamp case                                          |
| `binary_tile_38_23.2025.dat.gz` | 45–50°N / 5–10°E — Munich/Alpenvorland/Walchensee's 120 km skyglow march crosses ~0.04° into it |
| `binary_tile_39_24.2025.dat.gz` | 50–55°N / 10–15°E — Bayerischer Wald's march touches this and the two tiles below               |
| `binary_tile_40_23.2025.dat.gz` | 45–50°N / 15–20°E — Bayerischer Wald's march                                                    |
| `binary_tile_40_24.2025.dat.gz` | 50–55°N / 15–20°E — Bayerischer Wald's march                                                    |

They are committed rather than downloaded at test time so `src/lib/lorenz-decode.test.ts` and
`src/clients/lorenz-atlas.test.ts` pin the decoder and the march against real bytes without a
network call. The 38_23/39_24/40_23/40_24 set exists specifically so `fetchSkyglow` — which now
refuses to answer with a partial march (a missing tile reads as "no light there", not as "unknown")
— can resolve every shipped reference site's real march in full, not just its own zenith tile.
~800 KB total, and the atlas is republished about once a year, so they do not rot. Re-fetch with the
URL above if a new vintage needs covering.

Attribution: Light Pollution Atlas, David J. Lorenz (djlorenz.github.io/astronomy).
