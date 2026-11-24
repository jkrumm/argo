import { ColorSwatch, Group, Tooltip } from '@mantine/core'
import { VX } from 'basalt-ui/tokens'
import type { ColorRole } from '../lib/depot-chart'
import classes from './depot.module.css'

const CHOICES: readonly { role: ColorRole; color: string; label: string }[] = [
  { role: 'accent', color: VX.accentFill, label: 'Blue' },
  { role: 'buy', color: VX.goodSolid, label: 'Green: a buy level' },
  { role: 'sell', color: VX.badSolid, label: 'Red: a sell level or a resistance' },
]

/** The three colours a line can take: blue, green for a buy level, red for a sell level or a resistance. */
export function ColourSwatches({
  value,
  onPick,
}: {
  value: ColorRole
  onPick: (role: ColorRole) => void
}) {
  return (
    <Group gap="xs" role="group" aria-label="Line colour" wrap="nowrap">
      {CHOICES.map((choice) => (
        <Tooltip key={choice.role} label={choice.label} openDelay={250} withArrow>
          <ColorSwatch
            component="button"
            type="button"
            color={choice.color}
            size={20}
            aria-label={choice.label}
            aria-pressed={value === choice.role}
            data-active={value === choice.role}
            className={classes.swatch}
            onClick={() => onPick(choice.role)}
          />
        </Tooltip>
      ))}
    </Group>
  )
}
