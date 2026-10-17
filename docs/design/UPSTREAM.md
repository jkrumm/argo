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
| `StatGroup variant="strip"` | joined cells divided by 1 px gaps, each `{caption, qualifier, value, unit, delta?, visual?: ReactNode}` | a cell with several rows (`rows: {label, value, unit, sparkline, delta}[]`, e.g. Garmin's RHR / HRV / VO2max trio); a `footer` row under the cells (Warden's two budget meters; Keel's "Next step" row) | garmin-health, body-composition, walking-pad, agents, home, strength-tracker, reading, warden, astro-window, usage-tracking, m365-explorer | 35 | — |
| `BarList` | `rows: {label, value, valueLabel?}[], max?, format` with the bars on one shared scale, mono value right | a per-row `max` and denominator caption (recovery contributors as points of their weight); a `lead` slot (book cover); a trailing meta column (factor weight); a per-row series hue for categorical rows | garmin-health, reading, astro-window, usage-tracking, warden (poller ages), agents (collapsed idle projects) | 34 | **Shipped 2.18.0** — `import { BarList } from 'basalt-ui'`; API in `node_modules/basalt-ui/dist/dashboard/bar-list.d.ts`, gaps under basalt friction below |
| `EventList` | `groups: {label, count}[]`, rows `{actor, verb, title, chips?, status?, time}` (`status` is the status dot with a text label; status-dot lists are EventList rows, not a separate pattern) with the time pinned right, optional rail | `live` pulse on the group heading; `density="feed"` (Home stream); `collapse` for runs of identical rows (WalkingPad sessions); a leading glyph slot and a trailing control (M365 star) | agents (narratives), warden (item timeline), home, calendar (agenda), strength-tracker (PRs), reading (finished), walking-pad, hermes-chat, m365-explorer | 37 | — |
| `Board` | `columns: {key, label, count, totals?}[], cards, onOpen`; one column at a time at 390 | none | warden | 38 | — |
| Decision card (recipe; component per SPEC D4 only when argo and rb converge) | `question, facts: string[], evidence: ReactNode, preview?: ReactNode, primary, secondary?, menu?: Action[], disclosure?` (`preview` is the right-hand context: a draft excerpt or a from → to trend) | the `menu` replaces stacked buttons (Warden offers up to five verbs); a `source` chip when Home merges Warden and Agents items. The merge, count and sort live once in argo's `apps/dashboard/src/lib/decisions.ts` (the data side stays in argo; only the card is upstream) | agents, warden, home; astro-window's verdict card and strength-tracker's summary borrow the anatomy | 35 (recipe) | — |
| Record header (recipe) | `glyph, title, badges, facts: string[], actions` | a `pulse` for live state and a `stats[]` slot (WalkingPad session) | walking-pad, hermes-chat, m365-explorer | 38 (recipe) | — |

## New — not in SPEC §4

| Pattern | Props sketch | Pages | Note |
|-|-|-|-|
| Chart facts header | `ChartCard facts={[{value, unit, compare}]}`: the headline figure, unit, comparison and period replace the filler-question subtitle | every chart page: garmin-health, strength-tracker, walking-pad, body-composition, usage-tracking, astro-window | Highest leverage after `Meter`: argo has eight filler subtitles on Garmin alone. Possibly a `ChartCard` prop, otherwise a `basalt-design` recipe |
| Entity card with a 2×2 inner panel | `identity, status, cells: 4 × {caption, value, unit, visual}, now` | agents (one card per project); reading's in-progress book cards use the same identity + facts anatomy without the 2×2 | Keel's crew card. SPEC §6.9 lists it as a recipe |
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
| Status chip | `tone, label`; unknown values render neutral with the raw label | warden (failure class), agents (state chip) | SPEC §6.10 |
| Stepper | `steps: string[], current` as a quiet inline row | none yet | PLAN Wave 18 names it (Keel's stage stepper in the decision card `preview`), but no argo concept has staged data that needs it. Build it only when a page does |

## basalt friction (2.18.0) — what argo's real cases needed and the shipped API lacks

Each row names the exact prop argo needed. Wave 19 page workers append their rows here through the orchestrator.

| Export | Needed prop | argo case | What argo does instead |
|-|-|-|-|
| `Meter` | `ticks?: {at: number, label?: string}[]` (more than one tick; `target` draws exactly one) | garmin-health recovery (40 and 70 cut-offs + window-mean mark); agents oldest wait (24 h warn and 7 d abandon) | `zones` where the cut-offs bound bands; otherwise one `target` and the second mark stated in a caption |
| `Meter` | a root export of `MeterSegment` / `MeterZone` (missing; only `MeterProps` is exported) | every page that builds a `zones` / `segments` array in a typed helper | `Extract<MeterProps, { zones: readonly unknown[] }>['zones']` |
| `BarList` | per-row `max` (each row on its own denominator) | garmin-health recovery contributors (40 / 35 / 25 pts) | shared `max` = the largest weight, denominator in `secondary` |

