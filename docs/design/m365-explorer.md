# M365 Explorer — concept

Route `/m365-explorer` · `apps/dashboard/src/routes/m365-explorer.tsx`, `apps/dashboard/src/features/m365-explorer/explorer-page.tsx` (one 824-line file) · API `GET /m365/chats`, `/m365/teams`, `/m365/teams/:id/channels`, `.../messages`, `GET|POST /m365/labels`, `DELETE /m365/labels/{sourceId}`, `GET /m365/important`.

## Baseline verdict

Shots: `m365-explorer--dark--desktop.png` (5904 px tall at 2x), crops `m365-explorer--dark--01-card.png` (label chips), `02-card.png` (source list), `03-card.png` (empty preview).

- A two-sentence intro paragraph sits above everything and narrates the page ("Browse your Teams chats and channels, then star the ones…"), including a file path and an endpoint. This is the banned narration-of-the-UI filler.
- Tag chips (`DAILY · 2`, `TEAM · 2`, …) are all gold: seven tags, one hue, no meaning for the colour. Beneath them the labelled sources are wrapped chip-cards, each with a tag chip, a name, a star and a trash button: roughly 9 cards × 3 controls above the fold.
- The source list is 24 chats then 13 teams in one 3000 px column, each row a truncated name, a type badge, a truncated last message and an absolute date. No grouping by recency, no separation of chats from teams.
- The right pane is empty at 1440: `Pick a chat or channel on the left to preview its latest messages.` plus `9 sources labeled so far`, which is half the page spent on a placeholder.
- Header carries two buttons (`Refresh chats + channels`, `Manage tags (7)`), the second in the accent fill.

**Distance from bar: 5/5.** Furthest of the four: an admin-tool layout with filler copy, colour without meaning, an empty half-page, and no counts or scale for any dataset.

## The question and the decision

Question: which of my Teams sources carry signal, and which of those do the agents already see?
Decision: label (or unlabel) a chat or channel so it feeds `GET /m365/important` for the agents.

## Datasets and encodings

| Dataset | Source | Shape (SPEC §3) | Today | Chosen | Reason | Keel |
|-|-|-|-|-|-|-|
| Coverage | `labels[]` count vs labelable sources: chats + channels (`/m365/chats`, `/m365/teams/:id/channels` summed over the 13 teams; a team itself is not labelable, `kind` is `chat` or `channel`) | Progress (one bounded ratio) | `9 sources labeled so far` | Strip cell `LABELED` `9` + muted `of <n> chats + channels`, linear `Meter` 0–`<n>` (skeleton until the per-team channel counts load), no target tick (there is no target) | A ratio of a known total, not a score | `stat-cell.png` |
| Source kinds | `chats[].chatType` (oneOnOne, group, meeting), teams | Part of a whole, 2–6 parts | Per-row badges only | Strip cell `CHATS · 24` with a segmented bar `1:1 · group · meeting` and captions; second cell `TEAMS · 13` | The mix is visible without scanning 24 badges | `metric-card-bar.png` |
| Labels by tag | `labels[].label`, `/m365/labels` | Distribution | 7 gold chips with counts | Filter toolbar: neutral outline chips with counts, active chip filled in the accent, `Manage` as a quiet trailing action | A filter, not a status; tag hue is not earned | `filter-toolbar.png` |
| Labelled sources | `labels[{sourceId,kind,label,displayName}]` | List of references | Wrapped chip-cards with star + trash | Default state of the right pane: list grouped by tag, heading `alerts · 1`, rows with glyph (chat or channel), display name, tag chip, one remove action on hover | Turns the empty pane into the page's main surface; one control per row | `side-panel-card.png` |
| Chats by recency | `chats[].lastUpdatedAt`, `chatType`, `topic`, `members`, `lastMessagePreview` | Event sequence | Flat list, absolute dates | `EventList`-style rows grouped `Today · n`, `This week · n`, `Earlier · n`: glyph by `chatType`, name, one muted meta line `meeting · 4 members`, mono time pinned right, a star only when labelled | Recency is the reason to open a chat | `activity-item.png` |
| Teams and channels | `/m365/teams`, `/teams/:id/channels` | Tree (entity with children) | 13 team rows with description | Segmented control `Chats 24 | Teams 13` replaces the stacked lists; team row expands to its channels (`membershipType` as meta) | One list at a time halves the scroll | `nav-item.png` |
| Source preview | `GET .../messages`: `from.name`, `createdDateTime`, `bodyText`, `importance`, `replyCount`, `webUrl` | Event sequence | Empty on load | Record header (name, kind chip, facts `meeting · 4 members · last message 09:56`, one primary `Label as…` split-button with the tag select), then an `EventList` of messages: sender + mono time on line one, body clamped to 3 lines, `high` importance as a status dot, `replyCount` as a muted chip for channels | The user labels a source after seeing it, in one place | `record-header.png`, `timeline-event.png` |
| Agent feed | `GET /m365/important?label=&top=&limit=` → `messages[{source, sourceId, label, displayName, notes, message{id, createdAt, from, subject, importance, bodyText, webUrl, replyCount, isSystem}}]`, newest first, `top` per source (max 20) | Event sequence | Not shown | A third tab `Agent feed` rendering exactly that response for the active tag with the same message rows; each row's meta line adds the label and the source's `notes` | Shows the consequence of a label | `timeline-event.png` |
| Refresh | the two list queries | Action | Labelled button | Ghost icon-button with a mono fact `synced 12m ago` (query `dataUpdatedAt`) | Facts instead of a verb in a button | `page-header.png` |

