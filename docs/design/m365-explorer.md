# M365 Explorer — concept

Route `/m365-explorer` · `apps/dashboard/src/routes/m365-explorer.tsx`, `apps/dashboard/src/features/m365-explorer/explorer-page.tsx` (one 824-line file) · API `GET /m365/chats`, `/m365/teams`, `/m365/teams/:id/channels`, `.../messages`, `GET|POST /m365/labels`, `DELETE /m365/labels/{sourceId}`, `GET /m365/important`.

## Baseline verdict

Shots: `m365-explorer--dark--desktop.png` (5904 px tall at 2x), crops `m365-explorer--dark--01-card.png` (label chips), `02-card.png` (source list), `03-card.png` (empty preview).

- A two-sentence intro paragraph sits above everything and narrates the page ("Browse your Teams chats and channels, then star the ones…"), including a file path and an endpoint. This is the banned narration-of-the-UI filler.
- Tag chips (`{tag} · {n}`, …) are all gold: every tag, one hue, no meaning for the colour. Beneath them the labelled sources are wrapped chip-cards, each with a tag chip, a name, a star and a trash button: roughly {n} cards × 3 controls above the fold.
- The source list is {n_chats} chats then {n_teams} teams in one 3000 px column, each row a truncated name, a type badge, a truncated last message and an absolute date. No grouping by recency, no separation of chats from teams.
- The right pane is empty at 1440: `Pick a chat or channel on the left to preview its latest messages.` plus `{n} sources labeled so far`, which is half the page spent on a placeholder.
- Header carries two buttons (`Refresh chats + channels`, `Manage tags ({n})`), the second in the accent fill.

**Distance from bar: 5/5.** Furthest of the four: an admin-tool layout with filler copy, colour without meaning, an empty half-page, and no counts or scale for any dataset.

## The question and the decision

Question: which of my Teams sources carry signal, and which of those do the agents already see?
Decision: label (or unlabel) a chat or channel so it feeds `GET /m365/important` for the agents.

## Datasets and encodings

| Dataset | Source | Shape (SPEC §3) | Today | Chosen | Reason | Keel |
|-|-|-|-|-|-|-|
| Coverage | `labels[]` count vs labelable sources: chats + channels (`/m365/chats`, `/m365/teams/:id/channels` summed over the teams; a team itself is not labelable, `kind` is `chat` or `channel`) | Progress (one bounded ratio) | `{n} sources labeled so far` | Strip cell `LABELED` `{n}` + muted `of <n> chats + channels`, linear `Meter` 0–`<n>` (skeleton until the per-team channel counts load), no target tick (there is no target) | A ratio of a known total, not a score | `stat-cell.png` |
| Source kinds | `chats[].chatType` (oneOnOne, group, meeting), teams | Part of a whole, 2–6 parts | Per-row badges only | Strip cell `CHATS · {n}` with a segmented bar `1:1 · group · meeting` and captions; second cell `TEAMS · {n}` | The mix is visible without scanning {n} badges | `metric-card-bar.png` |
| Labels by tag | `labels[].label`, `/m365/labels` | Distribution | {n} gold chips with counts | Filter toolbar: neutral outline chips with counts, active chip filled in the accent, `Manage` as a quiet trailing action | A filter, not a status; tag hue is not earned | `filter-toolbar.png` |
| Labelled sources | `labels[{sourceId,kind,label,displayName}]` | List of references | Wrapped chip-cards with star + trash | Default state of the right pane: list grouped by tag, heading `{tag} · {n}`, rows with glyph (chat or channel), display name, tag chip, one remove action on hover | Turns the empty pane into the page's main surface; one control per row | `side-panel-card.png` |
| Chats by recency | `chats[].lastUpdatedAt`, `chatType`, `topic`, `members`, `lastMessagePreview` | Event sequence | Flat list, absolute dates | `EventList`-style rows grouped `Today · n`, `This week · n`, `Earlier · n`: glyph by `chatType`, name, one muted meta line `meeting · {n} members`, mono time pinned right, a star only when labelled | Recency is the reason to open a chat | `activity-item.png` |
| Teams and channels | `/m365/teams`, `/teams/:id/channels` | Tree (entity with children) | {n} team rows with description | Segmented control `Chats {n} | Teams {n}` replaces the stacked lists; team row expands to its channels (`membershipType` as meta) | One list at a time halves the scroll | `nav-item.png` |
| Source preview | `GET .../messages`: `from.name`, `createdDateTime`, `bodyText`, `importance`, `replyCount`, `webUrl` | Event sequence | Empty on load | Record header (name, kind chip, facts `meeting · {n} members · last message {time}`, one primary `Label as…` split-button with the tag select), then an `EventList` of messages: sender + mono time on line one, body clamped to 3 lines, `high` importance as a status dot, `replyCount` as a muted chip for channels | The user labels a source after seeing it, in one place | `record-header.png`, `timeline-event.png` |
| Agent feed | `GET /m365/important?label=&top=&limit=` → `messages[{source, sourceId, label, displayName, notes, message{id, createdAt, from, subject, importance, bodyText, webUrl, replyCount, isSystem}}]`, newest first, `top` per source (max 20) | Event sequence | Not shown | A third tab `Agent feed` rendering exactly that response for the active tag with the same message rows; each row's meta line adds the label and the source's `notes` | Shows the consequence of a label | `timeline-event.png` |
| Refresh | the two list queries | Action | Labelled button | Ghost icon-button with a mono fact `synced {age} ago` (query `dataUpdatedAt`) | Facts instead of a verb in a button | `page-header.png` |

