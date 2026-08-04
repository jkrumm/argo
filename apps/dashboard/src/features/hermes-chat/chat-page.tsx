import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { ActionIcon, Box, Group, Stack, Text, Textarea, Tooltip } from '@mantine/core'
import { IconSend } from '@tabler/icons-react'
import { hermesMutations, hermesQueries, type HermesThread } from '../../lib/queries/hermes'
import { useUiStore } from '../../lib/store'
import { ThreadFeedRow } from './thread-feed-row'
import { HERMES_CHAT_FEATURES } from './features'
import { useVoicePlayback } from './voice/voice-playback'
import { useVoiceRecorder } from './voice/use-voice-recorder'
import { VoiceControls } from './voice/voice-controls'
import { RecordingIndicator } from './voice/recording-indicator'

// Single-column Slack-style thread feed, chat-anchored: the feed scrolls with the
// newest thread at the BOTTOM (older scroll up), and a single composer is pinned to
// the bottom of the viewport. Typing there STARTS a new chat — it creates a thread and
// auto-sends the message (no separate "new chat" click). Continuing an existing thread
// uses that thread's own inline composer once expanded.
// See docs/HERMES-CHAT-PRD.md + ChatWireframe.svg.

// Full-bleed chat surface: fill the whole main area and cancel AppShell.Main's `padding="md"`
// with a negative margin so the feed and composer sit flush to the edges (no inset frame).
const FILL_HEIGHT =
  'calc(100dvh - var(--app-shell-header-offset, 0rem) - var(--app-shell-footer-offset, 0rem))'
const BLEED_MARGIN = 'calc(var(--app-shell-padding) * -1)'

// The playback provider is lifted to the app root so the header widget and every thread
// share ONE <audio> element — the key to iOS autoplay surviving navigation. The page is
// just the feed now.
export function HermesChatPage() {
  return <HermesChatFeed />
}

