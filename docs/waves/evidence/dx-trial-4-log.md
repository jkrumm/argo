# DX trial 4 — editable list page (throwaway)

Page `/checklist`: `BasaltDataTable` + `rowActions` (Edit, Delete), Edit modal (`useBasaltForm` + `inputProps`, zod schema, text + checkbox, inline errors), TanStack Query mutation, success toast via `emit`, Delete via `overlays.confirmDelete`. Data: in-memory mock (`features/checklist/checklist-api.ts`) — no existing endpoint fits an editable list.

Time to first green `make check`: ~1 min of shell wall-clock from the first command (stamp file), but `make check` was green on the **second** run; the first run failed `format:check`. Read time before the first write is not separable from this stamp.

| # | What happened | Fix | Doc/type/lint change that would have avoided it |
|-|-|-|-|
| 1 | `node_modules/basalt-ui` missing in the fresh worktree, so `llms.txt` and the `.d.ts` files were unreadable | `bun install` | None — `apps/dashboard/AGENTS.md` states it. The task brief could say "run `bun install` first". |
| 2 | `make check` failed at `oxfmt --check` on my new `checklist-page.tsx` (long `onClick` line) | `oxfmt` on the feature dir | My error. A `make fmt` target listed in AGENTS.md §Validate would make the fix one command. |
| 3 | `emit('checklist:saved', …)` needs the kind added to `lib/notifications.ts` (an app file outside the feature dir); the rules only say "`emit` is typed" | Added the kind next to the others | `basalt-batteries.md` has no Notifications bullet, and `llms.txt` lists `emit` without saying the registry is app-owned. One line: "register the kind in the app's `defineNotifications` registry first". |
| 4 | The registry's `toMessage` is `(payload: unknown) => payload.message` by app convention, so `emit` accepts any payload shape and the `{ message }` contract is unchecked | None; passed `{ message }` as the registry file's header describes | `lib/notifications.ts` annotates `toMessage` as `unknown`; annotating `(p: { message: ReactNode })` would make `emit` check it. App-side gap, not basalt. |
| 5 | No shipped form-in-modal seam: `overlays.open` needs a `defineOverlays` entry plus a `BasaltRegister` augmentation and a `render` that sits outside React Query context concerns. I used Mantine `Modal` in a `*-edit-modal.tsx` file (the `control-outside-home` filename carve-out) instead | Plain `Modal` rendered by the page; row held in `useState` | `basalt-controls.md` names the `*-modal.tsx` filename carve-out but not what to use for a form dialog. A one-line "form dialog = Mantine `Modal` in `*-modal.tsx`, or `overlays.open` for a registered overlay" would settle it. Not built with the shipped API: nothing. |
| 6 | `inputProps(form, 'done', { type: 'checkbox' })` — worked first time, no error | — | The rule bullet in `basalt-batteries.md` was sufficient. |

No basalt suppressions. No edits to package.json, bun.lock, `.claude/**`, AGENTS.md.
