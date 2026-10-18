# Hermes Chat — concept

Route `/hermes-chat` · `apps/dashboard/src/routes/hermes-chat.tsx`, `apps/dashboard/src/features/hermes-chat/` (`chat-page.tsx`, `hermes-row.tsx`, `threads-store.ts`) · API `GET /hermes/threads`, `GET /hermes/threads/:id/messages` (thread messages), `GET /hermes/chat/:id/stream` (resume), `POST /hermes/chat/:id/stop`, `GET /hermes/health`.

## Baseline verdict

Shot: `hermes-chat--dark--desktop.png` (no per-card crops exist; the page is one list plus a composer). The open-thread view is not in the baseline; this concept covers the list and the thread header only and leaves the message renderer (markdown, smart cards, diagrams, voice) untouched.

- The list is full-width rows of the same height with a trailing chevron; {n} consecutive rows read `New chat` (threads with `title: null`, never titled), so much of the screen is identical.
- Type badges (`TODO`, `INFRA`) are the only differentiator and are tiny; the summary line is a long sentence truncated mid-word.
- Relative time is German (`vor {n} Monaten`, `vorgestern`) in an otherwise English UI, and months-old threads are not grouped; there is no sense of "today".
- No count anywhere: not how many threads, how many pinned, whether any is streaming, whether Hermes is up.
- The composer is fine and stays.

**Distance from bar: 3/5.** Dense and functional, but a single undifferentiated list with no grouping, no counts and no state.

## The question and the decision

Question: which conversation do I pick back up, and is anything still running?
Decision: resume a thread, start a new one, or clean up dead ones.

## Datasets and encodings

| Dataset             | Source                                                           | Shape (SPEC §3)            | Today                                       | Chosen                                                                                                                                                                                                                     | Reason                                                                      | Keel                                      |
| ------------------- | ---------------------------------------------------------------- | -------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------- |
| Threads by recency  | `threads[].updated_at`, `pinned`, `title`, `summary`, `type`     | Event sequence             | Flat rows, relative German time             | `EventList` day groups: `Pinned · {n}`, `Today · {n}`, `This week · {n}`, `Earlier · {n}`; row: type chip, title, one-line summary, mono time pinned right (`HH:mm` today, `D Mon` older)                                  | Day groups give rhythm; absolute short times scan faster than "{n} Monaten" | `activity-item.png`, `timeline-event.png` |
| Untitled threads    | `title == null` (any `summary`)                                  | List of references         | {n} rows `New chat`                         | Every thread with `title: null` folds into one disclosure row `{n} untitled chats · oldest {age}` with one action `Delete all`; expanding it lists them with `Untitled · <time>`. No row in the main list reads `New chat` | Empty threads are noise; one row, one decision                              | `empty-state.png`                         |
| Type distribution   | `threads[].type` (todo, podcast, infra, note, research, general) | Part of a whole, 2–6 parts | 6 types only as row badges                  | Filter toolbar: neutral outline chips with counts (`All {n}`, `infra {n}`, …), active chip filled                                                                                                                          | The distribution is the filter; no chart needed                             | `filter-toolbar.png`                      |
| Live turn           | `threads[].streaming`                                            | Status                     | Not shown                                   | Pulse dot in the row and `Live` marker in the group heading while true                                                                                                                                                     | Streaming is the only thing that changes while the page is open             | `status-pill.png`                         |
| Hermes reachability | `GET /hermes/health`                                             | Status                     | Not shown                                   | Status dot + `Hermes reachable` / `degraded` in the `PageBar` meta                                                                                                                                                         | Explains why a send will fail before it does                                | `page-header.png`                         |
| Thread record       | `thread.created_at/updated_at`, `type`, `title`, `session_id`    | An entity with facts       | Title only                                  | Record header: title, type chip, one mono facts line `started {date} · last reply {time}`, one overflow menu (pin, archive, delete); `session_id` hidden behind the menu                                                   | One primary surface above the messages; destructive actions stay quiet      | `record-header.png`                       |
| Composer            | n/a                                                              | Form                       | Input + headset, mic, send icons, hint line | Unchanged; hint line stays                                                                                                                                                                                                 | Works as is                                                                 | —                                         |

## Layout

1440: `PageBar` (title, health dot, `New chat` primary only on the empty state since the composer already starts one). Summary sentence. Filter toolbar with type counts and a search field. `EventList` filling the scroll region, groups as above. Composer pinned at the bottom as today. Thread view: record header, messages, composer.

390: rows become two lines (chip + title; summary clamped to one line) with time on the title line; filter chips scroll horizontally; composer sticky with the safe-area inset; record header collapses facts to `<time> · <type>`.

Stay: composer, message renderer, voice, thread stream behaviour. Change: list rows, grouping, header. Go: chevrons, repeated `New chat` rows, German relative time (use the app locale: English).