## Layout

1440: `PageBar` (title, refresh with sync age). Summary sentence. Strip of 3 cells (Labeled, Chats, Teams). Toolbar: `Chats | Teams | Agent feed` segmented control, tag filter chips with counts, search. Two columns: source list (5 cols, internal scroll, sticky toolbar) and the right pane (7 cols) showing labelled sources grouped by tag until a source is selected, then the record header + messages.

390: single column; the strip is 3 compact cells in one row, the source list is the page and tapping a row pushes the preview as a full-screen sheet with a back affordance; the labelled-sources view is the empty-selection state of the sheet and a `Labeled · {n}` filter chip on the list.

Stay: the label API behaviour, the manage-tags dialog. Change: everything above the list and the empty pane. Go: the intro paragraph, the gold chips, the wrapped labelled-source cards, the stacked chats + teams list, the placeholder sentence.

## Copy

Format is binding; figures are placeholders.

- Summary: `{n} of {total} chats and channels labeled across {n} tags · {n} chats, {n} teams · latest activity {date} {time}`
- Cells: `LABELED · {n} of {total} chats + channels`, `CHATS · {n} · 1:1 {n} · group {n} · meeting {n}`, `TEAMS · {n} · {n} channels`
- Group headings: `{tag} · {n}`, `{tag} · {n}`, `Today · {n}`, `This week · {n}`, `Earlier · {n}`
- Row meta: `meeting · {n} members`, `team channel · standard`
- Empty state (no labels): `No labeled sources — label a chat to include it in /m365/important`; empty search: `No chats match "<query>"`
- Refresh: `synced {age} ago`

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

## Wave 22 rounds

Shots on live data via `basalt-ui shot` (r1–r3, 1440 / 390, light / dark) plus a scratch Playwright pass (gitignored) for the states `shot` cannot click: record view, label menu, agent feed, teams tree, mobile sheet. Scored by a fresh `basalt-design-reviewer` each round.

