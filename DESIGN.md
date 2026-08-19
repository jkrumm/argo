# Argo — Design

> Managed by basalt-ui (1.0.0). This is a **thin** instantiation — it records this app's **deltas
> only** on top of the shipped `basalt-*` rules. The universal law (earned color, neutral-by-default,
> three-tier `--vx-*` tokens, theme-is-data, the chart primitive contract, the elevation/density/shape
> doctrine) lives in those rules and the `/basalt:design` skill, and is **not** repeated here. Touch
> this file only to confirm identity, register the app's series, or record a genuine deviation.

## Precedence (when guidance conflicts)

This file's deltas win, then the shipped rules, then any skill:

1. **This file** (Argo DESIGN.md) — app-specific deltas. Highest authority.
2. **`basalt-*` rules** (`.claude/rules/basalt-*.md`) — the shipped law and its enforcement.
3. **Skills** (`/basalt:design`, `/basalt:charts`, `/frontend-design`, …) — generic method, lowest.

A skill never overrides this file or the `basalt-*` rules. When a skill's instinct collides with the
law, the law wins.

## Identity

Argo inherits the basalt-ui identity verbatim: a calm, dense, professional surface — **modern zinc**
(cool-neutral zinc surfaces, Tailwind zinc family, on both light and dark), **one earned accent: a
saturated sky-blue** — split by role: as INK (links, icons, chart lines) `#0077bd` light / `#8ec5ff`
dark; as a FILLED SURFACE `#0077bd` in both schemes with a white label — neutral grey as the default
data ink, `shadow-card` elevation (a whisper shadow + 1px ring, no plain hairline border on cards), a
three-font system (Nunito Sans body / Hubot Sans condensed headings / JetBrains Mono for all numerals

- micro-labels) carried by the shared `--basalt-font-*` vars. Neutrals do ~90% of the surface; the
  accent only points (primary data series, active-nav icons/child labels, links, primary buttons, focus
  rings, meter leader bars) — never floods. Light mode has cards (`#f4f4f5`) lifting subtly off a
  slightly darker page (`#ececee`-ish) with near-black ink text; dark mode is cool zinc (not steel-blue,
  not pure black). **Dense by default** (compact nav, `sm` gaps/padding); all cards render identically
  — **`shadow-card` depth, one radius token (`--vx-radius-card`)** — never inline-override a
  surface's shadow/radius/bg (enforced by `basalt-ui check-theme`). The theme runs a **strict surface
  system**: it collapses Mantine's raw ramp steps onto the `--vx-surface-*` tokens, so every component
  shares one bg/radius/depth. **Use Mantine primitives, not raw HTML**
  (`Box`/`Flex`/`Grid`/`SimpleGrid`/`Stack`/`Group`/`Paper`/`Card` over `<div>`/`<span>` with inline
  `style`) — also enforced by `check-theme`. See `docs/DESIGN-SPEC.md` in the basalt-ui repo for the
  full 2026-07 visual spec this identity is drawn from.

* **Accent hue:** blue (default: the saturated sky accent — `var(--vx-line)` neutral is still the
  default for single-series marks)
* **Tone deltas:** _(none — inherits)_. Argo's pre-migration Blueprint identity was also anchored on
  blue as its one earned hue, so this migration is a hue-family swap (Blueprint blue → basalt sky),
  not an identity change.

## Series dictionary

The framework owns the **roles** and the **available hues** (see the `basalt-tokens` rule). This
table is the app's **data dictionary** — which metric maps to which hue, as `{light,dark}` pairs,
wired through `defineSeries()` in `apps/dashboard/src/lib/series.ts`. This is the one design artifact
that legitimately lives in the consumer; keep it the single source of truth and never inline a hex
elsewhere.