## Copy

- Summary: `{n} threads · {n} pinned · {n} active today · last reply {time}` (plus `{n} untitled` when the fold is non-empty) (counts are derived client-side from the loaded list)
- Groups: `Pinned · {n}`, `Today · {n}`, `This week · {n}`, `Earlier · {n}`
- Disclosure: `{n} untitled chats · oldest {age}`
- Header facts: `Started {date} · last reply {time} · {type}`
- Health: `Hermes reachable` / `Hermes degraded · replies may fail`
- Composer placeholder stays `Message Hermes — starts a new chat…`

## Upstream candidates

- `EventList` `{ groups: {label, count}[], rows: {chips, title, meta, time, live?}[] }` with the time column pinned right, maps to planned `EventList` (§4, wave 37).
- Filter toolbar with counted chips (`{label, count, active}[]`), maps to the §3 "table filter" recipe in `BasaltDataTable`, but needs a standalone use here; check before proposing as new.
- Record header (title, chip, facts line, overflow), maps to the §4 record-page recipe.

## Pass criteria

1. The list is grouped by `Pinned` / `Today` / `This week` / `Earlier`, each heading carrying a count.
2. No row in the main list reads `New chat`; every `title: null` thread sits in one disclosure row with a count.
3. All times are English; today's rows show `HH:mm`, older rows `D Mon`.
4. A streaming thread shows a pulse dot; Hermes health shows as a dot with a word.
5. The summary sentence contains the live thread count and the last reply time.
6. No trailing chevrons; rows are one or two lines at every width.
7. At 390 px the composer stays visible and the filter chips scroll instead of wrapping into more than one line.

## Wave 22 rounds

Shot harness: `basalt-ui shot` against live data (dist + `/api` proxy), `/hermes-chat` and `/hermes-chat?thread={id}`, dark/light × 1440/390. The live account held {n} threads with none pinned, none from today and none streaming, so the `Pinned` / `Today` groups, the pulse dot, `Live` and the degraded health copy were never on a shot; they are covered by `thread-list-model.test.ts` only.

- **r1 (self read, no reviewer):** the row's own header still showed (basalt sets `display: block` inline) and the first lines sat under the shell header. Hid the header with `!important`, added top padding, replaced the labelled back button with an icon button at 390.
- **r2 (reviewer):** list page fail, record header fail. Failed: 9 px chip, off-scale button padding, type shown twice, `All {n}` not matching the visible rows, `Delete all` scope unclear. Changed: untitled count in the summary, `Delete all untitled`, type dropped from the wide facts line, same-day start/reply dedupe.
- **r3 (reviewer):** record header fail, list page fail. Failed: 9 px chip, date-less facts line at 390, chips not summing to `All`. Changed: `Untitled {n}` chip that filters to the fold, dated facts.
- **r4 (reviewer):** all four fail. Failed: chip still 9 px (Badge ignored the size var), list body unanchored, mid-word summary cut, 390 facts ambiguous. Changed: plain mono type chip, `data-shot` on list and toolbar, summary shown in full in the record header, `last reply {time}` at 390.
- **r5 (reviewer):** pages pass, `thread-summary` pass; `thread-toolbar`, `thread-list`, `thread-record-header` fail. Failed: clipped focus rings, four font sizes in the list, mid-word summary cut in rows, mono labels in the facts line. After the round (not re-shot): facts line set in sans, focus ring inset, toolbar padding for the ring.
- **r6 (reviewer):** `thread-summary`, `thread-list`, `thread-record-header` and both pages pass; `thread-toolbar` fails (chip focus ring clipped by the scroll area). Changed before this round: list reduced to three font sizes (the chip shares the meta size, `Delete all untitled` is `compact-sm`). Row summaries end in an ellipsis; the ellipsis clamp is accepted by design.
- **r7 (reviewer):** all four anchors and both pages pass. Fix: padding inside the chip scroller so the focus ring is whole. Code review round 1 fixes landed between r6 and r7 (pinned and fresh untitled threads stay out of the fold, `Archived {n}` chip and Unarchive, chip counts equal the rows they reveal, success-gated navigation, partial-delete toast, calendar-day week boundary with a minute tick) and are part of the r7 shots.
- **Converged at r7.** Superseded: the paragraph below describes r5.
- **Not converged (as of r5):** five rounds used. Open: the row summary is clamped mid-sentence by design (the full text sits in the open thread header); the list uses four font sizes (title 15, summary 13, chip/time 11, group caption 11/12).

## Wave 22 friction

