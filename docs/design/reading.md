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

| Dataset                       | Source                                                                                                                                        | Shape (SPEC §3)          | Today's encoding         | Chosen encoding                                                                                                                                                                                                                      | Reason                                                                       | Keel pattern                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | --------------------------------- |
| Shelf status counts           | `shelfCounts(shelf)` (`read`, `reading`, `backlog`, `paused`, `dnf`, `total`), one source for the sentence, the split and every section count | Part of whole, 2–6 parts | Four count tiles         | One segmented bar, parts in order `Read {n} · Reading {n} · Backlog {n}`, captions under the segments, caption `SHELF · by status`, total `{n} books` as the hero value; paused/dnf segments only when non-zero                      | Replaces N tiles with one strip that compares the parts and states the total | `metric-card-bar`                 |
| Progress of in-progress books | `shelf[].stats` (`currentPercent`, `pagesRead`, `totalReadSeconds`, `sessions`, `lastReadAt`) + `pages`                                       | Progress to a target     | 4 px bar + muted line    | Per book a linear Meter 0–100% with value `{pct}%` end caption, mono facts `{duration} · {n} sessions`, derived `≈ {hours}h left at {pace} pages/h` (remaining pages ÷ the shelf median pace), and staleness `last read {age} ago`   | Length on a shared track; the median pace turns a percent into an ETA        | `metric-card-bar`, `entity-card`  |
| Reading time per book         | `stats.totalReadSeconds`, in-progress + read                                                                                                  | Ranked list, top N       | Not shown                | `BarList` `Time read, per book`: cover thumbnail 24 px, title, bar on a shared hours scale, mono `{duration}`                                                                                                                        | The bar ranks effort before anything is read                                 | `table-row` (entity cell)         |
| Ratings                       | `shelf[].rating` (`ratedCount`)                                                                                                               | Distribution             | Mean + count tile        | Axis-less 5-bucket histogram (1–5 ★) in a cell with hero `{rating} ★` and caption `AVG RATING · {n} rated`; the rated-by-me mean sits beside the muted community mean                                                                | Small n: the shape shows spread a mean hides                                 | `stat-cell`                       |
| Finished books                | `readDate`, `startedDate`, `rating`, `pages`                                                                                                  | Event sequence           | Cover grid `Read ({n})`  | `EventList` grouped by month: cover thumb, title, author muted, `★ {rating}`, mono `finished {date} · {n} days · {pages} p`                                                                                                          | The completion rhythm and days-to-finish are the reading                     | `timeline-event`, `activity-item` |
| Backlog                       | `shelf` where `statusId = 1` (`communityRating`, `pages`, `genres`, `dateAdded`)                                                              | Ranked list, top N       | {n} cover cards          | Compact rows (cover 32 px, title, author, mono `{rating} · {n} ratings`, `{pages} p`), sorted by community rating, first 8 shown, `Show all {n}`; list header facts `{n} books · {pages} p · ≈ {hours} h at {pace} pages/h (median)` | Ranked rows compare; the pace-based total makes the backlog a number         | `table-row`, `entity-card`        |
| Backlog by genre              | `genres[]` over the backlog                                                                                                                   | Ranked list, top N       | Tag chips on each card   | `BarList` `Backlog by genre`: 5 rows, bar, mono count                                                                                                                                                                                | Counts the chips nobody sums                                                 | —                                 |
| Unmatched telemetry           | `GET /reading/unmatched`                                                                                                                      | List needing a decision  | Card with cover + button | Stays; heading `Unmatched device reads · N`, row facts `time read · pages`                                                                                                                                                           | Rare, action-bearing, already a decision                                     | `decision-card`                   |

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

## Wave 21 rounds

Shots: live production data, GET-only proxy, `apps/dashboard/.design-shots/w21-reading-r{N}/` (gitignored). Each round was scored by a fresh `basalt-design-reviewer`, plus a side-by-side read against the Keel Crew capture (hero-size headline, hero numerals, composite cards).

