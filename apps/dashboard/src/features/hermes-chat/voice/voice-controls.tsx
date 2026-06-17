import { ActionIcon, Loader, Tooltip } from '@mantine/core'
import { IconHeadphones, IconMicrophone, IconPlayerStopFilled } from '@tabler/icons-react'

// The headphones (voice-mode) toggle + mic button pair shared by the feed and
// in-thread composers. Stateless: state lives in the persisted store (voice mode)
// and the recorder hook (recording/transcribing); this only renders + dispatches.
export function VoiceControls({
  voiceMode,
  onToggleVoiceMode,
  isRecording,
  isTranscribing,
  audioAvailable,
  onMicClick,
  micDisabled,
}: {
  voiceMode: boolean
  onToggleVoiceMode: () => void
  isRecording: boolean
  isTranscribing: boolean
  audioAvailable: boolean | null
  onMicClick: () => void
  micDisabled?: boolean
}) {
  return (
    <>
      <Tooltip
        label={voiceMode ? 'Voice mode on — replies are spoken' : 'Voice mode (talk & listen)'}
        withArrow
      >
        <ActionIcon
          size={36}
          variant={voiceMode ? 'light' : 'subtle'}
          color={voiceMode ? 'blue' : 'gray'}
          disabled={audioAvailable === false}
          onClick={onToggleVoiceMode}
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
          disabled={isTranscribing || audioAvailable === false || micDisabled}
          onClick={onMicClick}
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
  )
}
