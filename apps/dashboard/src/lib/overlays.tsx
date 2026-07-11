/**
 * overlays.tsx — Argo's overlay registry (basalt-ui `defineOverlays`), kept in its own file/
 * `BasaltRegister.overlays` augmentation. Split from `commands.tsx` deliberately: a command in that
 * file calls `overlays.open(...)`, and `overlays.open`'s typed key resolves through
 * `BasaltRegister.overlays` — augmenting BOTH `commands` and `overlays` in the same file as the
 * `overlays.open` call creates a self-referential type cycle while TS infers `typeof COMMANDS`
 * (mirrors basalt-ui's own playground split: `demo/commands.ts` vs `demo/CommandsDemoPage.tsx`).
 */
import { defineOverlays, ShortcutsHelp } from 'basalt-ui/commands'

export const OVERLAYS = defineOverlays({
  'help:shortcuts': {
    title: 'Keyboard shortcuts',
    render: () => <ShortcutsHelp title="Keyboard shortcuts" />,
  },
})

declare module 'basalt-ui' {
  interface BasaltRegister {
    overlays: typeof OVERLAYS
  }
}
