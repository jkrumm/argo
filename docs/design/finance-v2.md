# Finance v2 — concept

Argo's `/finance` section is the frontend of the encrypted vault (`~/SourceRoot/finances`, contract `docs/service.md`). v1 was a port of the
vault's own SPA: pages that each answered "what happened in a range" and repeated each other. v2 answers one question first —
**where does my money stand this month** — and makes the data curable inline (categories, tax tags, subscriptions), because the
insights are only as good as the tagging.

Baseline verdict of v1 (owner feedback, 2026-11-03): the overview is not expressive; several pages show the same data; the
subscription list was wrong; events are not needed; net worth is two charts; transactions is a small table; tags are empty and
tagging has to continue; November read as −2000 because the salary lands around the 27th of the previous month (fixed in the API:
budget months).

Principles for every screen: the figure that decides comes first and carries its period; cards are titled by the question they
answer; one primary action per view; a list you curate is a list you can edit in place (no detour to another page to change a
category); phone first (390 px is the primary device): tables become card lists, charts shrink in height, no horizontal scroll.

## Screens

| Route | Question | Decision |
|-|-|-|
| `/finance` This month | Can I afford the rest of the month, and what is still coming? | Spend less / move money / nothing to do |
| `/finance/spending` | Where does the money go over a period, and what moved? | Which category or merchant to cut or investigate |
| `/finance/recurring` | What am I committed to paying, and is the list right? | Cancel, keep, correct the detection |
| `/finance/transactions` | What is in the books, and what is not curated yet? | Categorize, tag, make a rule |
| `/finance/net-worth` | Am I getting wealthier, and where does it sit? | Rebalance / save more |
| `/finance/tax` | Which of this year's bookings are tax relevant, and which are not tagged yet? | Tag the queue so the year is complete |

## Datasets and encodings

| dataset | source | shape | chosen encoding | basalt export | reason |
|-|-|-|-|-|-|
| Projected end, daily budget, received/spent/due | `GET /api/month-status` | three headline figures, one with parts | strip of three stat cells; the split of income as a segmented meter | `StatGroup variant="strip"`, `Meter` segments | the three numbers are the answer; the meter shows what share of income is spent, due, expected, left |
| Cumulative spend by day | `GET /api/transactions` (month + 3 before), summed client-side | three cumulative series over a day-of-month axis, one reference level | lines: this month (accent, to today, dashed projection after), last month (grey), 3-month average (grey dashed); income as a reference line | `Lines` + `refLines` | cumulative curves compare pace at the same day; the income line shows when spending crosses what came in |
| Still due | `month-status.fixed_due` | ranked list with a date | rows with a bar on a shared scale, date as secondary | `BarList` | length ranks, the date is the second fact |
| Category vs average | `GET /api/categories` (month + 3 before) | part-to-whole against a reference, ranked | one meter row per top category: fill = this month, tick = 3-month average, delta beside | `Meter` with `target` | the tick is the average; over/under reads without a legend |
| Latest bookings, editable | `GET /api/transactions?limit=10` | few rows, one editable attribute | compact rows, category as an inline select | shared `TxList` row + `CategoryPicker` | edit where you read |
| 12-month net and savings rate | `GET /api/overview` | one value per month, diverging | bars (net) with the selected month marked; click selects the month | `Bars` | seasonality and loss months at a glance; the click is the way into any month |
| Category totals, MoM deltas | `GET /api/categories` over the range and the previous range | ranked parts with change | table: category, total, per month, vs previous period, 12-month sparkline; row selects the category | `BasaltDataTable` + `Sparkline` | a table is scanned by column; the sparkline carries the history |
| Merchants of a category | `GET /api/merchants` | ranked list | rows with a bar | `BarList` | length ranks |
| Recurring | `GET /api/recurring?all=1`, `/overrides` | many rows, several attributes, one editable | tables per kind, row actions for the override; upcoming list ordered by date | `BasaltDataTable`, `rowActions`, `Section` collapsible | scanned by column; editing is a row action |
| Transactions | `GET /api/transactions` (server paged) | many rows, many attributes, two editable | full-height table; cards below the regular container class | `BasaltDataTable` manual pagination/sorting/selection, `renderCard` | the whole ledger; cards keep the editors on a phone |
| Net worth over time, by account | `GET /api/net-worth` | parts of a whole over time | stacked area by account (depot included), total line | `StackedArea`, `Lines` | parts and total in one frame |
| Balances, positions | `GET /api/holdings`, net-worth | few rows with a share | table with a share meter | `BasaltDataTable` | value, share and as-of date are columns |
| Depot value history | `holdings.history` | one value per import day | line | `Lines` | trend of one series |
| Tax sums, queue | `GET /api/tax-year`, `/transactions?untagged=1` | parts; a work queue | `BarList` per tag; queue rows with one-click tags | `BarList`, queue list | the queue is the work |

