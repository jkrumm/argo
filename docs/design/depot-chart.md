# Depot chart — concept

`/finance/depot` is where the owner reads a price chart next to his own trades. It replaces the habit of keeping the chart in TradingView
and marking buys and sells by hand: the market store, the depot and the hand-kept orders of the vault (`~/SourceRoot/finances`, contract
`docs/service.md` §Chart routes) are all served, so the page reads them in instead of asking him to draw them. Behind the finance gate like
its siblings; the market routes (bars, lists, search, series) answer while the vault is locked, the depot and drawing routes need it open.

## Question and decision

- **Question:** where is this instrument against what I paid, what I have waiting at the bank, and the levels I drew?
- **Decision:** wait, add to the position, or move an order. Nothing on the page places, changes or deletes an order at the bank:
  ING has no interface for orders, so the open orders are typed in here and closed here by hand.

## Layout

| Region         | Content                                                                                                                                                                                                                         | Narrow (390 px)                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Watchlist      | Tabs: In depot (units, value, share of the depot), one per list of the owner's, Crypto, Indices. A search field above the rows; the active list's rows with last close and day change, rename and remove per row                | Two columns above the chart in a short area that scrolls inside itself; the tab strip scrolls sideways inside itself |
| Chart card | Candles over an optional turnover pane; in the header the all-time high (value, day) and the last close's distance from it; the interval switch and one drawing toolbar (pointer, horizontal line, vertical line, price range, three colours, delete); under the chart the timeframes (1M to Max) on the left, "Compare with…" with its chip, Log and Volume on the right | Same card; the interval switch is the shell's select form, the toolbar wraps under it |
| Line editor | A small panel floating over the top of the chart while one line is selected: its colours, its label, for a horizontal line its exact price, delete | Same, wrapped to two rows |
| Index card     | An index chosen from the Indices tab (or found by the search), instead of the chart card and everything under it: its line over the stored history the range allows, the latest level and the change over the range             | Same card; the chart is shorter                                                                                      |
| Position strip | Quantity, value, FIFO cost, unrealised gain                                                                                                                                                                                     | Two by two                                                                                                           |
| Trades         | The instrument's trades, newest first                                                                                                                                                                                           | Card list                                                                                                            |
| Open orders    | The hand-kept orders, an add form, close as executed, cancelled or expired                                                                                                                                                      | Card list                                                                                                            |

The chart loads every stored bar of the instrument at once (the service answers up to 20,000; Bitcoin has about 5,500 daily bars since 2011) and
the **timeframes only move the view**: 1M, 3M, 6M, 1Y, 5Y and Max set the visible range, a drag scrolls and the wheel or a pinch zooms. Which button is
lit is read off the chart, so a zoom to something else lights none. It opens on the last year at the day interval; week and month open on 252 bars
(a year of trading days), so the candles are about as wide as at day and the distance between two bars does not jump when the interval changes. A
timeframe that would hold fewer than six bars at the interval (one month of week bars) is disabled. The page-bar range filter is gone from the chart; it
remains only for the index card. The market store has no intraday, so there is no minute or hour interval.

The chart is about 1.5 times as tall as the first version on a wide container (44 rem, 26 rem narrow).

## Encodings

