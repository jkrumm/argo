/**
 * Which inbound requests get a server span. The Elysia OTel plugin records `url.full` and
 * `url.query` on every span it opens, so a traced `/finance/*` request would ship merchant names and
 * search terms (the query of `/finance/api/transactions?search=…`) to ClickStack on the VPS. The
 * finance vault's plaintext must stay on the mini: those requests are not traced at all, and the
 * relay's own upstream span carries the path only (`routes/finance.ts`).
 *
 * `/paper/*` for the same reason: the plugin also records request and response bodies, which there
 * are the document index (titles, issuers, summaries), and the document id (date, issuer, title) is
 * in the path. `lib/paper.ts` logs each call's verb, outcome and duration instead.
 */
const UNTRACED_PREFIXES = ['/health', '/openapi', '/finance', '/paper'] as const

export function shouldTraceRequest(request: { url: string }): boolean {
  const { pathname } = new URL(request.url)
  if (pathname === '/') return false
  return !UNTRACED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}
