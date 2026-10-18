# Astro Window — concept

Route `/astro-window` (tabs Tonight, Map, Forecast) · `apps/dashboard/src/routes/astro-window.tsx`, `apps/dashboard/src/features/astro-window/` · API `GET /astro/window`, `/astro/horizon`, `/astro/visibility`, `/astro/skyglow`, `/astro/light-pollution`.

## Baseline verdict

Shots: `astro-window--dark--desktop.png` (Tonight), crops `astro-window--dark--01-card.png` (verdict), `02-card.png` (night strip), `03-card.png` (facts); `astro-window-tab-forecast--dark--02-night-timeline.png` … `05-annual-visibility-budget.png`; `astro-window-tab-map--dark--desktop.png`.

- Tonight: the verdict card shows `RULED OUT` in large type, two pill sentences and a right-aligned paragraph that says the same thing a third time (crop 01). The 10-night strip is ten identical cells `OUT · — · core low` (crop 02), so it carries no information when everything is out.
- The facts card (crop 03) is a 20-row label/value table (Darkness, Galactic core, Moon, Sky) beside an empty right half at 1440. It ends in a `SCORE` heading with nothing under it. Rows like `Core direction {mpsas} mag/arcsec²` carry no scale: is that dark?
- The subtitle "Is tonight worth going out for Milky Way nightscapes?" is a filler question, repeated on the Forecast tab above a strip that already answers it.
- Forecast charts (night timeline, cloud layers, sky panorama, annual budget) are the strongest surfaces: real encodings, units on axes. Their titles are bare nouns with an info icon; the panorama's solid red-orange skyglow fill dominates the card.
- Map tab: full-bleed map with a text-heavy drawer; option descriptions are paragraphs. Least slop on the page.

**Distance from bar: 3/5.** Charts and the engine are Keel-grade; the Tonight tab is a data dump and the strip and verdict repeat each other.

## The question and the decision

Question: is any night in the next 10 worth leaving the house for at this site, and if not, what stops it and when does that change?
Decision: go or stay (and which night and window), or switch site.

## Datasets and encodings

