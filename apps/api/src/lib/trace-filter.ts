/**
 * Which inbound requests get a server span. The Elysia OTel plugin records `url.full` and
 * `url.query` on every span it opens, so a traced `/finance/*` request would ship merchant names and
 * search terms (the query of `/finance/api/transactions?search=…`) to ClickStack on the VPS. The
 * finance vault's plaintext must stay on the mini: those requests are not traced at all, and the
 * relay's own upstream span carries the path only (`routes/finance.ts`).
 */
const UNTRACED_PREFIXES = ['/health', '/openapi', '/finance'] as const

export function shouldTraceRequest(request: { url: string }): boolean {
  const { pathname } = new URL(request.url)
  if (pathname === '/') return false
  return !UNTRACED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}
