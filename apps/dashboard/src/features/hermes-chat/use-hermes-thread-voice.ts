import {
  createElement,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react'
import type { AgentPart, ChatMessage, ThreadRunState, TranscriptPart } from 'basalt-ui/agent'
import type { ComposerHandle, MessageAffordances } from 'basalt-ui/agent-chat'
import { useUiStore } from '../../lib/store'
import { HERMES_CHAT_FEATURES } from './features'
import { useVoiceRecorder } from './voice/use-voice-recorder'
import { useVoicePlayback } from './voice/voice-playback'
import { VoiceControls } from './voice/voice-controls'
import { RecordingIndicator } from './voice/recording-indicator'
import { ReadAloudButton } from './voice/read-aloud-button'

// The voice half of a single open Hermes thread, extracted verbatim from the former per-thread
// conversation shell so `HermesRow` (which now composes basalt's own `ThreadFeedRow`) can wire it
// in as `affordances` + composer slots instead of hand-rolling the transcript/composer shell.

function joinTextParts(parts: readonly TranscriptPart[]): string {
  let out = ''
  for (const part of parts) {
    if (part.type === 'text' && 'text' in part && typeof part.text === 'string') out += part.text
  }
  return out
}

export function useHermesThreadVoice({
  thread,
  run,
  composerRef,
  onSend,
}: {
  thread: { id: string }
  run: ThreadRunState<AgentPart> | undefined
  composerRef: RefObject<ComposerHandle | null>
  /** Same callback `HermesRow` forwards to `ThreadFeedRow.onSend` — voice-mode dictation auto-sends
   * through it instead of inserting into the composer draft. */
  onSend: (text: string) => void
}): {
  affordances: MessageAffordances
  rightSection: ReactNode
  recordingIndicator: ReactNode
} {
  const isStreaming = run !== undefined

  // ── Voice: mode toggle + shared TTS playback ─────────────────────────────────
  const voiceMode = useUiStore((s) => s.voiceMode)
  const toggleVoiceMode = useUiStore((s) => s.toggleVoiceMode)
  const { audioAvailable, setAudioAvailable, primePlayback, readAloud } = useVoicePlayback()
  const voiceModeRef = useRef(voiceMode)
  voiceModeRef.current = voiceMode

  // ── Voice: auto-speak a finished reply, deferred while backgrounded ──────────
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
      return createElement(ReadAloudButton, { messageId: message.id, text, threadId: thread.id })
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

  return {
    affordances: { actions: affordanceActions },
    rightSection: HERMES_CHAT_FEATURES.audioTranscription
      ? createElement(VoiceControls, {
          voiceMode,
          onToggleVoiceMode: toggleVoiceMode,
          isRecording,
          isTranscribing,
          audioAvailable,
          onMicClick: toggleRecording,
          micDisabled: isStreaming,
        })
      : undefined,
    recordingIndicator: isRecording
      ? createElement(RecordingIndicator, { recordingMs })
      : undefined,
  }
}