| Data          | Encoding                                                                                                                                                                                                                                                                                | Why                                                                                                                                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Price         | Candles, up `VX.status.good`, down `VX.status.bad`. A switch makes the price scale logarithmic                                                                                                                                                                                          | Direction is the signal. Text-grade status inks, not the fill-only `excellent`. A log scale keeps a coin's decade of growth readable; it opens on for coins and is remembered per instrument on this device                                           |
| Turnover      | Histogram in its own pane below, the candle's colour at 45 %; a switch hides it. Off by default for coins and indices and where the instrument has no turnover (the switch is then disabled)                                                                                            | Same hue per bar so the two panes read together; faint so it never competes                                                                                                                                                                           |
| Index history | Before an ETF's first bar, a muted line (`VX.muted`) of the index it tracks, converted and scaled to meet the ETF's first close; the readout names it "Index, scaled to the ETF price"; a square marker "ETF launch" sits on the first own bar                                          | Data from another source is drawn as another kind of mark, never as candles: its bars are flat and carry no turnover. Price level only: the index has no dividends, so an accumulating fund's real history is a little higher (the info text says so) |
| Own trades    | Marker on the candle of the booking day (week, month: of the bar that holds it), twice the library's default size: buy a green arrow below the bar, sell a red arrow above, a count beside it when a bar holds several of that side; a circle where every quantity is estimated         | The arrow is the owner's own TradingView habit. Estimated is a different shape, not a different hue: colour stays the side. One marker per bar and side, so a savings plan never piles up arrows                                                      |
| Trade card    | On hover over a marker, or pinned by a click or tap on its bar: a card per trade with day, side, units (≈ when estimated), price (the dollar price too on a dollar chart), amount, fee and, for a sale, the realised gain in the good or bad tone; four trades at most, then "+ n more" | The marker only says that something happened; the numbers are the reason to look. A tap pins the card because a phone has no hover; the next click on a bar without a trade puts it away                                                              |
| Average cost  | Solid ink line with its value on the axis; in dollars (from the dollar price of the buys) on a dollar chart                                                                                                                                                                             | Data, so neutral; the one reference every other price is read against. The accent is kept for what the owner draws                                                                                                                                    |
| Open orders   | Dashed line at the limit or stop, the side's colour, titled "Sell limit 182 €"; on a US stock charted in dollars at the euro price times the latest ECB rate, titled with both ("Sell limit 213 € (238,56 $)"); the scale stretches to hold a line within half to double the last close | Dashed = not filled; a market order has no price and so no line. A coin charted as its ETP's row has no order line: the ETP's price is not the coin's. A locked vault (423) draws none and shows no error |
| Index         | A line in the accent over the whole stored history (daily levels, back to 1998-12-31 for ACWI IMI, World and Europe); logarithmic over "Everything", linear over a range; the latest level and the change over the range as facts                                                       | One series, so one hue (`FINANCE_INDEX.index`, the accent): a log axis keeps 28 years readable, as equal steps are equal percentages                                                                                                                  |
| Comparison    | The chosen index as a line on the chart's own price scale, which turns to percent: the candles and the line both start at 0 % at the left edge of the visible range and again after every timeframe, zoom or scroll. The index is the neutral ink, its name on the axis; a chip names it with its change over the visible range and the instrument's own | Instrument and index are two kinds of thing: the subject keeps its candles, the reference is the neutral line. The index is a net return, so a distributing fund's gap is partly its payouts |
| Drawn lines   | Horizontal and vertical lines in one of three colours: blue (the accent, default), green for a buy level, red for a sell level or a resistance; an optional label on the line (up to 40 characters). A price range stays the accent                                                     | Green and red are the side colours the markers and orders already use, so a level reads like what it stands for. The colour is stored as a role, not a hex, so the page paints it with the active scheme                                              |

Colour comes only from `VX.*` tokens, read at runtime and re-read when the scheme flips (a canvas library cannot read `var()`);
no series entry in `series.ts`, no literal colour in the source. A drawing is stored with its colour role (`accent`, `buy`, `sell`); the page paints it again with the
active scheme's token at load and on every scheme change.

## Listings and currency

Bitcoin is charted in dollars only (`BTC-USD`; the euro listing is not offered). An instrument the watchlist says is charted as another listing (a Bitcoin ETP, `instruments` of the `BTC-USD` row) has no row of its own: the row is held when any of its instruments is, its trades come from
`depot/trades?isin=BTC-USD`, and the position strip sums them. A US stock with a stored US listing (`us_mic`) is read on that listing, in dollars.
Trade markers sit on the candle of the booking day in either case; the trade card adds the dollar price (`price_usd`, the ECB rate of the booking day).
The position strip, the trades table's amounts and orders stay in euros. The table adds a dollar price column where a trade has one.

