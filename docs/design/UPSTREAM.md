# Upstream patterns — what argo's redesign needs from basalt-ui

Collected from the 13 page concepts in this directory (Wave 18, 2026-10-17). Each row is a pattern that
recurs across pages (or, under "New", a candidate a single page needs), the props the concepts converged on, its home in basalt-ui
(`basalt-ui/docs/waves/design-parity/SPEC.md` §3–§4), and the argo pages that use it.

**The loop (PLAN Part 2, Method step 2):** a page wave uses the basalt export when it is shipped. If it is
missing, the wave prototypes it under `apps/dashboard/src/features/<page>/` with the props below, adds
its file path in the **Prototype** column (a pattern two or more pages consume goes to the shared `apps/dashboard/src/components/upstream/` instead; switching means deleting it and importing from `basalt-ui`), and the basalt orchestrator promotes the proven version within
the same cycle. argo then switches to the import and deletes the prototype. Status on 2026-10-17: argo is on
basalt-ui 2.18.0, which ships `StatCard` (`sparkline`, `breakdown`), `StatGroup` (separate cards only),
`DeltaBadge`, `Sparkline`, `BandStrip`, `EmptyState`, `PageBar`, and since 2.18.0 `Meter` and `BarList`
(the Wave 19 local prototype of those two is deleted). Nothing else below is shipped yet.

## Planned basalt exports (SPEC §4) — the extensions argo needs

