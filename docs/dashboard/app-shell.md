# Dashboard app shell: theme, head, palette, forms

Moved from `apps/dashboard/AGENTS.md`. Read before changing the theme script in `index.html`, head metadata, the manifest or service worker, the commands palette, notifications, or a form or dialog.

## Theme Toggle

`useMantineColorScheme()` from Mantine — reads/writes `mantine-color-scheme-value` in localStorage. The inline script in `index.html` sets `data-mantine-color-scheme` before first paint, which does two things: it prevents the flash of the wrong scheme, and it **disarms** `basaltAppPlugin`'s anti-FOUC `<style>`, scoped `html:not([data-mantine-color-scheme])` since basalt-ui 1.21.0. After that line Mantine's own layered `color-scheme` rule owns the native controls in both schemes. The inline `style.colorScheme` this script used to write is gone — it existed only to beat the unlayered rule 1.20.0 emitted.

## Head metadata, manifest & service worker

Owned by `basaltAppPlugin` in `vite.config.ts` — the dual `theme-color` metas, the favicon/apple-touch links, the `apple-mobile-web-app-*` set, `darkreader-lock`, the viewport tag, `site.webmanifest` (generated, **not** a file in `public/`) and the `vite-plugin-pwa` service worker. The theme colors are resolved from basalt's `SURFACE.bg` token, so **never hand-write a hex in `index.html` or a manifest** — `basalt-ui check-theme` scans both. `colorScheme: 'dark'` mirrors `BasaltProvider`'s `defaultColorScheme` in `main.tsx` — keep the two in step. `index.html` keeps only `<meta charset>`, `<title>`, the color-scheme script and the module entry (`<meta charset>` is hoisted to the top of `<head>` by the plugin as of 1.21.0, byte 52 of the built document); `public/` keeps only the icon files. See `.claude/rules/basalt-batteries.md`.

## Commands palette & notifications

See `.claude/rules/basalt-batteries.md`. `emit(kind, { message })` needs the kind registered first in
`src/lib/notifications.ts` (the app's single `defineNotifications` registry); `toMessage` is typed
`{ message: ReactNode }`, so `emit` checks the payload.

A scrolling panel uses Mantine `ScrollArea` (`basalt/raw-scroll-container`).

## Forms and dialogs

A table row action is `rowActions` on `BasaltDataTable`, never a menu in a cell. A form dialog is a
Mantine `Modal` in a `*-modal.tsx` file (the `basalt-controls` filename carve-out) holding the row in
`useState`; `overlays.confirmDelete` covers delete confirmation. Boolean fields bind with
`inputProps(form, path, { type: 'checkbox' })`. In a fresh worktree run `bun install` before reading
`node_modules/basalt-ui` (`llms.txt`, `dist/**/*.d.ts`), and `oxfmt <dir>` fixes a `format:check` failure.
