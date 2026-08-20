/**
 * commands.ts — Argo's single global command registry (see basalt-ui/commands: `defineCommands`'s
 * contract is "call it once — the app's single command registry; the last call wins"). Imported
 * eagerly (side-effect) by main.tsx, before `BasaltOverlays` mounts, so Spotlight/ShortcutsHelp see
 * the full registry from boot.
 *
 * Navigation commands are DERIVED from `lib/nav.tsx`'s single `NAV` definition via `flattenNav`,
 * so a destination and its default search params are never restated here. They call
 * `router.navigate` directly (the module-level router singleton from `lib/router.ts`) rather than a
 * React `useNavigate` hook — commands run outside the component tree (e.g. triggered from the
 * Spotlight palette), so no hook is available. `lib/nav.tsx` is a leaf that imports nothing from
 * this app, so pulling it in here does not close the import cycle described below.
 *
 * Theme commands need `setColorScheme` (a Mantine hook return value) from the same outside-React
 * context — bridged via `lib/color-scheme-bridge.ts` (`__root.tsx` registers it on mount), the same
 * register-a-setter pattern basalt-ui's own playground uses for its demo:toggle command. It's a
 * separate leaf module rather than living here, to avoid a circular import (this file imports
 * `lib/router.ts`, which imports the generated route tree, which imports `__root.tsx` — so
 * `__root.tsx` importing anything back from THIS file would close the cycle).
 *
 * `help:shortcuts`'s `run` carries an explicit `: void` return-type annotation — without it, TS
 * must INFER the return type from `overlays.open(...)`, which resolves through `BasaltRegister`,
 * which this very file is also augmenting (`commands: typeof COMMANDS`, declared below) — a
 * self-referential cycle ("`COMMANDS` implicitly has type `any`... referenced in its own
 * initializer"). The explicit annotation gives TS a concrete type up front and breaks it.
 */
import { defineCommands, overlays, type Command } from 'basalt-ui/commands'
import { flattenNav, type NavItemId } from 'basalt-ui/router-tanstack'
import { router } from './router'
import { NAV } from './nav'
import { setColorScheme } from './color-scheme-bridge'
import { toggleSidebar } from './sidebar-bridge'
// Side-effect import: registers the overlays.open('help:shortcuts', …) target used below. Kept in
// its own file/BasaltRegister augmentation — see overlays.tsx header for why.
import './overlays'

/**
 * "Go to …" for every enabled destination in `NAV`, in sidebar order, grouped by its nav section.
 * Disabled placeholders (Docker / Monitoring / Tasks) are filtered out — they have no page.
 *
 * The single `as never` is at `router.navigate`'s own boundary: this maps over a HETEROGENEOUS
 * array whose per-element `to`/`search` pair TypeScript has already erased into a union, which
 * `NavigateOptions` cannot accept. It is not a nav-target cast — for one typed destination use
 * `navTarget(NAV, 'garmin')`, which needs none (see `routes/index.tsx`).
 *
 * `Object.fromEntries` itself only ever returns a `{ [k: string]: … }` index signature, which would
 * widen `CommandId` (`Extract<keyof Commands, string>` in basalt-ui's `define-commands.ts`) from a
 * literal union down to plain `string` — silently deleting the "unknown id is a tsc error" contract
 * `runCommand`'s own JSDoc documents. `NavCommandId` below is a template-literal union built from
 * `NavItemId` (basalt-ui's compile-time id union for `flattenNav`/`navTarget`), and the built object
 * is cast to it to restore that literal key set.
 *
 * `Partial<Record<NavCommandId, Command>>`, not the bare `Record`: the `disabled` filter above means
 * some `nav:*` ids are genuinely absent from the object at runtime, and `Partial` says so honestly
 * instead of claiming every id resolves. `runCommand` already `console.warn`s on an id with no
 * matching entry, so a disabled destination's id typechecks but degrades safely if ever called.
 *
 * Checked first: basalt-ui's `defineCommands` has no field that fully unregisters an entry from
 * both the palette AND `runCommand` — `Command.when` only gates palette/hotkey visibility (see
 * `projectors.ts`/`useCommandHotkeys.ts`), so swapping this filter for `when: () => !d.disabled`
 * would make disabled destinations `runCommand`-reachable (silently landing on the Usage Tracking
 * placeholder) instead of correctly-typed-but-absent. The runtime filter stays; only the type widens
 * to describe it.
 */
type NavCommandId = `nav:${NavItemId<typeof NAV.groups>}`

const NAV_COMMANDS = Object.fromEntries(
  flattenNav(NAV)
    .filter((d) => !d.disabled)
    .map((d) => [
      `nav:${d.id}`,
      {
        label: `Go to ${d.label}`,
        // The nav section, not a flat 'Navigation' — the palette's dividers then mirror the
        // sidebar the user already reads.
        group: d.groupLabel,
        icon: d.icon,
        run: () => void router.navigate(d.link as never),
      },
    ]),
) as Partial<Record<NavCommandId, Command>>

export const COMMANDS = defineCommands({
  'ui:toggle-sidebar': {
    label: 'Toggle sidebar',
    group: 'View',
    shortcut: 'Mod+B',
    run: () => toggleSidebar(),
  },
  ...NAV_COMMANDS,
  'theme:light': {
    label: 'Theme: Light',
    group: 'Theme',
    run: () => setColorScheme('light'),
  },
  'theme:dark': {
    label: 'Theme: Dark',
    group: 'Theme',
    run: () => setColorScheme('dark'),
  },
  'theme:auto': {
    label: 'Theme: System',
    group: 'Theme',
    run: () => setColorScheme('auto'),
  },
  'help:shortcuts': {
    label: 'Keyboard shortcuts',
    group: 'Help',
    shortcut: 'Mod+/',
    run: (): void => {
      overlays.open('help:shortcuts', {})
    },
  },
})

declare module 'basalt-ui' {
  interface BasaltRegister {
    commands: typeof COMMANDS
  }
}
