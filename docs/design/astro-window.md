# Astro Window — concept

Route `/astro-window` (tabs Tonight, Map, Forecast) · `apps/dashboard/src/routes/astro-window.tsx`, `apps/dashboard/src/features/astro-window/` · API `GET /astro/window`, `/astro/horizon`, `/astro/visibility`, `/astro/skyglow`, `/astro/light-pollution`.

## Baseline verdict

Shots: `astro-window--dark--desktop.png` (Tonight), crops `astro-window--dark--01-card.png` (verdict), `02-card.png` (night strip), `03-card.png` (facts); `astro-window-tab-forecast--dark--02-night-timeline.png` … `05-annual-visibility-budget.png`; `astro-window-tab-map--dark--desktop.png`.

- Tonight: the verdict card shows `RULED OUT` in large type, two pill sentences and a right-aligned paragraph that says the same thing a third time (crop 01). The 10-night strip is ten identical cells `OUT · — · core low` (crop 02), so it carries no information when everything is out.
- The facts card (crop 03) is a 20-row label/value table (Darkness, Galactic core, Moon, Sky) beside an empty right half at 1440. It ends in a `SCORE` heading with nothing under it. Rows like `Core direction 19.70 mag/arcsec²` carry no scale: is that dark?
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
| Verdict + killers | `window.verdict`, `score`, `killers[{id,label,reason}]`, `bestWindow` | A request that needs a decision | Big word + pills + paragraph | Verdict card: status chip `OUT` / `GO`, headline as fact (`OUT · core 3.9° under the gate`), killers as status-dot rows `● Core peak 4.1° · gate 8°` each with a horizontal `Meter` 0–30° (the same altitude scale as the Core cell; the core never tops ~30° at this latitude, so a 4° gap stays visible) and a tick at the gate; when a window exists, one primary line `22:40–01:10 · 2 h 30 m` | The gap to the gate is a length; a sentence hides it | `decision-card.png` |
| 10-night strip | `nights[]`: `verdict`, `score`, `window.minutes`, `killers[0].id` | Status over time | 10 cells `OUT / — / core low` | Cells keep the date (mono) and a `BandStrip` verdict band; second line is window length (`2 h 10 m`) or the first killer's short label (`core low`, `cloud`, `moon`); selected night outlined; best night gets a mono `BEST` marker | Cells vary only when the data varies; all-out nights still show why | `schedule-item.png` |
| Darkness | `night.darkStart/darkEnd/darkMinutes` | Record fact | 3 table rows | Cell `DARK` `20:05–05:54` + muted `9 h 49 m` | One fact line replaces three rows | `stat-cell.png` |
| Core | `transit`, `maxCoreAltitude`, `window.peakCoreAltitude/Azimuth` | Progress to a target | `Max altitude 13.2°`, `Window length —` | Cell `CORE` `13.2°` peak, linear `Meter` 0–30° with a tick at the 8° gate | Same encoding as the verdict row; one idea per surface | `metric-card-bar.png` |
| Moon | `moon.illumination/phase/rise/set`, `maxMoonAltitude` | Part of a whole (lit fraction) | 5 rows | Cell `MOON` `43 %` on a 0–100 bar, qualifier `sets 22:27 · first quarter` | Rise/set/phase fold into the qualifier; no second ring | `stat-cell.png` |
| Cloud tonight | `weather.cloudLow/Mid/High` | Three independent percentages | 3 rows `100 % / 61 % / 78 %` | Cell `CLOUD`: three stacked mini-bars on a shared 0–100 track in the `cloudLow`/`cloudMid`/`cloudHigh` severity ramp, mono values right | Same ramp as the cloud chart | `metric-card-bar.png` |
| Sky quality | `weather.transparency` (1–8), `location.coreDirectionMpsas`, `domePenaltyMag` | Progress to a target | `8/8`, `19.70 mag/arcsec²`, `1.04 mag` | Cell `SKY` `19.70` + muted `mag/arcsec²` on a 18–22 `Meter` using the `LP.*` ramp with a tick at 21.6 (the map legend's dark threshold); qualifier `dome −1.04 mag · transp. 8/8` | A magnitude without a scale is a bare number | `metric-card-gauge.png` |
| Score breakdown | `night.factors[{label,weight,value,weighted,detail}]`, `score`, `coverage` | Ranked list | Empty `SCORE` block | `BarList`: label, bar = `value` 0–1, mono `0.62`, trailing muted `w 25%`; when `verdict === 'out'` one line `Score withheld · gated by core low` | Fixes the empty block and shows what carries the score | `table-row.png` |
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

Format is binding; figures after the baseline ones are illustrative.

- Summary: `0 of 10 nights usable · closest Fri 23 · core peaks 4.1° against an 8° gate`
- Verdict: `OUT · core 3.9° under the gate` / `GO · Sat 24, 22:40–01:10 · 2 h 30 m`
- Cells: `DARK · 9 h 49 m`, `CORE · peak 13.2°`, `MOON · 43 % · sets 22:27`, `CLOUD · low 100 / mid 61 / high 78 %`, `SKY · 19.70 mag/arcsec²`
- Charts: `Core, moon and sun altitude · Sat 17 · 18:00–06:00`, `Cloud cover by layer · Sat 17`, `Usable core hours per month · peak <month> <h> h`
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
4. Every sky number carries its unit (`°`, `%`, `mag/arcsec²`, `h m`); `19.70` appears only on a scaled meter.
5. No filler question is a subtitle; the page summary sentence contains a live count of usable nights.
6. Panorama skyline and gate line are legible at first glance in dark and light.
7. At 390 px the strip scrolls with snap and nothing overflows the viewport.
