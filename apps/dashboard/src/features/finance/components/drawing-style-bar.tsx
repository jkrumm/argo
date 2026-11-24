import { Box, ColorSwatch, Group, TextInput } from '@mantine/core'
import { VX } from 'basalt-ui/tokens'
import { useState } from 'react'
import type { ColorRole } from '../lib/depot-chart'
import classes from './depot.module.css'
import { LinePriceField } from './line-price-field'
import type { DepotSelection } from './depot-chart'

const CHOICES: readonly { role: ColorRole; color: string; label: string }[] = [
  { role: 'accent', color: VX.accentFill, label: 'Blue' },
  { role: 'buy', color: VX.goodSolid, label: 'Green: a buy level' },
  { role: 'sell', color: VX.badSolid, label: 'Red: a sell level or a resistance' },
]

/** The label of the selected line: Enter and leaving the field apply it, Escape puts the line's own back. */
function LineLabelField({ label, onApply }: { label: string; onApply: (label: string) => void }) {
  const [value, setValue] = useState(label)
  const apply = () => {
    if (value.trim() !== label) onApply(value.trim())
  }
  return (
    <TextInput
      className={classes.labelField}
      aria-label="Label of the selected line"
      placeholder="Label"
      maxLength={40}
      value={value}
      onChange={(event) => setValue(event.currentTarget.value)}
      onBlur={apply}
      onKeyDown={(event) => {
        // An IME confirms its candidate with Enter: not an apply.
        if (event.nativeEvent.isComposing || event.keyCode === 229) return
        if (event.key === 'Enter') {
          apply()
          event.currentTarget.blur()
        } else if (event.key === 'Escape') {
          setValue(label)
          event.currentTarget.blur()
        }
      }}
    />
  )
}

/**
 * The look of a line: its colour (blue, green for a buy level, red for a sell level or a resistance), an
 * optional short label and, for a horizontal line, its exact price. The colour applies to the selected
 * line and to the next one drawn.
 */
export function DrawingStyleBar({
  role,
  onRole,
  selection,
  onLabel,
  onPrice,
}: {
  role: ColorRole
  onRole: (role: ColorRole) => void
  selection: DepotSelection
  onLabel: (label: string) => void
  onPrice: (id: string, price: number) => void
}) {
  const current = selection.single?.role ?? role
  return (
    <Box className={classes.styleBar} data-shot="depot-line-style">
      <Group gap="xs" role="group" aria-label="Line colour">
        {CHOICES.map((choice) => (
          <ColorSwatch
            key={choice.role}
            component="button"
            type="button"
            color={choice.color}
            size={20}
            aria-label={choice.label}
            title={choice.label}
            aria-pressed={current === choice.role}
            data-active={current === choice.role}
            className={classes.swatch}
            onClick={() => onRole(choice.role)}
          />
        ))}
      </Group>
      {selection.single !== null && (
        <LineLabelField
          key={selection.single.id}
          label={selection.single.label}
          onApply={onLabel}
        />
      )}
      {selection.line !== null && (
        <LinePriceField
          key={`${selection.line.id}:${selection.line.price}`}
          price={selection.line.price}
          onApply={(price) => onPrice(selection.line?.id ?? '', price)}
        />
      )}
    </Box>
  )
}
