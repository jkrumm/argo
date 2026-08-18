# POC — terrain horizons and the astro budget

Every number in `docs/ASTRO-HORIZON-RESEARCH.md` comes from a script here. They run
against the live AWS terrarium bucket, the Lorenz atlas and PVGIS, and cache what they
fetch under `.cache/` (gitignored), so a second run is offline and fast.

```bash
bun run docs/poc/astro-horizon/<script>.ts
```

`node_modules` is a gitignored symlink to `apps/api/node_modules` — the POC imports the
shipped libs directly and needs `astronomy-engine` resolvable from here.

| Script               | Answers                                         | Key output                                  |
| -------------------- | ----------------------------------------------- | ------------------------------------------- |
| `validate.ts`        | Is our raymarch PVGIS-grade?                    | 0.20° RMS over the southern arc             |
| `sensitivity.ts`     | What do zoom / step / range buy?                | range matters at Munich only; step does not |
| `nearfield.ts`       | Why does Bayerischer Wald move 0.65° with zoom? | its z12 maximum sits at 0.1 km              |
| `nearfield-share.ts` | Can the near band be separated?                 | far band is z11≡z12 to ≤0.08°               |
| `binding.ts`         | When does terrain become the binding gate?      | Wallberg summit loses 94% of its core hours |
| `visibility.ts`      | Annual core budget under three gates            | terrain-blocked moon: +21% at Walchensee    |
| `clearance-grid.ts`  | Can clearance be rastered?                      | 0.34 ms/cell, 8.3 M samples/s               |
| `panorama.ts`        | Does the combined view read?                    | writes `panorama.html`, open it             |

`sites.ts` holds the four committed sites, the DEM factory and the PVGIS client;
`lorenz-sampler.ts` is a disk-cached LPI sampler over the shipped decode, built to avoid
dragging the API's env validation and OTel into a POC.

Environment knobs: `ZOOM` (validate), `YEAR` (visibility), `N` (clearance-grid),
`SITE` / `DATE` (panorama). `panorama.ts` also takes `LAT` / `LON` / `NAME` for an
arbitrary coordinate — the committed `panorama.html` is Walchensee on the 2026-08-12 new
moon, which is the good case; render Wallberg summit for the bad one:

```bash
LAT=47.6631 LON=11.7736 NAME='Wallberg summit' bun run docs/poc/astro-horizon/panorama.ts
```

## What the panorama establishes for the real component

Layer order, bottom to top: twilight wash (sky colour from sun altitude) → skyglow raster
→ grid → the gate line → local-ground band → skyline fill → sun/moon/core tracks → the
segment of the core track that clears the gate in astronomical darkness, drawn bold →
instant markers. Axes are azimuth 0–360° in N-E-S-W-N order (which centres south for
free) against altitude −4…52°. The single number the header carries is minutes above the
gate tonight.
