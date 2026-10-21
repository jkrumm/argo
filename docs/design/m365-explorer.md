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

| Dataset            | Source                                                                                                                                                                                                                                   | Shape (SPEC §3)              | Today                                | Chosen                                                                                                                                                                                                                                                                                                                 | Reason                                                                                             | Keel                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Coverage           | `labels[]` count vs labelable sources: chats + channels (`/m365/chats`, `/m365/teams/:id/channels` summed over the teams; a team itself is not labelable, `kind` is `chat` or `channel`)                                                 | Progress (one bounded ratio) | `{n} sources labeled so far`         | Strip cell `LABELED` `{n}` + muted `of <n> chats + channels`, linear `Meter` 0–`<n>` (skeleton until the per-team channel counts load), no target tick (there is no target)                                                                                                                                            | A ratio of a known total, not a score                                                              | `stat-cell.png`                           |
| Source kinds       | `chats[].chatType` (oneOnOne, group, meeting), teams                                                                                                                                                                                     | Part of a whole, 2–6 parts   | Per-row badges only                  | Strip cell `CHATS · {n}` with a segmented bar `1:1 · group · meeting` and captions; second cell `TEAMS · {n}`                                                                                                                                                                                                          | The mix is visible without scanning {n} badges                                                     | `metric-card-bar.png`                     |
| Labels by tag      | `labels[].label`, `/m365/labels`                                                                                                                                                                                                         | Distribution                 | {n} gold chips with counts           | Filter toolbar: neutral outline chips with counts, active chip filled in the accent, `Manage` as a quiet trailing action                                                                                                                                                                                               | A filter, not a status; tag hue is not earned                                                      | `filter-toolbar.png`                      |
| Labelled sources   | `labels[{sourceId,kind,label,displayName}]`                                                                                                                                                                                              | List of references           | Wrapped chip-cards with star + trash | Default state of the right pane: list grouped by tag, heading `{tag} · {n}`, rows with glyph (chat or channel), display name, tag chip, one remove action on hover                                                                                                                                                     | Turns the empty pane into the page's main surface; one control per row                             | `side-panel-card.png`                     |
| Chats by recency   | `chats[].lastUpdatedAt`, `chatType`, `topic`, `members`, `lastMessagePreview`                                                                                                                                                            | Event sequence               | Flat list, absolute dates            | `EventList`-style rows grouped `Today · n`, `This week · n`, `Earlier · n`: glyph by `chatType`, name, one muted meta line `meeting · {n} members`, mono time pinned right, a star only when labelled                                                                                                                  | Recency is the reason to open a chat                                                               | `activity-item.png`                       |
| Teams and channels | `/m365/teams`, `/teams/:id/channels`                                                                                                                                                                                                     | Tree (entity with children)  | {n} team rows with description       | Segmented control `Chats {n}                                                                                                                                                                                                                                                                                           | Teams {n}` replaces the stacked lists; team row expands to its channels (`membershipType` as meta) | One list at a time halves the scroll      | `nav-item.png` |
| Source preview     | `GET .../messages`: `from.name`, `createdDateTime`, `bodyText`, `importance`, `replyCount`, `webUrl`                                                                                                                                     | Event sequence               | Empty on load                        | Record header (name, kind chip, facts `meeting · {n} members · last message {time}`, one primary `Label as…` split-button with the tag select), then an `EventList` of messages: sender + mono time on line one, body clamped to 3 lines, `high` importance as a status dot, `replyCount` as a muted chip for channels | The user labels a source after seeing it, in one place                                             | `record-header.png`, `timeline-event.png` |
| Agent feed         | `GET /m365/important?label=&top=&limit=` → `messages[{source, sourceId, label, displayName, notes, message{id, createdAt, from, subject, importance, bodyText, webUrl, replyCount, isSystem}}]`, newest first, `top` per source (max 20) | Event sequence               | Not shown                            | A third tab `Agent feed` rendering exactly that response for the active tag with the same message rows; each row's meta line adds the label and the source's `notes`                                                                                                                                                   | Shows the consequence of a label                                                                   | `timeline-event.png`                      |
| Refresh            | the two list queries                                                                                                                                                                                                                     | Action                       | Labelled button                      | Ghost icon-button with a mono fact `synced {age} ago` (query `dataUpdatedAt`)                                                                                                                                                                                                                                          | Facts instead of a verb in a button                                                                | `page-header.png`                         |

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

