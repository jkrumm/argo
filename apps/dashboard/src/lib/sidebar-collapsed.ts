import { createPersistedState } from 'basalt-ui/state'

const KEY = 'argo-sidebar'
const VERSION = 1

/**
 * Sidebar collapse, on the house persistence API.
 *
 * Until basalt-ui 1.21.0 `BasaltShell` persisted its own collapse with `@mantine/hooks`'
 * `useLocalStorage` and told the consumer to mirror that when driving `collapsed` externally, so
 * this lived on a raw `localStorage` key. 1.21.0 moved the shell to `createPersistedState`; this
 * follows, which puts every persisted value in the app behind one mechanism again.
 *
 * The one-time legacy read mirrors the shell's own `migrateLegacyCollapse`: Mantine's
 * `useLocalStorage` wrote `JSON.stringify(boolean)` — the literal string `'true'` or `'false'` —
 * under the un-namespaced key, so an already-collapsed sidebar would otherwise spring open once on
 * upgrade. Runs at module scope, before the store's first read, and only when the namespaced key
 * is absent.
 */
export function migrateLegacyCollapse(): void {
  if (typeof window === 'undefined') return
  try {
    if (window.localStorage.getItem(`basalt:${KEY}`) !== null) return
    const legacy = window.localStorage.getItem(KEY)
    if (legacy !== 'true' && legacy !== 'false') return
    window.localStorage.setItem(
      `basalt:${KEY}`,
      JSON.stringify({ v: VERSION, value: legacy === 'true' }),
    )
  } catch {
    // A blocked or full localStorage costs the previous collapse state, nothing more.
  }
}

migrateLegacyCollapse()

export const useSidebarCollapsed = createPersistedState<boolean>({
  key: KEY,
  version: VERSION,
  initial: false,
})
