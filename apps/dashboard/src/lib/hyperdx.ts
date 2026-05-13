import HyperDX from '@hyperdx/browser'

// Self-initializing side-effect module — patches window.fetch on import.
// Must be the FIRST import in main.tsx so the fetch patch is in place
// before Eden Treaty or TanStack Query capture the original fetch.
if (typeof window !== 'undefined') {
  const apiKey = import.meta.env.VITE_HYPERDX_API_KEY
  if (apiKey) {
    // Dev-only: filter Vite HMR client errors before HyperDX's unhandledrejection
    // listener sees them. @vite/client fires "send was called before connect" during
    // dep-optimizer rebuilds (WebSocket not yet open), generating false error spans.
    if (import.meta.env.DEV) {
      window.addEventListener(
        'unhandledrejection',
        (e) => {
          if ((e.reason as Error | undefined)?.stack?.includes('/@vite/')) {
            e.stopImmediatePropagation()
          }
        },
        { capture: true },
      )
    }

    HyperDX.init({
      apiKey,
      service: import.meta.env.VITE_HYPERDX_SERVICE_NAME ?? 'argo-dashboard',
      // SDK appends /v1/traces and /v1/logs. URL MUST be absolute — relative
      // paths silently fall back to HyperDX Cloud. window.location.origin works
      // because the dashboard origin proxies /v1/traces and /v1/logs to ClickStack
      // (Vite proxy in dev, Traefik in prod).
      url: import.meta.env.VITE_HYPERDX_ENDPOINT || window.location.origin,
      // Regex must match the absolute outgoing URL. Cover all three origins
      // the dashboard runs under so traceparent is injected on browser→API calls.
      tracePropagationTargets: [
        /argo\.jkrumm\.com\/api\//,
        /argo\.test\/api\//,
        /^https?:\/\/localhost:\d+\/api\//,
      ],
      consoleCapture: true,
      advancedNetworkCapture: false,
      // Session replay is heavy and noisy in dev (HMR causes lots of DOM churn).
      // Keep it on in prod for incident investigation.
      disableReplay: import.meta.env.DEV,
      // Skip Vite dev-server probes so they don't appear as spans/errors.
      ignoreUrls: [/\/@vite\//, /\/__vite_ping/, /\.hot-update\./, /\/node_modules\/.vite\//],
      otelResourceAttributes: {
        'deployment.environment': import.meta.env.MODE,
        // Injected by Vite at build time — see vite.config.ts `define`.
        'app.version': __APP_VERSION__,
      },
    })

    // Single-user dashboard — stamp the user once at boot so every span/log
    // carries it. For multi-user apps, call identify() after auth instead.
    HyperDX.setGlobalAttributes({ userId: 'jkrumm' })
  }
}

/**
 * Attach user-identifying attributes to every subsequent span and log record.
 * Call after auth in multi-user apps; not used in the current single-user setup.
 */
export function identifyUser(user: { id: string; email?: string; name?: string }): void {
  if (typeof window === 'undefined') return
  HyperDX.setGlobalAttributes({
    userId: user.id,
    ...(user.email ? { userEmail: user.email } : {}),
    ...(user.name ? { userName: user.name } : {}),
  })
}

export { HyperDX }
