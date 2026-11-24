# Depot page: information architecture

The depot page (`/finance/depot`) grew by accretion: a chart, then a watchlist, then an Indices tab, then Crypto. The owner's feedback of 2026-11-24 ("no whole, deep concept") is right: the navigation answered "what can I open?" with four unrelated mechanisms. This page states the model once; `depot-chart.md` stays the spec of the chart itself.

## One instrument model

Everything the page can open is an **instrument**: one row of the market store, keyed by a **symbol** (an ISIN, a coin symbol such as `BTC-USD`, or a series id such as `ftse-global-all-cap-usd`). Its **kind** comes from the service (`quote.kind`) and is the only thing that decides grouping and what the views can show.

| Kind | Group header | Has bars | Position, trades, orders |
|-|-|-|-|
| stock | Stocks | daily candles (US stock: dollars) | yes |
| etf | ETFs | daily candles, optionally with its tracked index in front | yes |
| etc | ETCs and ETNs | daily candles | yes |
| index | Indices | real candles (FTSE) or closes only | no |
| coin | Crypto | daily candles in dollars | yes, via the ETPs charted as it |
| series | Series | closes only | no |
| (none) | Other | whatever is stored | if held |

An instrument without bars is **loading** (the service is fetching its history) or **empty** (nothing found); both are states of the instrument, never of the page.

## What a list is

A **list** is an ordered set of symbols in the market store (`/market/lists`). Lists are the only thing the owner arranges; the instruments are not. A symbol may be on several lists. Removing it from a list never deletes prices or trades.

Two **built-in tabs** are not lists: they are views the page derives.

| Tab | Content | Can add, reorder, remove entries | Can be hidden |
|-|-|-|-|
| In depot | What is held now, largest value first, grouped by kind. Derived from `/depot/positions` | no | yes |
| Crypto (the owner's "Krypto") | Bitcoin in dollars and the CBBI, nothing more. No list, no search | no | yes |

The owner's **lists** follow them. Every list is a tab: the default "Watchlist" (cannot be deleted, can be renamed and moved) and any he creates. A list is created with the plus, renamed, moved left or right, and deleted from its tab's menu (right-click or long-press). A hidden built-in comes back from the plus menu. Which built-ins are hidden is kept on this device.

**The Indices tab is gone.** It was a picker of five MSCI series with no job of its own: comparing has its own menu ("Compare with…"), and an index is just an instrument of kind index. The five MSCI series stay in that menu; any stored series is found by the search and added to a list like anything else.

## Three views

A switch in the page bar, `?view=chart|details|board` (default Chart). It applies to the active tab; the selected instrument is `?isin=`.

| View | Shows | Notes |
|-|-|-|
| Chart | The chart card (candles, drawings, timeframes, comparison). Bitcoin adds the CBBI panel under it | An index draws candles from its first stored day: real bars where the series has them, weekly and monthly bars built from closes otherwise. A daily series that has closes only is a line, with a hint saying so |
| Details | Position strip: units, value, average cost (per unit, with the total), gain. Statistics: gain with this instrument over all time, invested, sold, realised and taxable gain, fees and tax, held since, largest holding (units and day), distance from the high. Then the trades and the open orders | An instrument with no position or trade says so in one line. Indices and series have no Details |
| Board | The active tab as a table: last close, day, week, month, YTD, 1Y, distance from the all-time high. Sortable; a click on a row opens its chart | In depot shows the held instruments that are on any list, Crypto the coins that are |

**Words.** The page says "average cost" (the owner's Einstandskurs) and "gain". "FIFO" appears once, in a tooltip on the taxable gain ("Sales are matched first in, first out, as the tax return counts them"). Nothing else on the page uses the word.

## The sidebar

Left of the main area; above a narrow container. Top to bottom:

1. **Tabs across the full width** of the page, above the sidebar and the main area (they were a 15 rem strip that clipped). Plain text tabs, the plus at the end.
2. **Search.** `/` focuses it; two characters search the whole Xetra universe, the coins and the stored series.
3. **Entries grouped by kind**, each group under a small header with its count (Stocks, ETFs, ETCs and ETNs, Indices, Crypto, Series, Other). An entry: name, last close, day change; a dot for held; a drag handle on the left (visible on hover; a touch screen has no drag, so the menu moves a row with Move up and Move down).
4. **Reorder** by dragging the handle inside a group, persisted through the list route (`position` of the entry); Alt+Arrow and the menu's Move up and Move down do the same from the keyboard and on touch. A group is derived from the kind, so an entry cannot be dragged into another group.
5. **Context menu** on an entry (right-click, or long-press on touch; a "…" button for the keyboard): Rename (list entries), Move to list (a submenu of the other lists; on In depot it reads Add to list), Move up, Move down, Open in board and Remove from list. On a tab: Rename, Move left, Move right, Hide (built-ins), Delete.

## The add flow

Keyboard first: type, arrow keys, Enter adds the highlighted hit to the active list (the default list when the tab is a built-in) and opens it; Escape clears. A result row has the name, a kind chip, the ticker and the ISIN. An instrument already on the list is marked "on this list" and Enter only opens it.

If the instrument has no bars, the service starts loading its history at once (`backfill`). The entry in the sidebar shows **Loading history**, then the number of bars and the first day while it runs; the main area shows the same as a card. When it is `done` the page refetches and shows its chart. `failed` shows the service's reason and a Retry (adding the entry again). The page polls `/market/backfill` while a state is `queued` or `running` and stops after `done`/`failed`.

## Crypto

One row: Bitcoin (USD). Under its chart a **CBBI panel**: the latest value on a 0 to 100 scale with its day, and a thin line of the stored history (the panel's "Line" switch, on by default, kept per device; the latest reading stays above it). No other coin, no list, no add. If the owner holds an ETP charted as Bitcoin, its trades are on the chart as before.

## Decided

- **Native drag and drop**, no dependency. The handle is the only draggable part; the keyboard and touch have Alt+Arrow and the menu. A drag library is a weight the one gesture does not need.
- **The board of In depot is the held instruments that are on a list**, and Crypto's the coins that are. The board route is per list; a held instrument on no list has no figures there. If that gap hurts, the service gets a board for held instruments (a follow-up for the finances repo), not a client-side recomputation.
- **The CBBI line is its own thin chart** under the candles, over the whole stored history; it does not follow the candle chart's zoom. Aligning two charts' time scales would put a second library's scrolling on the same canvas for a 0 to 100 gauge.
- **The view switch lives in the page bar** (`PageBar tabs`), because it switches the page, not one card.
- **Built-in tabs are hidden, not deleted:** nothing of the owner's is stored for them, so hiding is a device preference.
- **Chart polish stays in `depot-chart.md`.** This page adds no indicators, alerts or news.
