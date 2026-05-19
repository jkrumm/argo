import './lib/hyperdx'

import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import '@mantine/dates/styles.css'
import '@mantine/schedule/styles.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { ModalsProvider } from '@mantine/modals'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { AuthGate } from './lib/auth-gate'
import { ErrorBoundary } from './lib/error-boundary'
import { queryClient } from './lib/query-client'
import { routeTree } from './routeTree.gen'
import { VxBridge } from './charts-bridge'

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
    <MantineProvider defaultColorScheme="dark">
      <ErrorBoundary>
        <VxBridge>
          <Notifications />
          <ModalsProvider>
            <QueryClientProvider client={queryClient}>
              <AuthGate>
                <RouterProvider router={router} />
              </AuthGate>
              {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
            </QueryClientProvider>
          </ModalsProvider>
        </VxBridge>
      </ErrorBoundary>
    </MantineProvider>
  </StrictMode>,
)