function HermesChatFeed() {
  const queryClient = useQueryClient()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  // Seed message per freshly-created thread — consumed once by its ChatConversation.
  const [seeds, setSeeds] = useState<Record<string, string>>({})
  const pendingSeedRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const { data } = useSuspenseQuery(hermesQueries.threads('active'))
  const threads = data.data

  function scrollToBottom() {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  const create = useMutation({
    ...hermesMutations.createThread(),
    onSuccess: (thread: HermesThread) => {
      queryClient.setQueryData(hermesQueries.threads('active').queryKey, (old) =>
        old ? { data: [thread, ...old.data], total: old.total + 1 } : { data: [thread], total: 1 },
      )
      const seed = pendingSeedRef.current
      pendingSeedRef.current = null
      if (seed) setSeeds((prev) => ({ ...prev, [thread.id]: seed }))
      setExpandedId(thread.id)
      requestAnimationFrame(() => requestAnimationFrame(scrollToBottom))
    },
  })

  const remove = useMutation(hermesMutations.deleteThread())

  // Start pinned to the newest (bottom) thread, chat-style.
  useEffect(() => {
    scrollToBottom()
  }, [])

  // One-shot cleanup of empty/abandoned threads on load: a thread that never received a turn
  // still has `updated_at === created_at` (message persistence bumps updated_at). Threads
  // created this session always carry a seed message, so they're never caught here.
  const cleanedRef = useRef(false)
  useEffect(() => {
    if (cleanedRef.current) return
    cleanedRef.current = true
    const empties = threads.filter((t) => t.updated_at === t.created_at)
    if (empties.length === 0) return
    const emptyIds = new Set(empties.map((t) => t.id))
    queryClient.setQueryData(hermesQueries.threads('active').queryKey, (old) =>
      old
        ? {
            data: old.data.filter((t) => !emptyIds.has(t.id)),
            total: Math.max(0, old.total - empties.length),
          }
        : old,
    )
    void Promise.allSettled(empties.map((t) => remove.mutateAsync(t.id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function startChatWith(text: string) {
    const trimmed = text.trim()
    if (!trimmed || create.isPending) return
    setInput('')
    pendingSeedRef.current = trimmed
    create.mutate({})
  }

  function startChat() {
    startChatWith(input)
  }

  // Cross-app intent from the header widget: a `draft` seeds + starts a new chat, an `open`
  // expands the targeted thread. Keyed on the intent so it runs once per dispatch;
  // `consumeHermesIntent` reads-and-clears so it never re-fires.
  const hermesIntent = useUiStore((s) => s.hermesIntent)
  const consumeHermesIntent = useUiStore((s) => s.consumeHermesIntent)
  useEffect(() => {
    if (!hermesIntent) return
    const intent = consumeHermesIntent()
    if (!intent) return
    if (intent.type === 'draft') startChatWith(intent.text)
    else setExpandedId(intent.threadId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hermesIntent])

  // ── Voice: master toggle + dictation that starts a chat ──────────────────────
  const voiceMode = useUiStore((s) => s.voiceMode)
  const toggleVoiceMode = useUiStore((s) => s.toggleVoiceMode)
  const { audioAvailable, setAudioAvailable, primePlayback } = useVoicePlayback()

  // Mirror voice mode into a ref for the recorder's async onResult. Assigned in render
  // (no effect) to avoid a frame of staleness.
  const voiceModeRef = useRef(voiceMode)
  voiceModeRef.current = voiceMode

  const {
    isRecording,
    isTranscribing,
    recordingMs,
    toggle: toggleRecording,
  } = useVoiceRecorder({
    setAudioAvailable,
    onPrime: primePlayback,
    onResult: (transcript) => {
      // Voice mode: dictation immediately starts a new chat (the new thread inherits
      // voice mode from the shared store and speaks its reply). Otherwise just fill
      // the composer so it can be reviewed before sending.
      if (voiceModeRef.current) startChatWith(transcript)
      else setInput((prev) => (prev ? `${prev} ${transcript}` : transcript))
    },
  })

  function consumeSeed(id: string) {
    setSeeds((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  function toggleThread(id: string) {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  // Newest-first from the API → render reversed so the newest sits at the bottom.
  const ordered = threads.toReversed()

  return (
    <Stack h={FILL_HEIGHT} gap={0} style={{ margin: BLEED_MARGIN }}>
      {/* theme-allow — scrollRef reads scrollTop/scrollHeight directly for scrollToBottom(); ScrollArea's viewport is an internal implementation detail, not a ref-able node. */}
      <Box ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <Stack gap={0} mih="100%" justify="flex-end">
          {ordered.length === 0 ? (
            <Text c="dimmed" size="sm" ta="center" py="xl">
              No threads yet. Type below to start.
            </Text>
          ) : (
            ordered.map((thread) => (
              <ThreadFeedRow
                key={thread.id}
                thread={thread}
                expanded={thread.id === expandedId}
                onToggle={() => toggleThread(thread.id)}
                autoSendText={seeds[thread.id]}
                onAutoSent={() => consumeSeed(thread.id)}
              />
            ))
          )}
        </Stack>
      </Box>

      <Box
        p="sm"
        style={{ borderTop: '1px solid var(--mantine-color-default-border)', flexShrink: 0 }}
      >
        {isRecording && <RecordingIndicator recordingMs={recordingMs} />}

        <Group gap="xs" align="flex-end" wrap="nowrap">
          <Textarea
            flex={1}
            autosize
            minRows={1}
            maxRows={6}
            placeholder={
              voiceMode
                ? 'Talk or type — starts a new chat…'
                : 'Message Hermes — starts a new chat…'
            }
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                startChat()
              }
            }}
          />
          {HERMES_CHAT_FEATURES.audioTranscription && (
            <VoiceControls
              voiceMode={voiceMode}
              onToggleVoiceMode={toggleVoiceMode}
              isRecording={isRecording}
              isTranscribing={isTranscribing}
              audioAvailable={audioAvailable}
              onMicClick={toggleRecording}
              micDisabled={create.isPending}
            />
          )}
          <Tooltip label="Start chat" withArrow>
            <ActionIcon
              size={36}
              variant="filled"
              onClick={startChat}
              loading={create.isPending}
              disabled={!input.trim()}
              aria-label="Start new chat"
            >
              <IconSend size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Box>
    </Stack>
  )
}