```ts
// apps/dashboard/src/lib/series.ts — the app's guard-exempt series file
import { BP, defineSeries, groupTokens, p, seriesTokens, type SeriesMap } from 'basalt-ui/tokens'

const SERIES_MAP = defineSeries({ hrv: p(BP.blue) /* … */ } satisfies SeriesMap)

export const SERIES = seriesTokens(SERIES_MAP)
export const ACTIVITY = groupTokens('activity', ACTIVITY_MAP)
// …USAGE_SOURCE / USAGE_BILLING / USAGE_OUTCOME follow the same groupTokens() shape.
```

### Recovery / sleep / effort / movement (unprefixed — `SERIES.*`)

| Series name             | Light hex | Dark hex  | `defineSeries` key   | Role / earned reason                          |
| ----------------------- | --------- | --------- | -------------------- | --------------------------------------------- |
| HRV                     | `#0284c7` | `#38bdf8` | `hrv`                | Anchor metric — sky                           |
| HRV weekly avg          | `#38bdf8` | `#7dd3fc` | `hrvWeekly`          | Lighter sibling of hrv                        |
| Resting HR              | `#cd4246` | `#e76a6e` | `restingHr`          | Cardio family                                 |
| Sleep duration          | `#0369a1` | `#0284c7` | `sleepDuration`      | Deep sky, sleep anchor                        |
| Sleep stage: deep       | `#0c4a6e` | `#0369a1` | `deep`               | Darkest sleep-stage shade                     |
| Sleep stage: light      | `#38bdf8` | `#7dd3fc` | `light`              | Lighter sleep-stage shade                     |
| Sleep stage: REM        | `#147eb3` | `#3fa6da` | `rem`                | Aerobic/second-blue family                    |
| Sleep stage: awake      | `#71717a` | `#a1a1aa` | `awake`              | Neutral (non-sleeping state)                  |
| Intensity minutes (low) | `#238c2c` | `#29a634` | `intensityMin`       | Low end of effort ramp — forest               |
| Vigorous minutes        | `#d33d17` | `#eb6847` | `vigorousMin`        | High end of effort ramp — vermilion           |
| Intensity: walking      | `#43bf4d` | `#62d96b` | `intensityWalking`   | Forest, lighter sibling                       |
| Intensity: moderate     | `#d1980b` | `#f0b726` | `intensityModerate`  | Mid effort ramp — gold                        |
| Intensity: vigorous     | `#d33d17` | `#eb6847` | `intensityVigorous`  | High effort ramp — vermilion                  |
| Steps                   | `#38bdf8` | `#7dd3fc` | `steps`              | Movement — sky                                |
| Calories                | `#c87619` | `#ec9a3c` | `calories`           | Energy — orange                               |
| SpO2                    | `#147eb3` | `#3fa6da` | `spo2`               | Aerobic — cerulean                            |
| Respiration             | `#3fa6da` | `#68c1ee` | `respiration`        | Aerobic, lighter sibling                      |
| VO2max                  | `#d1980b` | `#f0b726` | `vo2max`             | Highlight — gold                              |
| ACWR                    | `#d1980b` | `#f0b726` | `acwr`               | Training-load highlight — gold                |
| Acute load              | `#ec9a3c` | `#fbb360` | `acute`              | Orange, lighter shade                         |
| Chronic load            | `#935610` | `#c87619` | `chronic`            | Orange, deeper shade                          |
| Bench press             | `#0284c7` | `#38bdf8` | `benchPress`         | Strength lift — sky                           |
| Squat                   | `#29a634` | `#43bf4d` | `squat`              | Strength lift — forest                        |
| Deadlift                | `#d33d17` | `#eb6847` | `deadlift`           | Strength lift — vermilion                     |
| Pull-ups                | `#d1980b` | `#f0b726` | `pullUps`            | Strength lift — gold                          |
| Timer phase: work       | `#29a634` | `#43bf4d` | `timerWork`          | Interval phase — forest                       |
| Timer phase: rest       | `#147eb3` | `#3fa6da` | `timerRest`          | Interval phase — cerulean                     |
| Skinfold: abdominal     | `#147eb3` | `#3fa6da` | `skinfoldAbdominal`  | Body-comp site — cerulean                     |
| Skinfold: suprailiac    | `#d1980b` | `#f0b726` | `skinfoldSuprailiac` | Body-comp site — gold                         |
| WalkingPad: distance    | `#0284c7` | `#38bdf8` | `walkingDistance`    | Anchor metric — sky                           |
| WalkingPad: pace        | `#d1980b` | `#f0b726` | `walkingPace`        | Gold accent                                   |
| WalkingPad: steps       | `#29a634` | `#43bf4d` | `walkingSteps`       | Forest accent                                 |
| WalkingPad: kcal        | `#c87619` | `#ec9a3c` | `walkingKcal`        | Energy — orange                               |
| WalkingPad: duration    | `#946638` | `#af855a` | `walkingDuration`    | Sepia (distinct from the set above)           |
| Core altitude           | `#0284c7` | `#38bdf8` | `coreAltitude`       | Anchor metric of the astro page — sky         |
| Moon altitude           | `#d1980b` | `#f0b726` | `moonAltitude`       | The core's antagonist, never a sibling — gold |
| Cloud: low              | `#cd4246` | `#e76a6e` | `cloudLow`           | Top of the cloud severity ramp — red          |
| Cloud: mid              | `#c87619` | `#ec9a3c` | `cloudMid`           | Middle of the severity ramp — orange          |
| Cloud: high             | `#a1a1aa` | `#d4d4d8` | `cloudHigh`          | Bottom of the severity ramp — neutral         |
| Transparency band       | `#147eb3` | `#3fa6da` | `transparencyBand`   | Atmospheric clarity — cerulean                |