| Round | What changed                                                                                                                                                                                                                                                                                                                                                          | Reviewer verdict                                                                                                                                                                                                                                                                                                                                                                                    |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| r0    | Baseline: five bare tiles, {n_books} equal cover cards, 4 px bars.                                                                                                                                                                                                                                                                                                    | Not scored (baseline, distance-from-bar 4).                                                                                                                                                                                                                                                                                                                                                         |
| r1    | Full rebuild: summary sentence, 3-cell strip (shelf split bar, ratings histogram with a mean tick, pace dots with a median tick), in-progress cards with `Meter` and ETA, Finished list, `BarList` time read, backlog rows with Show all, genre `BarList`.                                                                                                            | Self-read only: facts lines in mono read heavy, `last read last month` idiom, raw ISO dates, unknown days printed as `· — ·`.                                                                                                                                                                                                                                                                       |
| r2    | Proportional facts and footers, `numeric: 'always'` for ages, segment fills raised, shelf caption `by status` so the total is stated once.                                                                                                                                                                                                                            | Reviewer: page pass; strip-ratings, strip-pace, strip-shelf, progress-card, finished, time-read, backlog fail (unit-less pace dots, one meter with a page total and one without, `— days` unexplained, mobile row wraps, ranking basis unstated).                                                                                                                                                   |
| r3    | Headline as `Title order={3}`, hero numerals at `--vx-text-kpi`, `started {date}` short form.                                                                                                                                                                                                                                                                         | Shot only; folded into r4.                                                                                                                                                                                                                                                                                                                                                                          |
| r4    | Pace axis ends, legend swatches, `no page count, so no time left` fact, finished-list note naming why days are unknown, backlog `ranked by community rating`, genre `counts once per genre`, `★` on the community rating.                                                                                                                                             | Reviewer: summary, strip-ratings, strip-pace, page pass; strip-shelf (4 font sizes), progress-card (empty track read as 0 %), finished and backlog (row wraps at 390, truncated meta) fail; time-read fails basalt-side. Mobile ≈ 4 screens.                                                                                                                                                        |
| r5    | Unknown progress renders `— % · no device progress yet` instead of an empty track; finished/backlog trail shortened to `{date} · {pages} p`, days moved into the meta line when known; author line may wrap.                                                                                                                                                          | Folded into r6.                                                                                                                                                                                                                                                                                                                                                                                     |
| r6    | Final build after `make check` green.                                                                                                                                                                                                                                                                                                                                 | Reviewer: summary, strip-ratings, strip-pace, progress-card, time-read, page pass; strip-shelf and finished fail Craft 2 (four font sizes per cell); finished and backlog fail Craft 6 (the trailing `p` clipped at the crop edge, answered with 2 px of right padding after the round). Remaining BarList label/bar overlap, mono values and the slashed zero are basalt-side. Mobile ≈ 3 screens. |
| r7    | Review round 1: one source (`shelfCounts`) for the sentence, the split and every section count; backlog hours `—` when no page counts, `< 1 h` without `≈`; one time-read and pace cohort (in-progress and finished books); `< 0.1 h` instead of `0.0 h`; `— %` for a 0 % / 0-session report; the year read in UTC; finished-list note for read books without a date. | Own read of the r7 shots: the trailing `p` on finished and backlog rows is fully visible at 390 and at 1440. Not re-scored by a reviewer.                                                                                                                                                                                                                                                           |
| live1 | Post-live fix: the ratings histogram bins by whole star rounded down (`2.5` → 2★) and says so in the cell footer; the mean tick maps onto the `[i, i+1)` bins.                                                                                                                                                                                                        | Own read of the shot: the half-star book sits in the 2★ bar.                                                                                                                                                                                                                                                                                                                                        |

Pass criteria: 1 (no bare count; split bar with captions and total), 2 (Meter + ETA naming the median), 3 (backlog 8 rows at wide, 5 at compact, page and hour totals in the header), 4 (mean with `n` and histogram), 5 (counts via `Section count`), 6 (days per book when a start date exists, otherwise one stated reason), 7 (≈ 4 screens at 390), 8 (no titles in committed files) hold.

Deviations from the concept: Finished is grouped by month across all years rather than `Finished in {year}`, with the year-to-date figure carried by the sentence; the `BarList` rows carry no cover thumbnail (no leading slot); the finished-row facts are split between the meta line (rating, days) and the trailing value (date, pages).

## Wave 21 friction

| Export                      | Needed prop                                                        | argo case                     | What argo does instead                                                 |
| --------------------------- | ------------------------------------------------------------------ | ----------------------------- | ---------------------------------------------------------------------- |
| `BarList`                   | a `lead?: ReactNode` slot (thumbnail) and a label-outside row      | `Time read, per book`         | plain `BarList`; the label sits over the bar and crosses the fill edge |
| `BarList`                   | a `format` that also covers the value column's face (proportional) | hours and genre counts        | none; values render mono                                               |
| `Meter` with `segments`     | per-segment captions under the bar                                 | shelf split                   | a local legend row with a swatch per segment                           |
| `Meter`                     | `tone="muted"` for a non-verdict fill                              | in-progress cards             | `color={alpha(VX.muted, 0.35)}`                                        |
| `Meter`                     | a defined empty state that reads `—` rather than an empty track    | books with no device progress | a text line `— % · no device progress yet` instead of the meter        |
| `StatGroup variant="strip"` | a `segments` cell, a histogram cell, a dot-on-axis cell            | the three strip cells         | a local `strip.tsx` joined-cell grid                                   |
| `Section`                   | `summary` takes a facts line; a visible subtitle                   | backlog totals, finished note | `summary` carries the line                                             |
| heading face                | numerals without the slashed zero                                  | the summary headline          | none                                                                   |

