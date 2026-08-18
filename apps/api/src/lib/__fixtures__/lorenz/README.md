# Lorenz atlas tile fixtures

Real gzipped binary tiles from David J. Lorenz's Light Pollution Atlas, fetched on **2026-08-18**
from:

```
https://djlorenz.github.io/astronomy/binary_tiles/{year}/binary_tile_{tx}_{ty}.dat.gz
```

| File                            | Covers                                                      |
| ------------------------------- | ----------------------------------------------------------- |
| `binary_tile_39_23.2025.dat.gz` | 45–50°N / 10–15°E — every shipped German site, latest atlas |
| `binary_tile_39_23.2016.dat.gz` | the same block in the baseline year, for the decade trend   |
| `binary_tile_5_17.2025.dat.gz`  | Mauna Kea — the dark-sky sanity reference                   |
| `binary_tile_22_22.2025.dat.gz` | Times Square — the bright end, and the zone clamp case      |

They are committed rather than downloaded at test time so `src/lib/lorenz-decode.test.ts` pins the
decoder against real bytes without a network call. ~353 KB total, and the atlas is republished about
once a year, so they do not rot. Re-fetch with the URL above if a new vintage needs covering.

Attribution: Light Pollution Atlas, David J. Lorenz (djlorenz.github.io/astronomy).
