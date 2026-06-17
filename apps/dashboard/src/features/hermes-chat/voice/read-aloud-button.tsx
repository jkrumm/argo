import { ActionIcon, Center, Group, Loader, RingProgress, Text, Tooltip } from '@mantine/core'
import { IconPlayerStopFilled, IconVolume } from '@tabler/icons-react'
import { formatElapsed } from './audio-utils'
import { useVoicePlayback } from './voice-playback'

// Per-message read-aloud control, three states driven by the shared playback
// provider:
//   idle    → a speaker icon (tap to play the full message)
//   loading → a spinner while the TTS clip is fetched/decoded (so it no longer
//             flips straight to "stop" before any audio exists)
//   playing → a progress ring wrapping a stop button + the remaining time
//
// TODO(animation): once we're fluent in framer-motion, make this lovely — spring
// the idle↔loading↔playing transitions, animate the ring sweep, and fade the
// remaining-time readout in/out. The states are functional but static today, and
// the placement/affordance of the whole control deserves a proper design pass.
export function ReadAloudButton({
  messageId,
  text,
  threadId,
}: {
  messageId: string
  text: string
  threadId: string
}) {
  const { playingMessageId, isBuffering, progress, remainingSec, readAloud } = useVoicePlayback()
  const active = playingMessageId === messageId

  if (active && isBuffering) {
    return (
      <Tooltip label="Loading…" withArrow>
        <ActionIcon
          size={26}
          variant="subtle"
          color="gray"
          radius="xl"
          onClick={() => void readAloud(messageId, text, { threadId })}
          aria-label="Cancel"
        >
          <Loader size={14} color="gray" />
        </ActionIcon>
      </Tooltip>
    )
  }

  if (active) {
    return (
      <Group gap={4} wrap="nowrap">
        <RingProgress
          size={30}
          thickness={2.5}
          roundCaps
          sections={[{ value: Math.min(100, Math.round(progress * 100)), color: 'blue' }]}
          label={
            <Center>
              <Tooltip label="Stop" withArrow>
                <ActionIcon
                  size={18}
                  variant="subtle"
                  color="gray"
                  radius="xl"
                  onClick={() => void readAloud(messageId, text, { threadId })}
                  aria-label="Stop reading"
                >
                  <IconPlayerStopFilled size={11} />
                </ActionIcon>
              </Tooltip>
            </Center>
          }
        />
        <Text size="xs" c="dimmed" ff="monospace">
          {formatElapsed(remainingSec * 1000)}
        </Text>
      </Group>
    )
  }

  return (
    <Tooltip label="Read aloud" withArrow>
      <ActionIcon
        size={20}
        variant="subtle"
        color="gray"
        onClick={() => void readAloud(messageId, text, { threadId })}
        aria-label="Read aloud"
      >
        <IconVolume size={12} />
      </ActionIcon>
    </Tooltip>
  )
}
