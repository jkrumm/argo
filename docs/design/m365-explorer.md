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
- **r4 reviewer (scored, after the orchestrator's rulings and the code-review fixes): pass — strip-teams, tag-chips, detail-pane, labeled-pane, page; fail — strip-labeled, strip-chats (a visually-hidden 15 px Meter reading made four font sizes on the desktop cells), source-list (one focus shot timed out).** Confirmed fixed: the 390 labeled cell reads "of {n} sources", the summary adds latest activity / chats active in 7 days / tags in use, Meeting is distinct from Group and the track, groups read Today / Last 7 days / Earlier newest first, chip counts are scoped to the active view.
- **r5 reviewer (scored): pass — strip-labeled, strip-chats, strip-teams, tag-chips, detail-pane, labeled-pane, page (scored cells only); fail — source-list.** Strip cells measure three sizes (11 / 13 / 22) after the cell's `.visual` container set 13 px for the Meter's hidden text. Failed: titles wrap to a second line at 390 (kept: ellipsis was the r2 failure), and two focus shots timed out. The dark-desktop page and its anchors timed out on load, so every dark-desktop cell is unscored in r5 (it was scored in r4).
- **Harness note:** a `--wait 20000` settle plus staggering the per-team channel calls (four ahead of the settled count) captured the light-desktop page that timed out in r1–r3. The `source-list` focus shot still times out in a different cell each run (`boundingBox: Timeout 30000ms`); the focus ring was seen in the cells that did capture.

## Wave 22 code-review fixes (round 1)

- Labeled count is the intersection with the loaded chat and channel ids, so it can never exceed the total; labels outside the set are stated ("{n} outside this set"), and the 50-chat basis is stated when the chat list is capped.
- A failed channel list reads "≥{n}" with a team-failed line and Retry; the team row says "channels failed to load" and expands to a Retry.
- Chip counts are scoped to the active view and equal the rows that chip reveals; unknown is "—".
- A persisted tag that no longer exists falls back to "all".
- A failed label or tag write shows inline (record header, tags modal), not silently. A registry toast needs a kind in `lib/notifications.ts`, outside this page's owned files.
- Pending state is scoped to the mutated source / tag.
- Search matches every member name and channel names (a team auto-expands to its matching channels) and is disabled in the Agent feed view.
- Times use `APP_LOCALE`; the groups and the row times share one reference time (when the chats were fetched); rows sort by parsed time; "This week" became "Last 7 days".
- The feed keeps its previous data across tag changes.
- Channel lists load four teams ahead of the settled count, and Sync no longer re-fires every team's list.
- The label panel is a Popover (inputs keep their own keyboard handling) with Copy source id kept from the old page; the mobile sheet has one back affordance; the notes comparison is trimmed on both sides.

## Wave 22 code-review fixes (round 2, scope frozen)

- Recency and time labels compare against the one reference time (`isSameDay(d, now)`), so no test or render reads the system clock.
- An active "Labeled" filter always renders its chip; a failed remove from the labeled pane shows its error there; a write error clears when the selection changes.
- A filtered team row reads `{k} of {n} channels`.
- The label panel's Escape closes only the panel (not the mobile sheet) and its Tab order reaches an in-panel apply button; verified in a browser at 390.
- Bug found while verifying: the detail pane was not hidden below 800 px (CSS rule order), so the record rendered under the list as well as in the sheet. Fixed by ordering `.detailPane` after `.pane`.

## Wave 22 deviations kept from the concept

- Active tag chip is neutral (ink fill), not accent: basalt's "selection never takes the accent" rule wins over criterion 3 (owner ruling).
- The remove control on a labeled-source row stays hover/focus-only (criterion 5) and is always visible on coarse pointers: an action, not data (owner ruling).
- The labeled-source row carries no tag chip: the group heading already names the tag.
- The summary sentence carries latest activity, chats active in the last 7 days and tags in use; the labeled count and total live in the strip, so criterion 2 is met by the strip cell, not the sentence (owner ruling: do not restate the strip).
- View, tag filter and search live in a `createLocalStore` inside the feature (`store.ts`), not a search store in `lib/window-stores.ts`, which is outside this page's owned files; the view is not URL-addressable.
- The search filter and the view tabs sit in the `PageBar` slots (the controls law), not inside the list pane's toolbar; the tag chips are local buttons in the pane toolbar.
- Labelable total counts the 50 most recent chats the page loads, plus every channel.

## Wave 22 friction

| Export | Needed prop | argo case | What argo does instead |
|-|-|-|-|
| `StatusDot` | exported dot with a status tone | high-importance message marker | local `.dot` in `m365.module.css` filled `--vx-status-warn` |
| `Meter` | `tone="muted"` and distinct-by-construction segment steps | Labeled / Chats strip cells | `alpha(VX.muted, a)` per segment; the third step stays close to the track |
| `Meter` | a visually-hidden reading that does not add a font size | the hidden reading inherited the body 15 px | `.visual` sets 13 px on the container |
| `StatGroup` | `variant="strip"` with a compact (3-on-one-row) mode | 3-cell strip at 390 | local `.strip` / `.cell` grid, visual and footer hidden below 480 px |
| `EventList` | glyph slot, hover-only trailing control, day groups | source list and labeled-by-tag pane | local `SourceRow` (`source-row.tsx`: glyph, name, meta, mono time, star, hover remove) |
| `ViewTabs` | per-option count slot | `Chats {n} / Teams {n}` | the count is baked into the option label |
| `FilterSet` / `MultiSelectFilter` | counted neutral chips | tag filter | local `TagChips` (`tag-chips.tsx`) |
| (none) | master–detail shell with a mobile push sheet | list + record pane, 390 sheet | local grid in `m365.module.css`, `Drawer` in `preview-drawer.tsx` |
| (none) | `createLocalStore` fields with dynamic values | tag filter | `field.string` for tag and search |

Local prototypes built: `source-row.tsx` (`glyph`, `name`, `meta`, `time`, `selected`, `starLabel`, `expanded`, `child`, `onSelect`, `onRemove`, `removing`), `tag-chips.tsx` (`active`, `total`, `labeled`, `tagCounts`, `onChange`), `strip.tsx` (`ExplorerStrip`), `label-button.tsx` (split button: `existing`, `tags`, `saving`, `onSave`, `onRemove`), `preview-drawer.tsx` (`opened`, `onClose`).

## Wave 23 rounds

Live production shots (`basalt-ui shot`, 1440 + 390, both schemes) after the basalt-ui 2.20.0 adoption (#81–#84), scored each round by a fresh `basalt-design-reviewer` plus a side-by-side against Keel. Boards: `.design-shots/w23-r1-*` and `w23-r2-*` (gitignored).

- **r1:** fail. source-list rows wrapped at 390; fragmented right-pane scrollbar; the `Labeled` chip scope disagreed with the strip; zero-count chips; an unlabelled three-part meter.
- **Fixed between rounds (#88):** one-line rows at 390 (meta included), a single ScrollArea per pane, a scoped `Labeled {scope}` chip, zero-count chips dropped only once counts are settled, meter parts named in the footer.
- **r2:** fail: the labeled pane still shows a fragmented thumb; `LABELED` is an adjective, not a noun; the detail and labeled panes are unreachable at 390 (shot errors).
- **Against Keel:** close to Keel's records list, rougher.
- **Open for Wave 24:** panes reachable at 390, one scroll region, a noun for the labeled cell.

### Wave 24 fixes

- Headline: the `Text` summary replaced by `PageSummary`; `headlineOf` (tested): `{n} chats active in the last 7 days`, facts `{n} labeled · {n} tags in use · latest activity {stamp}`.
- Scrollbar: the sticky group headings (z-index 1) painted over the `ScrollArea` scrollbar and cut its thumb; the scrollbar is lifted to z-index 2 in the source list and the labeled pane. One `ScrollArea` per pane, none nested.
- Strip: the cell caption is the noun `Labeled sources`; the unit reads `of {total}`.
- 390: the detail and labeled panes were `display: none` below 800 px. A phone now gets a `Section` whose `tabs` slot holds a `ViewTabs` pane switch (`Sources` / `Labeled {n}` / `Detail`, the `pane` field of `explorerStore`; `ViewTabs` is refused outside a `tabs` slot) and shows one pane at a time; picking a source opens `Detail`, closing the record returns to `Sources`. The drawer (`preview-drawer.tsx`) is deleted. `data-shot="source-list"`, `labeled-pane` and `detail-pane` resolve once their pane is open; the pane is local state, not a URL param, because `lib/nav.tsx` links the route without search and is not an owned file (a shot has to click the tab).

| Export | Needed prop | argo case | What argo does instead |
|-|-|-|-|
| `createSearchStore` | optional-search route typing | a `pane` URL param on a route whose nav link carries no search | `createLocalStore` field |
| `Section` | untitled variant (no `title`) | a phone pane switch needs only the `tabs` slot | `Section` titled with the open pane's name |

### Wave 24 round (`w24-r1`, live after #90–#95)

- **Reviewer:** fail: the headline's `{n} labeled` disagrees with the strip's `{n−1} of {total}` and the caption `1 outside this set` does not say which set; the phone `Sources` heading restates the select beside it; row hover is invisible in light; the detail and labeled panes still declare no 390 anchors, so they are unmeasured there. Harness: one source-list focus crop timed out (light 390, a tall anchor).
- **Against Keel:** close — calm strip and headline; the Teams cell has no visual, the right pane groups by tag with no facts, rows all one weight.

### Wave 25 fixes

- One labeled count: `labeledCount(coverage)` feeds the headline and the strip (labels inside the loaded chats and channels; the headline omits the fact while a team loads).
- Strip footer names the set: `{n} labels on chats or channels not in this list` (`outsideNote`, tested).
- Phone `Sources` heading restated the pane switch: the title is now a fact per view (`{n} chats`, `{n} channels in {m} teams`, `{n} labeled sources`; `sourcesTitle`, tested).
- 390 anchors: the labeled pane's phone wrapper declares `data-shot="labeled-pane-phone"` (the detail wrapper already declares `detail-pane`).
- Row hover: `--vx-surface-panel-hover` is lighter than the panel in light mode (basalt itself notes the step is imperceptible), so rows use a 6 % `--vx-ink` wash, 9 % when selected.

| Export | Needed prop / default | argo case | What argo does instead |
|-|-|-|-|
| `VX.surface.rowHover` / `rowSelected` | a hover and a selected surface that reads in both schemes | list rows in light mode: `panelHover` is lighter than `panel` | a `color-mix` ink wash in the module CSS |
| `Section` | untitled variant (repeat) | the phone pane title restates the tab | a fact as the title |
