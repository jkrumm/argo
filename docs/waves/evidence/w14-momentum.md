# w14 — Momentum legend swatch

Round 3 saw the Momentum chart legend with one swatch for both the green and the red velocity bars.

## Finding

Not argo config. `momentum-chart.tsx` passes `bar.positive = VX.goodSolid` and `bar.negative = VX.badSolid`
to `DualPanel`, which is the whole supported surface (`DualPanelBar` in `basalt-ui/charts`
`DualPanel.d.ts`). `DualPanel` (basalt-ui 2.6.1, `dist/charts/DualPanel.js`) builds exactly one bar
series for the legend, `{ key, label: bar.label, color: bar.positive, mark: 'bar' }`; the `negative`
fill is applied per row in the bar `fill` callback and never reaches the legend. The type doc says so:
"`positive`: The fill above zero, and the legend swatch."

The 2.6.1 "per-bar legend shades" change only covers opacity ladders in `Bars`; it does not add a
per-sign swatch. `MIGRATING.md`, `llms.txt` and the `.d.ts` document no option for a second swatch
(`DualPanelBar` has no `legend` field; `DualPanelProps.legend` is chart-level mode only).

## Friction row

| What I hit                                                                               | Workaround NOT taken                                                                                                                                                               | Severity                                                                                                      |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `DualPanel` legend shows one swatch (`bar.positive`) for a two-colour signed bar series. | Hand-rendering a second legend swatch next to the chart, or splitting the bar into two fake series (positive/negative) to force two entries. Both bypass basalt's legend contract. | Low: cosmetic, the tooltip and sign still read correctly; the reader sees only the green swatch for red bars. |

No argo code changed; no basalt suppression added; basalt-ui not bumped.

Verdict: basalt
