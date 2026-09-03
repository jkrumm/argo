import './lib/hyperdx'

import '@mantine/core/styles.layer.css'
import '@mantine/notifications/styles.layer.css'
import '@mantine/spotlight/styles.layer.css'
import 'basalt-ui/styles.css'
import '@mantine/dates/styles.layer.css'
import '@mantine/schedule/styles.layer.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BasaltErrorBoundary, BasaltProvider, createBasaltTheme } from 'basalt-ui'
import { BasaltOverlays } from 'basalt-ui/commands'
import { applyOverrides, loadOverrides } from 'basalt-ui/theme-lab'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { AuthGate } from './lib/auth-gate'
import { CrashFallback, reportCrash } from './lib/error-boundary'
import { queryClient } from './lib/query-client'
import { router } from './lib/router'
import { argoPaletteGroups, ARGO_DERIVED } from './lib/series'
// Side-effect import: registers the app's global command registry (lib/commands.tsx's
// defineCommands) before BasaltOverlays mounts, so Spotlight/ShortcutsHelp see it from boot.
import './lib/commands'
// Side-effect import: registers the app's typed notification kind registry (lib/notifications.ts's
// defineNotifications) before any emit() call, so the runtime registry is populated from boot.
import './lib/notifications'

// The theme lab owns only the editing UI (see components/dev-dock.tsx) — the host re-applies any
// persisted overrides at boot, so a tuning session survives a refresh (per the theme-lab contract).
applyOverrides(loadOverrides())

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element not found')

createRoot(rootEl).render(
  <StrictMode>
    <BasaltProvider
      theme={createBasaltTheme()}
      paletteOptions={{ groups: argoPaletteGroups, derived: ARGO_DERIVED }}
      defaultColorScheme="dark"
      // BasaltProvider's error-report contract; HyperDX's consoleCapture: true (lib/hyperdx.ts)
      // turns this into a traced error automatically.
      // oxlint-disable-next-line no-console
      onError={(error, ctx) => console.error('[basalt]', ctx, error)}
    >
      <BasaltErrorBoundary
        onError={reportCrash}
        fallback={(error) => <CrashFallback error={error} />}
      >
        <BasaltOverlays>
          <QueryClientProvider client={queryClient}>
            <AuthGate>
              <RouterProvider router={router} />
            </AuthGate>
          </QueryClientProvider>
        </BasaltOverlays>
      </BasaltErrorBoundary>
    </BasaltProvider>
  </StrictMode>,
)
