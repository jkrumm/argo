import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { createBasaltTheme } from 'basalt-ui'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

/** The markup of a component in the providers the pages run in (theme, query client, a router for `Link`). */
export async function renderMarkup(ui: ReactNode): Promise<string> {
  const root = createRootRoute({ component: () => <>{ui}</> })
  const review = createRoute({ getParentRoute: () => root, path: '/documents/review' })
  const router = createRouter({
    routeTree: root.addChildren([review]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MantineProvider theme={createBasaltTheme()}>
        <RouterProvider router={router} />
      </MantineProvider>
    </QueryClientProvider>,
  )
}