| Export                            | Needed prop                                               | argo case                                   | What argo does instead                                                                 |
| --------------------------------- | --------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------- |
| `StatusDot`                       | exported dot with a status tone                           | high-importance message marker              | local `.dot` in `m365.module.css` filled `--vx-status-warn`                            |
| `Meter`                           | `tone="muted"` and distinct-by-construction segment steps | Labeled / Chats strip cells                 | `alpha(VX.muted, a)` per segment; the third step stays close to the track              |
| `Meter`                           | a visually-hidden reading that does not add a font size   | the hidden reading inherited the body 15 px | `.visual` sets 13 px on the container                                                  |
| `StatGroup`                       | `variant="strip"` with a compact (3-on-one-row) mode      | 3-cell strip at 390                         | local `.strip` / `.cell` grid, visual and footer hidden below 480 px                   |
| `EventList`                       | glyph slot, hover-only trailing control, day groups       | source list and labeled-by-tag pane         | local `SourceRow` (`source-row.tsx`: glyph, name, meta, mono time, star, hover remove) |
| `ViewTabs`                        | per-option count slot                                     | `Chats {n} / Teams {n}`                     | the count is baked into the option label                                               |
| `FilterSet` / `MultiSelectFilter` | counted neutral chips                                     | tag filter                                  | local `TagChips` (`tag-chips.tsx`)                                                     |
| (none)                            | master–detail shell with a mobile push sheet              | list + record pane, 390 sheet               | local grid in `m365.module.css`, `Drawer` in `preview-drawer.tsx`                      |
| (none)                            | `createLocalStore` fields with dynamic values             | tag filter                                  | `field.string` for tag and search                                                      |

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

| Export              | Needed prop                   | argo case                                                      | What argo does instead                     |
| ------------------- | ----------------------------- | -------------------------------------------------------------- | ------------------------------------------ |
| `createSearchStore` | optional-search route typing  | a `pane` URL param on a route whose nav link carries no search | `createLocalStore` field                   |
| `Section`           | untitled variant (no `title`) | a phone pane switch needs only the `tabs` slot                 | `Section` titled with the open pane's name |

### Wave 24 round (`w24-r1`, live after #90–#95)

- **Reviewer:** fail: the headline's `{n} labeled` disagrees with the strip's `{n−1} of {total}` and the caption `1 outside this set` does not say which set; the phone `Sources` heading restates the select beside it; row hover is invisible in light; the detail and labeled panes still declare no 390 anchors, so they are unmeasured there. Harness: one source-list focus crop timed out (light 390, a tall anchor).
- **Against Keel:** close — calm strip and headline; the Teams cell has no visual, the right pane groups by tag with no facts, rows all one weight.

### Wave 25 fixes

- One labeled count: `labeledCount(coverage)` feeds the headline and the strip (labels inside the loaded chats and channels; the headline omits the fact while a team loads).
- Strip footer names the set: `{n} labels on chats or channels not in this list` (`outsideNote`, tested).
- Phone `Sources` heading restated the pane switch: the title is now a fact per view (`{n} chats`, `{n} channels in {m} teams`, `{n} labeled sources`; `sourcesTitle`, tested).
- 390 anchors: the labeled pane's phone wrapper declares `data-shot="labeled-pane-phone"` (the detail wrapper already declares `detail-pane`).
- Row hover: `--vx-surface-panel-hover` is lighter than the panel in light mode (basalt itself notes the step is imperceptible), so rows use a 6 % `--vx-ink` wash, 9 % when selected.

