# Depot chart — concept

`/finance/depot` is where the owner reads a price chart next to his own trades. It replaces the habit of keeping the chart in TradingView
and marking buys and sells by hand: the market store, the depot and the hand-kept orders of the vault (`~/SourceRoot/finances`, contract
`docs/service.md` §Chart routes) are all served, so the page reads them in instead of asking him to draw them. Behind the finance gate like
its siblings; the market routes answer while the vault is locked, the depot and drawing routes need it open.

## Question and decision

- **Question:** where is this instrument against what I paid, what I have waiting at the bank, and the levels I drew?
- **Decision:** wait, add to the position, or move an order. Nothing on the page places, changes or deletes an order at the bank:
  ING has no interface for orders, so the open orders are typed in here and closed here by hand.

## Layout

| Region         | Content                                                                                                                                      | Narrow (390 px)                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Watchlist      | Every instrument with last close and day change; held ones marked; choosing one loads the chart (`?isin=`)                                   | Two columns above the chart in a short area that scrolls inside itself |
| Chart card     | Candles over a turnover histogram, interval switch (day, week, month), drawing tools, a price field for the selected line, crosshair readout | Same card; the interval switch is the shell's select form              |
| Position strip | Quantity, value, FIFO cost, unrealised gain                                                                                                  | Two by two                                                             |
| Trades         | The instrument's trades, newest first                                                                                                        | Card list                                                              |
| Open orders    | The hand-kept orders, an add form, close as executed, cancelled or expired                                                                   | Card list                                                              |

The range is a page-bar filter (`?rng=`), the interval a card switch (`?ivl=`): both are `finStore` fields, URL only. The range decides
how far back the day view reads; week and month load the whole history. The market store has no intraday, so there is no minute or hour interval.

The chart is about 1.5 times as tall as the first version on a wide container (44 rem, 26 rem narrow). Candles are the same distance apart at
every interval (7 px): the chart opens at the newest bar and shows what fits, so a week is as wide as a day and the owner scrolls or zooms out for more.
`fitContent` is not used: it squeezed a long history into hairlines.

## Encodings

| Data         | Encoding                                                                                                                                                                                                                                      | Why                                                                                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Price        | Candles, up `VX.status.good`, down `VX.status.bad`                                                                                                                                                                                            | Direction is the signal. Text-grade status inks, not the fill-only `excellent`                                                                                                                   |
| Turnover     | Histogram in its own pane below, the candle's colour at 45 %                                                                                                                                                                                  | Same hue per bar so the two panes read together; faint so it never competes                                                                                                                      |
| Own trades   | Marker on the candle of the booking day (week, month: of the bar that holds it): buy a green arrow below the bar, sell a red arrow above, a count beside it when a bar holds several of that side; a circle where every quantity is estimated | The arrow is the owner's own TradingView habit. Estimated is a different shape, not a different hue: colour stays the side. One marker per bar and side, so a savings plan never piles up arrows |
| Average cost | Solid ink line with its value on the axis; in dollars (from the dollar price of the buys) on a dollar chart                                                                                                                                   | Data, so neutral; the one reference every other price is read against. The accent is kept for what the owner draws                                                                               |
| Open orders  | Dashed line at the limit or stop, the side's colour, titled "Buy 5 limit"                                                                                                                                                                     | Dashed = not filled; a market order has no price and so no line. Orders have euro prices only: none is drawn on a dollar chart                                                                   |
| Drawings     | Horizontal line, price range (absolute, percent, "n bars"); accent while placed as well as after                                                                                                                                              | The two tools the owner named; the package has 86                                                                                                                                                |

Colour comes only from `VX.*` tokens, read at runtime and re-read when the scheme flips (a canvas library cannot read `var()`);
no series entry in `series.ts`, no literal colour in the source. Drawings are stored with the colour they were drawn in, so the
page paints them again with the active accent at load and on every scheme change.

## Listings and currency

Bitcoin is charted in dollars only (`BTC-USD`; the euro listing is not offered). An instrument the watchlist says is charted as another listing (a Bitcoin
ETP, `instruments` of the `BTC-USD` row) has no row of its own: the row is held when any of its instruments is, its trades come from
`depot/trades?isin=BTC-USD`, and the position strip sums them. A US stock with a stored US listing (`us_mic`) is read on that listing, in dollars.
Trade markers sit on the candle of the booking day in either case; the readout adds the dollar price (`price_usd`, the ECB rate of the booking day).
The position strip, the trades table's amounts and orders stay in euros. The table adds a dollar price column where a trade has one.

## Drawings

- The package paints a drawing in its own blue while it is placed. `setDefaultStyleOverride` gives both tools the accent before the first click, so the
  preview and the placed drawing look the same.
- Selecting a horizontal line (click it, or place it) shows a price field in the card's tools: Enter moves the line to that price, Escape puts the
  line's own price back. The move is saved like any edit.

- One JSON document per instrument, `{ v: 1, drawings: [...], foreign: [...] }`; the server never reads it.
- Saved about 500 ms after the last change (flushed on instrument switch, unmount and when the tab hides); a failed save is
  reported and retried with the next change while the instrument stays open. Leaving it (or a vault lock that
  drops the page to the unlock screen) with a save pending and failing loses that last change: the document is not kept
  outside the page.
- An entry the package cannot read after an upgrade (no id back from `importJSON`) moves to `foreign`, is offered to the package again at
  every load and written back on every save: never dropped.
- Delete and Escape work on the chart and ignore the keys while a form field has focus.

## Pass criteria

1. Candles at day, week and month, as wide at week and month as at day; no minute or hour control; the page does not scroll sideways at 390 px.
2. One marker per bar and side that holds a trade of the chart, with a count where it holds several; the readout names side, quantity (≈ when estimated) and amount, and the dollar price on a dollar chart.
3. An order added in the form is a line, and gone when closed.
4. A horizontal line and a price range survive a reload and show on a second device; a horizontal line set to a typed price keeps it.
5. The Bitcoin chart is in dollars and shows the ETP's trades as markers.
6. Light and dark, desktop and 390 px, none with a literal colour; a drawing is accent while it is placed.

`bun scripts/design-shot/depot.ts` checks 1, 4 and 5 (the bar distance at the three intervals, the typed price in the stored document and after a reload,
dollar charts and their trades) and writes the shots (day, week, Bitcoin in dollars, and more on a wide light page) against synthetic data: a world ETF with a
16-month savings plan, partial sells and one estimated quantity, a US stock, a Bitcoin ETP, an in-memory stand-in for `fin serve`:
no vault, no personal data, so the images may be shared). `bun scripts/design-shot/depot.ts --serve` serves only the stand-in and the built app.

## Decisions

- **Direct `lightweight-charts`, outside basalt-ui's chart primitives.** basalt-ui's charts have no candlesticks, no markers bound to a bar and no
  drawing tools. Owner decision 2026-11-22, recorded in `DESIGN.md` §App deviations. `basalt/chart-engine-boundary` polices only `@visx` and
  `@tanstack/charts`, so no lint exception exists or is needed. Both libraries are imported by `components/depot-chart.tsx` and nothing else.
- **The drawing package is pre-1.0 and pinned** (`lightweight-charts-drawing` 0.11.1; its API broke once between 0.1 and 0.2), hence the one
  component and the opaque document.
- **The TradingView attribution mark stays** (the library's licence asks for it).
- **No indicators, alerts or news.**
