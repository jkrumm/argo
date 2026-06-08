import { createFileRoute } from '@tanstack/react-router'
import { Suspense } from 'react'
import { Center, Loader } from '@mantine/core'
import { HermesChatPage } from '../features/hermes-chat'
import { hermesQueries } from '../lib/queries/hermes'

// Hermes Chat — thread-first chat with the Hermes agent core. Streaming transport
// (useChat → /hermes/chat), responsive list+detail, base markdown rendering.
// Smart cards/diagrams land in Group 6. See docs/HERMES-CHAT-PRD.md.

export const Route = createFileRoute('/hermes-chat')({
  loader: ({ context }) => context.queryClient.ensureQueryData(hermesQueries.threads('active')),
  component: HermesChatRoute,
})

function HermesChatRoute() {
  return (
    <Suspense
      fallback={
        <Center mih="60vh">
          <Loader />
        </Center>
      }
    >
      <HermesChatPage />
    </Suspense>
  )
}
