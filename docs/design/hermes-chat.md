# Hermes Chat — concept

Route `/hermes-chat` · `apps/dashboard/src/routes/hermes-chat.tsx`, `apps/dashboard/src/features/hermes-chat/` (`chat-page.tsx`, `hermes-row.tsx`, `threads-store.ts`) · API `GET /hermes/threads`, `GET /hermes/threads/:id/messages` (thread messages), `GET /hermes/chat/:id/stream` (resume), `POST /hermes/chat/:id/stop`, `GET /hermes/health`.

## Baseline verdict

Shot: `hermes-chat--dark--desktop.png` (no per-card crops exist; the page is one list plus a composer). The open-thread view is not in the baseline; this concept covers the list and the thread header only and leaves the message renderer (markdown, smart cards, diagrams, voice) untouched.

- The list is full-width rows of the same height with a trailing chevron; five consecutive rows read `New chat` (threads with `title: null`, never titled), so a third of the screen is identical.
- Type badges (`TODO`, `INFRA`) are the only differentiator and are tiny; the summary line is a 140-character sentence truncated mid-word.
- Relative time is German (`vor 4 Monaten`, `vorgestern`) in an otherwise English UI, and months-old threads are not grouped; there is no sense of "today".
- No count anywhere: not how many threads, how many pinned, whether any is streaming, whether Hermes is up.
- The composer is fine and stays.

**Distance from bar: 3/5.** Dense and functional, but a single undifferentiated list with no grouping, no counts and no state.

## The question and the decision

Question: which conversation do I pick back up, and is anything still running?
Decision: resume a thread, start a new one, or clean up dead ones.

## Datasets and encodings

| Dataset | Source | Shape (SPEC §3) | Today | Chosen | Reason | Keel |
|-|-|-|-|-|-|-|
| Threads by recency | `threads[].updated_at`, `pinned`, `title`, `summary`, `type` | Event sequence | Flat rows, relative German time | `EventList` day groups: `Pinned · 3`, `Today · 2`, `This week · 4`, `Earlier · 38`; row: type chip, title, one-line summary, mono time pinned right (`14:22` today, `12 Oct` older) | Day groups give rhythm; absolute short times scan faster than "4 Monaten" | `activity-item.png`, `timeline-event.png` |
| Untitled threads | `title == null` (any `summary`) | List of references | 5 rows `New chat` | Every thread with `title: null` folds into one disclosure row `5 untitled chats · oldest 4 months` with one action `Delete all`; expanding it lists them with `Untitled · <time>`. No row in the main list reads `New chat` | Empty threads are noise; one row, one decision | `empty-state.png` |
| Type distribution | `threads[].type` (todo, podcast, infra, note, research, general) | Part of a whole, 2–6 parts | 6 types only as row badges | Filter toolbar: neutral outline chips with counts (`All 47`, `infra 12`, …), active chip filled | The distribution is the filter; no chart needed | `filter-toolbar.png` |
| Live turn | `threads[].streaming` | Status | Not shown | Pulse dot in the row and `Live` marker in the group heading while true | Streaming is the only thing that changes while the page is open | `status-pill.png` |
| Hermes reachability | `GET /hermes/health` | Status | Not shown | Status dot + `Hermes reachable` / `degraded` in the `PageBar` meta | Explains why a send will fail before it does | `page-header.png` |
| Thread record | `thread.created_at/updated_at`, `type`, `title`, `session_id` | An entity with facts | Title only | Record header: title, type chip, one mono facts line `started 3 Oct · last reply 14:22`, one overflow menu (pin, archive, delete); `session_id` hidden behind the menu | One primary surface above the messages; destructive actions stay quiet | `record-header.png` |
| Composer | n/a | Form | Input + headset, mic, send icons, hint line | Unchanged; hint line stays | Works as is | — |

## Layout

1440: `PageBar` (title, health dot, `New chat` primary only on the empty state since the composer already starts one). Summary sentence. Filter toolbar with type counts and a search field. `EventList` filling the scroll region, groups as above. Composer pinned at the bottom as today. Thread view: record header, messages, composer.

390: rows become two lines (chip + title; summary clamped to one line) with time on the title line; filter chips scroll horizontally; composer sticky with the safe-area inset; record header collapses facts to `<time> · <type>`.

Stay: composer, message renderer, voice, thread stream behaviour. Change: list rows, grouping, header. Go: chevrons, repeated `New chat` rows, German relative time (use the app locale: English).

## Copy

- Summary: `47 threads · 3 pinned · 2 today · last reply 14:22` (illustrative figures; counts are derived client-side from the loaded list)
- Groups: `Pinned · 3`, `Today · 2`, `This week · 4`, `Earlier · 38`
- Disclosure: `5 untitled chats · oldest 4 months`
- Header facts: `Started 3 Oct · last reply 14:22 · infra`
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
