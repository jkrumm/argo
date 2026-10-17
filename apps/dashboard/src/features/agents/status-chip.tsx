import { Box, Group, Text } from '@mantine/core'
import { VX } from 'basalt-ui/tokens'
import classes from './status-chip.module.css'

export type StatusTone = 'neutral' | 'warn' | 'bad'

const TONE_INK: Record<StatusTone, string> = {
  neutral: VX.muted,
  warn: VX.status.warn,
  bad: VX.status.bad,
}

/** The 7 px state swatch shared by chips and legends. */
export function Dot({ color }: { color: string }) {
  return <Box className={classes.dot} bg={color} />
}

export type StatusChipProps = {
  tone: StatusTone
  label: string
}

/**
 * A quiet state label: a dot and text, no filled badge. Only a toned chip spends a hue; a neutral
 * one is muted ink. Prototype of the SPEC §6.10 status chip (`tone, label`).
 */
export function StatusChip({ tone, label }: StatusChipProps) {
  return (
    <Group gap={6} wrap="nowrap" className={classes.chip}>
      <Dot color={TONE_INK[tone]} />
      <Text size="sm" c={tone === 'neutral' ? 'dimmed' : TONE_INK[tone]}>
        {label}
      </Text>
    </Group>
  )
}
