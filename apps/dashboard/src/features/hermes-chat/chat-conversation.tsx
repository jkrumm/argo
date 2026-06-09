import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { isTextUIPart } from 'ai'
import { useQueryClient } from '@tanstack/react-query'
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  CloseButton,
  Collapse,
  FileButton,
  Group,
  Image,
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
import { notifications } from '@mantine/notifications'
import {
  IconArrowLeft,
  IconFile,
  IconFileText,
  IconMicrophone,
  IconPaperclip,
  IconPhoto,
  IconPlayerStopFilled,
  IconSend,
  IconTextSize,
  IconVolume,
} from '@tabler/icons-react'
import { hermesQueries, type HermesThread } from '../../lib/queries/hermes'
import { getToken } from '../../lib/auth'
import { MessageMarkdown } from './message-markdown'
import { createHermesTransport, apiBase } from './transport'
import type { Attachment, HermesUIMessage, ToolProgress } from './types'

// Inline size cap: 2 MB (base64-encoded payload stored in JSONB). Larger files
// are noted as future work requiring a server-side upload pipeline.
const ATTACHMENT_SIZE_LIMIT = 2 * 1024 * 1024

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

function AttachmentDisplay({ attachment }: { attachment: Attachment }) {
  const [expanded, setExpanded] = useState(false)

  if (attachment.type === 'image') {
    return (
      <Box>
        {attachment.title && (
          <Text size="xs" c="dimmed" mb={4}>
            {attachment.title}
          </Text>
        )}
        <Image
          src={attachment.dataUrl}
          alt={attachment.title ?? attachment.fileName ?? 'Image'}
          maw={240}
          radius="sm"
          style={{ border: '1px solid var(--mantine-color-default-border)' }}
        />
      </Box>
    )
  }

  if (attachment.type === 'file') {
    return (
      <Group gap={6} wrap="nowrap">
        <IconFile size={14} color="var(--mantine-color-dimmed)" />
        <Text size="xs" c="dimmed" lineClamp={1}>
          {attachment.fileName}
          {attachment.sizeBytes > 0 &&
            ` (${attachment.sizeBytes < 1024 ? `${attachment.sizeBytes} B` : attachment.sizeBytes < 1024 * 1024 ? `${Math.round(attachment.sizeBytes / 1024)} KB` : `${(attachment.sizeBytes / (1024 * 1024)).toFixed(1)} MB`})`}
        </Text>
      </Group>
    )
  }

  // type === 'text'
  const hasContent = Boolean(attachment.content?.trim())
  return (
    <Box>
      <Group
        gap={6}
        wrap="nowrap"
        style={hasContent ? { cursor: 'pointer' } : undefined}
        onClick={hasContent ? () => setExpanded((v) => !v) : undefined}
      >
        <IconFileText size={14} color="var(--mantine-color-dimmed)" />
        <Text size="xs" c="dimmed">
          {attachment.title ?? 'Text attachment'}
        </Text>
        {hasContent && (
          <Text size="xs" c="dimmed">
            {expanded ? '▲' : '▼'}
          </Text>
        )}
      </Group>
      {hasContent && (
        <Collapse expanded={expanded}>
          <Paper
            withBorder
            radius="sm"
            p="xs"
            mt={6}
            style={{ background: 'var(--mantine-color-default-hover)' }}
          >
            <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>
              {attachment.content}
            </Text>
          </Paper>
        </Collapse>
      )}
    </Box>
  )
}

