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
      url: import.meta.env.VITE_HYPERDX_ENDPOINT || window.location.origin,
      tracePropagationTargets: [/\/api\//],
      consoleCapture: true,
      advancedNetworkCapture: true,
    })
  }
}

export { HyperDX }
