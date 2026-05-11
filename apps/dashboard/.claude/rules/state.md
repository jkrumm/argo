---
paths:
  - apps/dashboard/**
---

# Client State — Zustand

## Scope

Zustand manages only UI state that must survive navigation but is not appropriate for URL params:

- Sidebar collapsed/open
- Any other persistent UI preferences

URL state (filters, active tab, pagination) → `validateSearch` in TanStack Router.
Server state (API data) → TanStack Query.
Theme (color scheme) → `useMantineColorScheme()` from Mantine — **not Zustand**.

## Store pattern

```ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UIStore {
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
    }),
    { name: 'argo-ui' },
  ),
)
```

The store lives in `src/lib/store.ts`. Keep it small — resist the urge to put query results here.
