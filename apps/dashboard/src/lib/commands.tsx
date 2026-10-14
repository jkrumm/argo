/**
 * commands.ts — Argo's single global command registry (see basalt-ui/commands: `defineCommands`'s
 * contract is "call it once — the app's single command registry; the last call wins"). Imported
 * eagerly (side-effect) by main.tsx, before `BasaltProvider` mounts, so Spotlight/ShortcutsHelp see
 * the full registry from boot.
 *
 * Navigation is not registered here: the provider builds the "go to" Spotlight entries from the
 * active `NAV` itself.
 *
 * `help:shortcuts`'s `run` carries an explicit `: void` return-type annotation — without it, TS
 * must INFER the return type from `overlays.open(...)`, which resolves through `BasaltRegister`,
 * which this very file is also augmenting (`commands: typeof COMMANDS`, declared below) — a
 * self-referential cycle ("`COMMANDS` implicitly has type `any`... referenced in its own
 * initializer"). The explicit annotation gives TS a concrete type up front and breaks it.
 */
import {
  defineCommands,
  defineOverlays,
  overlays,
  setColorScheme,
  ShortcutsHelp,
  toggleSidebar,
} from 'basalt-ui/commands'

export const OVERLAYS = defineOverlays({
  'help:shortcuts': {
    title: 'Keyboard shortcuts',
    render: () => <ShortcutsHelp title="Keyboard shortcuts" />,
  },
})

// No "Go to …" commands here: the provider's Spotlight already lists every enabled NAV destination
// (`nav.<id>`, grouped by nav section, from `getActiveNav()`), so registering them again would show
// each twice.
export const COMMANDS = defineCommands({
  'ui:toggle-sidebar': {
    label: 'Toggle sidebar',
    group: 'View',
    shortcut: 'Mod+B',
    run: () => toggleSidebar(),
  },
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
    overlays: typeof OVERLAYS
  }
}
