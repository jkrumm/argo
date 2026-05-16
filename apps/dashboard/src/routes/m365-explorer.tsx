import { createFileRoute } from '@tanstack/react-router'
import { Suspense } from 'react'
import { Center, Loader } from '@mantine/core'
import { M365ExplorerPage } from '../features/m365-explorer'
import { m365Queries } from '../lib/queries/m365'

export const Route = createFileRoute('/m365-explorer')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(m365Queries.chats(50)),
      context.queryClient.ensureQueryData(m365Queries.teams()),
      context.queryClient.ensureQueryData(m365Queries.labels()),
    ]),
  component: M365ExplorerRoute,
})

function M365ExplorerRoute() {
  return (
    <Suspense
      fallback={
        <Center mih="60vh">
          <Loader />
        </Center>
      }
    >
      <M365ExplorerPage />
    </Suspense>
  )
}
