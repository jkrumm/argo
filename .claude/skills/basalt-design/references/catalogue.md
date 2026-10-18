# Encoding catalogue

Shipped composites: `StatCard`, `ChartCard`, `Section`, `WidgetHeader`, `BasaltDataTable`, `EmptyState`. Imports: chart kinds and `ChartCard` from `basalt-ui/charts`, `BasaltDataTable` from `basalt-ui/table`, the rest from `basalt-ui`. A gap is reported, never hand-rolled. The reviewer cites this file for Expression 1: the data's shape and the encoding used must match a row here.

## 1. Is it even a chart?

Run this first. A "yes, chart" answer sends you to § 2.

| The data is                     | Not this         | Use                                                     |
| ------------------------------- | ---------------- | ------------------------------------------------------- |
| One current value               | A one-bar chart  | `StatCard` (`stat-tile.md`)                             |
| A handful of headline numbers   | A grouped bar    | `StatGroup variant="strip"` or a row of `StatCard`      |
| One ratio against a limit       | A two-slice pie  | `Meter` with a target tick                              |
| More than ~7 meaningful classes | More colours     | `BasaltDataTable`                                       |
| Fewer than 4 points             | A line           | `StatCard`                                              |
| 3–10 target-vs-actual metrics   | A bar per metric | A grid of `Meter`s with `target` (basalt's bullet form) |

## 2. Data shape to expression

| Data shape                                                   | Encoding                                                                           | basalt export (import path)                                                       | Not this                             |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------ |
| Single value with a trend                                    | Figure, text delta, `qualifier`, axis-less sparkline with end dot along the bottom | `StatCard` (`basalt-ui`) + `sparkline` slot with `Sparkline` (`basalt-ui/charts`) | A bare number in a box               |
| Progress to a target                                         | Filled track, target tick, end captions; extra cut-offs as `ticks`                 | `Meter` (`basalt-ui`) with `target`, `ticks`                                      | A hand-rolled progress bar           |
| Committed vs forecast                                        | Two segments, the forecast lighter, a tick and a caption at the boundary           | `Meter` `segments`, `forecastCaption`                                             | Two cards                            |
| Headline ratio where the shape is the message                | Ring, value centred, one per row                                                   | `Meter shape="ring"`                                                              | A donut plus a total card            |
| Reading in named bands (low / ok / high)                     | Zoned bar with the reading as a marker; `ticks` mark cut-offs or a window mean     | `Meter` `zones`, `ticks`                                                          | Colour-only thresholds               |
| Part of a whole, 2–6 parts                                   | One segmented bar, parts in order, captions under the segments                     | `Meter` `segments`; `Bars` stacked                                                | A row of N `StatCard`s; a donut      |
| Part of a whole when the parts are the page's subject        | Donut                                                                              | `Donut` (`basalt-ui/charts`)                                                      | Donut beside a total card            |
| Ranked list, top N (5–10)                                    | Label, bar on a shared scale, right-aligned value                                  | `BarList` (`basalt-ui`), its default thin-track rows                              | A table with a `%` column            |
| Value over time                                              | Line; stacked area for parts of a total                                            | `Lines` / `StackedArea` in a `ChartCard`                                          | A bar per day                        |
| Compare categories                                           | Bars                                                                               | `Bars layout="grouped"` in a `ChartCard`                                          | A pie                                |
| Distribution as a slot micro-visual (`StatCard`, strip cell) | Small axis-less histogram                                                          | `Bars`, no axes, in the slot                                                      | A mean alone                         |
| Distribution as a card's subject                             | One bar per bin, x labelled with the bin range ("€0–50"), y axis optional          | `Bars` in a `ChartCard`                                                           | A mean alone; an axis-less histogram |
| Status over time                                             | Band strip; heat grid for daily data                                               | `BandStrip` / `Heatmap` (`basalt-ui/charts`)                                      | A table of dates                     |
| Categorical status per cell (up, degraded, down)             | Flat status fills; a glyph on warn and bad, never hue alone                        | `Heatmap` `states` with a `tone` each, no hex; `BandStrip` `glyph`                | A hue-only grid                      |
| A set of KPIs about one record                               | One joined surface, cells split by hairlines                                       | `StatGroup variant="strip"`                                                       | N unrelated cards                    |
| Many rows, several attributes                                | Table, right-aligned figures                                                       | `BasaltDataTable` (`basalt-ui/table`)                                             | Cards per row                        |
| Nothing yet / failed                                         | Why and what to do                                                                 | `EmptyState`, or the component's own `query` state                                | "No data"                            |

## Not shipped — report the gap, don't hand-roll

| Shape                                                                | Missing        |
| -------------------------------------------------------------------- | -------------- |
| Event sequence (day groups, time pinned right)                       | `EventList`    |
| Work items by status (columns with counts)                           | `Board`        |
| Record page (header, facts line, strip, events) and list-row recipes | recipes only   |
| Bounded score inside a row                                           | tick meter     |
| Daily data over months with month labels                             | calendar grid  |
| Gapless histogram with bin-edge ticks                                | histogram kind |