An Xetra ETF with a tracked index (`index` of its watchlist row, set with `fin market watch add --index`) is asked for with `splice=index`: the answer opens with the index's levels as flat,
flagged bars (`source: "index"`, no turnover), converted with the ECB rate and scaled by one factor to meet the ETF's first close. A week or month bar is an index bar when every day in it is one.

## The watchlist panel

- **Tabs.** _In depot_ lists what the owner holds (units, value, share of the depot; sold-out instruments are not there), largest first; it is the first tab while anything is held. Then one tab
  per list of the owner's (the default list "Watchlist" cannot be deleted), _Crypto_ (the coins) and _Indices_ (the stored MSCI series). The tab is `?tab=`; an id that no longer exists falls back to the first.
- **Search.** A TradingView-like field above the rows: `/` focuses it from anywhere on the page, two characters start a search of the market store (instruments by name, ISIN, WKN or ticker; coins; stored index series),
  the arrow keys move through the results, Enter adds the highlighted one to the active list (the default list when the active tab is not a list) and opens it, Escape clears. It reads the store only; an ISIN gets its bars at the next sync.
- **Rename and remove.** A pencil on a row renames the entry in this list (the display name; empty gives the instrument's own back), a cross removes it from the list. Removing never deletes prices or trades: an old ETF disappears from the lists and its history and trades stay. A list is created with the plus, renamed and deleted from its menu.
- A series the owner added from the search and that is not one of the five MSCI ones opens as an index card named by what the store says of it.

## Comparison

"Compare with…" is a menu in the chart's bottom toolbar, beside Log and Volume; it names a stored index (`?cmp=`) and **is off by default**. The chosen index is drawn on the candles' own price scale, which switches to the library's percentage mode: each series is rebased to its first visible value, so the rebase follows the timeframe buttons, zoom and scroll with no code of ours, and 6M and 1Y read differently. There is no second area. Percent mode and the log scale exclude each other, so Log is disabled while comparing (its setting returns when the comparison is removed with the chip's x). The index is resampled to the chart's bar times (the last level on or before a bar, at most ten days old) so week and month charts keep their spacing.

The comparison exists because the index behind a young fund is not free: FTSE Global All Cap levels need an LSEG licence, so an ETF like VGLA (launched 2026-08) is read against MSCI ACWI IMI, which has the same size segments and about 63 % US weight, from 1998 on. The fund line is its close, so a distributing fund's payouts are not in it; the index line is a net return. The index is not the fund's own benchmark, so the gap is not tracking error. The spliced history in the chart is the fund's _tracked_ index (FTSE, price level); the comparison is the MSCI stand-in: two different questions. A comparison with another instrument is not offered; the URL field names the five stored indices.


## Numbers

German everywhere on the page (`lib/depot-number.ts`): a dot groups thousands, a comma opens the decimals, a minus is the real sign (−). A price has as many decimals as its size asks: none from 1.000 (`95.433`), two from 10 (`182,40`), three from 1 (`4,812`), four below. The price axis, the crosshair label, the readout, the header, the line labels (trailing zeros dropped: `182 €`), the drawings' own labels, the trade cards, the tables and the position strip use the same rules; the turnover axis reads `12 Mio.`. A percent has one decimal: `−18,3 %`, `+5,1 %`. Dates are `24.11.2026`.

## Header facts

The card header carries the **all-time high**: its value in the chart's currency, the day it was reached and, beside it, the last close's distance from it (`−6,2 % last close vs. high`). The high is the greatest daily high of the instrument's own stored bars (a spliced index does not count); on week and month charts the day bars are asked for separately, so the day is exact. It is read from the whole stored history, whatever the visible range.

