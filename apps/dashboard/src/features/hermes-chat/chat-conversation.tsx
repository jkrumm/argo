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
import { notifications } from '@mantine/notifications'
import {
  IconArrowLeft,
  IconFile,
  IconHeadphones,
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
import { HERMES_CHAT_FEATURES } from './features'
import { MessageMarkdown } from './message-markdown'
import { createHermesTransport, apiBase } from './transport'
import type { Attachment, HermesUIMessage, ToolProgress } from './types'
import { AttachmentDisplay } from './attachment-display'

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

// MediaRecorder output format differs by browser: Chrome/Firefox emit webm/opus,
// Safari/iOS only emit mp4/aac (it cannot produce webm). Pick the first supported
// container at record time — gpt-4o-transcribe accepts all of these, so no
// client-side transcoding is needed. Hardcoding webm silently broke iOS recording.
const PREFERRED_MIMES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg;codecs=opus',
]

function pickRecordingMime(): string {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return ''
  return PREFERRED_MIMES.find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
}

function mimeToExt(mime: string): string {
  if (mime.includes('mp4')) return 'm4a'
  if (mime.includes('mpeg')) return 'mp3'
  if (mime.includes('ogg')) return 'ogg'
  return 'webm'
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// A valid empty (zero-sample) WAV. Played once inside a user gesture (the mic tap)
// to "unlock" the playback element so voice-mode can auto-play the reply later,
// outside a gesture, under iOS/Safari autoplay policy.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='

function decodeAudioTitle(raw: string | null): string {
  if (!raw) return ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

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

  // ── Audio state ─────────────────────────────────────────────────────────────
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  // null = unknown, false = 503 confirmed (controls disabled), true = working
  const [audioAvailable, setAudioAvailable] = useState<boolean | null>(null)
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null)
  // Voice mode: after STT, auto-send the transcript and auto-speak the reply —
  // the hands-light "talk and it talks back" loop. Off → mic just fills the input.
  const [voiceMode, setVoiceMode] = useState(false)
  // Live mic level (0..1) and elapsed time, for recording feedback.
  const [recordingLevel, setRecordingLevel] = useState(0)
  const [recordingMs, setRecordingMs] = useState(0)

  const pendingAudioMsRef = useRef<number | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordingChunksRef = useRef<Blob[]>([])
  const recordingStartRef = useRef<number>(0)
  const streamRef = useRef<MediaStream | null>(null)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const levelRafRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const playingAudioRef = useRef<HTMLAudioElement | null>(null)
  const voiceModeRef = useRef(false)
  const lastSpokenRef = useRef<string | null>(null)
  // Mirrors playingMessageId so async playback can re-check the latest value after
  // an await — the closed-over state would be stale if the user stopped meanwhile.
  const playingMessageIdRef = useRef<string | null>(null)

  useEffect(() => {
    voiceModeRef.current = voiceMode
  }, [voiceMode])

  useEffect(() => {
    playingMessageIdRef.current = playingMessageId
  }, [playingMessageId])

  // Cleanup audio resources on unmount.
  useEffect(() => {
    return () => {
      if (playingAudioRef.current) {
        playingAudioRef.current.pause()
        if (playingAudioRef.current.src.startsWith('blob:')) {
          URL.revokeObjectURL(playingAudioRef.current.src)
        }
        playingAudioRef.current = null
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
      streamRef.current?.getTracks().forEach((t) => t.stop())
      if (levelRafRef.current) cancelAnimationFrame(levelRafRef.current)
      if (timerRef.current) clearInterval(timerRef.current)
      void audioCtxRef.current?.close().catch(() => {})
      void wakeLockRef.current?.release().catch(() => {})
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
      notifications.show({
        title: 'File too large',
        message: `Attachments must be under ${SIZE_LIMIT_MB} MB.`,
        color: 'red',
      })
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
      notifications.show({
        title: 'Read error',
        message: 'Could not read the selected file.',
        color: 'red',
      })
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

  const stopLevelMeter = useCallback(() => {
    if (levelRafRef.current) cancelAnimationFrame(levelRafRef.current)
    levelRafRef.current = null
    void audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    setRecordingLevel(0)
  }, [])

  const stopTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
  }, [])

  const finishRecording = useCallback(
    async (chunks: Blob[], durationMs: number, mime: string) => {
      setIsTranscribing(true)
      try {
        const type = mime || 'audio/webm'
        const blob = new Blob(chunks, { type })
        const form = new FormData()
        form.append('file', blob, `recording.${mimeToExt(type)}`)
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
              message: 'Speech-to-text is not configured.',
              color: 'red',
            })
          }
          return
        }
        const json = (await res.json()) as { text?: string }
        const transcript = (json.text ?? '').trim()
        setAudioAvailable(true)
        if (!transcript) return
        if (voiceModeRef.current) {
          // Voice mode: skip the input box and send the transcript straight away.
          pendingAudioMsRef.current = durationMs
          void sendMessage({ text: transcript })
          pendingAudioMsRef.current = null
        } else {
          setInput((prev) => (prev ? `${prev} ${transcript}` : transcript))
          pendingAudioMsRef.current = durationMs
        }
      } catch {
        notifications.show({
          title: 'Transcription failed',
          message: 'Could not transcribe audio.',
          color: 'red',
        })
      } finally {
        setIsTranscribing(false)
      }
    },
    [sendMessage],
  )

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    setIsRecording(false)
  }

  async function startRecording() {
    // Unlock playback within the user gesture so voice-mode can auto-play the
    // reply later (iOS autoplay policy). No-op when already unlocked.
    primePlayback()
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
      streamRef.current = stream
      const mime = pickRecordingMime()
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream)
      const chunks: Blob[] = []
      recordingChunksRef.current = chunks
      recordingStartRef.current = Date.now()

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }
      recorder.onstop = () => {
        const elapsed = Date.now() - recordingStartRef.current
        stopLevelMeter()
        stopTimer()
        stream.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        void wakeLockRef.current?.release().catch(() => {})
        wakeLockRef.current = null
        void finishRecording(chunks, elapsed, recorder.mimeType || mime)
      }

      mediaRecorderRef.current = recorder
      recorder.start()
      setIsRecording(true)
      setRecordingMs(0)
      timerRef.current = setInterval(
        () => setRecordingMs(Date.now() - recordingStartRef.current),
        200,
      )

      // Best-effort: keep the screen awake while recording. Browsers suspend mic
      // capture once the page is hidden, so foreground-with-screen-on is the
      // realistic ceiling — the wake lock just stops the screen auto-sleeping.
      try {
        wakeLockRef.current = (await navigator.wakeLock?.request('screen')) ?? null
      } catch {
        /* wake lock is non-essential */
      }

      // Best-effort live level meter via the Web Audio analyser, wrapped so any
      // AudioContext failure never breaks the recording itself.
      try {
        const AudioCtx =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (AudioCtx) {
          const ctx = new AudioCtx()
          audioCtxRef.current = ctx
          const source = ctx.createMediaStreamSource(stream)
          const analyser = ctx.createAnalyser()
          analyser.fftSize = 256
          source.connect(analyser)
          const data = new Uint8Array(analyser.frequencyBinCount)
          const tick = (): void => {
            analyser.getByteTimeDomainData(data)
            let sum = 0
            for (const v of data) {
              const x = (v - 128) / 128
              sum += x * x
            }
            setRecordingLevel(Math.min(1, Math.sqrt(sum / data.length) * 3))
            levelRafRef.current = requestAnimationFrame(tick)
          }
          tick()
        }
      } catch {
        /* level meter is best-effort */
      }
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

  // One persistent <audio> element for all TTS playback. Reusing it (rather than a
  // fresh `new Audio()` per click) lets `primePlayback()` unlock it inside a user
  // gesture so voice-mode auto-play works on iOS.
  const getPlaybackEl = useCallback((): HTMLAudioElement => {
    if (!playingAudioRef.current) {
      const el = new Audio()
      el.addEventListener('ended', () => setPlayingMessageId(null))
      el.addEventListener('error', () => setPlayingMessageId(null))
      playingAudioRef.current = el
    }
    return playingAudioRef.current
  }, [])

  const primePlayback = useCallback(() => {
    const el = getPlaybackEl()
    el.src = SILENT_WAV
    void el
      .play()
      .then(() => el.pause())
      .catch(() => {})
  }, [getPlaybackEl])

  const handleReadAloud = useCallback(
    async (messageId: string, text: string) => {
      const el = getPlaybackEl()
      el.pause()
      // Click the currently-playing message → just stop (toggle / barge-in).
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
              message: 'Text-to-speech is not configured.',
              color: 'red',
            })
          }
          setPlayingMessageId(null)
          return
        }
        const title = decodeAudioTitle(res.headers.get('x-audio-title'))
        const blob = await res.blob()
        // User stopped or switched playback during the fetch → drop this stale result.
        if (playingMessageIdRef.current !== messageId) return
        if (el.src.startsWith('blob:')) URL.revokeObjectURL(el.src)
        el.src = URL.createObjectURL(blob)
        // Lock-screen / background playback controls — playback keeps running when
        // the device is locked or the PWA is backgrounded (works on iOS + Android).
        if ('mediaSession' in navigator) {
          try {
            navigator.mediaSession.metadata = new MediaMetadata({
              title: title || 'Hermes',
              artist: 'Hermes',
            })
            navigator.mediaSession.setActionHandler('play', () => void el.play())
            navigator.mediaSession.setActionHandler('pause', () => el.pause())
            navigator.mediaSession.setActionHandler('stop', () => {
              el.pause()
              setPlayingMessageId(null)
            })
          } catch {
            /* media session is best-effort */
          }
        }
        setAudioAvailable(true)
        await el.play()
      } catch {
        setPlayingMessageId(null)
      }
    },
    [playingMessageId, getPlaybackEl],
  )

  // Voice mode: once a reply finishes streaming, speak it automatically.
  useEffect(() => {
    if (!voiceModeRef.current || status !== 'ready') return
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant' || lastSpokenRef.current === last.id) return
    const text = messageText(last)
    if (!text.trim()) return
    lastSpokenRef.current = last.id
    void handleReadAloud(last.id, text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, messages])

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

        {isRecording && (
          <Group gap="xs" align="center" wrap="nowrap" mb="xs">
            <Box w={8} h={8} bg="red.6" style={{ borderRadius: '50%' }} />
            <Text size="xs" c="dimmed" ff="monospace">
              {formatElapsed(recordingMs)}
            </Text>
            <Box
              flex={1}
              h={4}
              style={{
                background: 'var(--mantine-color-default-border)',
                borderRadius: 'var(--mantine-radius-xs)',
                overflow: 'hidden',
              }}
            >
              <Box
                h="100%"
                bg="red.5"
                style={{
                  width: `${Math.round(recordingLevel * 100)}%`,
                  transition: 'width 80ms linear',
                }}
              />
            </Box>
          </Group>
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
            <>
              <Tooltip
                label={
                  voiceMode ? 'Voice mode on — replies are spoken' : 'Voice mode (talk & listen)'
                }
                withArrow
              >
                <ActionIcon
                  size={36}
                  variant={voiceMode ? 'light' : 'subtle'}
                  color={voiceMode ? 'blue' : 'gray'}
                  disabled={audioAvailable === false}
                  onClick={() => setVoiceMode((v) => !v)}
                  aria-label="Toggle voice mode"
                  aria-pressed={voiceMode}
                >
                  <IconHeadphones size={18} />
                </ActionIcon>
              </Tooltip>
              <Tooltip
                label={
                  audioAvailable === false
                    ? 'Audio not configured'
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
            </>
          )}
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
