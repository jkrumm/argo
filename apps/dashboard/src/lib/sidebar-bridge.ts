/**
 * Leaf bridge (zero local imports) between `__root.tsx`'s controlled sidebar-collapse state and
 * `lib/commands.tsx`'s `ui:toggle-sidebar` command (Mod+B), which runs outside the React tree.
 * Same pattern and rationale as `color-scheme-bridge.ts` — see its header for the cycle it avoids.
 */
export type SidebarToggle = () => void

let toggleRef: SidebarToggle | null = null

export function registerSidebarToggle(toggle: SidebarToggle | null): void {
  toggleRef = toggle
}

export function toggleSidebar(): void {
  toggleRef?.()
}