| Export                                | Needed prop / default                                     | argo case                                                     | What argo does instead                   |
| ------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------- |
| `VX.surface.rowHover` / `rowSelected` | a hover and a selected surface that reads in both schemes | list rows in light mode: `panelHover` is lighter than `panel` | a `color-mix` ink wash in the module CSS |
| `Section`                             | untitled variant (repeat)                                 | the phone pane title restates the tab                         | a fact as the title                      |

### Wave 25 round (`w25-r1`, live after #96–#101)

- **Reviewer:** fail. Fixed: light row hover; the phone Sources heading. Open: `1 label on chats or channels not in this list` still names no list; `{n} labeled` vs the chip `Labeled chats {m}`; chats/teams cells restate the tab counts; detail and labeled panes still not captured at 390 (the anchor did not register); the labeled pane has no title; no hover on labeled rows or tag chips. Harness: a source-list focus crop timed out.
- **Against Keel:** close — Keel's rows carry real columns; every count here is printed three or four times.

### Wave 26 round (`w26-r1`, live after #102–#106)

- **Reviewer:** fail. Fixed: the labeled pane has a title, hover and its remove action; the chip names its scope; chats/teams cells no longer restate the tab counts; **the 390 labeled and detail panes are captured for the first time** (shot with a `basalt:m365-explorer` pane preset). Carried: the out-of-list label note still names neither the list nor the reason; tag chips have no hover. **New:** the detail and labeled panes at four sizes (the new pane title is the fourth); `Chats by kind` is a bare number list with a zero `Other` row. Unscored: the headline restates the `Last 7 days` list count; every labeled row carries the meta word `chat`; at 390 the section title restates the pane select and the labeled count sits in the strip and the select. Not verified: the detail pane with a source open at 390 (the preset opens it empty); three focus timeouts.
- **Against Keel:** close — the strip cells are plain text and counts still repeat.

### Wave 27 round (`w27-r1`, live after #107–#111)

- **Reviewer:** fail. Fixed: the panes at two type sizes; `Chats by kind` a segmented bar with worded parts, no zero row; no headline restating the list count; no `chat` meta word; the 390 section title no longer restates the select. Carried: the out-of-list note still names neither list nor reason; tag chips have no hover. **New:** the `Chats by kind` hero value is a dash although the footer counts every part; the headline `Latest activity {date}, {time}` restates the top row's time; the 390 labeled title `Grouped by tag` describes the layout. Unscored: the `Chats {n}` tab and `All {n}` chip print one count; at 390 the strip is 2 + 1 cells. Not verified: two focus timeouts; the 390 detail pane with a source open.
- **Against Keel:** close — the headline and the chats cell say less than Keel's people list.

### Wave 28 round (`w28-r1`, live after #112–#116 on basalt-ui 2.21.0)

- **Reviewer:** fail. Fixed: the `Chats by kind` hero is a value; the headline no longer restates the top row's time; the 390 labeled title no longer describes the layout; the `Chats` tab no longer repeats the `All {n}` count. Carried: the out-of-list note names neither list nor reason (`… on sources no longer listed`, says less than w27); tag chips have no hover; the 390 strip is 2 + 1 cells. **New:** the headline `Chats span {n} d` names neither end; the kind bar's hero part is its last segment but printed first, the footer drops it, the segments are shade-only; the 390 title `Labeled sources` restates its select value `Labeled`. Unscored: `{n} 1:1 chats` puts two numerals side by side; pane rows show no hover and the remove control appears on focus only. Not verified: the 390 labeled header; the 390 detail pane with a source open (the preset opens it empty); one focus timeout.
- **Against Keel:** does not yet — a span with no dates, a kind bar that needs a legend.

### Wave 29 round (`w29-r1`, live after #117–#121 on basalt-ui 2.21.0)

