import { useCallback, useEffect, useRef } from 'react'
import { ScrollArea, Stack } from '@mantine/core'
import { Composer, ThreadTranscript } from 'basalt-ui/agent-chat'
import type { ComposerHandle } from 'basalt-ui/agent-chat'
import type { AgentPart, ChatMessage, ThreadRunState, TranscriptPart } from 'basalt-ui/agent'
import { useUiStore } from '../../lib/store'
import { HERMES_CHAT_FEATURES } from './features'
import { hermesThreadRenderers } from './thread-renderers'
import { useVoiceRecorder } from './voice/use-voice-recorder'
import { useVoicePlayback } from './voice/voice-playback'
import { VoiceControls } from './voice/voice-controls'
import { RecordingIndicator } from './voice/recording-indicator'
import { ReadAloudButton } from './voice/read-aloud-button'

// One open thread's body: transcript + composer. The row header (title/pin/type badge/relative
// time) lives one level up in thread-feed-row.tsx — this is deliberately just the "thin shell"
// the brief asks for, composing basalt's own `ThreadTranscript`/`Composer` primitives directly.
// Mounted exactly once per thread per page session (thread-feed-row.tsx's lazy-mount-keep-mounted
// invariant) — there is no unmount/remount cycle here for a resume/subscription effect to
// duplicate (D-F).

function joinTextParts(parts: readonly TranscriptPart[]): string {
  let out = ''
  for (const part of parts) {
    if (part.type === 'text' && 'text' in part && typeof part.text === 'string') out += part.text
  }
  return out
}

export function ChatConversation({
  thread,
  messages,
  run,
  onSend,
  onStop,
}: {
  thread: { id: string }
  messages: ChatMessage<AgentPart>[]
  run: ThreadRunState<AgentPart> | undefined
  onSend: (text: string) => void
  onStop: () => void
}) {
  const isStreaming = run !== undefined
  const viewportRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<ComposerHandle>(null)

  // ── Voice: mode toggle + shared TTS playback ─────────────────────────────────
  // Voice mode is the persisted, app-wide master toggle (shared with the feed composer).
  // Playback lives in the feature-wide VoicePlaybackProvider so one <audio> element is reused.
  const voiceMode = useUiStore((s) => s.voiceMode)
  const toggleVoiceMode = useUiStore((s) => s.toggleVoiceMode)
  const { audioAvailable, setAudioAvailable, primePlayback, readAloud } = useVoicePlayback()
  const voiceModeRef = useRef(voiceMode)
  voiceModeRef.current = voiceMode

  // ── Auto-scroll ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = viewportRef.current
    if (el) el.scrollTo({ top: el.scrollHeight })
  }, [messages, run])

  // ── Voice: auto-speak a finished reply, deferred while backgrounded ──────────
  // Captures the live tail's text every render while streaming (run disappears from the map the
  // instant a turn finishes, so this is the only way to read "what it just said" at that instant —
  // see chat-page.tsx's run-finish effect for the same disappearing-map property).
  const lastLiveTextRef = useRef('')
  useEffect(() => {
    if (run) lastLiveTextRef.current = joinTextParts(run.parts)
  }, [run])

  const pendingSpeakRef = useRef<string | null>(null)
  const wasStreamingRef = useRef(false)
  useEffect(() => {
    const justFinished = wasStreamingRef.current && !isStreaming
    wasStreamingRef.current = isStreaming
    if (!justFinished || !voiceModeRef.current) return
    const text = lastLiveTextRef.current.trim()
    if (!text) return
    // Auto-pause: while Argo is backgrounded, defer instead of speaking — the visibilitychange
    // effect below replays it on return.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      pendingSpeakRef.current = text
      return
    }
    void readAloud(`${thread.id}:live`, text, { summarize: true, threadId: thread.id })
  }, [isStreaming, readAloud, thread.id])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const pending = pendingSpeakRef.current
      pendingSpeakRef.current = null
      if (!pending || !voiceModeRef.current) return
      void readAloud(`${thread.id}:live`, pending, { summarize: true, threadId: thread.id })
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [readAloud, thread.id])

  // ── Read-aloud (per message) ──────────────────────────────────────────────────
  const canReadAloud = audioAvailable !== false && !isStreaming
  const affordanceActions = useCallback(
    ({ message }: { message: ChatMessage<TranscriptPart> }) => {
      if (message.role !== 'assistant' || !canReadAloud) return null
      const text = joinTextParts(message.parts)
      if (!text) return null
      return <ReadAloudButton messageId={message.id} text={text} threadId={thread.id} />
    },
    [canReadAloud, thread.id],
  )

  // ── Voice recording → STT ───────────────────────────────────────────────────
  const {
    isRecording,
    isTranscribing,
    recordingMs,
    toggle: toggleRecording,
  } = useVoiceRecorder({
    setAudioAvailable,
    onPrime: primePlayback,
    onResult: (transcript) => {
      if (voiceModeRef.current) onSend(transcript)
      else composerRef.current?.insertText(transcript)
    },
  })

  return (
    <Stack h="100%" gap={0}>
      <ScrollArea style={{ flex: 1 }} viewportRef={viewportRef} type="auto">
        <ThreadTranscript
          messages={messages}
          liveParts={run?.parts}
          liveStatus={isStreaming ? 'streaming' : undefined}
          renderers={hermesThreadRenderers}
          affordances={{ actions: affordanceActions }}
        />
      </ScrollArea>

      <Stack gap={4} p="sm" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
        {isRecording && <RecordingIndicator recordingMs={recordingMs} />}
        <Composer
          ref={composerRef}
          onSubmit={({ text }) => onSend(text)}
          streaming={isStreaming}
          onStop={onStop}
          draftKey={`hermes-thread-${thread.id}`}
          placeholder="Message Hermes…"
          rightSection={
            HERMES_CHAT_FEATURES.audioTranscription ? (
              <VoiceControls
                voiceMode={voiceMode}
                onToggleVoiceMode={toggleVoiceMode}
                isRecording={isRecording}
                isTranscribing={isTranscribing}
                audioAvailable={audioAvailable}
                onMicClick={toggleRecording}
                micDisabled={isStreaming}
              />
            ) : undefined
          }
        />
      </Stack>
    </Stack>
  )
}
