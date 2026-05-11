---
paths:
  - apps/dashboard/**
---

# Client State — Zustand

## Scope

Zustand manages only UI state that must survive navigation but is not appropriate for URL params:

- Sidebar collapsed/open (`sidebarCollapsed`)
- Any other persistent UI preferences

URL state (filters, active tab, pagination) → `validateSearch` in TanStack Router.
Server state (API data) → TanStack Query.
Theme (color scheme) → `useMantineColorScheme()` from Mantine — **not Zustand**.

## Store Pattern

```ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type UiState = {
  sidebarCollapsed: boolean
  setSidebarCollapsed: (v: boolean) => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
    }),
    { name: 'argo-ui' },
  ),
)
```

The store lives in `src/lib/store.ts`. Keep it small — resist the urge to put query results or derived data here.
