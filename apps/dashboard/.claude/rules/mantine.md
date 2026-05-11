---
paths:
  - apps/dashboard/**
---

# Mantine v9 — Usage Conventions

## Provider order

In `main.tsx` the provider stack is:

1. `HyperDX` init (first import — monkey-patches fetch)
2. `MantineProvider` with `theme` and `defaultColorScheme`
3. `Notifications` (from `@mantine/notifications`)
4. `ModalsProvider` (from `@mantine/modals`)
5. `RouterProvider`

Never wrap `MantineProvider` inside `RouterProvider` — Mantine's context must be available before any route renders.

## Theming

- Color scheme: read/write via `useMantineColorScheme()`. Persisted to `mantine-color-scheme-value` in localStorage.
- Never use `localStorage.getItem('mantine-color-scheme-value')` directly — read it via the hook.
- Custom theme tokens live in `src/lib/theme.ts`. Use `theme.colors`, `theme.spacing`, etc.

## Component conventions

- **AppShell**: `<AppShell>` wraps every page via `__root.tsx`. Don't add another shell inside a page.
- **Stack/Group/SimpleGrid**: prefer over manual flex/grid CSS.
- **Notifications**: `notifications.show(...)` from `@mantine/notifications` — never roll a custom toast.
- **Modals**: `modals.openConfirmModal(...)` for destructive actions; `modals.open(...)` for forms.
- **DatePickerInput**: from `@mantine/dates` — requires `DatesProvider` in the provider stack if using locale.
- **Combobox / Select**: from `@mantine/core`. Don't use native `<select>`.

## Icons

All icons from `@tabler/icons-react`. Size them via `size={16}` prop, not CSS.
