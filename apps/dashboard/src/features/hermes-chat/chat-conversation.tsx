import { useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { isTextUIPart } from 'ai'
import { useQueryClient } from '@tanstack/react-query'
import {
  ActionIcon,
  Badge,
  Box,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Textarea,
  Tooltip,
} from '@mantine/core'
import { IconArrowLeft, IconPlayerStopFilled, IconSend } from '@tabler/icons-react'
import { hermesQueries, type HermesThread } from '../../lib/queries/hermes'
import { MessageMarkdown } from './message-markdown'
import { createHermesTransport } from './transport'
import type { HermesUIMessage, ToolProgress } from './types'

// Tool-progress events whose status means the call has finished — chip is dropped.
const TERMINAL_TOOL_STATUS = new Set([
  'done',
  'complete',
  'completed',
  'success',
  'finished',
  'error',
])

// One open thread. Owns the `useChat` instance (transport → /api/hermes/chat),
// renders the live transcript with streaming markdown, and surfaces Hermes'
// transient tool-progress as live chips during a run. Hydrated with the
// persisted transcript on mount; the parent remounts this (via `key={threadId}`)
// when the open thread changes. See docs/HERMES-CHAT-PRD.md.

function messageText(message: HermesUIMessage): string {
  return message.parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join('')
}

function MessageRow({ message }: { message: HermesUIMessage }) {
  const isUser = message.role === 'user'
  const text = messageText(message)
  const interrupted = message.metadata?.status === 'interrupted'

  if (isUser) {
    return (
      <Group justify="flex-end" gap={0}>
        <Paper
          withBorder
          radius="md"
          px="sm"
          py={6}
          maw="85%"
          bg="var(--mantine-color-default-hover)"
        >
          <MessageMarkdown content={text} />
        </Paper>
      </Group>
    )
  }

  return (
    <Box maw="92%">
      <Group gap="xs" mb={2}>
        <Text size="xs" fw="semibold" c="dimmed">
          Hermes
        </Text>
        {interrupted && (
          <Badge size="xs" variant="light" color="orange" radius="sm">
            interrupted
          </Badge>
        )}
      </Group>
      <MessageMarkdown content={text} />
    </Box>
  )
}

export function ChatConversation({
  thread,
  initialMessages,
  onBack,
}: {
  thread: HermesThread
  initialMessages: HermesUIMessage[]
  onBack?: () => void
}) {
  const queryClient = useQueryClient()
  const [input, setInput] = useState('')
  // Active tool calls keyed by toolCallId — Hermes streams these out-of-band; a
  // terminal status removes the chip. Transient (never persisted into the transcript).
  const [toolProgress, setToolProgress] = useState<Record<string, ToolProgress>>({})
  const viewportRef = useRef<HTMLDivElement>(null)

  const transport = useMemo(
    () => createHermesTransport({ threadId: thread.id, sessionId: thread.session_id }),
    [thread.id, thread.session_id],
  )

  const { messages, sendMessage, status, stop, error } = useChat<HermesUIMessage>({
    id: thread.id,
    messages: initialMessages,
    transport,
    onData: (dataPart) => {
      if (dataPart.type !== 'data-toolProgress') return
      const tp = dataPart.data
      setToolProgress((prev) => {
        const next = { ...prev }
        if (TERMINAL_TOOL_STATUS.has(tp.status)) delete next[tp.toolCallId]
        else next[tp.toolCallId] = tp
        return next
      })
    },
    onFinish: () => {
      setToolProgress({})
      // Refresh thread ordering + the persisted transcript. A fresh thread is
      // auto-titled off the response path (fire-and-forget on the server), so a
      // second, delayed invalidate catches the title once DeepSeek answers.
      void queryClient.invalidateQueries({ queryKey: hermesQueries.all() })
      setTimeout(() => {
        void queryClient.invalidateQueries({
          queryKey: hermesQueries.threads('active').queryKey,
        })
      }, 2500)
    },
  })

  const isStreaming = status === 'submitted' || status === 'streaming'
  // The assistant's reply is rendered live from `messages`; only show the
  // "thinking" indicator while we wait for the first token of a new reply.
  const awaitingReply = isStreaming && messages[messages.length - 1]?.role !== 'assistant'
  const activeTools = Object.values(toolProgress)

  useEffect(() => {
    if (status === 'ready' || status === 'error') setToolProgress({})
  }, [status])

  // Keep the latest message in view as it streams.
  useEffect(() => {
    const el = viewportRef.current
    if (el) el.scrollTo({ top: el.scrollHeight })
  }, [messages, toolProgress, awaitingReply])

  function send() {
    const text = input.trim()
    if (!text || isStreaming) return
    setInput('')
    void sendMessage({ text })
  }

  return (
    <Stack h="100%" gap={0}>
      <Group
        gap="xs"
        px="sm"
        py={8}
        wrap="nowrap"
        style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
      >
        {onBack && (
          <ActionIcon variant="subtle" color="gray" onClick={onBack} aria-label="Back to threads">
            <IconArrowLeft size={18} />
          </ActionIcon>
        )}
        <Text fw="semibold" size="sm" lineClamp={1}>
          {thread.title ?? 'New chat'}
        </Text>
      </Group>

      <ScrollArea style={{ flex: 1 }} viewportRef={viewportRef} type="auto">
        <Stack gap="md" p="md">
          {messages.length === 0 && !isStreaming && (
            <Text c="dimmed" size="sm" ta="center" py="xl">
              Send a message to start the conversation.
            </Text>
          )}
          {messages.map((message) => (
            <MessageRow key={message.id} message={message} />
          ))}
          {isStreaming && activeTools.length > 0 && (
            <Group gap="xs">
              {activeTools.map((tool) => (
                <Badge
                  key={tool.toolCallId}
                  size="sm"
                  variant="light"
                  color="gray"
                  radius="sm"
                  leftSection={
                    tool.emoji ? (
                      <span aria-hidden>{tool.emoji}</span>
                    ) : (
                      <Loader size={10} color="gray" />
                    )
                  }
                >
                  {tool.label}
                </Badge>
              ))}
            </Group>
          )}
          {awaitingReply && activeTools.length === 0 && (
            <Group gap="xs" c="dimmed">
              <Loader size="xs" />
              <Text size="sm">Hermes is thinking…</Text>
            </Group>
          )}
          {error && (
            <Text size="sm" c="red">
              Something went wrong. Try sending again.
            </Text>
          )}
        </Stack>
      </ScrollArea>

      <Box p="sm" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <Textarea
            flex={1}
            autosize
            minRows={1}
            maxRows={6}
            placeholder="Message Hermes…"
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          />
          {isStreaming ? (
            <Tooltip label="Stop" withArrow>
              <ActionIcon
                size={36}
                variant="light"
                color="gray"
                onClick={() => void stop()}
                aria-label="Stop generating"
              >
                <IconPlayerStopFilled size={18} />
              </ActionIcon>
            </Tooltip>
          ) : (
            <Tooltip label="Send" withArrow>
              <ActionIcon
                size={36}
                variant="filled"
                onClick={send}
                disabled={!input.trim()}
                aria-label="Send message"
              >
                <IconSend size={18} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Box>
    </Stack>
  )
}