## Drawings

- The package paints a drawing in its own blue while it is placed. `setDefaultStyleOverride` gives every tool the chosen colour before the first click, so the
  preview and the placed drawing look the same.
- **One toolbar.** The pointer, horizontal line, vertical line and price range are in the chart card's header; each has an icon and a tooltip naming it and what it marks ("Horizontal line: marks a price", "Vertical line: marks a day"). The three colours sit beside them: they colour the next line and, while the pointer is on and one line is selected, that line. A tool is used once: the pointer comes back after every drawing.
- **Line editor.** Selecting one line (a click on it, or placing it) opens a small panel over the top of the chart with the colours, a label field (Enter or leaving the field applies, Escape puts the line's own back), for a horizontal line its price, and delete. The price is typed German: `150`, `150,5`, `95.000` and `95.000,5` all read; a dot that is followed by exactly three digits is a thousands separator, any other dot a decimal point. Enter or leaving the field moves the line and writes the price back with grouping; Escape restores it; text that is no price reverts. The move is saved like any edit.
- One JSON document per instrument, `{ v: 1, drawings: [...], foreign: [...], roles: { <id>: 'accent' | 'buy' | 'sell' } }`; the server never reads it. A document without `roles` (the first version) reads as all accent.
- Saved about 500 ms after the last change (flushed on instrument switch, unmount and when the tab hides); a failed save is
  reported and retried with the next change while the instrument stays open. Leaving it (or a vault lock that
  drops the page to the unlock screen) with a save pending and failing loses that last change: the document is not kept
  outside the page.
- An entry the package cannot read after an upgrade (no id back from `importJSON`) moves to `foreign`, is offered to the package again at
  every load and written back on every save: never dropped.
- Delete and Escape work on the chart and ignore the keys while a form field has focus.

## Pass criteria

1. Candles at day, week and month with about the same distance between bars; no minute or hour control; the page does not scroll sideways at 390 px.
2. The chart opens on the last year; 5Y and Max change only the view; Bitcoin on Max starts in 2011, on the log scale, without turnover; an ETF opens on the linear scale with turnover.
3. One marker per bar and side that holds a trade of the chart, with a count where it holds several; hovering it, or clicking its bar, shows the card with side, units, price, amount and fee (and the realised gain of a sale, the dollar price on a dollar chart).
4. An order added in the form is a labelled dashed line ("Buy limit 112 €"), gone when closed; a US stock's hand-kept sell order is on its dollar chart, named in euros and dollars, inside the visible price range.
5. A red line with a label, a green line with a label and a blue vertical line survive a reload and show on a second device; a horizontal line set to a typed price keeps it.
6. The Bitcoin chart is in dollars and shows the ETP's trades as markers.
7. A young ETF's history opens with its index as a labelled muted line and a launch marker; the comparison is off until "Compare with…" asks for it. Chosen, the index is a line on a percent scale from 0 % at the left edge, 6M and 1Y read differently, and the chip's x removes it.
8. The tabs list In depot, the lists, Crypto and Indices; a search adds an instrument to a list, a rename shows its own name and a removal takes it off without touching its history.
9. Light and dark, desktop and 390 px, none with a literal colour; a drawing takes the active scheme's colour.
10. The Indices tab lists the stored series; an index shows as one line back to 1998 with its name, source and latest level.
11. Prices are German with the precision of their size (Bitcoin without decimals, a euro price with two or three); percentages read "−18,3 %"; the header names the all-time high with its day and distance.
12. The tools have tooltips, the colours sit in the toolbar, a selected line opens its editor, the pointer returns after one drawing, and a typed price accepts a comma and a thousands dot.

`bun scripts/design-shot/depot.ts` checks 1 to 5 and 7 to 12 (the opening view, the timeframes, the bar distance at the three intervals, Bitcoin on Max, the trade card by hover and by click, the three lines with their colours and labels in the stored document and after a reload, dollar charts and their trades, the spliced history and the comparison being off, the tabs and the search, rename and removal, the Indices tab, an index line back to 1998 and the overlay of a four-month-old fund against ACWI IMI) and writes the shots
(`index-max`, `compare-6m`, `compare-1y`, `compare-young`, `toolbar` with its tooltip, `line-editor`, `us-stock` with its order line, `spliced`, `trade-card`, `search`, `lists` as crops next to the page shots; day, week, Bitcoin in dollars and more on a wide light page) against synthetic data: a world ETF with a
16-month savings plan, partial sells and one estimated quantity, a US stock, a Bitcoin ETP, Bitcoin from 2011, a global all-cap fund with four months of history and a tracked index, two lists, a search catalogue, an in-memory stand-in for `fin serve`:
no vault, no personal data, so the images may be shared. `bun scripts/design-shot/depot.ts --serve` serves only the stand-in and the built app.

## Decisions

- **Direct `lightweight-charts`, outside basalt-ui's chart primitives.** basalt-ui's charts have no candlesticks, no markers bound to a bar and no
  drawing tools. Owner decision 2026-11-22, recorded in `DESIGN.md` §App deviations. `basalt/chart-engine-boundary` polices only `@visx` and
  `@tanstack/charts`, so no lint exception exists or is needed. Both libraries are imported by `components/depot-chart.tsx` and nothing else.
- **The whole history is loaded, the timeframes are a view** (owner feedback 2026-11-24): a range filter that decided what was loaded hid the data the owner wanted to scroll to. The cost is one answer of at most a few hundred kilobytes per instrument; paging older bars on scroll was left out because no stored history comes near the 20,000-bar cap.
- **Log scale and turnover are remembered per instrument, on this device**, in a `createPersistedState` map keyed by ISIN (`lib/view-prefs.ts`) and not as store fields: a store declares its fields once, and the instruments are open-ended. Two buttons bind it, no filter or tab does (`basalt:depot-view` in localStorage, no vault data), with defaults by kind: a coin opens logarithmic; a coin, an index or an instrument with no turnover opens without the turnover pane.
- **The spliced history is a line, not candles**: its bars are flat and carry no turnover, so candles would draw dashes and a turnover pane of zeros.
- **UI text is English** like the rest of the page; the German wording of the owner's feedback ("Im Depot", "Vergleichen mit…") is "In depot" and "Compare with…". Only numbers and dates are German.
- **Comparison is the library's percentage scale** (owner feedback 2026-11-24: the old overlay card reacted to other controls and could not follow the timeframes). The price scale of the candles turns to percent while an index is chosen, so no code rebases anything and no second area exists; the cost is that Log is off while comparing.
- **An order's line is drawn in the chart's currency**, converted with the latest `eur-usd` value for a US stock with a stored US listing; a coin's ETP orders stay off a coin chart.
- **The drawing package is pre-1.0 and pinned** (`lightweight-charts-drawing` 0.11.1; its API broke once between 0.1 and 0.2), hence the one
  component and the opaque document. A colour role lives beside the library's export, not inside it, so an upgrade cannot lose it.
- **Index lines use basalt's `Lines`, the candle chart stays direct.** A line over decades needs neither candles nor trade markers, so the charts rule applies (a series pair
  in `lib/series.ts`, `ChartCard`); the exception above covers only what basalt-ui cannot draw.
- **MSCI ACWI IMI stands in for FTSE Global All Cap** in the comparison, owner decision 2026-11-24: the FTSE daily levels are behind a licence, the MSCI series is in the store. The chart's own spliced history does use the FTSE price series, as the market store tracks it.
- **Indices are in the URL like instruments** (`?isin=<series id>`), so a link carries the view; `isin` allows 40 characters for it.
- **The TradingView attribution mark stays** (the library's licence asks for it).
- **No indicators, alerts or news.**