function MessageRow({
  message,
  onReadAloud,
  isPlayingAloud,
}: {
  message: HermesUIMessage
  onReadAloud?: (id: string, text: string) => void
  isPlayingAloud?: boolean
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
              <MessageMarkdown content={text} />
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
        {text && onReadAloud && (
          <Tooltip label={isPlayingAloud ? 'Stop' : 'Read aloud'} withArrow>
            <ActionIcon
              size={20}
              variant="subtle"
              color="gray"
              onClick={() => onReadAloud(message.id, text)}
              aria-label={isPlayingAloud ? 'Stop reading' : 'Read aloud'}
            >
              {isPlayingAloud ? <IconPlayerStopFilled size={12} /> : <IconVolume size={12} />}
            </ActionIcon>
          </Tooltip>
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
  hideHeader,
}: {
  thread: HermesThread
  initialMessages: HermesUIMessage[]
  onBack?: () => void
  hideHeader?: boolean
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

  // ── Audio state ─────────────────────────────────────────────────────────────
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  // null = unknown, false = 503 confirmed (controls disabled), true = working
  const [audioAvailable, setAudioAvailable] = useState<boolean | null>(null)
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null)

  const pendingAudioMsRef = useRef<number | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordingChunksRef = useRef<Blob[]>([])
  const recordingStartRef = useRef<number>(0)
  const playingAudioRef = useRef<HTMLAudioElement | null>(null)

  // Cleanup audio resources on unmount.
  useEffect(() => {
    return () => {
      if (playingAudioRef.current) {
        playingAudioRef.current.pause()
        playingAudioRef.current = null
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
    }
  }, [])

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

  function readFileAsAttachment(file: File, kind: 'image' | 'file') {
    if (file.size > ATTACHMENT_SIZE_LIMIT) {
      notifications.show({
        title: 'File too large',
        message: `Attachments must be under ${ATTACHMENT_SIZE_LIMIT / (1024 * 1024)} MB.`,
        color: 'red',
      })
      return
    }
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      const dataUrl = reader.result as string
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
    })
    reader.readAsDataURL(file)
  }

  function removeAttachment(index: number) {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  // ── Voice recording → STT ───────────────────────────────────────────────────

  const finishRecording = useCallback(async (chunks: Blob[], durationMs: number) => {
    setIsTranscribing(true)
    try {
      const blob = new Blob(chunks, { type: 'audio/webm' })
      const form = new FormData()
      form.append('file', blob, 'recording.webm')
      const token = getToken()
      const res = await fetch(`${apiBase}/ai/v1/audio/transcriptions`, {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: form,
      })
      if (!res.ok) {
        if (res.status === 503) {
          setAudioAvailable(false)
          notifications.show({
            title: 'Audio unavailable',
            message: 'Audio proxy is not configured.',
            color: 'red',
          })
        }
        return
      }
      const json = (await res.json()) as { text?: string }
      const transcript = (json.text ?? '').trim()
      if (transcript) {
        setInput((prev) => (prev ? `${prev} ${transcript}` : transcript))
        pendingAudioMsRef.current = durationMs
      }
      setAudioAvailable(true)
    } catch {
      notifications.show({
        title: 'Transcription failed',
        message: 'Could not transcribe audio.',
        color: 'red',
      })
    } finally {
      setIsTranscribing(false)
    }
  }, [])

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    setIsRecording(false)
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      notifications.show({
        title: 'Microphone unavailable',
        message: 'Your browser does not support audio recording.',
        color: 'red',
      })
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      const chunks: Blob[] = []
      recordingChunksRef.current = chunks
      recordingStartRef.current = Date.now()

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        void finishRecording(chunks, Date.now() - recordingStartRef.current)
      }

      mediaRecorderRef.current = recorder
      recorder.start()
      setIsRecording(true)
    } catch {
      notifications.show({
        title: 'Microphone unavailable',
        message: 'Could not access your microphone.',
        color: 'red',
      })
    }
  }

  function handleMicClick() {
    if (isRecording) stopRecording()
    else void startRecording()
  }

  // ── Read-aloud → TTS ────────────────────────────────────────────────────────

  async function handleReadAloud(messageId: string, text: string) {
    // Stop whatever is currently playing.
    if (playingAudioRef.current) {
      playingAudioRef.current.pause()
      playingAudioRef.current = null
    }
    // Click on the currently playing message → just stop.
    if (playingMessageId === messageId) {
      setPlayingMessageId(null)
      return
    }
    setPlayingMessageId(messageId)
    try {
      const token = getToken()
      const res = await fetch(`${apiBase}/ai/v1/audio/speech`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ input: text }),
      })
      if (!res.ok) {
        if (res.status === 503) {
          setAudioAvailable(false)
          notifications.show({
            title: 'Audio unavailable',
            message: 'Audio proxy is not configured.',
            color: 'red',
          })
        }
        setPlayingMessageId(null)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      const cleanup = () => {
        URL.revokeObjectURL(url)
        setPlayingMessageId(null)
        playingAudioRef.current = null
      }
      audio.addEventListener('ended', cleanup, { once: true })
      audio.addEventListener('error', cleanup, { once: true })
      playingAudioRef.current = audio
      await audio.play()
      setAudioAvailable(true)
    } catch {
      setPlayingMessageId(null)
      playingAudioRef.current = null
    }
  }

  // Expose read-aloud only when audio is not confirmed unavailable and not streaming.
  const readAloudHandler = audioAvailable !== false && !isStreaming ? handleReadAloud : undefined

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
          <Text fw="semibold" size="sm" lineClamp={1}>
            {thread.title ?? 'New chat'}
          </Text>
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
              onReadAloud={readAloudHandler}
              isPlayingAloud={playingMessageId === message.id}
            />
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
              <Menu.Item leftSection={<IconTextSize size={14} />} onClick={openLongTextModal}>
                Long Text
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>

          <Tooltip
            label={
              audioAvailable === false
                ? 'Audio proxy not configured'
                : isRecording
                  ? 'Stop recording'
                  : isTranscribing
                    ? 'Transcribing…'
                    : 'Voice input'
            }
            withArrow
          >
            <ActionIcon
              size={36}
              variant={isRecording ? 'filled' : 'subtle'}
              color={isRecording ? 'red' : 'gray'}
              disabled={isTranscribing || audioAvailable === false || isStreaming}
              onClick={handleMicClick}
              aria-label={isRecording ? 'Stop recording' : 'Voice input'}
            >
              {isTranscribing ? (
                <Loader size={14} />
              ) : isRecording ? (
                <IconPlayerStopFilled size={18} />
              ) : (
                <IconMicrophone size={18} />
              )}
            </ActionIcon>
          </Tooltip>
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