- **Reviewer:** fail. Fixed: the headline names the span with both end dates; the kind bar's hero first, the footer lists the other parts in segment order; the 390 title no longer restates its select; the out-of-list note names list and reason; the remove control visible at full opacity. Carried: kind-bar segments shade-only (the footer still acts as its legend); tag-chip hover and the 390 2 + 1 strip (basalt); three focus timeouts (harness). **New:** the remove control now shows at rest on every labeled row — against pass criterion 5 and the Wave 22 owner ruling (hover/focus only; the fix should have been a muted token on hover/focus, not at rest); the 390 headline breaks the start date from its year. Not verified: the 390 detail pane with a source open; the labeled header.
- **Against Keel:** close (was does not yet) — the span has its dates; the kind bar still needs its footer as a legend.

### Wave 30 fixes

- **Remove control at rest:** fixed — hidden at rest on fine pointers (`opacity: 0`, still in the tab order and labelled), revealed in the muted token on row hover, `:focus-within` and keyboard focus; always visible (muted) on coarse pointers (`@media (any-pointer: coarse)`), per the Wave 22 ruling.
- **390 headline date split:** fixed — every space inside a date is `NBSP` (day, month and year); only the spaces around the range dash can break. `spanDates` in `model.ts`, tested.

### Wave 30 round (`w30-r1`, live after #122–#125 on basalt-ui 2.21.0)

- **Reviewer:** fail (no new argo defect). Fixed: the remove control hidden at rest on fine pointers, visible on focus, always visible on coarse pointers (the Wave 22 ruling); the 390 headline keeps each date whole. Carried: kind-bar segments shade-only (basalt `SegmentBar` row); the 390 2 + 1 strip (basalt); two source-list focus timeouts and the 390 labeled header not captured (harness); the 390 detail pane opens empty. Unverified: the hover reveal (the harness hovers the pane, not a row). Unscored: the scrollbar thumb through the labeled-pane header.
- **Against Keel:** close — the kind bar still needs its footer as a legend.

### Wave 31 round (`w31-r1`, live after #129–#133 on basalt-ui 2.22.0; `w31-r2` after the follow-ups)

- **Reviewer:** fail. Fixed: `Chats by kind` labels each segment under the bar (2.22 `size="row"` captions), so the footer legend is deleted with no count lost; row hover/selected on basalt's row surfaces; the source-list focus timeouts are gone. **New:** the kind caption restates the hero's count (argo); the 1440 page shot is ~1.7k px with ~640 px empty under the panes (argo or harness); a light 390 capture mid-load (harness). Carried: tag-chip hover (basalt); labeled-row hover unverifiable (harness); the 390 2 + 1 strip (basalt); the scrollbar through the pane header; the 390 detail pane with a source open not verified.
- **Against Keel:** close — Keel's rows carry real columns and its page has no dead space.

### Wave 32 fixes

- **Shot states:** `tag-chips` declares `empty`; no chats / teams / labels is substituted where the page reads them, so the real empty list and labeled pane render. `loading` and `error` are not declared: the route loader awaits the lists, so production shows the route pending screen / crash screen.
- **Kind caption:** the leading kind's bar caption names the kind without its count — the hero holds the count. On a tie every caption keeps its count.
- **Page height:** the panes are `min(760px, 100dvh − 240px)`, independent of their content; the ~640 px of dead space under them in the 1440 page shot is the harness growing the inner scrollport (`100dvh` follows it), not argo sizing the page taller than its content. Left as is.
- **Scrollbar through the pane header:** argo-owned and fixed — the labeled pane's header sat inside its `ScrollArea`; it now sits above it, so the scrollbar starts under the header.

### Wave 32 round (`w32-r1`, live after #134–#138 on basalt-ui 2.22.0, the first round with declared shot states)