### Garmin activities (`activity-` prefix — `ACTIVITY.*`)

| Series name | Light hex | Dark hex  | `defineSeries` key | Role / earned reason  |
| ----------- | --------- | --------- | ------------------ | --------------------- |
| Gym         | `#cd4246` | `#e76a6e` | `gym`              | Cardio/exertion — red |
| Cycling     | `#0284c7` | `#38bdf8` | `cycling`          | Sky                   |
| Tennis      | `#d1980b` | `#f0b726` | `tennis`           | Gold                  |
| Running     | `#29a634` | `#43bf4d` | `running`          | Forest                |
| Hiking      | `#c87619` | `#ec9a3c` | `hiking`           | Orange                |
| Surfing     | `#147eb3` | `#3fa6da` | `surfing`          | Cerulean              |
| Other       | `#a1a1aa` | `#d4d4d8` | `other`            | Neutral (catch-all)   |

### Usage tracker — source (`usage-` prefix — `USAGE_SOURCE.*`)

| Series name  | Light hex | Dark hex  | `defineSeries` key | Role / earned reason |
| ------------ | --------- | --------- | ------------------ | -------------------- |
| Claude Code  | `#0284c7` | `#38bdf8` | `claudeCode`       | Sky                  |
| LiteLLM      | `#147eb3` | `#3fa6da` | `litellm`          | Cerulean             |
| sideclaw     | `#d1980b` | `#f0b726` | `sideclaw`         | Gold                 |
| Hermes Agent | `#cd4246` | `#e76a6e` | `hermesAgent`      | Red                  |
| Audio proxy  | `#29a634` | `#43bf4d` | `audioProxy`       | Forest               |
| Feuer        | `#d33d17` | `#eb6847` | `feuer`            | Vermilion            |
| OpenCode     | `#c87619` | `#ec9a3c` | `opencode`         | Orange               |
| Other        | `#a1a1aa` | `#d4d4d8` | `other`            | Neutral (catch-all)  |

### Usage tracker — billing (`billing-` prefix — `USAGE_BILLING.*`)

| Series name | Light hex | Dark hex  | `defineSeries` key | Role / earned reason |
| ----------- | --------- | --------- | ------------------ | -------------------- |
| Max plan    | `#d1980b` | `#f0b726` | `max`              | Gold                 |
| IU          | `#0284c7` | `#38bdf8` | `iu`               | Sky                  |
| Unknown     | `#a1a1aa` | `#d4d4d8` | `unknown`          | Neutral              |