| Pattern | Props the concepts converged on | Beyond SPEC §4 | Pages | basalt wave | Prototype |
|-|-|-|-|-|-|
| `Meter` | `value, max, unit, caption, target?, ticks?: number[], segments?: {label, value, tone?}[], shape: 'bar' \| 'ring'` | `zones?: {to, label, tone}[]` with a `marker` (ACWR, recovery cut-offs, readiness); a signed `neutral` band (`min<0`, weight rate); a `start → goal` span (body weight); `size="row"` for in-line use (calendar day strip); a custom stop ramp (`LP.*` sky magnitude) | garmin-health, body-composition, walking-pad, warden, agents, strength-tracker, reading, astro-window, usage-tracking, m365-explorer, calendar, home | 34 | **Shipped 2.18.0** — `import { Meter } from 'basalt-ui'`; API in `node_modules/basalt-ui/dist/dashboard/meter.d.ts`, gaps under basalt friction below |
| `StatGroup variant="strip"` | joined cells divided by 1 px gaps, each `{caption, qualifier, value, unit, delta?, visual?: ReactNode}` | a cell with several rows (`rows: {label, value, unit, sparkline, delta}[]`, e.g. Garmin's RHR / HRV / VO2max trio); a `footer` row under the cells (Warden's two budget meters; Keel's "Next step" row) | garmin-health, body-composition, walking-pad, agents, home, strength-tracker, reading, warden, astro-window, usage-tracking, m365-explorer | 35 | Wave 19 built three diverging prototypes — converge them in basalt wave 35: `features/garmin-health/stat-strip.tsx` (`StatStrip{children}`, `StripCell{caption, qualifier?, value, unit?, children?, footer?, loading?}`, `SignalRow{label, value, sparkline, delta}` — the multi-row cell), `features/agents/stat-strip.tsx` (`cells: {id, caption, value, unit?, tone?, visual?, footer?}[]`), `features/warden/stat-strip.tsx` (`cells: {key, caption, info?, value, unit?, valueColor?, qualifier?, visual?}[]`, `footer?: {key, content}[]` — the footer row) |
| `BarList` | `rows: {label, value, valueLabel?}[], max?, format` with the bars on one shared scale, mono value right | a per-row `max` and denominator caption (recovery contributors as points of their weight); a `lead` slot (book cover); a trailing meta column (factor weight); a per-row series hue for categorical rows | garmin-health, reading, astro-window, usage-tracking, warden (poller ages), agents (collapsed idle projects) | 34 | **Shipped 2.18.0** — `import { BarList } from 'basalt-ui'`; API in `node_modules/basalt-ui/dist/dashboard/bar-list.d.ts`, gaps under basalt friction below |
| `EventList` | `groups: {label, count}[]`, rows `{actor, verb, title, chips?, status?, time}` (`status` is the status dot with a text label; status-dot lists are EventList rows, not a separate pattern) with the time pinned right, optional rail | `live` pulse on the group heading; `density="feed"` (Home stream); `collapse` for runs of identical rows (WalkingPad sessions); a leading glyph slot and a trailing control (M365 star) | agents (narratives), warden (item timeline), home, calendar (agenda), strength-tracker (PRs), reading (finished), walking-pad, hermes-chat, m365-explorer | 37 | `features/agents/event-list.tsx`: `EventList{label, groups: {label, rows: {key, actor, title, chip?, time}[]}[], limit?}` with a `Show n more` row; day groups, mono time right |
| `Board` | `columns: {key, label, count, totals?}[], cards, onOpen`; one column at a time at 390 | none | warden | 38 | `features/warden/board.tsx`: `Board{columns: {key, label, items}[], onSelectItem(eventId)}` + `board-store.ts` (the column picked at 390); each item exactly once, unknown states in `Other` |
| Decision card (recipe; component per SPEC D4 only when argo and rb converge) | `question, facts: string[], evidence: ReactNode, preview?: ReactNode, primary, secondary?, menu?: Action[], disclosure?` (`preview` is the right-hand context: a draft excerpt or a from → to trend) | the `menu` replaces stacked buttons (Warden offers up to five verbs); a `source` chip when Home merges Warden and Agents items. The merge, count and sort will live once in argo's `apps/dashboard/src/lib/decisions.ts`, planned for Wave 20 and not yet built; the data side stays in argo and only the card is upstream | agents, warden, home; astro-window's verdict card and strength-tracker's summary borrow the anatomy | 35 (recipe) | `components/upstream/decision-card.tsx`, proven on Agents (read-only and copy-only cards) and Warden (write actions + menu): `question, facts: (string \| {text, tone: warn \| bad})[], status?, actor?, evidence?, preview?, primary?, secondary?, menu?: Action[], disclosure?: {label, content}, meta?`; `Action = {label, key?, onClick, loading?, disabled?, icon?}`; every slot optional, empty slots render nothing |
| Record header (recipe) | `glyph, title, badges, facts: string[], actions` | a `pulse` for live state and a `stats[]` slot (WalkingPad session) | walking-pad, hermes-chat, m365-explorer | 38 (recipe) | — |

## New — not in SPEC §4

| Pattern | Props sketch | Pages | Note |
|-|-|-|-|
| Chart facts header | `ChartCard facts={[{value, unit, compare}]}`: the headline figure, unit, comparison and period replace the filler-question subtitle | every chart page: garmin-health, strength-tracker, walking-pad, body-composition, usage-tracking, astro-window | Highest leverage after `Meter`: argo has eight filler subtitles on Garmin alone. Possibly a `ChartCard` prop, otherwise a `basalt-design` recipe Prototype: `features/garmin-health/facts-line.tsx`, `FactsLine{fact: {value, unit?, context: string[]}}` as the first child of `ChartCard`; the fact builders (`acwrFact` … `divergenceFact`) date their own point (`dayLabel`) |
| Entity card with a 2×2 inner panel | `identity, status, cells: 4 × {caption, value, unit, visual}, now` | agents (one card per project); reading's in-progress book cards use the same identity + facts anatomy without the 2×2 | Keel's crew card. SPEC §6.9 lists it as a recipe Prototype: `features/agents/entity-card.tsx`, `EntityCard{identity, status, cells: 4 × {caption, value, unit?, small?, visual?}, now?}` |
| Schedule / agenda row | `start, durationMin, title, meta, pill?, action?` | calendar, home | SPEC D10 says "not built, no consumer". argo is now that consumer, so propose adopting it |
| `EmptyState compact` with an action | one row instead of an empty chart card: reason + "widen to 90 d" | body-composition, walking-pad | A variant of the existing `EmptyState` |
| Point-mark cell | `value, unit, axis: [from, to], ticks: {at, label}[]` (time to the next event on a day axis) | home | Keel's "Next meeting" tile. Could be a `Meter` variant with point marks |
| Counted filter toolbar, standalone | `chips: {label, count, active}[]` + segmented control | hermes-chat, m365-explorer | The `BasaltDataTable` toolbar (wave 36) outside a table |
| Master–detail shell | list pane + record pane whose empty state shows real content; a push sheet at 390 | m365-explorer | Proposed in the M365 concept; Hermes and Warden may follow but their concepts do not specify it yet |
| `BandStrip` additions | a `today` outline, a text slot under the band, a preset banded by thresholds | walking-pad, astro-window, usage-tracking | Extends a shipped export |
| `foldTopN(series, n, otherLabel)` | top N series plus "Other" for stacked charts grouped by an open-ended key | usage-tracking (the tokens legend has {n_series} entries) | A data helper next to the chart kinds |

## Already specified, not built

| Pattern | Props sketch | Pages | Note |
|-|-|-|-|
| Status chip | `tone, label`; unknown values render neutral with the raw label | warden (failure class), agents (state chip) | SPEC §6.10 Two prototypes to converge: `features/agents/status-chip.tsx` (`tone: neutral \| warn \| bad`, plus `Dot`) and `features/warden/status-chip.tsx` (`tone: work \| infra \| policy \| neutral \| warn \| bad`) |
| Stepper | `steps: string[], current` as a quiet inline row | none yet | PLAN Wave 18 names it (Keel's stage stepper in the decision card `preview`), but no argo concept has staged data that needs it. Build it only when a page does |

## basalt friction (2.18.0) — what argo's real cases needed and the shipped API lacks

Each row names the exact prop argo needed. Rows from the Wave 19 pages (Garmin Health, Agents, Warden) are merged in from their concept docs.

| Export | Needed prop | argo case | What argo does instead |
|-|-|-|-|
| `Meter` | `ticks?: {at: number, label?: string}[]` (more than one tick; `target` draws exactly one) | garmin-health recovery (40 and 70 cut-offs + window-mean mark); agents oldest wait (24 h warn and 7 d abandon) | `zones` where the cut-offs bound bands; otherwise one `target` and the second mark stated in a caption |
| `Meter` | a root export of `MeterSegment` / `MeterZone` (missing; only `MeterProps` is exported) | every page that builds a `zones` / `segments` array in a typed helper | `Extract<MeterProps, { zones: readonly unknown[] }>['zones']` |
| `BarList` | per-row `max` (each row on its own denominator) | garmin-health recovery contributors (40 / 35 / 25 pts) | shared `max` = the largest weight, denominator in `secondary` |
| `Meter` | a caption size that follows the host text (or one `size` prop) | warden strip cells reach 4–5 type sizes because Meter draws captions in three sizes of its own | none; listed here for basalt |
| `Meter` | a muted fill option for a non-verdict reading (the neutral `VX.line` fill is near-white in dark mode) | garmin-health contributor rows | none; listed here for basalt |
| `Meter` with `segments` | per-segment captions under the bar | agents fleet by state | a local legend row under the meter |
| `BarList` | a thin, label-outside row (today: a full-height rail with the label inside) | garmin-health contributors, agents quiet projects | one `Meter` per row (garmin); a plain row list when values tie (agents) |
| `BarList` | a per-row tick (a stale mark) | warden pollers | the threshold stated in `secondary` |
| `Sparkline` | `reference?: number \| 'mean'` or a target band, plus a hover readout | garmin-health fitness rows, agents needs-you trend (Wave 19 rule: a tile visual encodes a limit) | a visible figure beside it (`peak n in 24 h`, the delta) |
| `DeltaBadge` | `period` composes "vs <period>" itself (today it renders raw text) | garmin-health fitness deltas | the caller writes "vs" |
| hero numerals | `numerals: 'proportional'` for hero values (the mono face is tabular; DESIGN.md puts all numerals in mono, so argo keeps mono) | every strip hero value | none; DESIGN.md wins |
| `ChartCard` | a `facts` slot | every chart page | `FactsLine` as the first child |
| `Bars` / `Lines` | `refLines[].label` (the 600 MET-min target), legends that collapse to the active series at compact width | garmin-health | the target stated in the facts line |
| `BandStrip` | a text slot under the band and a legend for an intensity ramp | agents 24 h activity | a heading figure (`n agents at peak`) |
| `ViewTabs` in `Section.tabs` | a segmented row with counts at 390 instead of folding to a select; a conditional `tabs` without a hoisted ternary | warden board | the select fold, `undefined` at desktop |
| `Button` theme | paddings on basalt's spacing scale (Mantine's 14 px default and `compact-xs` 7 px are off-scale) | warden and agents decision cards | none; listed here for basalt |
| `relativeTime` | honour the `defineFormat`/provider locale: `relativeTimeFormat(locale, …)` in `format/date.js` builds `Intl.RelativeTimeFormat` from the call's `locale` only, while `numberFormat`/`dateFormat` fall back to `defaults.locale` (so it reads "vor 4 Tagen" under `locale="en-GB"` on a German system) | warden state history and board, Home decision cards, agents stale banner | `lib/format.ts` `relativeTime` wrapper passes `APP_LOCALE` explicitly; drop it once basalt resolves `locale ?? defaults.locale` |
| `basalt-ui shot` | the `Sparkline` focus state intermittently times out (`boundingBox: Timeout 30000ms`) | garmin-health fitness cell | re-run; one anchor fails per run at most |

<!-- w20-calendar -->

### Wave 20 — Calendar (`features/calendar`)

Prototype built: `components/upstream/schedule-row.tsx` — `ScheduleRow{start, durationMin, title, meta?, pill?, action?, past?}` (Keel `schedule-item`; the duration sits beside the start at ≥ 480 px of container width and under it below; no domain types in the signature, so Home adopts it as is).

| Export | Needed prop | argo case | What argo does instead |
|-|-|-|-|
| `Meter` | `size="row"` (no caption rows, track height of a text line) | the 7-row day-load strip | `startCaption={null} endCaption={null}`; the row's value and count are a CSS-grid sibling |
| `Meter` | `tone="muted"` (a non-verdict fill that is not near-white in dark) | day-load bars: a load is not a verdict, `VX.line` is loud | `color={alpha(VX.muted, 0.35)}`; `VX.status.warn` past the 8 h target |
| `Meter` with `segments` | per-segment captions under the bar | Work / Personal booked hours | a local caption row with a swatch per segment |
| `Meter` | a `target` tick that is visible when `max === target` (the tick lands on the track end) | the 0–8 h strip | none; the tick sits on the track end |
| `@mantine/schedule` `WeekView` | a visible-days prop (3 days on a phone) | the Week tab at 390 | a day-grouped list of the 3 days (selected ± 1) instead of a grid |
| `EventList` | day-grouped rows with a leading time column and a trailing action | the Next 7 days list | `DayGroups` in `features/calendar/agenda-parts.tsx` over `ScheduleRow` |

<!-- /w20-calendar -->

<!-- w20-home -->

### Wave 20 — Home (`/`) friction and prototypes

| Export | Needed prop | argo case | What argo does instead |
|-|-|-|-|
| `Meter` | `tone="muted"` (or a `color` token the docs name for a non-verdict reading); the default `VX.line` fill is near-white in dark | home recovery and dispatch cells (neither is a verdict until it crosses a limit) | `color={alpha(VX.muted, 0.35)}` in `features/home/strip-cells.tsx`; a verdict (`warn` at 90 % of the cap) passes `VX.warn` |
| `Meter` | `ticks?: {at, label?}[]` | home recovery: the 7 d mean AND the day's activity ceiling; ACWR zones AND a marker | `target` = the 7 d mean only; the ceiling is not shown (it is an activity score in MET-min, not on the 0–100 scale) |
| `Meter` | `target` that does not need `max = target` headroom: a cap tick inside a longer track | home dispatch budget (cap tick, overrun visible) | `max = cap × 1.25`, `target = cap`, `endCaption = "cap {n}"` |
| `BandStrip` | `ticks`/`xTicks` labels that do not collide at a 190 px cell (the 6-hourly labels touch) | home agents-working cell | none; four labels at 190 px sit tight |
| `BandStrip` | a muted single-hue intensity ramp without hand-built `alpha()` fills per bucket | home agents-working cell | `getBand` returns `fill: alpha(VX.muted, 0.35 + 0.5 × share)` |
| `StatGroup variant="strip"` | five cells; two columns at 390 with the odd cell spanning | home | `features/home/today-strip.tsx` (own grid) |
| `Section` | a `live` pulse beside the title and a count line (`n events today`) | home Activity | the pulse and count are the first row inside the section (`features/home/activity-feed.tsx`) |
| `Section` | `subtitle`/`info` render as a hover-only icon; a visible period line (`today`, `since yesterday`) | home Meetings, Activity | the period is written into the title or the live line |
| `Sparkline` | a hover/focus value readout (it takes focus and shows nothing) | home recovery cell | none |
| `BandStrip` | a tooltip that stays inside a narrow cell | home agents cell at 390 | none |
| `BandStrip` | a quiet intensity preset (the dense grey block is loud at any alpha) and a `marker` radius on the scale | home agents cell | `alpha(VX.muted, .12 + .4 × share)`, 28 px high, plus the text line |
| Heading face (`--basalt-font-heading`) | numerals without the slashed zero (`font-feature-settings` off for `zero`), or a proportional numeral face for display text | the Today headline sentence renders `100` with slashed zeros while the same figure in the strip does not | none; owner rule (a) says do not fight basalt with local CSS |
| `Section` | the title count chip in the proportional face (it renders mono) | Calendar `Today · {n}`, `Next 7 days · {n}`, `Tasks due · {n}`; Home `Needs you {n}`, `Meetings today {n}` | none; left as basalt renders it |
| `Button component={Link}` | typed `to` through Mantine's polymorphic `component` | home `Show n more` links | works; noted because the cast-free form is not in the docs |

| Pattern | Prototype (path + props as built) |
|-|-|
| Point-mark cell (next meeting) | `features/home/strip-visuals.tsx` `DayAxis{meetings, next, now}`: ticks at start times on a 08–19 h axis (widened when a meeting falls outside), the next tick emphasised, past ticks dimmed, a now dot, `role="img"` with every time in the label |
| Schedule / agenda row | adopted as is: `features/home/meetings.tsx` renders `components/upstream/schedule-row.tsx`; the countdown wording is Calendar's `untilLabel` |
| `EventList density="feed" live` | `features/home/activity-feed.tsx` `ActivityFeed{groups, total, stale, loaded, now}`: the sentence is `actor` bold + title + a chip, time pinned right, day groups with a count, `Show n more`; the Agents `EventList` is not reused because its 10 rem actor column does not fit a 40 % column |
| Merged inbox | `lib/decisions.ts` `deriveDecisions({warden, agents, wardenReceivedAt?, now}) → Decision[]` (`source`, `id`, `headline`, `facts`, `ageMs`, `href`, `evidence`, `history`, `abandoned`), pure and tested; the Home heading, sentence and cards read its length |