- **Reviewer:** fail. Fixed: the `Chats by kind` lead caption no longer restates the hero's count (`{kind}`; the rest keep `{kind} {n}`, a tie keeps every count); the labeled pane has one root with its header above the scroll area, so the scrollbar starts under the header; the light 390 mid-load capture is gone; `empty` declared (the two phone presets' remaining `craft-7` fixed after the shot in `69568a6`). **New (argo, empty state):** the unfiltered source list reads `No chats yet` with no reason or next step, while the labeled pane beside it gives both; the labeled cell draws a blank track with `Labeled 0 · Unlabeled 0` under `0 of 0`. Unscored: the `Labeled {n}` caption repeats the hero's `{n} of {total}` (the restatement just fixed in `Chats by kind`); `no channels` repeats `0 channels`; the labeled row's focus ring sits flush on the pane edge with the remove control outside it. Carried: tag-chip hover (basalt); row hover unverifiable (harness hovers the pane); the 390 labeled header not captured (harness); the 390 2 + 1 strip (basalt); the ~640 px empty band under the panes at 1440 (owner unproven); the 390 detail pane with a source open not verified.
- **Against Keel:** close — Keel's rows carry real columns; ours are name + meta + time.

### Wave 33 fixes (round 12)

- **One empty pattern:** `No chats yet — Microsoft 365 returned none; refresh to retry` (and the same for teams) matches the labeled pane's `{what} — {next step}` shape.
- **Labeled cell:** with nothing to label the cell states it once (`Nothing to label — no chats or channels came back; refresh to retry`) instead of a blank track under `0 of 0`.
- **No restatement:** the labeled meter's lead caption is `Labeled` (the hero holds `{n} of {total}`); on a tie both captions keep their count. The channels footer drops `no channels` when the hero reads `0 channels`.
- **Focus ring:** a source row's focus ring is inset, so it no longer sits flush on the pane edge.
- **Basalt, no workaround:** tag-chip hover, the 390 2 + 1 strip.

### Wave 33 round (`w33-r1`, live after #139–#143 on basalt-ui 2.22.0)

- **Reviewer:** fail. Fixed: the empty source list reads `{what} — {cause}; {next step}`; the empty labeled cell says the absence once with no blank track; the lead caption is a bare `Labeled`; `no channels` is gone beside `0 channels`. **Not fixed / unverified:** the source-row focus ring (the focus crop lands on the `All {n}` chip; on the labeled pane the ring still sits ~1 px off the pane edge with the remove control outside it). **New (argo):** the chats cell under `empty` is `—` over `no chats` with no cause or next step, and the channels cell a bare `0 channels` — three spellings for one gap across the strip; the 390 detail pane's `Pick a chat or channel in Sources to open it` points at an empty list; an `All 0` chip above the empty list (the pattern Hermes dropped this round); the empty list pane ~90 % blank. Carried: tag-chip hover (basalt); the 390 2 + 1 strip (basalt); the 390 labeled header and the detail pane with a source open not captured (harness); the ~640 px band under the panes at 1440. Unscored: the phone preset crop clips the tabs and ends on a group heading (harness); chat names ellipsize at 390. No lost fact.
- **Against Keel:** close — Keel's rows carry real columns; ours are name + meta + time, and the empty cells use three spellings for one gap.

### Wave 34 round (`w34-r1`, live after #144–#147 on basalt-ui 2.22.0; `w34-r2` after #148)

- **Reviewer (`w34-r1`):** fail. Fixed: the strip's empties read `No chats came back` / `No teams came back` and the labeled cell carries `… refresh to retry` once; no `All 0` chip under `empty` (chips stay while a tag is active); the focus ring wraps the whole row shell, the remove control inside it; the 390 detail pane no longer points at an empty list. **Regression, fixed in #148 and verified in `w34-r2`:** P0 — removing the pointer left the 390 Detail pane zero-size under `empty` (2 error shots); it now reads `Nothing to open — no chats came back` (teams / channels likewise). **Remaining (argo):** P2 — one gap two ways on one screen (strip `No chats came back`, list `No chats yet — Microsoft 365 returned none; refresh to retry`); P3 — `refresh to retry` twice (labeled cell, source list); P3 — the 390 Detail line gives the cause, not a step; carried P1 — the empty source list (and labeled pane) ~95 % blank at 1440, message top-set; carried P2 — under `empty` the labeled pane says `label a chat to include it in …` with no chats; the ring still sits flush on the pane's left edge and over the scrollbar. Carried (basalt): chip hover; the 390 2 + 1 strip. Carried (harness): 390 crops of detail / labeled not captured by the default preset, the phone crop clips its tabs, the source-list focus crop lands on a chip, the ~640 px band under the panes. Unscored: chat names ellipsize at 390. No lost fact.
- **Against Keel:** does not yet — Keel's rows carry real columns; ours are name + meta + time, and one gap still has two wordings.

