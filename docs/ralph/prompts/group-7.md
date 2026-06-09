# Group 7: Attachments

## What You're Doing

Add the composer **attach menu** (File / Image / Long Text) from the wireframe and render
attachments in the transcript, persisting them on the message `payload`. The `Attachment`
payload type is already reserved — this is composer UI + rendering + persistence.

---

## Research & Exploration First

1. `apps/api/src/db/schema.ts` — the `Attachment` type (`type: 'text'`, title, content) +
   `MessagePayload.attachments` reserved on `hermesMessage.payload`. Note it currently only
   models `'text'`; decide whether Image/File need an extended discriminated union and, if so,
   extend the type (kept backward-compatible).
2. `apps/dashboard/src/features/hermes-chat/` — the composer shell + attach placeholder slot
   from Group 5; how `payload` flows through persistence (`persistTurn` in `hermes.ts`).
3. `docs/diagrams/ChatWireframe.svg` — the Attach menu (File / Image / Long Text; Camera/Voice
   are Group 6 / out of scope here).
4. Mantine v9 `Menu`, `FileButton`, `Modal`/`Textarea` for the "Long Text" paste affordance.
5. `DESIGN.md` — theming for attachment chips/cards (no raw hex).

---

## What to Implement

### 1. Attach menu (composer)

- A paperclip `Menu` in the action cluster: **File**, **Image**, **Long Text**.
  - File/Image → `FileButton`; read as needed (small files inline; document any size cap in
    RALPH_NOTES). Image preview chip; file name chip.
  - Long Text → a `Modal` with a `Textarea` → a `text` attachment (title + content), matching
    the existing `Attachment` shape.
- Show pending attachments as removable chips above the textarea before send.

### 2. Persist + render

- Carry attachments through to `payload.attachments` on the user turn (extend the type if you
  added Image/File kinds; keep `'text'` working).
- Render persisted attachments in the transcript with themed Mantine chips/cards (text →
  expandable card; image → thumbnail; file → download/name chip).

Keep scope tight: text + image + small-file attachments. Camera and voice are out of scope
(voice is Group 6). Don't build a server upload pipeline unless trivial — prefer inline/data
handling and note any deferral.

---

## Validation

```bash
bun run --cwd apps/api typecheck
bun run --cwd apps/dashboard typecheck
bun run lint && bun run format:check
bun run --cwd apps/dashboard build
bun test --cwd apps/api          # if payload types/persistence change, keep tests green
```

Manual-QA notes: attach a text/image/file → chips show → send → renders in the transcript and
survives reload (persisted in `payload`).

---

## Commit

```
feat(hermes-chat): composer attach menu + attachment rendering
```

---

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then:

```
RALPH_TASK_COMPLETE: Group 7
```
