---
name: basalt-design
description: Build or restyle dashboards and metric UIs in a basalt-ui app — scenario, encoding, build, then rounds of screenshots scored by a reviewer subagent.
when_to_use: User is building or restyling dashboards, charts or metric UIs; tuning a palette; or says a UI looks inconsistent, over-colored or "AI default". Entry point for "make this look professional".
---

Method only; the law is `.claude/rules/basalt-*.md` and `./DESIGN.md`.

## Steps

1. Read `./DESIGN.md` and the rules `basalt-tokens.md`, `basalt-mantine.md`, `basalt-controls.md`, `basalt-charts.md`. No `DESIGN.md`: run `/basalt-app` first.
2. **Scenario first.** Write down realistic fixture data, the user's question, and the decision the view supports. Decide which metrics earn a hue (trend, status, separation; the rest neutral), the one primary action per view, each control's home (a `SettingsRow` preference via `createLocalStore`, never `useState`).
3. **Pick each encoding from the data's shape**, then the shipped composite (`StatCard`, `ChartCard`, `Section`, `WidgetHeader`, `BasaltDataTable`, `EmptyState`; a gap is reported, not routed around). Chart kinds and `ChartCard` import from `basalt-ui/charts`, `BasaltDataTable` from `basalt-ui/table`, the rest from `basalt-ui`:

   | Data shape                    | Encoding                                                                                                | Component                                   |
   | ----------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
   | Single value with a trend     | figure, text delta, `qualifier`, axis-less sparkline (end dot) along the card's bottom                  | `StatCard` + `sparkline` slot (`Sparkline`) |
   | Value over time               | line or stacked area                                                                                    | `Lines` / `StackedArea` in a `ChartCard`    |
   | Compare categories            | bars                                                                                                    | `Bars layout="grouped"`                     |
   | Part of a whole, 2–6 parts    | one segmented (stacked) bar, parts in order — not a donut plus a total card, not a row of N `StatCard`s | `Bars` (stacked, the default)               |
   | Distribution                  | small axis-less histogram                                                                               | `Bars` in a `ChartCard`                     |
   | Status over time              | band strip; a heat grid for daily data                                                                  | `BandStrip` / `Heatmap`                     |
   | Many rows, several attributes | table, right-aligned tabular figures                                                                    | `BasaltDataTable`                           |
   | Nothing yet / failed          | why + what to do                                                                                        | `EmptyState` / the component's own state    |

   No row fits the data → say so; never default to a number in a box.

4. Build with Mantine primitives and the composites; every color from `VX.*` or a series token. Tune by eye in the theme lab (`dev.theme` Spotlight command, dev only) in both schemes, then bake values into the `derive` knobs of `createBasaltTheme` and series colors into `src/lib/series.ts`.
5. **Mark up for the board.** Tag each scored component `data-shot="<name>"`; hover and tooltip targets inside it get `data-shot-hover` / `data-shot-tooltip`; when the target's centre paints no readout (a donut's hole), add `data-shot-at="x,y"` (fractions of its box, e.g. `0.25,0.2`) and the shot hovers there. Declare supported states with `data-shot-states="empty loading error"` and render them when the `shot-state` URL param asks.
6. **Rounds, at least three.** Playwright is the app's dev dependency: `bun add -d playwright && bunx playwright install chromium`. Then:
   - `basalt-ui shot <routes> --dist <built app>` (or `--base <url>` for a running server); a real, signed-in app (live data, no `data-shot` yet): `basalt-ui shot /overview --dist dist --api /api=https://app.example.com --local-storage auth-token=@env:APP_TOKEN --auto-anchors` seeds the token (app origin only; `@env:`/`@file:`, never inline), proxies GET/HEAD under `/api` (writes get 405 unless `--api-allow-writes`) and crops every large Card, Paper and table. One `--header authorization=@env:NAME` goes to EVERY `--api` origin (https required for any secret), never on a navigation. A redirect, 401/403/404, 5xx or dead API fails every shot of that page; a key the app already holds is never overwritten. These shots reach the reviewer subagent's model provider, the session's own: an app holding third parties' data should point `--api` at staging or synthetic data;
   - hand the out dir (`.basalt/shots`) to the `basalt-design-reviewer` subagent by name; it reads each component's contact sheet (`png/*__sheet.png`) and every page shot;
   - revise every failing item at its source, rebuild, and shoot again.
     Boards stay local (gitignored); the scored verdict and notes are worth committing.
7. **Done** only when the reviewer passes every component, and never before round three: a pass earlier does not end the loop. After five failed rounds stop and show the owner the boards and the failing items.
8. Run the repo's own gate (e.g. `make check`); fix every finding at its source. `shot` captures desktop (1440) and mobile (390) in both schemes; check both.
