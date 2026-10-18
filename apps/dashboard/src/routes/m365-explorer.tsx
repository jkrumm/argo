import type { QueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Suspense } from 'react'
import { Center, Loader } from '@mantine/core'
import { M365ExplorerPage } from '../features/m365-explorer'
import { m365Queries } from '../lib/queries/m365'
import { shotLoader } from '../lib/shot-state'

export const Route = createFileRoute('/m365-explorer')({
  loader: shotLoader(({ context }: { context: { queryClient: QueryClient } }) =>
    Promise.all([
      context.queryClient.ensureQueryData(m365Queries.chats(50)),
      context.queryClient.ensureQueryData(m365Queries.teams()),
      context.queryClient.ensureQueryData(m365Queries.labels()),
    ]),
  ),
  component: M365ExplorerRoute,
})

function M365ExplorerRoute() {
  return (
    <Suspense
      fallback={
        <Center mih="60vh" data-shot="explorer-loading">
          <Loader />
        </Center>
      }
    >
      <M365ExplorerPage />
    </Suspense>
  )
}