Colour: neutral ink by default; one accent for "this month / the focus"; the comparison curves are grey; status ink only for
over/under budget and negative balance. Series dictionary: `FINANCE_SPLIT` and `FINANCE_ACCOUNT` (`src/lib/series.ts`).

## Layout

**This month, 1440:** page bar (month select, prev/next, sync, lock) · hero strip (projected month end · per day · received/spent/due)
with the split meter underneath · row: cumulative spend chart (wide) beside Still due · row: category vs average beside Latest
bookings · full-width 12-month trend. **390:** hero cells stack (projected end first), split meter, chart (260 px), still due,
categories, latest bookings as cards, trend.

**Spending, 1440:** range bar · category table beside the merchants of the selected category · month-by-month bars of the focus
category. **390:** categories as rows, selecting scrolls the merchants card into view.

**Recurring, 1440:** strip (subscriptions per month and per year, bills per month, due in 30 days) · subscriptions table · bills
table · upcoming list beside cancelled (collapsed). **390:** every table becomes cards.

**Transactions, 1440:** page bar filters (search, account, category, tag, amount, uncategorized, untagged) · queue strip (uncategorized
count, untagged expense count) · the table fills the page. **390:** filters in the sheet, rows as cards with both selects.

**Net worth, 1440:** strip (total, cash, depot, change in 12 months) · stacked area beside the depot history · accounts and positions
tables. **Tax, 1440:** year select · sums per tag beside the queue progress · the queue.

## Copy

Titles are questions or plain nouns for tables ("Where does the month stand", "Still due", "Latest bookings"). Facts carry their
period ("this month", "last 3 months"). Empty: "Nothing is due for the rest of this month." Errors come from the query card
(Retry). Amounts: whole euros from 10 €, cents below; signed only where a sign is information.

## Pass criteria

1. The first screen of This month states the projected month end and the daily budget with their period.
2. The cumulative chart shows three curves plus the income level; today is marked where the actual curve ends.
3. Every list that shows a category lets it be changed in place; a failed write rolls the row back and says why.
4. No screen repeats a dataset of another: recurring lives only on `/recurring`, the ledger only on `/transactions`.
5. At 390 px nothing is clipped horizontally and every table is a card list.
6. Filter values never appear in the address bar; `month`, `from`, `to`, `year` may.
7. A tax tag set in the queue removes the booking from the queue and moves the year's sums.

## Shot rounds

Method: `basalt-ui shot` over a synthetic sandbox vault (real `fin serve` handler, Argo relay, built dashboard), auto-anchors, light and dark, 1440 and 390; scored by the `basalt-design-reviewer` subagent plus `basalt-ui shot detect --lint` (zero findings in every round).

| Round | Verdict | Main findings fixed in the next one |
|-|-|-|
| 1 | 5 components failing | no marker for today on the pace chart; split meter without a legend; latest bookings 890 px tall beside a 450 px card; a running month compared with full-month averages; net-worth step unexplained (the depot joins in one month) |
| 2 | 3 failing, score 30 | spending deltas without a direction glyph; crowded or uneven tick labels (trend, tax, depot); two axes with different zeros; tax queue rows too heavy; recurring right column empty |
| 3 | 2 failing, score 68 | merchant action clipped on the tax queue; ribbon without savings rate and loss glyph; headline deltas without glyph |
| 4 | all 18 components pass, detect clean, score 91 | P2 only: ribbon cell wrap at 390 (fixed after), delta colour neutral on mobile |

Accepted, not fixable in the app: the pager's current-page fill is basalt's `Pagination`; 390 px crops of the tall tables are "not captured" by the tool (the page shots cover them); Month/From/To selects show their field name (basalt `SelectFilter`); a card list has no selection column, so bulk edits are a desktop job.
