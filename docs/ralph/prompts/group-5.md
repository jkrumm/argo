# Group 5: Slack-feed layout

## What You're Doing

The headline. Rebuild the chat surface from the current two-pane list+detail into the
**single-column, inline-expandable thread feed** in `docs/diagrams/ChatWireframe.svg`: a feed
of thread rows each showing **type badge + DeepSeek title + one-line summary + timestamp + an
expand chevron**; expanding a row reveals that thread's conversation inline (reusing the
existing conversation + renderer), with the composer pinned at the bottom. Frontend only;
data (title/summary/type) comes from Groups 1–2; the rich rendering from Groups 3–4.

> **Hard constraint:** DESIGN.md is law — Mantine v9 + Blueprint palette/tokens, no raw hex
> (`check-theme.mjs`). Read `DESIGN.md` + `docs/MANTINE-THEMING.md` before building.

---

## Research & Exploration First

1. `docs/diagrams/ChatWireframe.svg` — the target. Rows: badge (Todo/Podcast/Infra…), title,
   summary line, timestamp, chevron; expanded row shows the Johannes/Hermes exchange inline;
   composer at the bottom with an attach/mic cluster (the affordances are wired in Groups
   6–7 — leave placeholders).
2. `apps/dashboard/src/features/hermes-chat/` — `chat-page.tsx` (the responsive list+detail
   container to replace), `thread-list.tsx`/`ThreadRow` (current rows: title+pin+timestamp),
   `chat-view.tsx` + `chat-conversation.tsx` (the conversation + composer — **reuse** for the
   expanded row), `message-markdown.tsx`.
3. `apps/dashboard/src/lib/queries/hermes.ts` — `HermesThread` now has `summary` + `type`;
   the threads query.
4. `DESIGN.md`, `docs/MANTINE-THEMING.md`, `apps/dashboard/CLAUDE.md` — theming + page
   conventions. Mantine `Accordion`/`Collapse`, `Badge`, `Card` patterns.

---

## What to Implement

### 1. The feed

Rebuild `chat-page.tsx` (extract new components as needed, e.g. `thread-feed.tsx`,
`thread-feed-row.tsx`) into a single scrolling column of thread rows:

- **Collapsed row:** type `Badge` (color mapped from `thread.type` via palette tokens — define
  a `type → color` map, no raw hex), title (`lineClamp={1}`, bold), one-line `summary`
  (`lineClamp={1}`, dimmed), right-aligned relative timestamp, expand chevron. Pinned threads
  surface first / with the pin icon (existing behavior).
- **Expanded row:** mount the existing `ChatView`/`ChatConversation` inline (keyed by thread
  id — `useChat` hydrates by id) so streaming, tool-progress chips, and the rich renderer all
  keep working unchanged.
- "New chat" affordance creates a thread (existing `POST /hermes/threads`) and opens it
  expanded.

### 2. Composer shell

Rebuild the composer into a shell with a trailing **action cluster**: the existing Send/Stop
`ActionIcon`, plus disabled/placeholder slots for **attach** (paperclip) and **mic** — wired
in Groups 6 (mic/audio) and 7 (attach). Keep Enter-submit / Shift+Enter-newline.

### 3. Responsive

Preserve a sensible mobile layout (single column already suits it). Keep the app-shell height
math (`FILL_HEIGHT`) working.

---

## Validation

```bash
bun run --cwd apps/dashboard typecheck
bun run lint && bun run format:check    # check-theme.mjs (no raw hex / off-palette badges)
bun run --cwd apps/dashboard build
```

Manual-QA notes in RALPH_NOTES: feed lists threads with badge+title+summary+timestamp;
expanding streams a live conversation; collapse/expand is smooth; dark/light correct; mobile
usable. (No dashboard test harness — typecheck + build + manual.)

---

## Commit

```
feat(hermes-chat): Slack-style inline-expandable thread feed
```

---

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then:

```
RALPH_TASK_COMPLETE: Group 5
```