| Export               | Needed prop                                                               | argo case                                          | What argo does instead                                                                  |
| -------------------- | ------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `PageBar`            | a `meta` slot for a status dot and word                                   | Hermes reachability beside the title               | a `kind: 'custom'` action with `primary: true` (the type demands one primary)           |
| `EventList`          | day groups with a `Live` heading marker and a right-pinned time (wave 37) | thread list                                        | `thread-list.tsx` (local, below)                                                        |
| Counted filter chips | `{label, count, active}[]` standalone toolbar                             | type filter plus `Untitled`                        | `thread-toolbar.tsx` (local, below)                                                     |
| `ThreadFeedRow`      | a `hideHeader` / headerless mode                                          | the open thread has its own record header          | CSS `display: none !important` on the header slot (basalt sets `display: block` inline) |
| `createSearchStore`  | route search keys optional on links                                       | `?thread=` must not force `search` on the nav link | route `validateSearch` input typed `Partial<…> & SearchSchemaInput`                     |
| `StatusDot`          | root export                                                               | health dot                                         | local 8 px dot (`hermes-health.tsx`); it exists in `theme/` but is not exported         |

Local prototypes: `features/hermes-chat/thread-list.tsx` (`ThreadList{groups: {key, label, rows, live}[], untitled, now, busy, foldOpen, onOpen, onDeleteUntitled}`, the `EventList` shape with a fold), `thread-toolbar.tsx` (`ThreadToolbar{total, typeCounts, untitledCount, type, query, onType, onQuery}`), `thread-record-header.tsx` (`ThreadRecordHeader{entry, now, busy, onBack, onPin, onArchive, onDelete}`, the record-page recipe).

## Wave 22 deviations from the concept

- Health sits in the `PageBar` as a custom action, not a meta slot; `New chat` is not offered (the composer starts a chat).
- Archived threads sit behind an `Archived {n}` chip (shown only when n > 0); the record-header menu offers Unarchive there.
- An untitled thread that is streaming or not yet persisted stays in the main list under its first line instead of the fold.
- Opening a thread is a `?thread=` URL param (push), replacing inline expansion.

## Wave 23 rounds

