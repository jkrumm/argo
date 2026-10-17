# Reading — concept

Route `/reading` — `apps/dashboard/src/routes/reading.tsx`, `features/reading/` (`hero-stats`, `shelf-section`, `book-card`, `unmatched-section`); API `GET /reading` (`summary` + `shelf[]`, each with `stats`), `apps/api/src/routes/reading.ts`.

## Baseline verdict

- `reading--dark--01-total-books.png … 05-avg-rating.png`: five tiles — `TOTAL BOOKS {n}`, `READ {n}`, `CURRENTLY READING {n}`, `WANT TO READ {n}`, `AVG RATING {rating} ★ · {n} rated`. Rows of bare numbers: no period, no target, the same count restated again in the section headings (`Currently Reading ({n})`, `Want to Read ({n})`, `Read ({n})`). `AVG RATING` repeats `{n} rated` twice.
- `06-card.png … 40-card.png`: {n_books} identical cover cards in a 3-column grid. {n_backlog} of them are the backlog, so most of the page height is unread books; the one thing that is live — progress on the in-progress books — is a thin bar with one muted line (`{pct}% read · {duration} · {pace} pages/hr · {n} sessions`).
- Slop by the owner's verdict: tiles of bare numbers, a card grid where a ranked list exists, no encoding of progress as a shape beyond the 4 px bar, no summary sentence, and a `Sync now` button as the only status chrome.
- Data the page drops: `pages` (backlog length), `startedDate`/`readDate` (days to finish), `lastReadAt` (staleness), `genres` (counts), `communityRating` as a ranking key, `paused`/`dnf` (zero today, so correctly absent).
- Mobile (`reading--dark--mobile.png`): the {n_books} cards stack to one column; the page is {n} screens tall.
- **Distance-from-bar: 4** — covers are legitimate content, but the page has no summary, no progress shape and no backlog compression.

## The question and the decision

- Question on opening: what am I reading, how far along, and how long is the backlog?
- Decision: which book to pick up now (stalest or nearest to done), and which want-to-read book to start next.

## Datasets and encodings

| Dataset | Source | Shape (SPEC §3) | Today's encoding | Chosen encoding | Reason | Keel pattern |
|-|-|-|-|-|-|-|
| Shelf status counts | `summary` (`read`, `currentlyReading`, `wantToRead`, `paused`, `dnf`, `total`) | Part of whole, 2–6 parts | Four count tiles | One segmented bar, parts in order `Read {n} · Reading {n} · Backlog {n}`, captions under the segments, total `{n} books` in the caption row; paused/dnf segments only when non-zero | Replaces N tiles with one strip that compares the parts and states the total | `metric-card-bar` |
| Progress of in-progress books | `shelf[].stats` (`currentPercent`, `pagesRead`, `totalReadSeconds`, `sessions`, `lastReadAt`) + `pages` | Progress to a target | 4 px bar + muted line | Per book a linear Meter 0–100% with value `{pct}%` end caption, mono facts `{duration} · {n} sessions`, derived `≈ {hours}h left at {pace} pages/h` (remaining pages ÷ the shelf median pace), and staleness `last read {age} ago` | Length on a shared track; the median pace turns a percent into an ETA | `metric-card-bar`, `entity-card` |
| Reading time per book | `stats.totalReadSeconds`, in-progress + read | Ranked list, top N | Not shown | `BarList` `Time read, per book`: cover thumbnail 24 px, title, bar on a shared hours scale, mono `{duration}` | The bar ranks effort before anything is read | `table-row` (entity cell) |
| Ratings | `shelf[].rating` (`ratedCount`) | Distribution | Mean + count tile | Axis-less 5-bucket histogram (1–5 ★) in a cell with hero `{rating} ★` and caption `AVG RATING · {n} rated`; the rated-by-me mean sits beside the muted community mean | Small n: the shape shows spread a mean hides | `stat-cell` |
| Finished books | `readDate`, `startedDate`, `rating`, `pages` | Event sequence | Cover grid `Read ({n})` | `EventList` grouped by month: cover thumb, title, author muted, `★ {rating}`, mono `finished {date} · {n} days · {pages} p` | The completion rhythm and days-to-finish are the reading | `timeline-event`, `activity-item` |
| Backlog | `shelf` where `statusId = 1` (`communityRating`, `pages`, `genres`, `dateAdded`) | Ranked list, top N | {n} cover cards | Compact rows (cover 32 px, title, author, mono `{rating} · {n} ratings`, `{pages} p`), sorted by community rating, first 8 shown, `Show all {n}`; list header facts `{n} books · {pages} p · ≈ {hours} h at {pace} pages/h (median)` | Ranked rows compare; the pace-based total makes the backlog a number | `table-row`, `entity-card` |
| Backlog by genre | `genres[]` over the backlog | Ranked list, top N | Tag chips on each card | `BarList` `Backlog by genre`: 5 rows, bar, mono count | Counts the chips nobody sums | — |
| Unmatched telemetry | `GET /reading/unmatched` | List needing a decision | Card with cover + button | Stays; heading `Unmatched device reads · N`, row facts `time read · pages` | Rare, action-bearing, already a decision | `decision-card` |