### Usage tracker — outcome (`outcome-` prefix — `USAGE_OUTCOME.*`)

| Series name | Light hex | Dark hex  | `defineSeries` key | Role / earned reason |
| ----------- | --------- | --------- | ------------------ | -------------------- |
| OK          | `#29a634` | `#43bf4d` | `ok`               | Forest (success)     |
| Error       | `#cd4246` | `#e76a6e` | `error`            | Red (status-bad)     |
| Cancelled   | `#d1980b` | `#f0b726` | `cancelled`        | Gold (status-warn)   |

### Light pollution ramp (`lp-` prefix — `LP.*`)

A **diverging** map ramp, ordered by sky brightness. Stop values are the raw tile payload
(mpsas × 100, ascending from the polluted end because `interpolate` stops must ascend); the alpha
is ramp geometry and lives with the stops in the map component, not in the token. Several rows
below reuse the same token at a different alpha rather than mint a new one — `LP.*` has exactly
seven members and stays there; an intermediate row is a finer step through one of those seven, not
an eighth hue.

| Series name  | Light hex | Dark hex  | `defineSeries` key | Role / earned reason                                                                                                     |
| ------------ | --------- | --------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| LP: city     | `#cd4246` | `#e76a6e` | `lpCity`           | Warm end, stop `1800`, alpha `.90` — red                                                                                 |
| LP: urban    | `#d33d17` | `#eb6847` | `lpUrban`          | Stop `1960`, alpha `.62` — vermilion                                                                                     |
| LP: suburban | `#c87619` | `#ec9a3c` | `lpSuburban`       | Stop `2060`, alpha `.40`; and again at stop `2095`, alpha `.24` — orange, fading toward the crossing                     |
| LP: rural    | `#d1980b` | `#f0b726` | `lpRural`          | The neutral crossing and the ALPHA MINIMUM, stop `2130`, alpha `.12`; opening back up at stop `2145`, alpha `.15` — gold |
| LP: dark     | `#0284c7` | `#38bdf8` | `lpDark`           | Sky, stop `2155`, alpha `.18` — the band our sites live in; and again at stop `2170`, alpha `.25`                        |
| LP: darker   | `#0284c7` | `#38bdf8` | `lpDarker`         | Sky, stop `2180`, alpha `.31`; and again at stop `2190`, alpha `.37` — same hue, deeper alpha                            |
| LP: pristine | `#0284c7` | `#38bdf8` | `lpPristine`       | Cool end, stop `2200`, alpha `.44` — same hue, deepest alpha                                                             |

The alpha minimum sits exactly on `lpRural`'s crossing stop (`2130`) rather than one stop past it —
a diverging ramp has to fade to its most transparent exactly at the point it diverges around, or
the map reads as flat colour blocks with an offset, near-invisible gap rather than a gradient.
Alpha rises monotonically in both directions away from that minimum, with no dip anywhere else in
the table.

The `LP.*` group is reused verbatim (same tokens, same stops, same alpha ladder) for the sky
panorama's skyglow field on the Forecast tab: `GET /astro/skyglow`'s rose is the same mag/arcsec²
quantity this ramp already encodes, measured in the sky rather than on the ground, so it earns the
same ramp rather than a second one. `rampFill` in `charts/sky-panorama.tsx` walks the table
generically (by length and index), so it tracks this ramp's shape with no code change of its own.

The ramp's own opacity and its `color-relief` resampling mode (`linear`, smooth and the default —
`nearest`, the atlas's true 30 arcsec granularity) are both drawer-controlled, riding in the `lp`
search param as `<year>[:<percent>[:<smooth|sharp>[:<min>-<max>]]]`. Neither is ramp geometry — they
scale/soften the whole table above rather than reshape it — so neither lives in this table. The
trailing `<min>-<max>` slot is the ramp's SENSITIVITY window (a drawer `RangeSlider`, mag×100): it
linearly remaps the table's eleven stops onto an arbitrary domain narrower or wider than the
canonical one, so the whole ramp can be spent on a band as tight as the one an actual scouting trip
cares about. The stop values in the table above are the CANONICAL, un-windowed positions — what a
window of `[1800, 2200]` (the default, spanning the whole domain) reduces to — not what is
necessarily painted on screen once a narrower window is selected.