Live production shots (`basalt-ui shot`, 1440 + 390, both schemes) after the basalt-ui 2.20.0 adoption (#81–#84), scored each round by a fresh `basalt-design-reviewer` plus a side-by-side against Keel. Boards: `.design-shots/w23-r1-*` and `w23-r2-*` (gitignored).

- **r1:** fail. the summary sat flush under the header; a date split at 390; mono uppercase type chips.
- **Fixed between rounds (#89):** a top inset, no-wrap dates, quiet sentence-case pills on `--vx-surface-subtle`.
- **r2:** **pass** — every component and the page.
- **Against Keel:** weaker than Keel: a page-height void under three rows, pills faint in light, no headline.
- **Open for Wave 24:** pills visible in light; Pinned / Today / streaming states still never on a live shot.

### Wave 24 fixes

- Headline: the dimmed summary line replaced by `PageSummary`; `summaryHeadline` (tested): `{n} threads, {m} today`, facts `{n} untitled · {n} pinned · last reply {time}`. `summaryParts` deleted.
- Type pills: text `--vx-ink2` on a 9 % `--vx-ink` wash (tokens only), replacing muted on `--vx-surface-subtle`, which vanished against the light card.

### Wave 24 round (`w24-r1`, live after #90–#95)

- **Reviewer:** pass: every component except the thread-list hover, which is invisible in light (dark tints the row).
- **Against Keel:** does not yet — three rows then an empty page above the composer; title and summary run together on one line.

### Wave 25 fixes

- Thread-list row hover: a 6 % `--vx-ink` wash replaces `--vx-surface-panel-hover` (lighter than the panel in light mode, so invisible).
- Row layout: title on its own line, muted summary on the line beneath; the narrow container-query layout is gone because one stacked layout fits both widths.
- List end note: under an unfiltered list, `That is every thread: {n} threads since {date}, plus {m} archived` when the server's `total` is covered, else `{loaded} of {total} threads, back to {date}` (the list request is capped; `total` is threaded through `useHermesThreads`; `listEndNote`, tested at the cap). A short list reads as complete rather than empty.

### Wave 25 round (`w25-r1`, live after #96–#101)

- **Reviewer:** fail (was pass). Fixed: light row hover. Open: a summary cut mid-word at 1440; no chip hover; the thread count three times (subtitle, chip, footer) and the list-end note restates the headline.
- **Against Keel:** does not yet — three rows, then an empty page.

### Wave 26 round (`w26-r1`, live after #102–#106)

- **Reviewer:** fail. Fixed: summaries end at a word at 1440; the thread total printed once. Carried: no chip hover. **New:** the headline's `in the last 7 days` restates the `This week` group count under another window name; the headline opens on a zero. Unscored: the untitled count printed three times; a `0 pinned` fact; row times touch the right edge (dark desktop); summaries cut mid-word at 390.
- **Against Keel:** does not yet — three rows, then a void above the composer.

### Wave 27 round (`w27-r1`, live after #107–#111)

- **Reviewer:** fail. Fixed: no restated `This week` count, no opening zero, no `0 pinned`; the untitled count printed once; row times inside the edge; summaries end at a word at 390. Carried: no chip hover. **New:** a row title cut mid-word at 390 (whole in w26); the fold row `{n} untitled chats · oldest {age} ago` orphans `ago` at 390; the `Untitled` chip lost its count while every sibling keeps one, so the chips no longer add up to `All {n}`. Unscored: the footer's `Oldest thread started {date}` repeats the last row's date beside a second "oldest" in the fold.
- **Against Keel:** does not yet — three rows and a fold, then a void above the composer.

### Wave 28 round (`w28-r1`, live after #112–#116 on basalt-ui 2.21.0)

- **Reviewer:** fail. Fixed: the `Untitled {n}` chip has its count, the chips add up to `All {n}`; the fold no longer orphans `ago`; row titles at 390 end at a word. Carried: chips have no hover (basalt `Button`); the complete-list footer `First thread {date}` still sits beside the fold's `oldest {age}` (reworded, not removed). Unscored: the headline `Nothing running` carries no figure or scope.
- **Against Keel:** does not yet — three rows and a fold over a void above the composer.

### Wave 29 round (`w29-r1`, live after #117–#121 on basalt-ui 2.21.0)

- **Reviewer:** fail. Fixed: the headline carries the running count and the thread total; `First thread {date}` stays and the fold's `oldest {age}` is gone. Carried: chips without hover (basalt). **New:** the fold row is the bare word `Untitled` (its count lives only in the chip).
- **Against Keel:** does not yet — three rows and a fold over a void above the composer.

### Wave 30 fixes

- **Fold row bare `Untitled`:** fixed — the fold label is `{n} untitled chats` (`untitledFoldLabel`, tested; page vocabulary is "chats"). The count is read from the rows the fold holds, so it matches what opens.

### Wave 30 round (`w30-r1`, live after #122–#125 on basalt-ui 2.21.0)

- **Reviewer:** fail. Fixed: the fold row names what it folds (`{n} untitled chats`), its count matching the chip. Carried: chips without hover (basalt `Button`). **New:** none. Unscored: the untitled count now appears twice (chip and fold).
- **Against Keel:** does not yet — three rows and a fold over a void above the composer.

### Wave 31 round (`w31-r1`, live after #129–#133 on basalt-ui 2.22.0; `w31-r2` after the follow-ups)

- **Reviewer:** fail. Fixed: the untitled count said once (the chip); the fold row reads `Untitled chats`. Carried: chips without hover (basalt `Button`). No lost fact.
- **Against Keel:** does not yet — three rows and a fold over a void above the composer.

### Wave 32 fixes

- **Shot states:** `thread-toolbar` declares `empty`; an empty thread list is substituted so the real no-threads note renders (`thread-empty`), and `thread-list` is absent there. `loading` and `error` are not declared: the route loader awaits the threads, so production shows the route pending screen / crash screen.
- **Against Keel:** no subtraction removes the void above the composer without adding UI; left.

### Wave 32 round (`w32-r1`, live after #134–#138 on basalt-ui 2.22.0, the first round with declared shot states)

- **Reviewer:** fail. Fixed: the empty branch declared (`thread-toolbar`), `thread-empty` says what to do, `thread-list` absent in empty. Unscored (argo): with no threads the toolbar still shows an `All 0` chip and a search field; at 390 every title ellipsizes after a few words while its summary gets two lines. Carried: chips without hover (basalt). No lost fact.
- **Against Keel:** does not yet — the void between the last row and the composer.

### Wave 33 fixes (round 12)

- **No threads:** the toolbar (the `All 0` chip and the search field) renders only when a thread exists; the list's own note carries the state. `thread-toolbar` stays the declaring anchor and is absent under `empty`.
- **At 390:** the title wraps to two lines (cut at a word past ~52 characters) and the summary holds to one.

### Wave 33 round (`w33-r1`, live after #139–#143 on basalt-ui 2.22.0)

- **Reviewer:** fail (basalt only). Fixed: with no threads the toolbar (`All 0` chip, search) is absent; `thread-empty` says what is missing and what to do; at 390 titles wrap to two lines and summaries hold one. **New (argo, P2):** at 390 the leading tag column takes ~a quarter of the row, so a one-line summary shows ~four words — the reviewer counts that as a lost fact against w32's two summary lines. Carried (basalt): filter chips without hover. Unscored: the composer placeholder wraps at 390.
- **Against Keel:** does not yet — three rows and a fold over a void above the composer.
