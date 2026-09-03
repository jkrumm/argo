import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { formatDistanceToNowStrict } from 'date-fns'
import {
  ActionIcon,
  Badge,
  Box,
  Center,
  Divider,
  Group,
  Loader,
  Popover,
  Stack,
  Text,
  Textarea,
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { IconMessageChatbot, IconMicrophone, IconSend } from '@tabler/icons-react'
import { hermesQueries, type HermesThread, type HermesThreadType } from '../../lib/queries/hermes'
import { useUiStore } from '../../lib/store'
import { useVoicePlayback } from './voice/voice-playback'
import { useVoiceRecorder } from './voice/use-voice-recorder'
import classes from './hermes-widget.module.css'

// Global Hermes widget, rendered in the header via GlobalActions. A one-tap entry
// point to Hermes Chat from anywhere: peek at recent threads, hand the chat page a
// draft or an open-thread intent, dictate, or jump straight in. The trigger doubles
// as the app-wide TTS status light — when a reply is being spoken it wraps the icon
// in a progress ring with a remaining-time readout (mirrors ReadAloudButton).
//
// Identity blue earns its place on exactly two surfaces (DESIGN.md): the speaking
// ring and the send button. Everything else stays neutral gray.

// Allowed Mantine accents only (DESIGN.md: no teal/violet/grape/indigo/pink).
// Mirrors hermes-row.tsx so the type badges read identically everywhere.
const TYPE_COLOR: Record<HermesThreadType, string> = {
  todo: 'blue',
  podcast: 'orange',
  infra: 'gray',
  note: 'yellow',
  research: 'green',
  general: 'gray',
}

const TYPE_LABEL: Record<HermesThreadType, string> = {
  todo: 'Todo',
  podcast: 'Podcast',
  infra: 'Infra',
  note: 'Note',
  research: 'Research',
  general: 'General',
}

// Recent active threads shown in the dropdown — enough to recognise, few enough to scan.
const MAX_THREADS = 6

export function HermesWidget() {
  const navigate = useNavigate()
  const setHermesIntent = useUiStore((s) => s.setHermesIntent)
  const { playingThreadId, audioAvailable, setAudioAvailable, primePlayback } = useVoicePlayback()

  const [opened, { open, close, toggle }] = useDisclosure(false)
  const [input, setInput] = useState('')

  // Only fetch the thread list while the popover is open — the trigger lives in the
  // header on every page, so an always-on query would poll feed data app-wide.
  const { data, isLoading } = useQuery({
    ...hermesQueries.threads('active'),
    enabled: opened,
  })
  const threads = (data?.data ?? []).slice(0, MAX_THREADS)

  const {
    isRecording,
    isTranscribing,
    toggle: toggleRecording,
  } = useVoiceRecorder({
    setAudioAvailable,
    onPrime: primePlayback,
    // Append each transcript to the current input (space-joined) for review before send.
    onResult: (transcript) => setInput((prev) => (prev ? `${prev} ${transcript}` : transcript)),
  })

  function goToChat() {
    void navigate({ to: '/hermes-chat' })
    close()
  }

  function sendDraft() {
    const trimmed = input.trim()
    if (!trimmed) return
    setHermesIntent({ type: 'draft', text: trimmed })
    setInput('')
    goToChat()
  }

  function openThread(threadId: string) {
    setHermesIntent({ type: 'open', threadId })
    goToChat()
  }

  return (
    <Popover
      width="min(380px, calc(100vw - 1.5rem))"
      position="bottom-end"
      withArrow
      shadow="md"
      opened={opened}
      onChange={(v) => (v ? open() : close())}
    >
      <Popover.Target>
        <ActionIcon
          size={36}
          variant="subtle"
          color="gray"
          onClick={toggle}
          aria-label="Hermes chats"
        >
          <IconMessageChatbot size={18} />
        </ActionIcon>
      </Popover.Target>

      <Popover.Dropdown p="md">
        <Stack gap="sm">
          <Text size="sm" fw="semibold">
            Hermes
          </Text>

          {isLoading ? (
            <Center py="sm">
              <Loader size="sm" color="gray" />
            </Center>
          ) : threads.length === 0 ? (
            <Text size="xs" c="dimmed" py={6}>
              No active chats
            </Text>
          ) : (
            <Stack gap={4}>
              {threads.map((thread) => (
                <ThreadRow
                  key={thread.id}
                  thread={thread}
                  speaking={thread.id === playingThreadId}
                  onClick={() => openThread(thread.id)}
                />
              ))}
            </Stack>
          )}

          <Divider />

          <Group gap="xs" align="flex-end" wrap="nowrap">
            <Textarea
              flex={1}
              autosize
              minRows={1}
              maxRows={4}
              placeholder="Message Hermes…"
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendDraft()
                }
              }}
            />
            <Tooltip label={isRecording ? 'Stop recording' : 'Dictate'} withArrow>
              <ActionIcon
                size={36}
                variant={isRecording ? 'light' : 'subtle'}
                color="gray"
                onClick={toggleRecording}
                loading={isTranscribing}
                disabled={audioAvailable === false}
                aria-label={isRecording ? 'Stop recording' : 'Dictate'}
              >
                <IconMicrophone size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Send" withArrow>
              <ActionIcon
                size={36}
                variant="filled"
                onClick={sendDraft}
                disabled={!input.trim()}
                aria-label="Send message"
              >
                <IconSend size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>

          <UnstyledButton
            className={classes.openFull}
            onClick={goToChat}
            aria-label="Open full chat"
          >
            <Text size="xs" c="dimmed" ta="center">
              Open full chat
            </Text>
          </UnstyledButton>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}

function ThreadRow({
  thread,
  speaking,
  onClick,
}: {
  thread: HermesThread
  speaking: boolean
  onClick: () => void
}) {
  return (
    <UnstyledButton
      className={classes.threadRow}
      onClick={onClick}
      aria-label={thread.title ?? 'New chat'}
    >
      <Box px="xs" py={6}>
        <Group gap="xs" wrap="nowrap" justify="space-between">
          <Group gap={6} wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
            {thread.type && (
              <Badge
                size="xs"
                variant="light"
                color={TYPE_COLOR[thread.type]}
                radius="sm"
                style={{ flexShrink: 0 }}
              >
                {TYPE_LABEL[thread.type]}
              </Badge>
            )}
            <Text size="sm" lineClamp={1}>
              {thread.title ?? 'New chat'}
            </Text>
          </Group>
          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
            {speaking
              ? 'Speaking'
              : formatDistanceToNowStrict(new Date(thread.updated_at), { addSuffix: false })}
          </Text>
        </Group>
      </Box>
    </UnstyledButton>
  )
}