Rules for this table (from the `basalt-tokens` / `basalt-charts` rules — do not relax):

- One hue per series, drawn from the identity families only. Never raw Material/AntD/Tailwind.
- A series earns a color only for **trend**, **signal/status**, or **categorical separation**.
  A lone single-series metric stays neutral (`var(--vx-line)`).
- Light is one shade **deeper**, dark one shade **lighter** — same hue, never the same hex.

`ARGO_DERIVED` in `series.ts` also carries one derived (non-`defineSeries`) var: `--vx-optimalZone`,
a `color-mix` tint of `--vx-goodSolid` fed to `BasaltProvider`'s `paletteOptions.derived` — not a
per-metric series, so it isn't in the table above.

## App deviations

Genuine, intentional departures from the basalt-ui defaults — each with a one-line justification. An
empty section is the correct default; do not invent deviations to fill it.

- **The three cloud layers are a severity ramp, not three peers.** `cloudLow` takes the red
  normally reserved for status/cardio because at a 13° target it is low cloud that actually ends
  the night; mid steps down to orange and high goes fully NEUTRAL, because by "ink earns its
  colour" a layer that only costs a little contrast has not earned a hue. Read as an escalation,
  the same way the effort ramp (`intensityMin` → `vigorousMin`) is. Sepia was tried for the high
  layer first and read as a second orange against mid on the same axis. The map's cloud-mask
  overlay reuses `cloudHigh` alone, at ascending alpha (`CLOUD_RAMP` in
  `features/astro-window/map-layers.ts`), rather than minting a token of its own — the same
  argument the `LP.*` group's reuse for the skyglow rose already makes: a satellite cloud mask is a
  single BINARY field, and by "ink earns its colour" a lone series that is neither a trend nor a
  status nor a categorical set does not earn a hue. `cloudHigh` is already the dictionary's neutral
  cloud ink, so the mask reads as cloud without spending the accent.
- **The light-pollution ramp's dark end is opaque, not transparent, and its five cool-side rows
  (across the three sky-blue tokens `lpDark`/`lpDarker`/`lpPristine`) share one hue.** A severity
  ramp fades out where nothing is wrong; this one is DIVERGING, so the cool half is the actual
  answer — "go here" — and fading it out would erase the only band the map exists to show. Those
  rows therefore all take `p(BP.blue)` — the sky family every other blue series in the app is drawn
  from — and separate by alpha alone (`.18` → `.25` → `.31` → `.37` → `.44`), which is why the alpha
  ladder lives with the ramp stops in the map component rather than in the token. The crossing
  itself — `lpRural`, gold, at stops `2130`/`2145` — carries the ramp's actual ALPHA MINIMUM
  (`.12`, rising to `.15`), and it sits exactly on the crossing rather than one stop past it: that
  is what makes the ramp read as diverging rather than as two disconnected halves, fading smoothly
  through neutral instead of jumping from warm colour to an offset, near-invisible gap to blue.
  The minimum is a FLOOR, not zero: much of the rural band this map is read for sits at 21.2–21.4,
  so a crossing that faded to nothing would blank the very region being scouted. `.12` is a
  present-but-unemphatic tint — the ramp never disappears anywhere along its domain.
- **`VX.muted` is used instead of `VX.tooltipMuted`** in two bespoke tooltip/legend labels
  (readiness-strain, time-of-day): the opaque secondary-ink token reads equivalently there. Note
  this is now a preference, not a constraint — basalt-ui 1.0.0 does export `VX.tooltipMuted`
  (the earlier claim that it did not was written against a pre-1.0 build). Retire this entry if
  those two call sites ever move to `VX.tooltipMuted`.