### Wave 35 round (`w35-r1`, live after #149–#151 on basalt-ui 2.22.0)

- **Reviewer:** pass (argo and harness P3s). Fixed (confirmed): the full sentence `… — Microsoft 365 returned none; refresh to retry` appears once (the labeled strip cell) and `refresh to retry` only there; the chats cell and the source list use the short form `No chats came back`; the labeled cell and pane say `No chats or channels came back` instead of asking to label a chat; the empty source list and the labeled pane centre their message (the w34 P1 closed); the row focus ring is inset from the pane edge and clears the scrollbar. **New (argo, P3):** the channels cell's short form `No teams came back` uses another noun than the leading sentence's `channels`. Carried (argo, P3): the 390 Detail line `Nothing to open — no chats came back` is a third spelling with no step. Carried (basalt / harness): chip hover; the labeled-phone focus ring under the sticky search; the ~640 px band under the panes. No lost fact.
- **Against Keel:** close (w34: does not yet) — one gap, one sentence; Keel's rows still carry real columns.
- **Re-score `w35-r2` (after basalt-ui 2.23.0, #152):** pass, incl. both pane presets. New (basalt, P3): strip footers no longer line up across cells. Carried: the `No teams came back` noun mismatch and the 390 Detail line (argo P3s); the tag-chip hover crop (lands on the active chip); the labeled-phone crop under the sticky tabs; the band under the panes. Headline zeros no longer slashed (2.23). No lost fact.

### Wave 36 round (`w36-r1`, live after #153–#155 on basalt-ui 2.23.0; `w36-r2` after #156–#158)

- **Reviewer (`w36-r1`):** pass, incl. both pane presets. Fixed (confirmed, #155): with the Labeled cell leading, the channels cell reads `No chats or channels came back` (w35's `No teams came back` noun mismatch); the phone Detail line is the screen's short form (`Nothing to open — …` gone). Unscored before (argo, P3): the chats cell and the source list still read `No chats came back` on the both-empty screen — the next wave decides whether a chats-only gap is a narrower gap with its own sentence or takes the leading clause. Carried (harness / basalt, P3): the labeled-phone focus ring under the sticky tabs, the ~640 px band under the panes, the chip hover crop, ragged strip footers. No lost fact.
- **Against Keel:** close — one gap, one sentence; Keel's rows still carry real columns.

### Wave 37 round

- **Decision:** a both-empty screen is ONE gap, so every surface (Labeled cell, chats cell, channels cell, source list in either view, phone Detail line) takes the leading clause verbatim: `No chats or channels came back`. `No chats came back` stays only for the narrower chats-only gap (channels present), where the chats cell leads with its own full sentence. Selection lives in `emptyGap(leader, kind)` and `detailGap` (`model.ts`).

### Wave 37 re-score (`w37-r1`, live after #162 on basalt-ui 2.23.0, incl. both pane presets)

- **Reviewer (`w37-r1`):** **pass**, default run and both phone presets. Fixed (confirmed): on the both-empty screen every surface — Labeled cell (the one full sentence with its step), Chats cell, Channels cell, the source list, the desktop Labeled pane, the phone Labeled pane and the phone Detail line — names the gap with `No chats or channels came back`; none still says `No chats came back`, none shows both forms. Harness: the first preset run seeded the store without its `{v, value}` envelope and the phone panes did not render; re-shot with the envelope and re-scored. Not shot: the chats-only gap (channels present). Carried (P3): chat names ellipsize at 390 (argo); the strip-cell `—` above its reason (basalt); the sticky tabs over the phone focus ring, the desktop detail crop identical to the labeled pane, the ~640 px band under the panes, the chip hover crop (harness). No lost fact.
- **Against Keel:** close — one gap, one sentence; Keel's rows still carry real columns.

### Wave 38 round

- **Re-score (`w38-r1`, `w38-r3`, basalt-ui 2.24 → 2.25, no argo change, default + both pane presets):** **pass** in both. Closed by 2.24: the strip-cell `—` above its reason. Open (P3): chat names ellipsize at 390 and direct-chat member order varies between loads (argo); harness crops as before. Against Keel: close.

### Wave 39 round

- Fixed (argo): a topic-less chat's name sorts its member names (`localeCompare`) before taking the first three, with a code-unit tie-break for locale-equal names, so it reads the same on every load. No lost fact.
- **Re-score (`w39-r1`, default + both pane presets):** pass. The sorted order is visible and stable. Open (argo, P3): chat names ellipsize at 390; sorted names mix `Last, First` and bare formats (source data). Against Keel: close.

### Wave 40 round

- **Re-score on basalt-ui 2.26.0 (`w40-r4`, default + both pane presets):** pass, no regression vs `w39-r1`, no lost fact; the labeled preset now opens the Labeled pane at 390 (the `basalt:m365-explorer` seed `{"v":1,"value":{"pane":"labeled"}}`). Carried: chat names ellipsize at 390 (argo, P3), tag-chip hover on the active chip (harness), the 390 detail pane with a source open not captured, the ~600 px band under the panes at 1440. Against Keel: close.

## Wave 51 — two-reviewer re-score (2026-10-21, live production data, basalt-ui 2.27.2)

Shots `w51-m365{,-labeled,-detail}` (gitignored; `shot detect` run on each dir). Two fresh `basalt-design-reviewer`s, all sheets, 1440 / 390, both schemes, Keel side by side.

- **Reviewer A: pass, 83.**
  - P2 `page` (argo): Communication 4 / Expression 2: the headline 'Chats span 512 d, 27 May 2025 - 21 Oct 2026' is a date-span fact that does not answer the page's decision (which sources carry signal, which agents…
  - P2 `page / source-list (390)` (argo): Communication 4: at 390 the list heading reads bare 'Chats' beside the 'Sources' select, directly under the 'Chats' tab. It restates the tab. The doc says the title was changed to a fact ('{n}…
  - P2 `page (1440)` (argo): Craft 3 (page level): both panes stop about 1065 px down, and the page runs on empty to 1823 px (dark) and 2000 px (light). This is the carried ~600 px band under the panes. Component emptyRatio is…
  - P2 `page / strip / source-list` (harness): The dark and light page shots do not show the same data, so schemes cannot be compared. Dark: 6 of 244, 13 meetings, 25 chats, 'Last 7 days 6', '3 more labels on sources gone from the chat and…
  - P2 `detail-pane` (harness): Unverified, CARRIED: at 1440 the detail-pane crop is identical to the labeled pane. The record header, message list, label split-button and Agent feed (the page's main decision surface) were never…
- **Reviewer B: pass, score returned as 7 (it opened a subset of the sheets).**
  - P2 `page (1440, both schemes)` (argo): The two panes cap at about 760 px and the rest of the 2684 px page is blank, roughly 1000 px (a third to a half of the page). Keel's crew page fills the viewport with content. Carried from earlier…
  - P2 `labeled-pane / detail-pane` (argo): Glyphs in the Labeled sources pane do not follow the source kind. Meetings (TL<>PM<>EM daily, Prometheus Daily) and the 1:1 chat (Samhammer, Fabian) all show the two-person group glyph, while the…
  - P2 `detail-pane (anchor)` (harness): The detail-pane anchor never shows a source open. At 1440 its crop is identical to labeled-pane. At 390 it shows only the one-line placeholder 'Pick a chat or channel in Sources to open it'. The…
  - P2 `strip-chats (Chats by kind)` (basalt): The kind bar's three segments are told apart by grey shade alone. At 390 and in light mode group and direct are close greys. The captions carry the labels, so it is not colour-only, but it is the…

**Result: passes the bar** (both reviewers, no P0/P1, every component passes).
