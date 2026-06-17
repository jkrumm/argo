import { ActionIcon, Center, Group, Loader, RingProgress, Text, Tooltip } from '@mantine/core'
import { IconHeadphones, IconPlayerStopFilled } from '@tabler/icons-react'
import { useUiStore } from '../../lib/store'
import { formatElapsed } from './voice/audio-utils'
import { useVoicePlayback } from './voice/voice-playback'

// Global auto-speak control in the app header. Idle: a headphones toggle for voice
// mode (replies spoken back), mirroring the composer's VoiceControls toggle so it
// reads as the same control. While a reply is being spoken it MORPHS in place into a
// progress ring + remaining-time + stop — reusing its own slot rather than spawning a
// separate indicator. Identity blue earns its place on exactly two states (DESIGN.md):
// the speaking ring and the toggle when auto-speak is on; otherwise neutral gray.
export function HermesVoiceButton() {
  const voiceMode = useUiStore((s) => s.voiceMode)
  const toggleVoiceMode = useUiStore((s) => s.toggleVoiceMode)
  const { playingMessageId, isBuffering, progress, remainingSec, audioAvailable, stop } =
    useVoicePlayback()

  if (playingMessageId !== null) {
    return (
      <Group gap={6} wrap="nowrap">
        {isBuffering ? (
          <Tooltip label="Stop" withArrow>
            <ActionIcon
              size={36}
              variant="subtle"
              color="gray"
              radius="xl"
              onClick={() => stop()}
              aria-label="Stop speaking"
            >
              <Loader size={16} color="gray" />
            </ActionIcon>
          </Tooltip>
        ) : (
          <>
            <RingProgress
              size={36}
              thickness={2.5}
              roundCaps
              sections={[{ value: Math.min(100, Math.round(progress * 100)), color: 'blue' }]}
              label={
                <Center>
                  <Tooltip label="Stop" withArrow>
                    <ActionIcon
                      size={22}
                      variant="subtle"
                      color="gray"
                      radius="xl"
                      onClick={() => stop()}
                      aria-label="Stop speaking"
                    >
                      <IconPlayerStopFilled size={12} />
                    </ActionIcon>
                  </Tooltip>
                </Center>
              }
            />
            <Text size="xs" c="dimmed" ff="monospace">
              {formatElapsed(remainingSec * 1000)}
            </Text>
          </>
        )}
      </Group>
    )
  }

  return (
    <Tooltip
      label={
        voiceMode ? 'Auto-speak on — replies are spoken' : 'Auto-speak off — tap to hear replies'
      }
      withArrow
    >
      <ActionIcon
        size={36}
        variant={voiceMode ? 'light' : 'subtle'}
        color={voiceMode ? 'blue' : 'gray'}
        disabled={audioAvailable === false}
        onClick={toggleVoiceMode}
        aria-label="Toggle auto-speak"
        aria-pressed={voiceMode}
      >
        <IconHeadphones size={18} />
      </ActionIcon>
    </Tooltip>
  )
}
