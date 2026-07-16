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
  surface's shadow/radius/bg (enforced by `basalt check-theme`). The theme runs a **strict surface
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

| Series name             | Light hex | Dark hex  | `defineSeries` key   | Role / earned reason                |
| ----------------------- | --------- | --------- | -------------------- | ----------------------------------- |
| HRV                     | `#0284c7` | `#38bdf8` | `hrv`                | Anchor metric — sky                 |
| HRV weekly avg          | `#38bdf8` | `#7dd3fc` | `hrvWeekly`          | Lighter sibling of hrv              |
| Resting HR              | `#cd4246` | `#e76a6e` | `restingHr`          | Cardio family                       |
| Sleep duration          | `#0369a1` | `#0284c7` | `sleepDuration`      | Deep sky, sleep anchor              |
| Sleep stage: deep       | `#0c4a6e` | `#0369a1` | `deep`               | Darkest sleep-stage shade           |
| Sleep stage: light      | `#38bdf8` | `#7dd3fc` | `light`              | Lighter sleep-stage shade           |
| Sleep stage: REM        | `#147eb3` | `#3fa6da` | `rem`                | Aerobic/second-blue family          |
| Sleep stage: awake      | `#71717a` | `#a1a1aa` | `awake`              | Neutral (non-sleeping state)        |
| Intensity minutes (low) | `#238c2c` | `#29a634` | `intensityMin`       | Low end of effort ramp — forest     |
| Vigorous minutes        | `#d33d17` | `#eb6847` | `vigorousMin`        | High end of effort ramp — vermilion |
| Intensity: walking      | `#43bf4d` | `#62d96b` | `intensityWalking`   | Forest, lighter sibling             |
| Intensity: moderate     | `#d1980b` | `#f0b726` | `intensityModerate`  | Mid effort ramp — gold              |
| Intensity: vigorous     | `#d33d17` | `#eb6847` | `intensityVigorous`  | High effort ramp — vermilion        |
| Steps                   | `#38bdf8` | `#7dd3fc` | `steps`              | Movement — sky                      |
| Calories                | `#c87619` | `#ec9a3c` | `calories`           | Energy — orange                     |
| SpO2                    | `#147eb3` | `#3fa6da` | `spo2`               | Aerobic — cerulean                  |
| Respiration             | `#3fa6da` | `#68c1ee` | `respiration`        | Aerobic, lighter sibling            |
| VO2max                  | `#d1980b` | `#f0b726` | `vo2max`             | Highlight — gold                    |
| ACWR                    | `#d1980b` | `#f0b726` | `acwr`               | Training-load highlight — gold      |
| Acute load              | `#ec9a3c` | `#fbb360` | `acute`              | Orange, lighter shade               |
| Chronic load            | `#935610` | `#c87619` | `chronic`            | Orange, deeper shade                |
| Bench press             | `#0284c7` | `#38bdf8` | `benchPress`         | Strength lift — sky                 |
| Squat                   | `#29a634` | `#43bf4d` | `squat`              | Strength lift — forest              |
| Deadlift                | `#d33d17` | `#eb6847` | `deadlift`           | Strength lift — vermilion           |
| Pull-ups                | `#d1980b` | `#f0b726` | `pullUps`            | Strength lift — gold                |
| Skinfold: abdominal     | `#147eb3` | `#3fa6da` | `skinfoldAbdominal`  | Body-comp site — cerulean           |
| Skinfold: suprailiac    | `#d1980b` | `#f0b726` | `skinfoldSuprailiac` | Body-comp site — gold               |
| WalkingPad: distance    | `#0284c7` | `#38bdf8` | `walkingDistance`    | Anchor metric — sky                 |
| WalkingPad: pace        | `#d1980b` | `#f0b726` | `walkingPace`        | Gold accent                         |
| WalkingPad: steps       | `#29a634` | `#43bf4d` | `walkingSteps`       | Forest accent                       |
| WalkingPad: kcal        | `#c87619` | `#ec9a3c` | `walkingKcal`        | Energy — orange                     |
| WalkingPad: duration    | `#946638` | `#af855a` | `walkingDuration`    | Sepia (distinct from the set above) |

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

- **`VX.muted` is used instead of `VX.tooltipMuted`** in two bespoke tooltip/legend labels
  (readiness-strain, time-of-day): the opaque secondary-ink token reads equivalently there. Note
  this is now a preference, not a constraint — basalt-ui 1.0.0 does export `VX.tooltipMuted`
  (the earlier claim that it did not was written against a pre-1.0 build). Retire this entry if
  those two call sites ever move to `VX.tooltipMuted`.
