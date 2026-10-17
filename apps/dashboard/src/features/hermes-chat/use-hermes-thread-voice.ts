import {
  createElement,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react'
import type {
  AgentPart,
  ChatMessage,
  ComposerHandle,
  MessageAffordances,
  ThreadRunState,
  TranscriptPart,
} from 'basalt-ui/agent'
import { useUiStore } from '../../lib/store'
import { HERMES_CHAT_FEATURES } from './features'
import { isLiveRun } from './run-liveness'
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
  const isStreaming = isLiveRun(run)

  // ── Voice: mode toggle + shared TTS playback ─────────────────────────────────
  const voiceMode = useUiStore((s) => s.voiceMode)
  const toggleVoiceMode = useUiStore((s) => s.toggleVoiceMode)
  const { audioAvailable, setAudioAvailable, primePlayback } = useVoicePlayback()
  const voiceModeRef = useRef(voiceMode)
  useEffect(() => {
    voiceModeRef.current = voiceMode
  }, [voiceMode])

  // Auto-speak of a finished reply lives in `ThreadSpeaker` (use-auto-speak.ts): it must run for
  // every thread, not only the one whose view is open.

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
