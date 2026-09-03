import { Box, Group, Text } from '@mantine/core'
import { formatElapsed } from './audio-utils'
import classes from './recording-indicator.module.css'

// A calm "recording" affordance shown above a composer while capturing: a softly
// pulsing red dot, a label, and the elapsed timer. (The earlier live mic-level bar
// was jumpy and read as visual noise, so it was dropped.)
export function RecordingIndicator({ recordingMs }: { recordingMs: number }) {
  return (
    <Group gap="xs" align="center" wrap="nowrap" mb="xs">
      <Box className={classes['dot']} />
      <Text size="xs" c="dimmed">
        Recording
      </Text>
      <Text size="xs" c="dimmed" ff="monospace">
        {formatElapsed(recordingMs)}
      </Text>
    </Group>
  )
}
