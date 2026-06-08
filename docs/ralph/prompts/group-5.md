# Group 5: Frontend core chat (working chat!)

## What You're Doing

Build the actual chat UI: a responsive list+detail layout wired to `useChat` →
`/hermes/chat`, with base markdown rendering. After this group, Hermes Chat is a
**usable threaded chat** on Mac and iPhone (PWA). Smart cards/diagrams come in
Group 6 — base markdown is enough here.

## Research & Exploration First

1. Re-read `docs/HERMES-CHAT-PRD.md` → Thread UX + Rendering + the E2E auth note.
2. Verify AI SDK v5 client APIs (Context7/WebFetch): `useChat`,
   `DefaultChatTransport`, `prepareSendMessagesRequest` (send only the new turn),
   passing custom request `headers`, and consuming transient data parts.
3. Read `apps/dashboard/src/lib/eden.ts` + `auth.ts` (`useAuthStore` Bearer),
   `query-client.ts`, an existing route page (`m365-explorer.tsx`), and how Mantine
   layout/AppShell + the nav are used. Read `DESIGN.md` + `docs/MANTINE-THEMING.md`.

## What to Implement

### 1. Data hooks (TanStack Query v5)

Thread list + thread messages via the Group 4 endpoints (through `eden.ts`).
"New chat" → `POST /hermes/threads` then select it. Optimistic add of the user
message; invalidate thread list after a turn completes.

### 2. `useChat` transport

Point `DefaultChatTransport` at `/api/hermes/chat`. **Inject the Bearer from
`useAuthStore`** in the transport headers (the stream bypasses Eden Treaty).
`prepareSendMessagesRequest` sends only the latest message + `threadId` + the
thread's `session_id`. Hydrate `useChat` with persisted messages on thread open.

### 3. Responsive list+detail layout (Mantine)

- **Mac (≥ md):** two-pane — thread list beside the open thread.
- **iPhone (< md):** stacked — thread list; opening a thread is full-screen with a
  back affordance.
  Compose box at the bottom; render streaming assistant text live; show a transient
  "Hermes is <label>…" indicator from `data-toolProgress` parts. All Mantine + DESIGN.md
  tokens (no raw hex).

### 4. Base rendering

A `MessageMarkdown` component: `react-markdown` v10 + `remend` (streaming-safe) +
`remark-gfm`, with Mantine-native element mappings (headings, lists, code, links,
tables). Cards/mermaid/vega are NOT handled yet — they render as plain code blocks
for now (Group 6 replaces them).

## Validation

```bash
bun run lint && bun run format:check
bun run --cwd apps/api typecheck && bun run --cwd apps/dashboard typecheck && bun run --cwd packages/charts typecheck
bun run --cwd apps/dashboard build
```

Manual acceptance (Johannes, post-loop): start/continue/new thread on Mac + iPhone;
streaming visible; reload restores the transcript from Postgres.

## Commit

```
feat(hermes-chat): responsive list+detail chat UI with streaming + base rendering
```

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then:

```
RALPH_TASK_COMPLETE: Group 5
```
