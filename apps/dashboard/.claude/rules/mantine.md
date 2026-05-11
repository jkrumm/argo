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
