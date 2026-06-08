---
paths:
  - apps/dashboard/**
---

# Mantine v9 — Usage Conventions

## Provider Order

In `main.tsx` the provider stack is (top to bottom):

1. `import './lib/hyperdx'` — first import (patches fetch before anything else)
2. `MantineProvider` with `defaultColorScheme="dark"`
3. `VxBridge` — bridges Mantine's color scheme to `@argo/charts` (see below)
4. `Notifications` (from `@mantine/notifications`)
5. `ModalsProvider` (from `@mantine/modals`)
6. `QueryClientProvider`
7. `RouterProvider`

Never wrap `MantineProvider` inside `RouterProvider` — Mantine's context must be available before any route renders.

## Theming

- Color scheme: read/write via `useMantineColorScheme()`. Persisted to `mantine-color-scheme-value` in localStorage.
- Never read `localStorage.getItem('mantine-color-scheme-value')` directly — use the hook.
- Custom theme tokens live in `src/lib/theme.ts`. Use `theme.colors`, `theme.spacing`, etc.

## VxBridge

`src/charts-bridge.tsx` is the **only** file allowed to import both `@mantine/core` and `@argo/charts`. It reads the color scheme from Mantine and passes it to `VxThemeProvider`:

```ts
import { useMantineColorScheme } from '@mantine/core'
import { VxThemeProvider } from '@argo/charts'

export function VxBridge({ children }: { children: ReactNode }) {
  const { colorScheme } = useMantineColorScheme()
  const resolved = colorScheme === 'auto' ? 'dark' : colorScheme
  return <VxThemeProvider colorScheme={resolved}>{children}</VxThemeProvider>
}
```

Route components import chart primitives directly from `@argo/charts` — never from `src/charts-bridge.tsx`.

## Component Conventions

- **AppShell**: `<AppShell>` wraps every page via `__root.tsx`. Don't add another shell inside a page.
- **Stack/Group/SimpleGrid**: prefer over manual flex/grid CSS.
- **Notifications**: `notifications.show(...)` from `@mantine/notifications` — never roll a custom toast.
- **Modals**: `modals.openConfirmModal(...)` for destructive actions; `modals.open(...)` for forms.
- **DatePickerInput**: from `@mantine/dates`. In Mantine v9 it uses `DateStringValue = string` (format `YYYY-MM-DD`) for both `value` and `onChange` — no `Date` object conversion needed.
- **Combobox / Select**: from `@mantine/core`. Don't use native `<select>`.
- **useElementSize**: from `@mantine/hooks` — use for responsive chart sizing (replaces `@visx/responsive` ParentSize).

## Icons

All icons from `@tabler/icons-react`. Size via `size={16}` prop, not CSS.

## Interaction Feedback (micro-animations)

Every action button (Save, Log, Add, Delete, Toggle) must give immediate visual confirmation. Silent success feels broken. Three layers, applied together:

1. **In-flight state** — `loading` prop on `<Button>` (built-in spinner). Use `mutation.isPending` from TanStack Query. Disables clicks automatically.
2. **Post-success state on the trigger itself** — flip the button briefly to confirm: swap label `Save → Saved`, set `color="green"` (the success status hue — never `teal`/`violet`/etc., which the theme guard rejects as off-identity), and reveal an `IconCheck` via `<Transition mounted={justSaved} transition="pop" duration={180}>`. Hold ~1.2–1.5s, then reset. The point is reactive proximity — the user's eye is on the thing they clicked, so feedback lands there, not only in a corner toast.
3. **Toast (`notifications.show`)** — only for outcomes the user might miss (writes that succeed off-screen, errors, async background work). Don't toast trivial UI toggles. Keep `autoClose` ≤ 2000ms for success; errors stay until dismissed.

Guidelines:

- Durations: 120–200ms for state flips, 180–250ms for `Transition`, never above 300ms (feels laggy). Tailwind/Mantine `ease` curves are fine — don't hand-roll bezier.
- Never animate layout-shifting properties (height, width) on buttons — animate `transform`, `opacity`, `color`, `background`.
- Don't toast on every action. A button that turns into a check **is** the confirmation; the toast is for context the user can't see (e.g. "Weight logged — 80.3 kg on 2026-05-27").
- Destructive actions: confirm with `modals.openConfirmModal` first, then the same in-button success pattern after deletion.
- Form errors: prefer inline field errors over toast; toast only for submit-level failures (network, server).

Reference implementation: `src/features/strength-tracker/components/body-weight-panel.tsx` → `WeightEntryForm` (loading + check-icon flip + success toast).
