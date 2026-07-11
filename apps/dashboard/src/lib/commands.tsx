/**
 * commands.ts — Argo's single global command registry (see basalt-ui/commands: `defineCommands`'s
 * contract is "call it once — the app's single command registry; the last call wins"). Imported
 * eagerly (side-effect) by main.tsx, before `BasaltOverlays` mounts, so Spotlight/ShortcutsHelp see
 * the full registry from boot.
 *
 * Navigation commands call `router.navigate` directly (the module-level router singleton from
 * `lib/router.ts`) rather than a React `useNavigate` hook — commands run outside the component tree
 * (e.g. triggered from the Spotlight palette), so no hook is available. Each nav command restates
 * the destination's default search params, mirroring the sidebar's own default-search links.
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
import { format } from 'date-fns'
import { defineCommands, overlays } from 'basalt-ui/commands'
import { router } from './router'
import { setColorScheme } from './color-scheme-bridge'
// Side-effect import: registers the overlays.open('help:shortcuts', …) target used below. Kept in
// its own file/BasaltRegister augmentation — see overlays.tsx header for why.
import './overlays'

export const COMMANDS = defineCommands({
  'nav:hermes-chat': {
    label: 'Go to Hermes Chat',
    group: 'Navigation',
    run: () => void router.navigate({ to: '/hermes-chat' }),
  },
  'nav:calendar': {
    label: 'Go to Calendar',
    group: 'Navigation',
    run: () =>
      void router.navigate({
        to: '/calendar',
        search: { view: 'week', date: format(new Date(), 'yyyy-MM-dd') },
      }),
  },
  'nav:garmin-health': {
    label: 'Go to Garmin Health',
    group: 'Navigation',
    run: () => void router.navigate({ to: '/garmin-health', search: { window: '30d' } }),
  },
  'nav:strength-tracker': {
    label: 'Go to Strength Tracker',
    group: 'Navigation',
    run: () =>
      void router.navigate({
        to: '/strength-tracker',
        search: { window: 'all', tab: 'charts', exercises: 'bench_press,deadlift,squat,pull_ups' },
      }),
  },
  'nav:body-composition': {
    label: 'Go to Body Composition',
    group: 'Navigation',
    run: () => void router.navigate({ to: '/body-composition', search: { window: '90d' } }),
  },
  'nav:walking-pad': {
    label: 'Go to WalkingPad',
    group: 'Navigation',
    run: () => void router.navigate({ to: '/walking-pad', search: { window: '30d' } }),
  },
  'nav:reading': {
    label: 'Go to Reading',
    group: 'Navigation',
    run: () => void router.navigate({ to: '/reading' }),
  },
  'nav:usage-tracking': {
    label: 'Go to Usage Tracking',
    group: 'Navigation',
    run: () =>
      void router.navigate({
        to: '/usage-tracking',
        search: {
          range: '30d',
          grain: 'day',
          costGroupBy: 'source',
          tokensGroupBy: 'sub_tool',
        },
      }),
  },
  'nav:m365-explorer': {
    label: 'Go to M365 Explorer',
    group: 'Navigation',
    run: () => void router.navigate({ to: '/m365-explorer' }),
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
  }
}
