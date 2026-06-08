import { createFileRoute } from '@tanstack/react-router'
import { Center, Stack, Text, ThemeIcon, Title } from '@mantine/core'
import { IconMessageChatbot } from '@tabler/icons-react'

// Hermes Chat — thread-first chat with the Hermes agent core. Group 1 ships a
// placeholder only; the working chat (useChat → /hermes/chat, responsive
// list+detail, streaming render) lands in Group 5. See docs/HERMES-CHAT-PRD.md.

export const Route = createFileRoute('/hermes-chat')({
  component: HermesChatRoute,
})

function HermesChatRoute() {
  return (
    <Center mih="60vh">
      <Stack align="center" gap="sm" maw={420} ta="center">
        <ThemeIcon size={56} radius="xl" variant="light" color="blue">
          <IconMessageChatbot size={32} />
        </ThemeIcon>
        <Title order={3}>Hermes Chat</Title>
        <Text c="dimmed">
          Thread-first chat with the Hermes agent is coming soon. Streaming responses, rich
          rendering, and audio land in the upcoming build groups.
        </Text>
      </Stack>
    </Center>
  )
}