- **r1 (baseline of the rebuild, own read only):** summary, strip, chips, master–detail all present. Failed on my read: card insets broke the full-bleed toolbar and produced stray scrollbars; labeled rows carried free-text notes as meta. Changed: panes became `Card.Section` bodies; meta is the kind only.
- **r2 reviewer: fail (strip, chips, source list, labeled pane, mobile, page).** Failed: 4 font sizes in strip cells; segmented-meter segments too close to the track; active chip accent; truncated titles; rows not in recency order and weekday-only times; bare values in the 390 strip; summary restating the tabs and cells. Changed: segment alphas stepped, titles wrap to 2 lines, rows sorted newest first with `{weekday} {day}`, summary reduced to the labeled/total/tags sentence plus latest activity, mobile keeps the unit.
- **r3 reviewer: fail (strip-labeled, strip-chats, source-list, tag-chips, detail-pane, labeled-pane, page); pass: strip-teams.** Fixed and confirmed: recency order, wrapped titles, contrast (no failures). Still failing: active-chip accent (basalt law, see deviations), 4 distinct font sizes in two cells (Meter caption 11 / unit 13 / Meter 15 / value 22, Meter-owned), the Meeting segment still close to the track, remove control visible only on hover/focus, summary still restating the strip. One `source-list` mobile focus shot and one first-load of the light desktop page timed out (harness flake: some Graph channel lists answer in 5–10 s).
- **r4 (changes only, no reviewer round):** active chip became neutral (ink fill), segment alphas 0.9 / 0.6 / 0.3, labeled cell carries the noun on desktop (hidden below 480 px), paragraph margins removed. Verified by the scratch Playwright pass; not re-scored.

## Wave 22 deviations kept from the concept

- Active tag chip is neutral (ink fill), not accent: the reviewer cited the basalt "selection never takes the accent" rule and `DESIGN.md` carries no delta for it. Pass criterion 3 (accent on the active chip) is therefore deliberately not met.
- The remove control on a labeled-source row stays hover/focus-only (criterion 5) and is always visible on coarse pointers; the reviewer reads this as hover-only data (craft rule 7).
- The labeled-source row carries no tag chip: the group heading already names the tag.
- The summary sentence keeps the labeled count and the total (criterion 2) and drops the chat/team counts the concept listed, since the tabs repeat them.
- View, tag filter and search live in a `createLocalStore` inside the feature (`store.ts`), not a search store in `lib/window-stores.ts`, which is outside this page's owned files; the view is not URL-addressable.
- The search filter and the view tabs sit in the `PageBar` slots (the controls law), not inside the list pane's toolbar; the tag chips are local buttons in the pane toolbar.
- Labelable total counts the 50 most recent chats the page loads, plus every channel.

## Wave 22 friction

| Export | Needed prop | argo case | What argo does instead |
|-|-|-|-|
| `StatusDot` | exported dot with a status tone | high-importance message marker | local `.dot` in `m365.module.css` filled `--vx-status-warn` |
| `Meter` | `tone="muted"` and distinct-by-construction segment steps | Labeled / Chats strip cells | `alpha(VX.muted, a)` per segment; the third step stays close to the track |
| `Meter` | a neutral, compact caption size | strip cells read four font sizes (11 / 13 / 15 / 22) | accepted; the Meter owns the 15 |
| `StatGroup` | `variant="strip"` with a compact (3-on-one-row) mode | 3-cell strip at 390 | local `.strip` / `.cell` grid, visual and footer hidden below 480 px |
| `EventList` | glyph slot, hover-only trailing control, day groups | source list and labeled-by-tag pane | local `SourceRow` (`source-row.tsx`: glyph, name, meta, mono time, star, hover remove) |
| `ViewTabs` | per-option count slot | `Chats {n} / Teams {n}` | the count is baked into the option label |
| `FilterSet` / `MultiSelectFilter` | counted neutral chips | tag filter | local `TagChips` (`tag-chips.tsx`) |
| (none) | master–detail shell with a mobile push sheet | list + record pane, 390 sheet | local grid in `m365.module.css`, `Drawer` in `preview-drawer.tsx` |
| (none) | `createLocalStore` fields with dynamic values | tag filter | `field.string` for tag and search |

Local prototypes built: `source-row.tsx` (`glyph`, `name`, `meta`, `time`, `selected`, `starLabel`, `expanded`, `child`, `onSelect`, `onRemove`, `removing`), `tag-chips.tsx` (`active`, `total`, `labeled`, `tagCounts`, `onChange`), `strip.tsx` (`ExplorerStrip`), `label-button.tsx` (split button: `existing`, `tags`, `saving`, `onSave`, `onRemove`), `preview-drawer.tsx` (`opened`, `onClose`).
