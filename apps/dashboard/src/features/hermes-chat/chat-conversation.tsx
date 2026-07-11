import { useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { isTextUIPart } from 'ai'
import { useQueryClient } from '@tanstack/react-query'
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  CloseButton,
  FileButton,
  Group,
  Loader,
  Menu,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Textarea,
  Tooltip,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { emit } from 'basalt-ui/notifications'
import {
  IconArrowLeft,
  IconFile,
  IconMicrophone,
  IconPaperclip,
  IconPhoto,
  IconPlayerStopFilled,
  IconSend,
  IconSettings,
  IconTextSize,
} from '@tabler/icons-react'
import { hermesQueries, type HermesThread } from '../../lib/queries/hermes'
import { useUiStore } from '../../lib/store'
import { HERMES_CHAT_FEATURES } from './features'
import { MessageMarkdown } from './message-markdown'
import { createHermesTransport, stopHermesStream } from './transport'
import type { Attachment, HermesUIMessage, ToolProgress } from './types'
import { AttachmentDisplay } from './attachment-display'
import { useVoiceRecorder } from './voice/use-voice-recorder'
import { useVoicePlayback } from './voice/voice-playback'
import { VoiceControls } from './voice/voice-controls'
import { RecordingIndicator } from './voice/recording-indicator'
import { ReadAloudButton } from './voice/read-aloud-button'

// Inline size cap: 2 MB (base64-encoded payload stored in JSONB). Larger files
// are noted as future work requiring a server-side upload pipeline.
const ATTACHMENT_SIZE_LIMIT = 2 * 1024 * 1024
const SIZE_LIMIT_MB = ATTACHMENT_SIZE_LIMIT / (1024 * 1024)

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

function MessageRow({
  message,
  canReadAloud,
  threadId,
}: {
  message: HermesUIMessage
  canReadAloud?: boolean
  threadId: string
}) {
  const isUser = message.role === 'user'
  const text = messageText(message)
  const interrupted = message.metadata?.status === 'interrupted'
  const hasVoiceInput = (message.metadata?.audio?.length ?? 0) > 0
  const attachments = message.metadata?.attachments ?? []

  if (isUser) {
    return (
      <Group justify="flex-end" gap={0}>
        <Stack gap={4} align="flex-end" maw="85%">
          {hasVoiceInput && (
            <Group gap={4}>
              <IconMicrophone size={11} color="var(--mantine-color-dimmed)" />
              <Text size="xs" c="dimmed">
                Voice
              </Text>
            </Group>
          )}
          {attachments.length > 0 && (
            <Stack gap={6} w="100%">
              {attachments.map((att, i) => (
                <Paper key={i} withBorder radius="sm" px="sm" py={6}>
                  <AttachmentDisplay attachment={att} />
                </Paper>
              ))}
            </Stack>
          )}
          {text && (
            <Paper
              withBorder
              radius="md"
              px="sm"
              py={6}
              w="100%"
              bg="var(--mantine-color-default-hover)"
            >
              <MessageMarkdown content={text} messageId={message.id} threadId={threadId} />
            </Paper>
          )}
        </Stack>
      </Group>
    )
  }

  return (
    <Box maw="92%">
      <Group gap="xs" mb={2} justify="space-between" wrap="nowrap">
        <Group gap="xs">
          <Text size="xs" fw="semibold" c="dimmed">
            Hermes
          </Text>
          {interrupted && (
            <Badge size="xs" variant="light" color="orange" radius="sm">
              interrupted
            </Badge>
          )}
        </Group>
        {text && canReadAloud && (
          <ReadAloudButton messageId={message.id} text={text} threadId={threadId} />
        )}
      </Group>
      <MessageMarkdown content={text} messageId={message.id} threadId={threadId} />
    </Box>
  )
}

export function ChatConversation({
  thread,
  initialMessages,
  onBack,
  hideHeader,
  autoSendText,
  onAutoSent,
}: {
  thread: HermesThread
  initialMessages: HermesUIMessage[]
  onBack?: () => void
  hideHeader?: boolean
  /** First message to auto-send once on mount — used when a thread is created from
   *  the feed-level composer so the user types only once (no separate "new chat" click). */
  autoSendText?: string
  onAutoSent?: () => void
}) {
  const queryClient = useQueryClient()
  const [input, setInput] = useState('')
  const [toolProgress, setToolProgress] = useState<Record<string, ToolProgress>>({})
  const viewportRef = useRef<HTMLDivElement>(null)

  // ── Attachment state ─────────────────────────────────────────────────────────
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([])
  const pendingAttachmentsRef = useRef<Attachment[] | null>(null)
  const [longTextModalOpen, { open: openLongTextModal, close: closeLongTextModal }] =
    useDisclosure(false)
  const [longTextTitle, setLongTextTitle] = useState('')
  const [longTextContent, setLongTextContent] = useState('')

  // ── Voice: mode toggle + shared TTS playback ─────────────────────────────────
  // Voice mode is the persisted, app-wide master toggle (shared with the feed
  // composer). Playback lives in the feature-wide VoicePlaybackProvider so one
  // <audio> element is reused — that's what keeps iOS autoplay unlocked across the
  // feed → thread hop. Recording is owned by useVoiceRecorder below.
  const voiceMode = useUiStore((s) => s.voiceMode)
  const toggleVoiceMode = useUiStore((s) => s.toggleVoiceMode)
  const showToolProgress = useUiStore((s) => s.showToolProgress)
  const toggleShowToolProgress = useUiStore((s) => s.toggleShowToolProgress)
  const { audioAvailable, setAudioAvailable, primePlayback, readAloud } = useVoicePlayback()

  // Carries the recorded clip duration into the next sendMessage so the user turn is
  // tagged with its audio length (usage) — read in prepareSendMessagesRequest.
  const pendingAudioMsRef = useRef<number | null>(null)
  // Latest assistant message id already auto-spoken in voice mode (speak once). Seeded
  // with the last historical assistant message so opening an existing thread with voice
  // mode on doesn't blurt an old reply on mount — only NEW replies auto-speak.
  const lastSpokenRef = useRef<string | null>(
    initialMessages.findLast((m) => m.role === 'assistant')?.id ?? null,
  )
  // A reply that completes while Argo is backgrounded is stashed here and spoken when
  // you return — auto-pause "holds until you return", rather than blurting immediately.
  const pendingSpeakRef = useRef<{ id: string; text: string } | null>(null)
  // Mirror voice mode into a ref so async callbacks read the live value. Assigned in
  // render (no effect) to avoid a frame of staleness.
  const voiceModeRef = useRef(voiceMode)
  voiceModeRef.current = voiceMode

  // ── Transport ────────────────────────────────────────────────────────────────
  const transport = useMemo(
    () =>
      createHermesTransport({
        threadId: thread.id,
        sessionId: thread.session_id,
        getPendingAudio: () => pendingAudioMsRef.current,
        getPendingAttachments: () => pendingAttachmentsRef.current,
      }),
    [thread.id, thread.session_id],
  )

  const { messages, sendMessage, status, stop, error } = useChat<HermesUIMessage>({
    id: thread.id,
    messages: initialMessages,
    transport,
    // Recover an in-flight turn after a dropped connection or reload: fires a GET
    // to /hermes/chat/:id/stream on mount (204 when nothing is streaming).
    resume: true,
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
      void queryClient.invalidateQueries({ queryKey: hermesQueries.all() })
      const threadsKey = hermesQueries.threads('active').queryKey
      let attempts = 0
      const pollForTitle = async (): Promise<void> => {
        attempts += 1
        await queryClient.invalidateQueries({ queryKey: threadsKey })
        const titled = queryClient
          .getQueryData<{ data: HermesThread[]; total: number }>(threadsKey)
          ?.data.find((t) => t.id === thread.id)?.title
        if (!titled && attempts < 6) setTimeout(() => void pollForTitle(), 1500)
      }
      setTimeout(() => void pollForTitle(), 1500)
    },
  })

  const isStreaming = status === 'submitted' || status === 'streaming'
  const awaitingReply = isStreaming && messages[messages.length - 1]?.role !== 'assistant'
  const activeTools = Object.values(toolProgress)

  useEffect(() => {
    if (status === 'ready' || status === 'error') setToolProgress({})
  }, [status])

  useEffect(() => {
    const el = viewportRef.current
    if (el) el.scrollTo({ top: el.scrollHeight })
  }, [messages, toolProgress, awaitingReply])

  // Auto-send the seed message exactly once when a thread is opened straight from the
  // feed composer (create-and-send), so "new chat" needs no extra click.
  const autoSentRef = useRef(false)
  useEffect(() => {
    if (autoSentRef.current || !autoSendText?.trim()) return
    autoSentRef.current = true
    void sendMessage({ text: autoSendText.trim() })
    onAutoSent?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSendText])

  // ── Send ────────────────────────────────────────────────────────────────────

  function send() {
    const text = input.trim()
    if ((!text && pendingAttachments.length === 0) || isStreaming) return

    // For text attachments, append content to the Hermes-bound message so Hermes
    // can read it. Image/file attachments are stored in payload only (display).
    let augmentedText = text
    for (const att of pendingAttachments) {
      if (att.type === 'text' && att.content?.trim()) {
        const header = att.title ? `**${att.title}**\n` : ''
        augmentedText = augmentedText
          ? `${augmentedText}\n\n${header}${att.content}`
          : `${header}${att.content}`
      }
    }

    pendingAttachmentsRef.current = pendingAttachments.length > 0 ? pendingAttachments : null
    setInput('')
    setPendingAttachments([])
    void sendMessage({ text: augmentedText || text || ' ' })
    // Both refs are read synchronously inside prepareSendMessagesRequest, which
    // runs during sendMessage, so clear them after the call.
    pendingAudioMsRef.current = null
    pendingAttachmentsRef.current = null
  }

  // ── Attachment handlers ──────────────────────────────────────────────────────

  function handleLongTextSave() {
    const content = longTextContent.trim()
    if (!content) return
    const att: Attachment = {
      type: 'text',
      ...(longTextTitle.trim() ? { title: longTextTitle.trim() } : {}),
      content,
    }
    setPendingAttachments((prev) => [...prev, att])
    setLongTextTitle('')
    setLongTextContent('')
    closeLongTextModal()
  }

  async function readFileAsAttachment(file: File, kind: 'image' | 'file') {
    if (file.size > ATTACHMENT_SIZE_LIMIT) {
      emit(
        'chat:error',
        { message: `Attachments must be under ${SIZE_LIMIT_MB} MB.` },
        { title: 'File too large' },
      )
      return
    }
    let dataUrl: string
    try {
      dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.addEventListener('load', () => resolve(reader.result as string))
        reader.addEventListener('error', () => reject(reader.error))
        reader.readAsDataURL(file)
      })
    } catch {
      emit('chat:error', { message: 'Could not read the selected file.' }, { title: 'Read error' })
      return
    }
    if (kind === 'image') {
      const att: Attachment = {
        type: 'image',
        dataUrl,
        mimeType: file.type,
        ...(file.name ? { fileName: file.name } : {}),
        ...(file.name ? { title: file.name } : {}),
      }
      setPendingAttachments((prev) => [...prev, att])
    } else {
      const att: Attachment = {
        type: 'file',
        dataUrl,
        mimeType: file.type,
        fileName: file.name,
        sizeBytes: file.size,
        ...(file.name ? { title: file.name } : {}),
      }
      setPendingAttachments((prev) => [...prev, att])
    }
  }

  function removeAttachment(index: number) {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  // ── Voice recording → STT ───────────────────────────────────────────────────
  // The recorder hands back a transcript; this component decides what to do with it.
  const {
    isRecording,
    isTranscribing,
    recordingMs,
    toggle: toggleRecording,
  } = useVoiceRecorder({
    setAudioAvailable,
    onPrime: primePlayback,
    onResult: (transcript, durationMs) => {
      if (voiceModeRef.current) {
        // Voice mode: skip the input box and send the transcript straight away.
        pendingAudioMsRef.current = durationMs
        void sendMessage({ text: transcript })
        pendingAudioMsRef.current = null
      } else {
        setInput((prev) => (prev ? `${prev} ${transcript}` : transcript))
        pendingAudioMsRef.current = durationMs
      }
    },
  })

  // ── Read-aloud → TTS ────────────────────────────────────────────────────────

  // Voice mode: once a reply finishes streaming, speak a SHORT summary of it — but
  // only while Argo is foregrounded. If you've switched away (e.g. into a Teams
  // call) the reply is marked spoken and held, so it won't blurt out when you
  // return. Explicit read-aloud is unaffected and always speaks the full text.
  useEffect(() => {
    if (!voiceModeRef.current || status !== 'ready') return
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant' || lastSpokenRef.current === last.id) return
    const text = messageText(last)
    if (!text.trim()) return
    // Auto-pause: while Argo is backgrounded, defer instead of speaking — the
    // visibilitychange effect below replays it on return. Leave it unmarked so it can
    // still be spoken when you come back.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      pendingSpeakRef.current = { id: last.id, text }
      return
    }
    lastSpokenRef.current = last.id
    void readAloud(last.id, text, { summarize: true, threadId: thread.id })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, messages])

  // Replay a reply that was deferred while backgrounded, once Argo is foreground again.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const pending = pendingSpeakRef.current
      pendingSpeakRef.current = null
      if (!pending || !voiceModeRef.current) return
      lastSpokenRef.current = pending.id
      void readAloud(pending.id, pending.text, { summarize: true, threadId: thread.id })
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [readAloud, thread.id])

  // Per-message read-aloud (full text — only voice mode summarizes) is offered only
  // when audio isn't confirmed unavailable and no reply is streaming. The control
  // itself reads live playback state from the provider.
  const canReadAloud = audioAvailable !== false && !isStreaming

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Stack h="100%" gap={0}>
      {!hideHeader && (
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
          <Text fw="semibold" size="sm" lineClamp={1} flex={1}>
            {thread.title ?? 'New chat'}
          </Text>
          <Menu shadow="md" position="bottom-end" withinPortal>
            <Menu.Target>
              <Tooltip label="Chat settings" withArrow>
                <ActionIcon variant="subtle" color="gray" size={28} aria-label="Chat settings">
                  <IconSettings size={15} />
                </ActionIcon>
              </Tooltip>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                onClick={toggleShowToolProgress}
                rightSection={
                  <Text size="xs" c="dimmed">
                    {showToolProgress ? 'on' : 'off'}
                  </Text>
                }
              >
                Show tool activity
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      )}

      <ScrollArea style={{ flex: 1 }} viewportRef={viewportRef} type="auto">
        <Stack gap="md" p="md">
          {messages.length === 0 && !isStreaming && (
            <Text c="dimmed" size="sm" ta="center" py="xl">
              Send a message to start the conversation.
            </Text>
          )}
          {messages.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              canReadAloud={canReadAloud}
              threadId={thread.id}
            />
          ))}
          {isStreaming && (
            <Group gap={6}>
              <Badge
                size="sm"
                variant="light"
                color="gray"
                radius="sm"
                leftSection={<Loader size={10} color="gray" />}
              >
                {showToolProgress && activeTools.length > 0
                  ? activeTools
                      .map((t) => t.emoji ?? '')
                      .filter(Boolean)
                      .join(' ') || 'working…'
                  : 'working…'}
              </Badge>
            </Group>
          )}
          {error && (
            <Text size="sm" c="red">
              Something went wrong. Try sending again.
            </Text>
          )}
        </Stack>
      </ScrollArea>

      {/* Long Text attachment modal */}
      <Modal
        opened={longTextModalOpen}
        onClose={closeLongTextModal}
        title="Add text attachment"
        size="lg"
      >
        <Stack gap="sm">
          <Textarea
            label="Title (optional)"
            placeholder="e.g. Context, Paste, Draft…"
            value={longTextTitle}
            onChange={(e) => setLongTextTitle(e.currentTarget.value)}
            autosize
            minRows={1}
            maxRows={2}
          />
          <Textarea
            label="Content"
            placeholder="Paste or type longform text here…"
            value={longTextContent}
            onChange={(e) => setLongTextContent(e.currentTarget.value)}
            autosize
            minRows={6}
            maxRows={20}
            data-autofocus
          />
          <Group justify="flex-end" gap="xs">
            <Button variant="subtle" color="gray" onClick={closeLongTextModal}>
              Cancel
            </Button>
            <Button onClick={handleLongTextSave} disabled={!longTextContent.trim()}>
              Attach
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Box p="sm" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
        {/* Pending attachment chips */}
        {pendingAttachments.length > 0 && (
          <Stack gap={4} mb="xs">
            {pendingAttachments.map((att, i) => (
              <Group key={i} gap={6} wrap="nowrap">
                {att.type === 'image' ? (
                  <IconPhoto size={13} color="var(--mantine-color-dimmed)" />
                ) : att.type === 'file' ? (
                  <IconFile size={13} color="var(--mantine-color-dimmed)" />
                ) : (
                  <IconTextSize size={13} color="var(--mantine-color-dimmed)" />
                )}
                <Text size="xs" c="dimmed" flex={1} lineClamp={1}>
                  {att.type === 'file' || att.type === 'image'
                    ? (att.fileName ?? att.title ?? att.type)
                    : (att.title ?? 'Text attachment')}
                </Text>
                <CloseButton
                  size="xs"
                  aria-label="Remove attachment"
                  onClick={() => removeAttachment(i)}
                />
              </Group>
            ))}
          </Stack>
        )}

        {isRecording && <RecordingIndicator recordingMs={recordingMs} />}

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

          {/* Attach menu */}
          <Menu shadow="md" position="top-end" withinPortal>
            <Menu.Target>
              <Tooltip label="Attach" withArrow>
                <ActionIcon
                  size={36}
                  variant={pendingAttachments.length > 0 ? 'light' : 'subtle'}
                  color={pendingAttachments.length > 0 ? 'blue' : 'gray'}
                  aria-label="Attach"
                >
                  <IconPaperclip size={18} />
                </ActionIcon>
              </Tooltip>
            </Menu.Target>
            <Menu.Dropdown>
              {HERMES_CHAT_FEATURES.imageUpload && (
                <FileButton
                  onChange={(file) => {
                    if (file) readFileAsAttachment(file, 'image')
                  }}
                  accept="image/*"
                >
                  {(props) => (
                    <Menu.Item {...props} leftSection={<IconPhoto size={14} />}>
                      Image
                    </Menu.Item>
                  )}
                </FileButton>
              )}
              {HERMES_CHAT_FEATURES.fileUpload && (
                <FileButton
                  onChange={(file) => {
                    if (file) readFileAsAttachment(file, 'file')
                  }}
                >
                  {(props) => (
                    <Menu.Item {...props} leftSection={<IconFile size={14} />}>
                      File
                    </Menu.Item>
                  )}
                </FileButton>
              )}
              <Menu.Item leftSection={<IconTextSize size={14} />} onClick={openLongTextModal}>
                Long Text
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>

          {HERMES_CHAT_FEATURES.audioTranscription && (
            <VoiceControls
              voiceMode={voiceMode}
              onToggleVoiceMode={toggleVoiceMode}
              isRecording={isRecording}
              isTranscribing={isTranscribing}
              audioAvailable={audioAvailable}
              onMicClick={toggleRecording}
              micDisabled={isStreaming}
            />
          )}
          {isStreaming ? (
            <Tooltip label="Stop" withArrow>
              <ActionIcon
                size={36}
                variant="light"
                color="gray"
                onClick={() => {
                  // With resume on, local stop() is only a disconnect — abort the
                  // generation server-side first so it truly stops and persists.
                  void stopHermesStream(thread.id)
                  void stop()
                }}
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
                disabled={!input.trim() && pendingAttachments.length === 0}
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