## Wave 23 rounds

Live production shots (`basalt-ui shot`, 1440 + 390, both schemes) after the basalt-ui 2.20.0 adoption (#81–#84), scored each round by a fresh `basalt-design-reviewer` plus a side-by-side against Keel. Boards: `.design-shots/w23-r1-*` and `w23-r2-*` (gitignored).

- **r1:** fail. the shelf cell was half empty (emptyRatio ≥ 0.4); `Finished` had no scope; four sizes in the finished list.
- **Fixed between rounds (#87):** `Finished` carries its period from the model's `scopeLabel`; three sizes.
- **r2:** fail: the shelf cell is still stretched half-empty; title links draw a square full-width focus box over the author line; the time-read label crosses its bar end.
- **Against Keel:** closest to Keel (headline sentence, strip with inline charts).
- **Open for Wave 24:** a footer fact on the shelf cell (or no stretch), the title-link focus ring, outside labels on time-read.

### Wave 24 fixes

- Headline: the `Title` sentence is now `PageSummary` — sentence `{n} books in progress, median {pace} pages/h`, facts `{n} finished in {year}` and `backlog {n} books ≈ {h} h` (`summaryParts`, tested).
- Shelf cell: a footer fact, `{n}% of the shelf is read · {n}% is backlog` (`shelfShares`, clamped to 1–99 % for a non-zero part, tested), so the stretched cell is no longer half empty.
- Title links: the two-line clamp sits on a wrapper `Text`; the inline `Anchor` inside draws a focus ring that hugs the title text and leaves the author line alone.
- Time read: `BarList variant="thin"` puts each title on its own line above a thin bar, with the value on that line, so no label crosses a bar end.

No new basalt rows.

### Wave 24 round (`w24-r1`, live after #90–#95)

- **Reviewer:** fail: the ratings caption explains the binning, the pace caption explains the dots, the finished list carries a note about what it does not draw; the ratings ticks crowd at 390; link focus is now a 2 px bar after the title instead of an outline (the r2 focus-box fix overcorrected).
- **Against Keel:** holds up — still the closest to Keel.

### Wave 25 fixes

- Ratings cell: the footer is the community mean and its base, plus a half-star rounding fact only when a half star is rated (`ratingsFooter`, tested). The cell is its own container; under 240 px the even-star tick labels hide (the bars and the aria label keep all five).
- Pace cell: the footer states the total read time only; the dot/tick explanation is gone.
- Finished list: the summary line carries `{n} finished without a read date, not listed` and, only when some rows lack a start date, `days to finish need a start date; {n} of {m} have none`.
- Title link: `:focus-visible` is a 2 px accent outline with offset around the link text. The clamp clips overflow, so its wrapper carries 3 px padding with a matching negative margin to leave room for the ring (it was clipped to a bar before).

No new basalt rows.

### Wave 25 round (`w25-r1`, live after #96–#101)

- **Reviewer:** fail. Fixed: link focus is an outline ring. Open: `half stars count in the star below` still explains the binning; at 390 two ratings bars lose their labels; the pace visual (two unnamed dots + a tick) does not answer "what is my pace"; `days to finish need a start date; {n} of {n} have none` still describes what is not drawn; the headline repeats the pace cell and the shelf legend; backlog caption repeats the headline; shelf footer percentages restate the bar; time-read repeats the progress cards' hours in a second format, drawn as tracks that read as percent; `— % · no device progress yet` pairs a dash with a unit.
- **Against Keel:** does not yet (was holds up) — the stricter copy bar; Keel's micro-visuals carry their own scale and target.

### Wave 26 round (`w26-r1`, live after #102–#106)

- **Reviewer:** fail. Fixed: no binning note (the bucket label states its range); no note about what is not drawn; no headline/pace/legend/backlog restatement; no shelf percentages; time-read no longer repeats hours; no dash paired with a unit. **New:** the pace cell lost its visual and is half blank (`emptyRatio` ≈ 0.48); the range bucket label wraps onto three lines at 390; time-read is now a permanent empty card that does not say what fills it; finished rows show no days-to-finish and no reason. Unscored: the shelf legend and the `Currently reading` heading print one count; the shelf cell stretches at 390.
- **Against Keel:** does not yet — two empty surfaces.

### Wave 27 round (`w27-r1`, live after #107–#111)

- **Reviewer:** fail. Fixed: the `Currently reading` heading no longer repeats the legend count; no permanent empty time-read card. Carried: the pace cell half blank (`emptyRatio` 0.48); the range bucket label wraps at 390; finished rows show no days-to-finish (shown only when the API sends a start date); the shelf cell stretches at 390. **New:** with time-read gone the Finished list takes the left half of its row and leaves the right half empty at 1440; lost fact — the histogram bucket labels dropped `★`, so two rows of bare numbers sit under the bars. Unscored: month group heads print a bare count with no noun.
- **Against Keel:** does not yet — two half-empty regions.

### Wave 28 round (`w28-r1`, live after #112–#116 on basalt-ui 2.21.0)

- **Reviewer:** fail. Fixed: bucket labels carry `★`; Finished spans the full row at 1440; month heads read `{n} books`; the shelf cell no longer stretches at 390 (2.21.0). Carried: the pace cell half blank (`emptyRatio` 0.51 on 2.21.0 — basalt row); range bucket labels at 390 no longer wrap but run into each other; no days-to-finish on finished rows (only when the API sends a start date). Unscored: `≈ {h} h to read` names no pace; backlog focus crops under the sticky bar (harness).
- **Against Keel:** does not yet — the pace cell is half blank beside the histogram.

### Wave 29 round (`w29-r1`, live after #117–#121 on basalt-ui 2.21.0)

- **Reviewer:** fail. Fixed: the backlog names its pace (`≈ {h} h to read at {p} pages/h`); 390 range bucket labels no longer run into each other. Carried: the pace cell half blank (`emptyRatio` 0.51 — basalt row); no days-to-finish on finished rows (the API sends no start date for them). **New:** none. Unscored: one bucket reads `{a}–{b} ★` at 1440 but `{a} ★` at 390, which reads as a whole-star bucket; the backlog focus crop under the bottom nav (harness).
- **Against Keel:** does not yet — the pace cell is still half blank beside the histogram.

### Wave 30 fixes

- Rating bucket label: fixed — the label keeps its range at every width: `{a}–{b} ★` wide, `{a}–{b}` at compact (no glyph, no space) so the 390 labels do not collide; the ratings cell caption carries the unit (`Ratings (★)`).
- Not fixed (basalt / no API field): pace cell half blank, no days-to-finish on finished rows.

Follow-up (w30-r1):

- **`last read {n} months ago` split the number from its unit** — fixed: `lastReadFact` (`reading/model.ts`) binds a leading number to its unit with a no-break space; `ago` stays breakable.

Follow-up (w30-r2):

- **`last read` / `{n} months ago` split** — fixed: `lastReadFact` glues `last read {n} {unit}` as one run; `ago` stays breakable.

### Wave 30 round (`w30-r1`, live after #122–#125; `w30-r2` / `w30-r3` after #126–#128, basalt-ui 2.21.0)

- **Reviewer (r1):** fail. Fixed: the rating buckets keep their range at every width (`{a}–{b}` at 390, the caption names the star unit), no labels running together. **New (r1), fixed in #126/#128:** `last read {n} {unit} ago` split number from unit, then `last read` from the number — glued as one run (dark 1440; 390 unverified, no anchor on that row; the light 1440 pass rendered the pre-#128 bundle). Carried: the pace cell half blank at 1440 (`emptyRatio` 0.51 — basalt row); no days-to-finish on finished rows (no API field); the backlog focus crop under the bottom nav (harness). Unscored: the mono `★` renders as a small asterisk-like glyph.
- **Against Keel:** does not yet — the pace cell is still half blank beside the histogram.

### Wave 31 round (`w31-r1`, live after #129–#133 on basalt-ui 2.22.0; `w31-r2` after the follow-ups)

- **Reviewer:** **pass, for the first time.** Fixed: the pace cell under the empty-ratio line by measure (0.14, from 0.51 — the 2.22 cell box ends at its content; visually the column is still half blank, P2 basalt); the rating axis `★` in the body face; `last read {n} {unit} ago` whole. New (basalt, P2): the shelf bar ~40 px below its hero. Carried: the mono `★` in the caption; slashed zeros. No lost fact.
- **Against Keel:** does not yet — the pace column is still a blank half beside the histogram.

### Wave 32 round (`w32-r1`, live after #134–#138 on basalt-ui 2.22.0, the first round with declared shot states)

- **Reviewer:** fail on basalt-only P0s. Changed only by the state attributes: `empty` declared on `finished` (a rest anchor absent in empty), the real `Your shelf is empty` branch cropped as `empty-shelf`; progress, finished, backlog and time-read declare themselves absent. **New (basalt):** the `StatGroup` strip's cell anchors (`strip-<key>`) vanish under `empty` with no way to declare `data-shot-absent`, so 12 error shots. Carried (basalt): the pace column a blank half beside the histogram; the shelf bar floating under its hero; the mono `★`; slashed zeros. No lost fact.
- **Against Keel:** does not yet — the pace column is still a blank half beside the histogram.

### Wave 33 round (`w33-r1`, live after #139–#143 on basalt-ui 2.22.0)

- **Reviewer:** fail on basalt-only P0s; not changed this round. Carried (basalt): the `StatGroup` strip-cell anchors error under `empty` (12 shots, no way to declare `data-shot-absent`); the pace column a blank half beside the histogram; the mono `★`; slashed zeros. `empty-shelf` passes (cause + when the data arrives). No lost fact.
- **Against Keel:** does not yet — the pace column is still a blank half.

### Wave 34 round (`w34-r1`, live after #144–#147 on basalt-ui 2.22.0; `w34-r2` after #148)

- **Reviewer:** fail (basalt only); untouched this round. Carried (basalt): the strip-cell anchors error under `empty` (12 shots); the pace column a blank half beside the histogram; the mono `★`; slashed zeros. `empty-shelf` passes. No lost fact.
- **Against Keel:** does not yet — the pace column is still a blank half at 1440.

### Wave 35 round (`w35-r1`, live after #149–#151 on basalt-ui 2.22.0)

- **Reviewer:** fail (basalt only). The 12 error shots are the strip-cell `data-shot-absent` row only (three strip cells × `empty` × four variants). Carried (basalt): at 1440 the pace column is a blank half beside the histogram; the mono `★` and slashed zeros. Unscored (argo, P3): the rating bins `1 / 2–2.5 / 3 / 4 / 5 ★` cover the half steps unevenly. No lost fact.
- **Against Keel:** does not yet — the pace cell is a bare figure over a blank half; every Keel tile carries a visual.
- **Re-score `w35-r2` (after basalt-ui 2.23.0 and `shotAbsent`, #152):** pass on the page; components fail on basalt rows only. **Closed:** the strip-cell P0 (0 error shots, the strip cells read `absent` under `empty`). Not closed (basalt): the pace cell's blank half at 1440; mono `★` and slashed zeros in mono counts (by identity). The uneven rating bins (argo, P3) are unchanged. No lost fact.

### Wave 36 round (`w36-r1`, live after #153–#155 on basalt-ui 2.23.0; `w36-r2` after #156–#158)

- **Reviewer (`w36-r1`):** pass, untouched. Carried: the pace cell's blank half at 1440 (basalt, P3); the rating bins covering half steps unevenly (argo, P3). No lost fact.
- **Against Keel:** does not yet — the pace tile has no visual, where every Keel tile carries one.

### Wave 37 concept (round 16)

- **Question:** how fast do I read, and how much do my books differ? Decision: is the median a fair ETA for the next book, or do the books spread too far for one figure to hold.
- **Dataset shape:** a small list of per-book paces (`pace.paces`, pages/h, ascending, `{n}` books) with one median; ratings are half steps `0.5`–`5`, `{n}` rated.
- **Encoding:** pace is a tick distribution on a slowest-to-fastest axis, books at one displayed pace sharing a tick whose height grows with the count, the median drawn full height in ink; the axis ends carry `slowest {a}` and `fastest {b}`, so the range footer is subtracted. One book, or all books at one pace, has no span: no axis is drawn and the footer states it. Ratings keep the five-bar histogram, but every bar now holds exactly two half steps, `(i, i + 1]` (`0.5`, `1` → bar 1; `4.5`, `5` → bar 5), the mean marker at `mean / 5` on the same 0…5 track.
- **Why:** with a handful of books a histogram of pace bins would be mostly empty bars; ticks show every book and its spread, and the median says where the figure sits inside it.
- **Keel pattern:** a stat cell whose micro-visual is fitted to its data (`stat-cell`), as the shelf Meter and the ratings histogram already are.
