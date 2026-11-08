/**
 * The factory Console's URL for a path, from the configured origin (`VITE_CONSOLE_URL`, baked into the
 * bundle by `make deploy` from the mini's own `~/.argo/console-url`; `.env.development` points dev at
 * the `.test` door). No host is written in a tracked file. Unset, empty or not an http(s) origin: null,
 * so the page renders no Console link.
 */
export function consoleUrl(origin: string | undefined, path = '/'): string | null {
  if (!origin) return null
  try {
    const base = new URL(origin)
    if (base.protocol !== 'https:' && base.protocol !== 'http:') return null
    return new URL(path, base.origin).href
  } catch {
    return null
  }
}
