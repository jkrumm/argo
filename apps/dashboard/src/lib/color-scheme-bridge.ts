/**
 * A tiny leaf module (zero local imports) bridging `useMantineColorScheme()`'s live
 * `setColorScheme` — set by `__root.tsx` on mount — to `lib/commands.tsx`'s `theme:*` commands,
 * which run outside the React tree (e.g. triggered from Spotlight) and have no hook access.
 *
 * Deliberately its own file, not folded into `commands.tsx`: `__root.tsx` needs to call
 * `registerColorSchemeSetter`, and `commands.tsx` imports `lib/router.ts`, which imports
 * `routeTree.gen.ts`, which imports every route file including `__root.tsx` — so `__root.tsx`
 * importing anything from `commands.tsx` closes a real circular module dependency (surfaces as TS
 * "implicitly has type any... referenced in its own initializer" on `COMMANDS`). This leaf module
 * has no outgoing imports, so both sides can depend on it without re-closing that cycle.
 */
export type ColorScheme = 'light' | 'dark' | 'auto'
export type ColorSchemeSetter = (scheme: ColorScheme) => void

let setColorSchemeRef: ColorSchemeSetter | null = null

export function registerColorSchemeSetter(setter: ColorSchemeSetter | null): void {
  setColorSchemeRef = setter
}

export function setColorScheme(scheme: ColorScheme): void {
  setColorSchemeRef?.(scheme)
}
