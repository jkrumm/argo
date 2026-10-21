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

| Dataset           | Source                                                                        | Shape (SPEC §3)                 | Today                                        | Chosen                                                                                                                                                                                                                                                                                                                                                                                                             | Reason                                                              | Keel                    |
| ----------------- | ----------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ----------------------- |
| Verdict + killers | `window.verdict`, `score`, `killers[{id,label,reason}]`, `bestWindow`         | A request that needs a decision | Big word + pills + paragraph                 | Verdict card: status chip `OUT` / `GO`, headline as fact (`OUT · core {gap}° under the gate`), killers as status-dot rows `● Core peak {peak}° · gate 8°` each with a horizontal `Meter` 0–30° (the same altitude scale as the Core cell; the core never tops ~30° at the site latitude, so a small gap stays visible) and a tick at the gate; when a window exists, one primary line `{start}–{end} · {duration}` | The gap to the gate is a length; a sentence hides it                | `decision-card.png`     |
| 10-night strip    | `nights[]`: `verdict`, `score`, `window.minutes`, `killers[0].id`             | Status over time                | 10 cells `OUT / — / core low`                | Cells keep the date (mono) and a `BandStrip` verdict band; second line is window length (`{duration}`) or the first killer's short label (`core {gap}° under its gate` for a core miss, then `cloud`, `moon`); selected night outlined; best night gets a mono `BEST` marker                                                                                                                                       | Cells vary only when the data varies; all-out nights still show why | `schedule-item.png`     |
| Darkness          | `night.darkStart/darkEnd/darkMinutes`                                         | Record fact                     | 3 table rows                                 | Cell `DARK` `{start}–{end}` + muted `{duration}`                                                                                                                                                                                                                                                                                                                                                                   | One fact line replaces three rows                                   | `stat-cell.png`         |
| Core              | `transit`, `maxCoreAltitude`, `window.peakCoreAltitude/Azimuth`               | Progress to a target            | `Max altitude {alt}°`, `Window length —`     | Cell `CORE` `{alt}°` peak, linear `Meter` 0–30° with a tick at the 8° gate                                                                                                                                                                                                                                                                                                                                         | Same encoding as the verdict row; one idea per surface              | `metric-card-bar.png`   |
| Moon              | `moon.illumination/phase/rise/set`, `maxMoonAltitude`                         | Part of a whole (lit fraction)  | 5 rows                                       | Cell `MOON` `{illumination} %` on a 0–100 bar, qualifier `sets {time} · {phase}`                                                                                                                                                                                                                                                                                                                                   | Rise/set/phase fold into the qualifier; no second ring              | `stat-cell.png`         |
| Cloud tonight     | `weather.cloudLow/Mid/High`                                                   | Three independent percentages   | 3 rows `{low} % / {mid} % / {high} %`        | Cell `CLOUD`: three stacked mini-bars on a shared 0–100 track in the `cloudLow`/`cloudMid`/`cloudHigh` severity ramp, mono values right                                                                                                                                                                                                                                                                            | Same ramp as the cloud chart                                        | `metric-card-bar.png`   |
| Sky quality       | `weather.transparency` (1–8), `location.coreDirectionMpsas`, `domePenaltyMag` | Progress to a target            | `{n}/8`, `{mpsas} mag/arcsec²`, `{dome} mag` | Cell `SKY` `{mpsas}` + muted `mag/arcsec²` on a 18–22 `Meter` using the `LP.*` ramp with a tick at 21.6 (the map legend's dark threshold); qualifier `dome {dome} mag · transp. {n}/8`                                                                                                                                                                                                                             | A magnitude without a scale is a bare number                        | `metric-card-gauge.png` |
| Score breakdown   | `night.factors[{label,weight,value,weighted,detail}]`, `score`, `coverage`    | Ranked list                     | Empty `SCORE` block                          | `BarList`: label, bar = `value` 0–1, mono `{value}`, trailing muted `w {weight}%`; when `verdict === 'out'` one line `Score withheld · gated by core low`                                                                                                                                                                                                                                                          | Fixes the empty block and shows what carries the score              | `table-row.png`         |
| Night timeline    | `detail.hourly[]`                                                             | Event sequence on a time axis   | Line chart on Forecast                       | Stays; also placed under the verdict on Tonight, with the best-window band                                                                                                                                                                                                                                                                                                                                         | The core / moon / sun picture is the proof of the verdict           | `timeline-event.png`    |
| Cloud layers      | `hourly.cloudLow/Mid/High`                                                    | Status over time                | Line chart                                   | Stays unchanged                                                                                                                                                                                                                                                                                                                                                                                                    | Severity ramp already earned                                        | —                       |
| Sky panorama      | `/astro/horizon`, `/astro/skyglow`                                            | Directional field               | Orange-red fill                              | Stays; lower the fill alpha so skyline and gate line lead                                                                                                                                                                                                                                                                                                                                                          | The fill is louder than the answer it frames                        | —                       |
| Annual budget     | `/astro/visibility`                                                           | Part of a whole by month        | Grouped bars, 3 gates                        | Stays; caption names the peak month                                                                                                                                                                                                                                                                                                                                                                                | Right shape already                                                 | —                       |
| Forecast sources  | `window.sources{dwdIcon,globalForecast,sevenTimer}`                           | Status                          | Right-aligned `DWD ICON unavailable`         | Footer row of three status dots with names, red only when down                                                                                                                                                                                                                                                                                                                                                     | Degraded input is a fact about the verdict's trust                  | `status-pill.png`       |

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
- Sky footer: `town glow +{d} mag · transparency {n}/8 (1 = best)` — three lines at 1440; the word is the page's (`Transparency` on the score card), and the direction hint is a fact, so no two-line form is honest.
- Forecast, site not in the list: `No site "{site}" in the list — choose another site, or reload if the list is empty`.

**Shot states.** Forecast declares `empty` (the site list emptied, so the unknown-site card renders; it is a basalt `EmptyState`, title `No site "{site}" in the list` plus description `Choose another site, or reload if the list is empty`, no action, and both texts wrap a long site id). Tonight declares none: its route loader awaits the window and the site list, so a hung or failed fetch is the route's pending / error screen, never a card; the window API answers an unknown site 404 and an out-of-range `detailDate` with the first scored night, so no Tonight card has an empty branch, and the empty site list only empties the site selector in the bar.

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
4. Every sky number carries its unit (`°`, `%`, `mag/arcsec²`, `h min`), spelled with a space (`2 h 30 min`, `46 %`); `{mpsas}` appears only on a scaled meter.
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

| Export                        | Needed prop                                            | argo case                                                                   | What argo does instead                                       |
| ----------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `StatusDot` / `StatusVerdict` | exported from a barrel                                 | killer/gate and source rows                                                 | `components/status-dot.tsx` built on `ColorSwatch`           |
| `Meter`                       | `stops` (custom ramp) + multi-`ticks` + `tone="muted"` | sky brightness on the `LP.*` ramp with value marker and 21.6 threshold tick | local `SkyScale` / `Gauge` in `components/night-anatomy.tsx` |
| `BandStrip`                   | text slot under a cell                                 | 10-night strip cells                                                        | local button cells in `components/night-strip.tsx`           |
| `StatGroup`                   | `variant="strip"`                                      | five-reading Night anatomy                                                  | local grid in `components/night-anatomy.module.css`          |
| `BarList`                     | trailing meta column                                   | score weight                                                                | `secondary` carries `w {share} %`                            |
| `Section`                     | subtitle that never folds                              | summary line at 390                                                         | visible `Text` line in the body                              |

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

### Wave 24 round (`w24-r1`, live after #90–#95)

- **Reviewer:** fail: the headline lost its noun (`No usable night in the next {n}`) and `closest {day}` carries no shortfall; `OUT` is a bare word with no dot; the core and cloud cells show no gate or limit to compare against; the sky ramp has an unlabelled second marker; the source dots carry no word; the Forecast tooltips narrate the charts; azimuth readouts have no label; the panorama's 0–50° domain leaves most of the plot blank; cloud layers are labelled twice. The strip now passes: every night's bar differs and the 390 `{n} more nights` cue shows. Basalt: the site select still clips, the meter caption `scale 0–30°`, cloud direct labels colliding with lines.
- **Against Keel:** close — the headline works and the strip now reads per night; the OUT verdict card is still half empty beside the tall gates card, and the Forecast charts carry no per-chart verdict line.

### Wave 25 fixes

- Headline: `No usable night in the next {n} nights`; the closest night now states its miss (`closest {day}, core {x}° under its gate`, else the API's first killer) via `gateMissText()`.
- Verdict: `OUT`/`GO` is a status dot + word (`verdictStatus()`), the question line carries only the reason or window. An OUT card also lists further failed gates (`alsoFailed()`) and the next usable night (`nextUsableText()`), which fills the space beside the gates card.
- Sources: every dot carries a word (`{name} up` / `{name} down`).
- Core cell: transit time and `{x}° at transit`, no meter — the verdict card owns the core-against-gate reading. Cloud cell: the meters are gone (the API exposes no cloud limit to compare against); the three layer values stand alone under `Cloud cover`.
- Sky ramp: the unlabeled tick is named in the footer (`dark sky from 21.6`).
- Forecast: tooltips are definitions, not drawing narration; azimuths read `az {deg}° {compass}` (`fmtAzimuth()`); the panorama's altitude axis is fitted to skyline, gate and tracks (`fitAltDomain()`, height 420 → 320); cloud legend entries are `Low`/`Mid`/`High` (the title already says cloud); each chart has a facts line (`windowFact()`, `peakLowCloud()`, core-at-its-highest, `peakMonth()`, all through `withFacts()`).

No basalt gaps.

### Wave 25 round (`w25-r1`, live after #96–#101)

- **Reviewer:** fail. Fixed: the headline noun and the shortfall, OUT and sources with dot + word, labelled azimuths, a fitted panorama domain, cloud layers labelled once. Open: the Forecast panorama's core altitude disagrees with Tonight's for the same night; low cloud has no statistic/window on Tonight and is missing from the gates card although it ruins the night; core and cloud cells still draw no gate or harm line (core cell `emptyRatio` ≈ 0.46); the verdict card at 4 sizes and `next {n−1} nights` vs the headline's `{n}`; the core miss stated three times; night-strip hover identical to rest and bars without a gate tick; timeline tracks run below the floor with a tooltip on an undrawn point; `Clearance +{c}°` red beside `does not clear`; the skyglow legend swatch mismatched; `dome +{d} mag brighter` jargon; source dots without run time; the site select cuts its value at 1440.
- **Against Keel:** does not yet (was close) — one verdict split across three cards that restate and still disagree.

### Wave 26 round 5 fixes

- **Panorama core = Tonight's core.** Root cause: the Forecast header stated the core's _highest_ altitude in the dark, read off the hourly rows, while Tonight states the altitude at the sample _closest to the gate_, read off the API's finer sampling (`gateCoreAltitude`). Two questions, two samplings. The header now reads the same API fields (`coreGateFact()`, tested against the Core cell's own figure), and the scrubber opens on the hourly sample nearest the API's `gateSampleTime` (`nearestInstantIndex`).
- **One verdict card.** The Gates card is folded into the verdict card: question, status + facts, then the gates as rows with a cause in words (no figures, those live in the Core and Moon cells). Two type sizes in the rows (`sm` name, `xs` cause) plus the question. A usable night's facts drop the limiting factor when the low-cloud row already says it (`verdictFacts`).
- **Low cloud** gets a row only when the API marks its factor `ruinous` (new additive field, derived from the engine's `CLOUD_RUINS_AT`: low 55 %, mid 80 %, high 100 %), quoting the scored window mean (`lowCloudRow`). Worded `ruinous · scored, not a gate`. No client threshold. Gated (`out`) nights carry no factors, so show no row.
- **API, additive:** `killers[].cause` (`ridge` | `floor` | `never-rises`, core-altitude gate), `factors[].ruinous`, `nights[].gateSampleTime`. The UI branches on `cause` and shows `reason` verbatim for any other value (`coreGateDetail`); gate rows are built by the pure `gateRows`.
- **Core miss stated once**, in the verdict question. The headline names the closest night's miss only when another night is selected; the timeline fact names it on Forecast only (`windowFact(night, {withMiss})`); the Core gate row says what raised the gate, in words.
- **`next {n−1}` vs `{n}`:** the verdict card no longer counts (`no later night is usable`); the headline owns the number.
- **Core cell** is a gauge against its gate tick (`closest to gate`), which removes the stretch (emptyRatio ≈ 0.46); the meter left the verdict card. **Cloud cell** states low cloud with mid and high in the footer and draws nothing: the API sends no cloud limit to draw.
- **Strip:** hover is a tint distinct from rest, and an out-on-core night's bar is the core altitude against a gate tick on a shared scale (`gateBar`), replacing the shortfall bar.
- **Timeline** tracks outside the −20…20° domain are gaps, so nothing is drawn below the floor and no tooltip row appears on an undrawn point.
- **Panorama readout:** `Clearance` follows the same verdict as the sentence beside it (green when clear, neutral otherwise, never red); the skyglow legend swatch is the ramp's colour at the rose's median brightness (`medianMpsas`).
- **Copy:** `dome +x mag brighter` → `town glow adds x mag`. Sources footer carries the run time (`run {hh:mm}`, from `generatedAt`; the API sends no per-source time). The site select label drops the drive time so the value is no longer cut at 1440.
- Left: none. Basalt-owned: none new.
- Round 2: the panorama readout opens on the API's own reading at `gateSampleTime` (the header's figure) and is re-keyed per night/instant; once scrubbed it is the hourly sample at its own time. The Core gauge widens to a gate above 30°. Core and Moon rows read `n/a` with no astronomical night; a moon over its limit says why it passed.

### Wave 26 round (`w26-r1`, live after #102–#106)

- **Reviewer:** fail. Fixed: panorama and Core cell agree on the core altitude (both read the API's gate sample); one verdict card at three sizes with the gates inside it; `next {n}` counts agree; the Core cell a gauge with a gate tick (no longer stretched); timeline tracks clipped at the floor, tooltips only on drawn points; clearance no longer red; sources carry their run time; plain words for skyglow; strip bars against a gate tick. The API now emits `killers[].cause`, `factors[].ruinous` and `nights[].gateSampleTime`, so the card renders causes instead of inferring them. Carried: the site select cuts its value at 1440 and 390; low cloud on Tonight is a bare `{x} % low` with no statistic, window or limit while Forecast says `{y} % peak low cloud` for the same night, and the verdict card has no cloud row unless the API calls the layer ruinous. **New:** the Cloud cell now stretches (`emptyRatio` ≈ 0.46 — the stretch moved from Core); the panorama header reads `gate gate`; the sources footer wraps at 390 now that it carries the run time. Unscored: the Moon row repeats the Moon cell's illumination; `atmospheric floor` undefined on Tonight; one 8° line named `Core gate` and `Framing gate`, sharing the Sun's dashed glyph; the site name and its sky brightness printed twice. Not verified: night-strip hover (the harness hovers the selected cell).
- **Against Keel:** close (up from does not yet) — one verdict card with the timeline reads like Keel's decision card; the cloud cell still contradicts Forecast.

### Wave 27 round (`w27-r1`, live after #107–#111)

- **Reviewer:** fail. Fixed: the site select no longer cut, the site name once; no `gate gate`; sources footer on one line at 390; low cloud has one statistic and window and Tonight agrees with Forecast; the Cloud cell no longer stretched; no `atmospheric floor`; one name and its own glyph for the 8° line. Carried: the Moon gate row repeats the Moon cell's illumination; the verdict card has no cloud row unless the API calls the layer ruinous. **New:** lost fact — the Cloud cell dropped the mid and high layer values; the Cloud bar draws no limit on a night with no shooting window (a fill that answers nothing); the panorama header runs two clauses together (`{x}° closest to the gate must exceed {g}°`). Unscored: `Clearance +{c}°` beside `Core does not clear the gate now` with no reference named; 390 info tooltips cover the previous card (basalt). Not verified: night-strip hover.
- **Against Keel:** close — the cloud cell lost facts and gained an empty bar.

### Wave 28 round (`w28-r1`, live after #112–#116 on basalt-ui 2.21.0)

- **Reviewer:** fail. Fixed: the Cloud cell carries the mid and high layers again; no limitless Cloud bar; the panorama header one clause (`{a}° closest to gate, needs > {g}°`); `Skyline clearance` names its reference in code (the reviewer still reads it as undefined beside the gate sentence). Carried: the Moon gate row repeats the Moon cell's illumination on a failed night with no window (the API reason is quoted verbatim); the verdict card has no cloud row unless low cloud is ruinous or limiting; 390 info tooltips cover the card above (basalt). **New:** `mid` / `{m} %` split across lines at 1440 in the Cloud cell; cloud-layers prints the mid value three times (headline, legend, line-end label) and its tooltip doubles it; line-end labels repeat the legend and clip `Low` at the top-right; night-strip hover now captured and shows no hover state. Unscored: `town glow adds {d}` breaks before `mag`, `dark sky from {v}` has no unit; `{h}h {m}m` and `{m}%` unspaced; `closest to gate` beside the verdict's shortfall figure, two figures for one fact; the score card restates the failed gates with no number; the Forecast headline restates the selected night; the annual budget's two greys differ by shade only, `{n}h` ticks; the 390 tab bar left-aligns `Map` (basalt).
- **Against Keel:** close — the anatomy strip carries every layer; the verdict and score cards restate each other.

### Wave 29 round (`w29-r1`, live after #117–#121 on basalt-ui 2.21.0)

- **Reviewer:** fail. Fixed: the Cloud cell keeps `mid {m} %` together; the cloud-layers mid value printed once (flat layers `{v} % all night`), the tooltip lists each layer once; the Moon gate row from structured fields (`up to {x}° while it is dark`); unit spacing (`{h} h {m} min`, `{m} %`, `mag`, `mag/arcsec²`); the Forecast headline no longer names the selected night; the score card's withheld line; budget ticks `{n} h`. Carried: line-end labels repeat the legend and clip `Low` (basalt `Lines`, no off-prop); 390 info tooltips over the card above and `Map` left-aligned (basalt); the annual budget's greys shade-only (basalt `Bars` has no pattern fill); `closest to gate` beside the verdict's shortfall figure; night-strip hover unverifiable (the harness hovers the selected cell). **New:** the Sky cell's five-line footer stretches the anatomy row (`strip-dark` / `strip-cloud` `emptyRatio` 0.44 at 1440); the cloud-layers headline runs its two phrases together (`{v} % low cloud dark-hours mean`). Unscored: `transparency {n}/8, 1 = clearest` reads as a score; the verdict-card cloud row absent on gated nights (no factors).
- **Against Keel:** close — the verdict card plus timeline reads like Keel's decision card; the anatomy row is uneven again.

### Wave 30 fixes

- **Sky footer stretched the anatomy row** — fixed: the footer is three short glued phrases (`dark ≥ {t} mag/arcsec²`, `town glow +{d} mag`, `transparency {n}/8, lower clearer`), down from five lines. The dark-sky threshold reads in the Sky cell footer as `dark ≥ {t} mag/arcsec²` (the scale's tick is unlabelled); the Forecast panorama also states it. Cell height at 1440 not measured here (no dev server); the round's shot decides.
- **Cloud-layers headline ran two phrases together** — fixed: `{v} % low cloud · dark-hours mean` (or `shooting-window mean`), each phrase glued with no-break spaces, one break point at the separator (`cloudHeadline`).
- **`transparency {n}/8, 1 = clearest` read as a score** — fixed: `transparency {n}/8, lower clearer`; the value is kept.
- **Verdict-card cloud row absent on gated nights** — fixed: the API still sends the night's low-cloud figure for a ruled-out night, so the row shows it as `Low cloud · not scored` with the figure. Nights that are not ruled out and carry no cloud factor still get no row.
- **`closest to gate` beside the shortfall figure** — fixed: the Core cell and the panorama fact now label the reading `nearest its gate`; the shortfall (`core {g}° under its gate`) is stated once, in the verdict headline.
- **Not argo's, left:** `Lines` end labels, info tooltips at 390, `Map` tab alignment, budget greys shade-only (basalt rows, see `UPSTREAM.md`); night-strip hover.

Follow-up (w30-r1):

- **Sky footer clipped at 1440** — fixed: the transparency phrase splits into `transparency {n}/8` (glued) + a breakable space + `(lower = clearer)` (glued); `dark` breaks from a glued `≥ {t} mag/arcsec²`, `town glow +{d} mag` stays one glued run; every unbreakable run, bound `·` included, is ≤ 24 characters (tested). Every fact kept (`skyCellFooter`).
- **Moon footer opened a line with `· sets`** — fixed: each `·` is bound to the text before it (`moonFooter`).
- **Core footer split `at transit`** — fixed: `at transit` is glued (`coreTransitFooter`).

Follow-up (w30-r2):

- **Sky footer still five lines at 1440** — fixed: the dark-sky threshold `{t}` is labelled under the tick on the local `SkyScale` (mono xs muted; the unit is the cell's), and the aria-label names it. `skyCellFooter` drops `dark ≥ {t} mag/arcsec²`, so the footer is `town glow +{d} mag · transparency {n}/8 (lower = clearer)`; no fact lost. Footer height at 1440 not measured here (no dev server); the round's shot decides.

### Wave 30 round (`w30-r1`, live after #122–#125; `w30-r2` / `w30-r3` after #126–#128, basalt-ui 2.21.0)

- **Reviewer (r1):** fail. Fixed: the cloud headline in two phrases; a ruled-out night's verdict card shows its low cloud as `not scored`; `nearest its gate`, the shortfall said once; the transparency gloss. **New (r1):** the glued Sky footer clipped mid-word at 1440 — #126 let it wrap, which re-stretched the anatomy row (strip-dark / strip-cloud `emptyRatio` 0.44, r2); #128 moved the dark-sky threshold onto the Sky scale's tick, bringing the row to 0.38 at 1440 (r3, dark; the light 1440 pass rendered the pre-#128 bundle). **Open (r3):** the tick label is a bare `{t}` with no word or unit (the meaning left with the footer phrase); the Sky footer is three lines at 1440 (target two). Carried (basalt): `Lines` end labels clip `Low`; 390 info tooltips over the card above; the budget's shade-only greys; night-strip hover unverifiable (harness). Unscored: the panorama readout's threshold without a unit; `Moon up` in bad ink with no verdict word.
- **Against Keel:** close — the verdict card plus timeline reads like Keel's decision card; Keel labels its thresholds, this tick does not yet.

### Wave 31 round (`w31-r1`, live after #129–#133 on basalt-ui 2.22.0; `w31-r2` after the follow-ups)

- **Reviewer:** fail (both tabs). Fixed: the Sky tick reads `dark ≥ {t}`, one glued run, nowrap and end-aligned at the tick (the unit in its accessible text); the panorama readout's threshold carries `mag/arcsec²`; the Moon line gives a verdict word from the Moon gate's own rule (`over the limit` / `under the limit` / `no interference`). Kept: the cloud headline's `· ` period (2.22's `period` list puts no separator between unit and period). Carried: the tick's unit not visible (P3, argo); the Sky footer still three lines at 1440 (P3, argo); the Sky/anatomy cell at four sizes — the tick label is the fourth (argo); `Lines` still clips `Low` and sets `High` under its dashed line (basalt); the budget's shade-only greys (basalt); night-strip hover unverifiable (harness); 390 tooltips over content (basalt). No lost fact.
- **Against Keel:** close — Keel's threshold labels carry their units; this one still does not on screen.

### Wave 32 round (`w32-r1`, live after #134–#138 on basalt-ui 2.22.0, the first round with declared shot states)

- **Reviewer:** fail (both tabs). Fixed: the Sky tick reads `dark ≥ {t} mag/arcsec²` with the unit on screen, `dark ≥` bound to the figure; `strip-sky` and `night-anatomy` back to three type sizes; Forecast declares `empty` (on `sky-panorama`, the real `Unknown site` card cropped). **Not fixed (argo):** the Sky footer is still three lines at 1440 (no line opens on `·` now). **New (argo):** the `Unknown site` card says neither why nor what to do, and is 49 % empty (`placeholderHeight` around two words). **Disputed (argo):** Tonight still declares nothing; the worker found no Tonight card with a reachable no-data state, the reviewer points at the shared site selector — Wave 33 settles it. Unscored: Tonight's altitude chart has no anchor (Forecast's `night-timeline` covers the same card); at 390 the fourth night's `{v}° short` fades at the card edge. Carried (basalt): `Lines` clips `Low` and gives `High` no end label; the budget's shade-only greys; night-strip hover (harness); 390 info tooltips; the sticky bar over the panorama crop; `ViewTabs` 390 centring; the slashed zero. No lost fact.
- **Against Keel:** close — the threshold carries its unit now; Forecast's empty card is a bare noun.

### Wave 33 round (`w33-r1`, live after #139–#143 on basalt-ui 2.22.0)

- **Reviewer:** fail (rubric only on Tonight, basalt elsewhere). Fixed: the `unknown-site` card names the cause and the next step and ends at its content (`emptyRatio` down from 0.49); the Sky footer's three lines at 1440 judged justified — the page's word `transparency` and the direction hint `(1 = best)` stay, one line at 390. **Tonight's state, settled:** it declares none; the reviewer accepts the reasoning (the loader awaits, the API never yields an empty card, an empty site list only empties the selector) — the remaining `craft-7` is a rubric/harness gap, not an argo defect. **New (argo, P3):** the unknown-site copy says `pick another in Site` where no control is labelled `Site`, and prints the raw site id; the altitude card's subtitle words one missed night two ways (`no stretch passes every gate` on Tonight, `core {gap}° under its gate` on Forecast). Unscored: the 390 fade is gone, a `{n} more nights →` row replaces it. Carried (basalt): `Lines` overprinting `Low` with no `High` end label; the budget's shade-only greys; 390 info tooltips; the sticky bar; night-strip hover (harness). No lost fact.
- **Against Keel:** close — the empty card says why and what to do, but as a plain sentence where Keel adds a title and an action.

### Wave 34 round (`w34-r1`, live after #144–#147 on basalt-ui 2.22.0; `w34-r2` after #148)

- **Reviewer:** fail (rubric gap on Tonight, basalt on Forecast). Fixed: Tonight's timeline is a bare `No window` and the missed night is worded once on screen (the verdict headline's `core {gap}° under its gate`); Forecast's timeline reads `No window · core {gap}° under its gate`; the unknown-site card reads `No site "{id}" in the list — pick another from the site filter, or reload if the list is empty`. Unscored: the strip cell's `{gap}° short` beside the verdict's `core {gap}° under its gate` (two wordings since w32; P3 if scored); at 1440 no control is labelled "site filter" (the select shows only its value; 390 says `Filters`); under `empty` the unknown-site card sits beside cards still showing that site's nights (as w33). Carried (basalt): the `craft-7` rubric gap (Tonight declares no states by decision), `Lines` over `Low`, the budget's shade-only greys, 390 info tooltips, the sticky bar, night-strip hover (harness). No lost fact.
- **Against Keel:** Tonight close; Forecast does not yet — the empty card is one sentence where Keel's empty state has a title, a fact line and an action.

### Wave 35 round (`w35-r1`, live after #149–#151 on basalt-ui 2.22.0)

- **Reviewer:** Tonight fail (the rubric's `craft-7/no-declared-states` gap only — Tonight declares no states by decision); Forecast pass. Fixed (confirmed): the night-strip cell reads the verdict's own words `core {gap}° under its gate`, one wording across verdict, strip and both timelines; the Forecast unknown-site card is basalt `EmptyState` (title `No site "{id}" in the list`, description `Choose another site, or reload if the list is empty`). **New (argo, P3):** at 1440 the longer cell text wraps with `gate` orphaned on the second line (Tonight and Forecast), and at 390 one cell's `under its gate` runs into the strip's right-edge fade. Carried (argo, P3): the title prints the raw site id. Carried (basalt): info tooltips over the timeline headline, `Lines` end labels overprinting, the budget's shade-only greys, the sticky bar over the panorama crop. No lost fact.
- **Against Keel:** Tonight close; Forecast close (w34: does not yet) — the empty state has a title and a reason; Keel's also has an action.
- **Re-score `w35-r2` (after basalt-ui 2.23.0, #152):** **Tonight pass** (w35-r1: fail on the rubric gap) — 2.23 fires `craft-7/no-declared-states` only on the route's stateful anchor (`night-timeline`, P2 by the 2.23 claim — no `detect.json` to prove the severity). Forecast pass. Verified: the cloud-layers headline reads `{v} % low cloud · {basis}` with exactly one separator from the `period` list (the local `· ` prefix is gone). Partly closed (basalt): `Lines` end labels sit inside the plot, but `High` now collides with the falling `Low` line. New (basalt, P3): the night-anatomy strip's footers no longer line up across cells. Carried (argo): the `gate` orphan at 1440 and the 390 fade (P3); the raw site id in the empty-state title (P3); under `empty`, the strip, timeline and cloud cards still show a full night beside `No site "{id}" in the list` (P2, first scored now — production-reachable: the window query is keyed by the URL site id, not the list). No lost fact.

### Wave 36 round (`w36-r1`, live after #153–#155 on basalt-ui 2.23.0; `w36-r2` after #156–#158)

- **Reviewer (`w36-r1`):** Tonight pass; Forecast pass. Fixed (confirmed, #155): under `empty` (an empty site list, so the URL's site is unknown) the Forecast tab shows only the unknown-site card — no summary, strip, timeline or cloud cards beside it (the w35 P2); the title reads `No site “{id}” in the list`; the strip cell keeps `its gate` together, no `gate` orphan at 1440. Harness: the three subtracted anchors were undeclared (12 `error` shots); #156 declares them `data-shot-absent="empty"` and `w36-r2` records them `absent` with 0 error shots. Carried (argo, P3): at 390 `under its gate` runs into the strip's right-edge fade. Declined (argo, P3): printing a display name in the unknown-site title — the site is unknown by construction, so the id is the only fact there is. Carried (basalt): the `Lines` end label `Low` on the `High` line, the budget's shade-only greys, the sticky bar over the panorama crop, the anatomy footers out of line; the rubric's `craft-7` P2 on Tonight stays by decision. No lost fact.
- **Against Keel:** Tonight close; Forecast close — the empty state has a title and a reason; Keel's also carries an action.

### Wave 37 round (`w37-r1`, live after #160–#162 on basalt-ui 2.23.0)

- **Reviewer (`w37-r1`):** Tonight **pass**; Forecast **pass**. Fixed (confirmed, #162): at 390 the night strip fits exactly four nights and ends one fade-width short of the edge, so `core {x}° under its gate` wraps at word breaks and the fade covers only the fifth cell's edge (both tabs, both schemes, rest and focus). The unknown-site state keeps its title and next step. Carried: the `craft-7` P2 on Tonight (kept by decision); (harness) the night-strip hover lands on the selected cell; (basalt) `Lines` end labels, the budget's shade-only greys, the sticky bar over the panorama crop, the anatomy footers out of line. No lost fact.
- **Against Keel:** Tonight close; Forecast close — Keel's empty state also carries an action button.

### Wave 38 round (`w38-r1`)

- **Night timeline y domain (argo, P1):** the altitude chart's fixed `[-20, 20]` domain cut the moon's line when it climbed above 20° (live, about 18:30–21:00), so the peak the verdict card states was missing from the chart that should prove it. The top is now `max(20, higher of the core and moon peaks)` rounded up to the next 10°, the sun staying clipped by `inPlot` (`charts/night-timeline-domain.ts`, unit-tested); the bottom stays −20 and a low night draws exactly as before. Colours, legend, gate logic and copy are unchanged.
- **Re-score (`w38-r1`, `w38-r3`):** `w38-r1` fail — a high moon ran off the fixed 20° timeline axis (argo P1, data-triggered) and the sky panorama's 390 legend folds three entries (basalt 2.24). Fixed in #170: the top is the larger of 20° and the core / moon peak rounded up to 10°, the sun clipped at 20°. `w38-r3` **pass** on both tabs (the live night had a high moon; a low night was not shot). Open: the kept `no-declared-states` decision, basalt info bubbles and the sun-first legend order. Against Keel: close.

### Wave 39 round

- **Re-score (`w39-r1`, Tonight + Forecast, no argo change):** pass. Basalt (carried): the 2.24 legend fold and entry wrap on the sky panorama at 390. Against Keel: close.

### Wave 40 round

- **Re-score on basalt-ui 2.26.0 (`w40-r4`, both tabs):** pass. Closed: legend order (`Galactic core` leads, references after), the sky panorama names all seven entries at 390, no entry wraps inside itself. New (basalt, P2): at 390 the night timeline folds its two references (`Sun altitude`, `Core gate 8.0°`) into `+2`, which w39 named — the gate value stays in the Core cell and the panorama header, so no lost fact. Pre-existing, kept by decision: `night-timeline` declares no `data-shot-states` (detect P2). Carried (basalt): 390 info bubbles over headlines, shade-only budget greys, stacked `High` / `Mid` end labels. Against Keel: close.

### Wave 41 bump round

- **Re-score on basalt-ui 2.27.0 (`w42-d`, `w42-r3-map`):** Tonight pass (94), Forecast pass (94), Map pass after the fix. Closed (basalt): the night-timeline legend names all four keys at 390. Fixed (argo): the Map legends sat under the expanded attribution strip at 390 and lost their last lines — `bottom` 8 → 44, verified at 390 and 1440. Carried: night-anatomy footers out of line, annual-budget greys differ by shade only, info bubbles at 390, no declared states on the timeline.

## Wave 51 — two-reviewer re-score (2026-10-21, live production data, basalt-ui 2.27.2)

Shots `w51-astro-{tonight,forecast,map}` (gitignored; `shot detect` run on each dir). Two fresh `basalt-design-reviewer`s, all sheets, 1440 / 390, both schemes, Keel side by side.

- **Reviewer A: fail (site-map), 78.**
  - P1 `site-map (Map tab)` (argo): detect craft-1/nested-radius-step: the map's inner surface has a 10px radius inside a 10px _inset_ parent (all four light/dark x desktop/mobile). Detect score 70. Not in the page doc's carried list,…
  - P1 `site-map (Map tab)` (argo): detect craft-1/off-scale-radius and nested-radius-step at 390: the MapLibre attribution control (`details.maplibregl-ctrl`) has a 12px radius, which is not on the radius scale…
  - P2 `night-timeline (Tonight)` (harness): craft-7/no-declared-states: the timeline renders a state surface but declares no data-shot-states, so empty, loading and error were never scored. Carried: the page doc says this is kept by decision,…
  - P2 `cloud-layers (Forecast)` (basalt): Carried. The `Lines` end labels High, Low and Mid stack and overprint at the bottom-right of the plot (1440 dark). The 390 shot uses a legend and has no overprint.
  - P2 `annual-budget (Forecast)` (basalt): Carried. The two grey bar series (flat floor vs flat + skyline) differ by shade only, so they are hard to tell apart in dark mode. Basalt `Bars` has no pattern fill.
- **Reviewer B: fail (site-map), 82.**
  - P1 `site-map (Map tab, attribution control)` (argo): detect.json reports 3 P1s on site-map (score 70): craft-1/nested-radius-step at 10px inside a 10px parent, craft-1/nested-radius-step at 12px inside 10px, and craft-1/off-scale-radius at 12px on…
  - P2 `night-timeline (Tonight)` (harness): craft-7/no-declared-states: it renders a state surface but declares no data-shot-states, so empty, loading and error were never scored (detect.json P2, Tonight score 97). The page doc says Tonight…
  - P2 `night-anatomy (Tonight)` (basalt): Cell footers do not line up across the five cells at 1440. Dark has a two-line footer, Core and Moon have three, and Sky has a tick label plus a three-line footer. The row is uneven, and Dark and…
  - P2 `cloud-layers (Forecast)` (basalt): The line-end labels `High`, `Low` and `Mid` overprint each other at the right edge, where Low and Mid both drop to 0 and High sits at 100. The Low and Mid lines also overlap at 100 % for long…
  - P2 `verdict-card (Tonight)` (argo): At 1440 the card is about 300 px tall beside a timeline card about 390 px tall, leaving a dead band under it. The Gates rows use dim yellow dots for failed gates and a grey fill panel that is heavy…
  - P2 `annual-budget (Forecast)` (basalt): The `Flat atmospheric floor` and `Flat + measured skyline` bars are two greys that differ by shade only, so they are hard to tell apart, especially in light mode. Carried (basalt `Bars` has no…

**Result: fails the bar.** Both reviewers fail `site-map` on `shot detect` P1s (score 70): the map overlays (`Paper` scrubber and legends, 10 px) nest inside the 10 px map `Card` (`craft-1/nested-radius-step`), and the MapLibre compact attribution control is 12 px (`craft-1/off-scale-radius`, 390 only). Neither is a copy, unit or label fix: the strict surface system collapses `Paper` radii, so a local override would be a workaround. Recorded in `UPSTREAM.md` § Wave 51 and handed to the Map tab concept wave (Wave 52). Tonight and Forecast otherwise pass.

## Wave 52 — Map tab concept

**Scenario.** A reader opens the Map tab to scout: where is the sky dark enough, and what is the weather doing over there now or
in the next hours? In order, they need (1) the canvas, as large as the viewport allows; (2) what the colours mean, for each
layer that is on; (3) when the time-following layers are showing (observed or forecast, and the hour); (4) the data credits,
which the licences require. Layer choice lives in the `Map layers` aside and scouting a point in the scout drawer; neither sits
on the canvas.

**Decision: nothing argo draws floats over the canvas.** The Wave 51 P1 (`craft-1/nested-radius-step`) was the light-pollution
legend `Paper` (and, when a time layer is on, the scrubber `Paper` and the weather legend `Paper`s) floating inside the flush
map `Card`: two surfaces with the same 10 px radius, one inside the other. Instead of asking basalt for a radius step for a
floating panel (`UPSTREAM.md` § Wave 51, row 1, kept), the map card gets a **key rail**: one band at the top of the card, above
the canvas, separated from it by a divider, holding in order:

1. the time scrubber, only while a time-following layer is on (play, mono clock, `observed` / `forecast`, slider, the radar
   hold note);
2. the light-pollution key, only while the atlas is on: the ramp bar with its two mono ends, then one line
   `mag/arcsec² · blue from {mpsas}, where the sites sit · {year} atlas`;
3. one key per active weather layer with a legend: its label, the legend image (height-capped, scrolls past the cap), and its
   `emptyMeans` line.

The rail is plain layout inside the card (`Group`, wrapping), not a surface: no `Paper`, no radius, no shadow. With no layer
that needs a key, the rail is absent and the canvas takes the whole card. The canvas is the rest of the card's height; MapLibre
re-measures its container when the rail appears or wraps.

**Why the top, not the bottom.** A key is read before the field it explains; at 390 the bottom edge of a full-height card sits
under the mobile tab bar, which is where the legend was cut off in Wave 51; and the bottom-right corner belongs to the
attribution control.

**390.** The rail wraps: the scrubber takes its own row, each key takes one row at full width. The canvas keeps at least
`MAP_MIN_HEIGHT` minus the rail; the card does not grow past the viewport.

**Attribution.** MapLibre's compact attribution control stays where the licences put it, on the canvas. Its 12 px radius is a
third-party style (`UPSTREAM.md` § Wave 51, row 2), not restyled locally. The concept does not depend on it: no argo surface sits
in or near that corner, and nothing in the key rail depends on its size.

**Kept.** Site markers on the canvas (the data itself), the `Map layers` aside, the scout drawer, the failed-tiles message.
**Dropped.** Every absolutely positioned `Paper` over the canvas.

**Pass criteria (Map tab).**

1. `shot detect` reports no `nested-radius-step` on an argo surface in `site-map`.
2. Every key names its unit or meaning in words; the light-pollution key states the atlas year and the site threshold.
3. At 390 the key rail is fully visible above the canvas at rest, nothing overflows the viewport width.
4. With no keyed layer on, there is no empty rail.

**Round 1 fixes.** Four defects from the first review round, recorded against the concept above (the key-rail list's "height-capped,
scrolls past the cap" and the 390 note's "the card does not grow past the viewport" are superseded by items 2 and 3).

1. The radar raster sources cap at zoom 7 (`RAINVIEWER_MAXZOOM`, the free-tier limit), so MapLibre overzooms z7 tiles instead of
   drawing the provider's "Zoom Level Not Supported" placeholder.
2. The EUMETSAT weather key is requested opaque with `WIDTH=300` and shown cropped to 320 × 80 on its own white plate in both
   schemes: the GeoServer legend ignores `fontColor` / `fontSize`, so the font-colour plumbing is gone (`DESIGN.md`, App deviations).
3. The key rail is unbounded, so every key is fully visible at rest at 390; the canvas keeps a floor (`mih` 240) and the card keeps
   `MAP_MIN_HEIGHT`.
4. `MAP_FULL_BLEED_HEIGHT` now subtracts the footer offset, the bottom safe-area inset, the page-bar band and twice the main's block
   padding, so the card no longer runs under the mobile tab bar; at desktop widths the footer and inset terms are 0 and it equals
   the scrollport's content box.

**Round 2 fixes.** Five defects from the second review round on the key rail (item 2 of Round 1 is superseded by item 1 here).

1. The EUMETSAT weather key gets its white plate from us: GeoServer ignores `transparent=false` and `bgColor` as well as
   `fontColor` (the PNG is RGBA, transparent background), so black text sat on the dark rail. `WeatherLegendCard` wraps the
   cropped image in a `Box` with `bg="white"`, no radius, shadow or border; `legendUrl` no longer sends the ignored options
   (`DESIGN.md`, App deviations).
2. Radar had no key. The `radar` catalogue row carries a `textKey` (title `Radar`, one dimmed line: rain echoes of the last
   2 h, grey-beige faint, blue, yellow, orange to dark red heavy; RainViewer colour scheme 2 "Universal Blue", past frames only),
   rendered in the rail while radar is on with the same anatomy as the image keys. The "radar holds at its latest frame" note
   stays in the scrubber.
3. The light-pollution key gets the title `Light pollution`, so every key in the rail opens with a title.
4. The scrubber states its span under the slider in dimmed mono, `{first}–{last}`, so the slider's ends are named.
5. `UPSTREAM.md` § Wave 52 records that basalt's chart catalogue has no form for a geographic raster on a map canvas.

## Wave 52 rounds (2026-10-21, live production bundle; two fresh `basalt-design-reviewer`s per round)

Shots `w52-r{1,2,3}-map` (gitignored): the default Map tab and the Map tab with radar + lightning on, 1440 / 390, both schemes.

| Round | Live       | Reviewer A  | Reviewer B  | Argo P1s fixed after it                                                                                                    |
| ----- | ---------- | ----------- | ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| r1    | `603dd251` | fail 27     | fail 14     | radar placeholder tiles above z7; lightning raster clipped; capped rail hid keys at 390; card ran under the tab bar at 390 |
| r2    | `11cd2f8b` | fail 21     | fail 43     | no plate behind the lightning raster in dark (the server ignores `bgColor`/`transparent`); no radar key                    |
| r3    | `1de613c1` | **fail 23** | **fail 29** | none left that argo can fix without an owner decision                                                                      |

**Result: fails the bar.** Concept pass criteria 1–4 hold (no argo surface nests in the card; every key is titled and names its unit; the rail is fully visible at 390; no empty rail). What both final reviewers still fail it on:

- **Owner decision (argo P1, both reviewers):** with radar, lightning and the light-pollution atlas on together, three third-party ramps share one canvas: RainViewer's Universal Blue (the only scheme left since 2026-01-01) reuses the atlas's "dark sky" blue, and its yellow → dark red heavy end overlaps both the lightning ramp and the atlas's warm half. Colour alone cannot separate them. The fix is a product choice, not a style one: either the map answers one question at a time (a weather layer lowers or hides the atlas), or radar is drawn off-palette (desaturated, at the cost of its provider ramp). Not taken without the owner.
- **Third-party (P1 by rubric):** MapLibre's compact attribution control is 12 px (`craft-1/off-scale-radius`, `nested-radius-step`), at 390 on the default route and at every width once weather sources lengthen the credits. `UPSTREAM.md` § Wave 51 row 2; not restyled locally.
- **Basalt (P1 by rubric):** the catalogue has no form for a geographic raster on a map canvas (Expression 1). `UPSTREAM.md` § Wave 52.
- **Open P2/P3 (argo):** at 390 with three keys the rail takes most of the card; at 1440 the radar key wraps alone onto a second row; the white plate is the brightest block in dark; the clock has no time zone; the aside footer narrates the URL state. Third-party P2: the EUMETSAT raster's `Count / 5 minutes` runs into its `1` tick.

## Wave 53 — one question at a time

**Owner decision (2026-10-21).** The map answers one question at a time. Wave 52's last two rounds failed on three third-party
ramps sharing one canvas (the atlas's red → gold → blue, RainViewer's Universal Blue, the lightning raster's yellow → red); no
style choice separates them, so the canvas stops showing more than one coloured field.

**Scenario.** The reader scouting a site tonight asks, in order: (1) where is the sky dark enough; (2) is weather there now;
(3) what does the model expect over the next hours. Each is one question with its own coloured field. Relief, contours and trails
are neutral context for any of the three and never compete for hue.

**Which layers exclude, which combine.**

| Group | Members | Rule |
|-|-|-|
| The answer field | the light-pollution atlas, or exactly ONE weather layer (radar, lightning, cloud mask, infrared cloud, cloud top, the three forecast fields) | Mutually exclusive. One coloured field on the canvas, ever. |
| Context | base map, hillshade, 3D terrain, contours, trails | Combine freely with the answer field and each other. Neutral ink, no hue to collide. |

- **A weather layer hides the atlas; it does not lower it.** Lowered, the atlas's blue still reads as radar's blue. The atlas
  year, opacity, smoothing and range stay in the URL while hidden, so leaving weather restores exactly the atlas that was set.
- **Weather layers are single-select.** Radar and lightning share yellow → red, the same collision one level down. Picking a second
  weather layer replaces the first. A shared link carrying several `wx` tokens opens on the first valid one.
- **Picking an atlas year leaves weather.** In the drawer the atlas years and the weather layers are one choice, so a year radio
  clears the weather layer, and `Off` in a weather section clears it too.

**Default.** The atlas (latest year) with no weather layer, as today: "where is it dark" is the question a scouting reader opens
the tab with, and the weather questions only make sense once a site is in view.

**How the key rail says what is shown and what is hidden.** The rail keys exactly the one answer field, so it never holds more
than: the time scrubber (time-following layers only), one key, and while a weather layer is on, one line naming what is hidden:
`Light pollution hidden while {layer} is on`, with a `Show light pollution` button that leaves weather. Every weather layer has a
key now: the image keys (lightning, cloud top), radar's text key, and text keys for the cloud mask, infrared cloud and the three
forecast fields (Wave 52 drew no key for those five). The scrubber names its clock's zone.

**390.** One key and one note, each a full-width row; the scrubber its own row above them. The rail never holds three keys again,
so the canvas keeps most of the card.

**States shot.** `loading` (the style has not loaded: the canvas shows `Loading map…`, the rail keys nothing) and `error` (the
map failed before its style loaded: `Map unavailable`, the existing failed-tiles message). Not through `data-shot-states`: the
route's loader awaits the API, so `?shot-state=loading|error` replaces the whole route and the map card never renders. The map
reads its own read-once param instead, `?shot-map=loading|error` (`lib/shot-state.ts`), shot as two extra routes
`/astro-window?tab=map&shot-map=loading|error`. The weather-layer states (each forecast key; radar with the atlas hidden) are
routes with `wx=` set.

**Pass criteria (Map tab, Wave 53).**

1. With any weather layer on, the atlas is not painted and the rail says so in words.
2. At most one coloured answer field on the canvas in every shot.
3. Every weather layer that can be selected has a titled key naming its unit or meaning.
4. Wave 52's criteria 1–4 still hold.
