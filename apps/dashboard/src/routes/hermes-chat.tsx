import { createFileRoute, type SearchSchemaInput } from '@tanstack/react-router'
import { Suspense } from 'react'
import { Center, Loader } from '@mantine/core'
import { HermesChatPage } from '../features/hermes-chat'
import { hermesChatStore } from '../features/hermes-chat/chat-store'
import { hermesQueries } from '../lib/queries/hermes'

// Hermes Chat — thread-first chat with the Hermes agent core: a day-grouped thread list, and one
// open thread (`?thread=`) with its transcript and composer. Streaming transport
// (useChat → /hermes/chat), base markdown rendering. See docs/HERMES-CHAT-V2.md and
// docs/design/hermes-chat.md.

// The store's validated search has every key required, which would force `search` onto every link
// to this route (the nav entry in `lib/nav.tsx`, the header widget). Branding the validator's
// INPUT with `SearchSchemaInput` and making it partial keeps `/hermes-chat` linkable bare; the
// store still fills each key's fallback.
type HermesChatSearchInput = Partial<ReturnType<typeof hermesChatStore.validateSearch>> &
  SearchSchemaInput

export const Route = createFileRoute('/hermes-chat')({
  validateSearch: (raw: HermesChatSearchInput) => hermesChatStore.validateSearch(raw),
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