## Layout

1440: `PageBar` (title, refresh with sync age). Summary sentence. Strip of 3 cells (Labeled, Chats, Teams). Toolbar: `Chats | Teams | Agent feed` segmented control, tag filter chips with counts, search. Two columns: source list (5 cols, internal scroll, sticky toolbar) and the right pane (7 cols) showing labelled sources grouped by tag until a source is selected, then the record header + messages.

390: single column; the strip is 3 compact cells in one row, the source list is the page and tapping a row pushes the preview as a full-screen sheet with a back affordance; the labelled-sources view is the empty-selection state of the sheet and a `Labeled · 9` filter chip on the list.

Stay: the label API behaviour, the manage-tags dialog. Change: everything above the list and the empty pane. Go: the intro paragraph, the gold chips, the wrapped labelled-source cards, the stacked 24 + 13 list, the placeholder sentence.

## Copy

Format is binding; figures other than the baseline ones are illustrative.

- Summary: `9 of <n> chats and channels labeled across 7 tags · 24 chats, 13 teams · latest activity 16 Oct 09:56`
- Cells: `LABELED · 9 of <n> chats + channels`, `CHATS · 24 · 1:1 6 · group 5 · meeting 13`, `TEAMS · 13 · <n> channels`
- Group headings: `alerts · 1`, `daily · 2`, `Today · 3`, `This week · 8`, `Earlier · 13`
- Row meta: `meeting · 4 members`, `team channel · standard`
- Empty state (no labels): `No labeled sources — label a chat to include it in /m365/important`; empty search: `No chats match "<query>"`
- Refresh: `synced 12m ago`

## Upstream candidates

- `StatGroup variant="strip"` with `Meter` segments inside cells: planned strip + `Meter`.
- `EventList` rows with a glyph slot and a trailing star control: planned `EventList` (§4, wave 37).
- Filter toolbar with counted chips and a segmented control: maps to the `BasaltDataTable` toolbar recipe (§4, wave 36); new as a standalone for list pages (argo: Hermes, M365).
- Master–detail shell (list pane + record pane with an empty state that carries real content, mobile push sheet): new; used by M365, Hermes thread list and Warden.
- Record header: §4 record-page recipe.

## Pass criteria

1. No paragraph of narration above the content; no placeholder sentence in the right pane at 1440.
2. The page summary sentence contains the labeled count and the total source count.
3. Tag chips are neutral; the accent appears only on the active filter chip and the primary action.
4. Chats and teams are never stacked in one scroll column; the list has day group headings with counts.
5. Each row carries at most one control (star or remove); trash buttons are not visible at rest.
6. Selecting a source shows a record header with a facts line and a message list with mono times.
7. At 390 px the preview opens as a sheet and the strip fits on one row.
8. No chat names, member names or message text appear in this document or its commits; only the shot's structure does.
