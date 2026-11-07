/** Guards a URL before it is used as an `href` — a link from a third-party payload (an event's
 * meeting link) must never render a non-http(s) scheme (`javascript:`, `data:`, …) as clickable. */
export function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}