| Dataset | Source | Shape (SPEC §3) | Today | Chosen | Reason | Keel |
|-|-|-|-|-|-|-|
| Verdict + killers | `window.verdict`, `score`, `killers[{id,label,reason}]`, `bestWindow` | A request that needs a decision | Big word + pills + paragraph | Verdict card: status chip `OUT` / `GO`, headline as fact (`OUT · core {gap}° under the gate`), killers as status-dot rows `● Core peak {peak}° · gate 8°` each with a horizontal `Meter` 0–30° (the same altitude scale as the Core cell; the core never tops ~30° at the site latitude, so a small gap stays visible) and a tick at the gate; when a window exists, one primary line `{start}–{end} · {duration}` | The gap to the gate is a length; a sentence hides it | `decision-card.png` |
| 10-night strip | `nights[]`: `verdict`, `score`, `window.minutes`, `killers[0].id` | Status over time | 10 cells `OUT / — / core low` | Cells keep the date (mono) and a `BandStrip` verdict band; second line is window length (`{duration}`) or the first killer's short label (`core low`, `cloud`, `moon`); selected night outlined; best night gets a mono `BEST` marker | Cells vary only when the data varies; all-out nights still show why | `schedule-item.png` |
| Darkness | `night.darkStart/darkEnd/darkMinutes` | Record fact | 3 table rows | Cell `DARK` `{start}–{end}` + muted `{duration}` | One fact line replaces three rows | `stat-cell.png` |
| Core | `transit`, `maxCoreAltitude`, `window.peakCoreAltitude/Azimuth` | Progress to a target | `Max altitude {alt}°`, `Window length —` | Cell `CORE` `{alt}°` peak, linear `Meter` 0–30° with a tick at the 8° gate | Same encoding as the verdict row; one idea per surface | `metric-card-bar.png` |
| Moon | `moon.illumination/phase/rise/set`, `maxMoonAltitude` | Part of a whole (lit fraction) | 5 rows | Cell `MOON` `{illumination} %` on a 0–100 bar, qualifier `sets {time} · {phase}` | Rise/set/phase fold into the qualifier; no second ring | `stat-cell.png` |
| Cloud tonight | `weather.cloudLow/Mid/High` | Three independent percentages | 3 rows `{low} % / {mid} % / {high} %` | Cell `CLOUD`: three stacked mini-bars on a shared 0–100 track in the `cloudLow`/`cloudMid`/`cloudHigh` severity ramp, mono values right | Same ramp as the cloud chart | `metric-card-bar.png` |
| Sky quality | `weather.transparency` (1–8), `location.coreDirectionMpsas`, `domePenaltyMag` | Progress to a target | `{n}/8`, `{mpsas} mag/arcsec²`, `{dome} mag` | Cell `SKY` `{mpsas}` + muted `mag/arcsec²` on a 18–22 `Meter` using the `LP.*` ramp with a tick at 21.6 (the map legend's dark threshold); qualifier `dome {dome} mag · transp. {n}/8` | A magnitude without a scale is a bare number | `metric-card-gauge.png` |
| Score breakdown | `night.factors[{label,weight,value,weighted,detail}]`, `score`, `coverage` | Ranked list | Empty `SCORE` block | `BarList`: label, bar = `value` 0–1, mono `{value}`, trailing muted `w {weight}%`; when `verdict === 'out'` one line `Score withheld · gated by core low` | Fixes the empty block and shows what carries the score | `table-row.png` |
| Night timeline | `detail.hourly[]` | Event sequence on a time axis | Line chart on Forecast | Stays; also placed under the verdict on Tonight, with the best-window band | The core / moon / sun picture is the proof of the verdict | `timeline-event.png` |
| Cloud layers | `hourly.cloudLow/Mid/High` | Status over time | Line chart | Stays unchanged | Severity ramp already earned | — |
| Sky panorama | `/astro/horizon`, `/astro/skyglow` | Directional field | Orange-red fill | Stays; lower the fill alpha so skyline and gate line lead | The fill is louder than the answer it frames | — |
| Annual budget | `/astro/visibility` | Part of a whole by month | Grouped bars, 3 gates | Stays; caption names the peak month | Right shape already | — |
| Forecast sources | `window.sources{dwdIcon,globalForecast,sevenTimer}` | Status | Right-aligned `DWD ICON unavailable` | Footer row of three status dots with names, red only when down | Degraded input is a fact about the verdict's trust | `status-pill.png` |

## Layout

1440 Tonight: summary sentence; verdict card (8 cols) with the night timeline beneath it and a "Why not" column (4 cols) of killers; the 10-night strip; one composite **Night anatomy** card of five inner cells (Dark, Core, Moon, Cloud, Sky) divided by hairlines, beside the score `BarList`; sources footer. Forecast: strip, timeline, cloud layers, panorama, annual budget as today with new titles. Map: chrome unchanged; drawer descriptions cut to one line each.

390: strip scrolls horizontally with snap; verdict card full width with the killer `Meter`s under the headline; Night anatomy becomes a 2×3 grid; charts stay full width.

Stay: all four charts, the map and tab model. Change: verdict card, strip cells, facts → anatomy card, drawer copy. Go: the 20-row facts table, the duplicated verdict sentences, the page subtitle.

## Copy

Format is binding; figures are placeholders.

- Summary: `{n} of 10 nights usable · closest {weekday} {day} · core peaks {peak}° against an 8° gate`
- Verdict: `OUT · core {gap}° under the gate` / `GO · {weekday} {day}, {start}–{end} · {duration}`
- Cells: `DARK · {duration}`, `CORE · peak {alt}°`, `MOON · {illumination} % · sets {time}`, `CLOUD · low {low} / mid {mid} / high {high} %`, `SKY · {mpsas} mag/arcsec²`
- Charts: `Core, moon and sun altitude · {weekday} {day} · {start}–{end}`, `Cloud cover by layer · {weekday} {day}`, `Usable core hours per month · peak <month> <h> h`
- Sources: `DWD ICON ● down · global ● ok · 7Timer ● ok`

## Upstream candidates

- `Meter` `{ value, max, target?, stops? }` with a target tick and a custom stop ramp (`LP.*`): planned `Meter` (§4, wave 34).
- `BarList` with a trailing meta column (`weight`): planned `BarList`.
- `StatGroup variant="strip"` as the Night anatomy host: planned strip.
- Decision-card recipe (verdict + killer rows) shared with Warden and Agents: §4 recipe, not a component.
- New: `BandStrip` cell variant with a text slot under the band (day strips).
- New: inline status-dot row `{label, state}[]`; check against `status-pill` before proposing.

## Pass criteria

1. The Tonight tab has no two-column facts table and no empty `SCORE` block; when gated it says why in one line.
2. The verdict card states the gap to the gate with a number and `°`, and draws it as a length against a tick.
3. With all 10 nights out, each strip cell still names its first killer or window length; no cell repeats `—` on two lines.
4. Every sky number carries its unit (`°`, `%`, `mag/arcsec²`, `h m`); `{mpsas}` appears only on a scaled meter.
5. No filler question is a subtitle; the page summary sentence contains a live count of usable nights.
6. Panorama skyline and gate line are legible at first glance in dark and light.
7. At 390 px the strip scrolls with snap and nothing overflows the viewport.

## Wave 22 build notes

- **Additive API fields** (`apps/api/src/routes/astro.ts`, tested): each night carries `gateCoreAltitude` and `coreGateDeg`: the altitude and floor at the dark sample closest to clearing the core gate, from the same per-sample floor `resolveNight` builds `coreUp` from, so out + core killer ⇒ altitude ≤ floor and pass ⇒ altitude > floor (tested; both null with no astronomical night). `maxCoreAltitude` is the transit altitude, which can fall in daylight and contradicted the killer sentence. The response also carries `bestDate` (set even when every night is out) and `moonMaxIllumination`, so the UI mirrors no threshold or guess. No behaviour change for existing callers.
- **Kept deviations from the concept:** the "Why not" column is a **Gates** card (all three hard gates, pass/fail word each, moon meter against its 25 % limit) beside the verdict card; the verdict card carries the core-gap meter (0–30° with the gate tick) so the gap is drawn once. Cloud mini-bars are muted (owner rule) instead of the severity ramp. The Sky meter is a local gradient track from the map's `LP_RAMP` (no Meter `stops`). Selected strip cell is ringed in neutral ink. The Tonight summary is a heading with the live count plus one visible line, because `Section.subtitle` folds into the info glyph below 480 px.
- **Panorama:** the skyglow field's own opacity ceiling (`GLOW_ALPHA` in `charts/sky-panorama.tsx`) lowers it on top of the twilight fade; the `LP.*` alpha ladder in DESIGN.md is untouched. The 8° core gate is a named dashed reference line on the night timeline.
- **Not verified live:** the `GO` verdict state and a gated-by-terrain night (every night in range was out when shot); the strip's scroll-snap is CSS-only and checked on stills.

## Wave 22 rounds

- r0: baseline shot of the three tabs before any change.
- r1: own read — page crashed against a production API that lacked the new fields; shots now run against a local `/astro` route harness with other GETs proxied to production.
- r2: reviewer fail on every Tonight component — verdict gap not drawn, accent ring on selection, colour-only gate state, cloud and sky fills not muted, duplicate figures. Changed: gap meter in the verdict card, neutral ring, pass/fail words, muted cloud bars, gate line on the timeline, odd last anatomy cell spans the row.
- r3: reviewer fail on gates card empty space, panorama glow still dominant, bare mpsas unit, unexplained "0m", unnamed gate line, summary duplicating the verdict. Changed: glow ceiling 0.4 → 0.25, unit, labels, legend entry for the gate, shorter summary.
- r4: reviewer fail on skyglow still dominant, `none time` label, gate legend glyph identical to the sun's, summary repeating the verdict. Changed: glow ceiling 0.25 → 0.12, `No time` label, solid gate line, summary reduced to the closest night.
- r5: reviewer pass on verdict card, night strip, score card, cloud layers and both pages; panorama criterion 6 passes in both schemes. Remaining fails left as-is: font-size count on gates card and panorama, sources row wrapping at 390, tooltip over the timeline legend on hover, undefined `dome`/`transparency` labels, bare `mag/arcsec²` readout in the panorama's scrub line (criterion 4).

## Wave 22 friction

| Export | Needed prop | argo case | What argo does instead |
|-|-|-|-|
| `StatusDot` / `StatusVerdict` | exported from a barrel | killer/gate and source rows | `components/status-dot.tsx` built on `ColorSwatch` |
| `Meter` | `stops` (custom ramp) + multi-`ticks` + `tone="muted"` | sky brightness on the `LP.*` ramp with value marker and 21.6 threshold tick | local `SkyScale` / `Gauge` in `components/night-anatomy.tsx` |
| `BandStrip` | text slot under a cell | 10-night strip cells | local button cells in `components/night-strip.tsx` |
| `StatGroup` | `variant="strip"` | five-reading Night anatomy | local grid in `components/night-anatomy.module.css` |
| `BarList` | trailing meta column | score weight | `secondary` carries `w {share} %` |
| `Section` | subtitle that never folds | summary line at 390 | visible `Text` line in the body |

Local prototypes: `components/night-anatomy.tsx` (`Cell`, `Gauge {value,max,target,label}`, `SkyScale {mpsas}`), `components/night-strip.tsx` (`{nights, selectedDate, markedDate, onSelect}`), `components/tonight-top.tsx` (`{verdict, gates, timeline}`).

- r6: reviewer on live (all out) and a pinned-clock fixture (mid-August: four GO nights, the rest out; fixture only, nothing committed). Pass: both verdict cards, anatomy (OUT), strip (OUT), cloud layers (OUT), pages (OUT), GO timeline window band, BEST marker. Fail and left: gates-card font-size count, timeline tooltip over the next card's title (OUT hover), sticky bars clipping crops at 390, sources dots without a status word, GO score `w` label (renamed `weight`), window repeated in summary/verdict/title (GO). Fixed in r6: sources one line at 390, legend moved to the chart header, dome/transparency defined, panorama readout names the 21.6 dark threshold, panorama font sizes.
- r7 (after code-review round 1): verdict, gates and timeline now all follow the selected night; the strip marker and summary name the API's `bestDate`; one-decimal degrees everywhere; night switching goes through `useDeferredValue` so the previous frame stays. Shot live and with the fixture; not re-scored.

## Wave 22 Keel read

Side by side with `decision-card`, `stat-strip`, `metric-card-bar` and `status-pill` (dark desktop).

Holds: the verdict card follows decision-card anatomy (one question line, a `·` facts line, evidence inset); the Night anatomy card is the stat-strip idea (hairline-divided cells, caption + value + qualifier); the core and moon meters follow metric-card-bar (a neutral fill, a tick at the limit, a caption naming it); every figure is proportional sans with mono only on captions and times.

Does not hold: Keel's decision card carries a real action row and a context preview with a sparkline; ours has neither (read-only, the timeline sits beside it instead). Keel's meters caption both ends (`$0` / `$1.60M target`) and use hatching for the forecast part; ours name the gate but the Moon meter drops its start caption. Keel's stat-strip has a status-pill row; ours uses a plain dot and word (`passed` / `failed`) because `StatusDot` is not exported. Keel's cells are taller with a larger value size; ours are denser (value at `--vx-text-lg`).

## Wave 22 code review round 2

- The core-altitude killer now reads the same closest-to-gate sample as `gateCoreAltitude`/`coreGateDeg` (one derivation); the ridge wording reads "gets no higher than Y° there". The dashboard labels the figure "closest to the gate" in the verdict card, gates and anatomy.
- `coreGateReading` has unit tests on synthetic ridge nights (an out night whose highest sample differs from the closest one, a passing night compared unrounded, no darkness).
- The page resolves its selected site from the deferred params, so a site switch never pairs the old night with the new site.

## Wave 23 rounds

Live production shots (`basalt-ui shot`, 1440 + 390, both schemes) after the basalt-ui 2.20.0 adoption (#81–#84), scored each round by a fresh `basalt-design-reviewer` plus a side-by-side against Keel. Boards: `.design-shots/w23-r1-*` and `w23-r2-*` (gitignored).

- **r1:** fail. ten identical all-out strip cells; score card stretched empty; source dots without words; a dead column beside the timeline; a clipped site select; core altitude stated four times.
- **Fixed between rounds (#88):** a per-night `{n}° short` note, the core reading stated once (and still shown when the gate clears) with the API's terrain reason kept on a failed gate, `coreGateFailure` as the one rule, a compact `{x} mag` site label, degraded sources named with a word.
- **r2:** fail: the strip still draws an identical full-width bar per night and shows 4 of 10 nights at 390 with no scroll cue; the core strip cell is half empty; healthy source dots still carry no word (the reviewer wants one on every dot); the select still clips at 1440 (basalt max width).
- **Against Keel:** does not hold up yet: a half-empty verdict card beside a tall gates card, the strip.
- **Open for Wave 24:** a per-night shortfall bar (or none), a 390 strip scroll cue, the core cell, the panorama-minutes and GO-window items (not on any shot — no GO night, Forecast tab not shot).

### Wave 24 fixes

- Headline is the shared `PageSummary` (`pageSummary()` in `formulas.ts`): `{n} of {total} nights usable` (or `No usable night in the next {total}`), facts `best|closest {day}` · `{n} ruled out`, site name as aside. On Tonight it carries no window (the verdict card owns it); on Forecast, which has no verdict card, it states the range once. "Closest" comes from the smallest core-gate shortfall, not the API's `bestDate` (the first night when all are out).
- The GO window (day, clock range, length) is stated once, in the verdict card (`verdictHeadline()`, now unit-tested on a GO fixture). Its facts line no longer repeats the day on a GO night.
- The panorama's header minute figure is removed: it counted samples above the panorama gate and disagreed with the API's window. The per-night length stays in the strip cell.
- Strip: a night out on the core gate draws its shortfall as a bar on one scale shared by all nights (`shortfallScale`/`shortfallShare`); usable nights draw their window length on one shared scale in the verdict hue; other ruled-out nights draw none (their note names the killer).
- Strip at narrow widths: right-edge fade plus a `{n} more night(s) →` count (also in the group's aria-label), measured with viewport rects (hidden from 800 px, where the strip tiles).
- Core cell: footer `{x}° at transit` (transit can fall in daylight, so never "of the night") (the verdict meter owns the in-dark reading).
- `data-shot="sky-panorama"` already wraps the Forecast panorama and `/astro-window?tab=forecast` is in `scripts/evidence/routes.txt`; no change needed.

No basalt gaps.
