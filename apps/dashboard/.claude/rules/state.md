---
paths:
  - apps/dashboard/**
---

# Client State — where each kind lives

`.claude/rules/basalt-state.md` (shipped by basalt-ui) is the law. This file is the argo delta.

| Kind                                                          | Home                                                                                |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| anything a control reads or writes — filter, tab, range, view | a **field** on the page's `createSearchStore` (`src/lib/window-stores.ts`)          |
| a per-card select (one chart's exercise, one card's metric)   | a module-scope `createLocalStore` in that card's own file, keyed `<feature>:<card>` |
| server data                                                   | TanStack Query                                                                      |
| a preference that must survive a reload but no control reads  | `createPersistedState` from `basalt-ui/state`                                       |
| color scheme                                                  | `useMantineColorScheme()` — never a store                                           |
| genuinely shared mutable state with no owning component       | Zustand — and only the two below                                                    |

**Never `useState` for a filter, a tab, a range or a view** (law C3): it resets on navigation, it
cannot be linked, and a basalt control refuses to take it (`value`/`onChange` do not exist on one).

## The two remaining Zustand stores, and why

- `src/lib/timer-store.ts` — the rest/interval timer. It ticks from an app-level engine mounted in
  `__root.tsx` and is read by a header widget, a card and a bus subscriber at once. No URL, no
  owning component.
- `src/lib/auth.ts` — the session gate, `persist` middleware.

Sidebar collapse is NOT here: it moved to `createPersistedState`
(`src/lib/sidebar-collapsed.ts`) when `BasaltShell`'s own uncontrolled path did. Do not add a
third Zustand store for UI state a store field or `createPersistedState` can hold.