## Layout

**1440.** Summary sentence under `PageBar`. Then, top to bottom:

1. Joined stat strip (one surface, three cells): `SHELF` segmented bar ({n} books) · `RATINGS` histogram cell · `READING PACE` cell `{pace} pages/h` with caption `median of {n} books`. **Pace is one statistic everywhere:** the median of `pagesRead ÷ (totalReadSeconds ÷ 3600)` over the cohort of books with `pagesRead > 0` **and** `totalReadSeconds > 0`; the ETA, the backlog hours and this cell all use it. When no book qualifies the cell, the ETAs and the backlog hours show `—` with the reason `no book has reading time yet`.
2. `Currently reading · {n}` — 2-column grid of entity cards: cover 56 px, title/author, Meter, facts line, `last read` staleness, nothing else.
3. Two columns: left `Finished · {n}` EventList, right `Time read, per book` BarList.
4. `Backlog · {n}` — ranked rows, 8 shown, with the genre BarList on its right at 1440.
5. `Unmatched device reads` only when non-empty.

What stays: cover art on the in-progress cards and on thumbnails (identity), the Hardcover link on the title. What goes: the five tiles, the {n} equal cards, the three count-in-parens headings, the `★`-row decoration on read cards.

**390.** Strip becomes the segmented bar alone with the histogram below; in-progress cards single column; Finished and BarList stack; Backlog shows 5 rows. Page height target: under 6 screens.

## Copy

Placeholders; the format is the contract.

- Summary sentence: `{n} books in progress, median {pace} pages/h · {n} finished in {year} · backlog {n} books ≈ {hours} h`
- Strip captions: `SHELF · {n} books`, `RATINGS · {n} rated`, `READING PACE · median of {n} books` (n = the cohort size)
- Section titles: `Currently reading · {n}`, `Finished in {year} · {n}`, `Time read, per book · hours`, `Backlog · {n} books · {pages} p`, `Backlog by genre · top 5`
- In-progress facts: `{pct}% · {duration} read · {pace} pages/h · {n} sessions · ≈ {hours}h left · last read {age} ago`
- Finished row: `<book> · <author>   ★ {rating}   finished {date} · {n} days · {pages} p`
- Empty: `No books in progress — pick one from the backlog` (only when `currentlyReading = 0`)
- Replaces: `Total Books`, `across all shelves`, `{n} rated books` duplicates, and any "What am I reading?" subtitle.

## Upstream candidates

- `Meter` linear with value caption and end tick (maps to `Meter`). Props: `value`, `max`, `caption`, `target?`.
- `BarList` with a leading thumbnail slot (maps to `BarList`; the leading slot is new). Props: `rows: { label, value, valueLabel, lead?: ReactNode }[]`, `max?`.
- `StatGroup variant="strip"` with a `segments` cell kind — a segmented bar as one cell (maps to `Meter segments`). Props: `segments: { label, value }[]`, `total`.
- Entity row (thumbnail, title, one meta line, trailing mono value) — SPEC §3 "list of references"; recipe only, per §4.

## Pass criteria

1. No tile shows a bare count; the shelf split is one segmented bar with captions and a total.
2. Each in-progress book shows its percent as a Meter plus a time-left estimate that names the median pace it uses.
3. The backlog occupies at most 8 rows at 1440 and shows its page and hour totals in the header.
4. The ratings cell shows the mean with `n` and a histogram.
5. Section headings carry a count or a unit, never a parenthesised count after a category word.
6. The `Finished` list shows days-to-finish per book.
7. At 390 the full page is under 6 viewport heights.
8. No book title, author or cover appears in this doc or any committed file.
