import './lib/hyperdx'

import '@mantine/core/styles.layer.css'
import '@mantine/notifications/styles.layer.css'
import '@mantine/spotlight/styles.layer.css'
import 'basalt-ui/styles.css'
import '@mantine/dates/styles.layer.css'
import '@mantine/schedule/styles.layer.css'
import './styles/native.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BasaltProvider, createBasaltTheme } from 'basalt-ui'
import { Notifications } from '@mantine/notifications'
import { ModalsProvider } from '@mantine/modals'
import { QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { AuthGate } from './lib/auth-gate'
import { ErrorBoundary } from './lib/error-boundary'
import { queryClient } from './lib/query-client'
import { routeTree } from './routeTree.gen'
import { VxBridge } from './charts-bridge'
import { argoPaletteGroups, ARGO_DERIVED } from './lib/series'

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

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
      <ErrorBoundary>
        <VxBridge>
          <Notifications />
          <ModalsProvider>
            <QueryClientProvider client={queryClient}>
              <AuthGate>
                <RouterProvider router={router} />
              </AuthGate>
            </QueryClientProvider>
          </ModalsProvider>
        </VxBridge>
      </ErrorBoundary>
    </BasaltProvider>
  </StrictMode>,
)
