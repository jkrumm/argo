# basalt-ui 2.20.0 adoption (basalt Wave 35)

Released: basalt-ui 2.20.0 (2026-10-18) carries all of basalt Wave 35.
Repo: `argo`, landing per its own AGENTS.md (fan-out workers through `rd merge`). Do not edit basalt-ui.

1. Bump `basalt-ui` to the release; `bun install`; `bunx basalt-ui sync`; read `MIGRATING.md` § 2.20.0 (the Wave 35
   entries) (typography law and `--basalt-font-numeral` opt-out, card inset owned by the theme, sparkline
   readout, relativeTime locale, DeltaBadge `vs` prefix, chrome: button padding, neutral active nav row, error state).
2. Delete the local workarounds (net-negative in argo), each replaced by the named export:
   - `features/{garmin-health,agents,warden}/stat-strip.tsx` (+ their CSS), `features/home/today-strip.tsx` and the
     Wave 21 page strips → `StatGroup variant="strip"` (`cells`, `footer`, `rows`, `stale`, `loading`; anchors are
     derived `strip-<key>` / `strip-footer-<key>`; warden's under-value qualifier maps to `footer`).
   - `features/garmin-health/facts-line.tsx` (`FactsLine`) → `ChartCard facts` (`ChartFact` from `basalt-ui/charts`).
   - `lib/format.ts` `relativeTime` wrapper → `relativeTime` from basalt (it now honours `defineFormat`'s locale).
   - every `alpha(VX.muted, …)` Meter fill → `Meter tone="muted"`; `startCaption={null} endCaption={null}` → `size="row"`;
     second-mark captions → `ticks`; `Extract<MeterProps…>` helpers → `MeterSegment` / `MeterZone` / `MeterTick`.
   - BarList contributor rows → per-row `max` (+ `format(value, part)` for "32 / 40 pts"), `variant="thin"`, `tick`.
   - local status dots → `StatusDot` / `StatusVerdict` from the root.
   - the 45 `py="sm" px="md"` pairs on Card/Paper (now flagged redundant) → delete; the map card → `variant="flush"`.
   - callers writing "vs …" in `DeltaBadge period` keep working; a non-comparison period needs `periodPrefix=""`.
   - target lines named in the facts line → `refLines[].label`; sparkline limits stated as text → `reference`.
3. `make check` green, then live-shoot Garmin, Agents, Warden and Home with `basalt-ui shot` (the seeded-auth recipe)
   and score them with the `basalt-design-reviewer`.
4. Report: the argo line delta (`git diff --stat` of the PR), what could not be deleted and why (a new friction row
   per gap, in `docs/design/UPSTREAM.md`), the reviewer's verdict per page.

Known gaps already recorded for Wave 36+: the strip has no `query`/`state` prop (empty/error is `—` + a footer
note); Meter ring ticks; home's activity ceiling on another scale; BandStrip muted ramp; EventList, Board, decision card.
