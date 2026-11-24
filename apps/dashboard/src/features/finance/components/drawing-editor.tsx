import { ActionIcon, Paper, TextInput, Tooltip } from '@mantine/core'
import { IconTrash } from '@tabler/icons-react'
import { useState } from 'react'
import type { ColorRole } from '../lib/depot-chart'
import { ColourSwatches } from './colour-swatches'
import classes from './depot.module.css'
import { LinePriceField } from './line-price-field'
import type { DepotSelection } from './depot-chart'

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
 * The small editor of one selected line, floating over the chart: its colour, its label, for a horizontal line its
 * exact price, and delete. It opens when a line is selected and closes with the selection.
 */
export function DrawingEditor({
  selection,
  onRole,
  onLabel,
  onPrice,
  onDelete,
}: {
  selection: DepotSelection
  onRole: (role: ColorRole) => void
  onLabel: (label: string) => void
  onPrice: (id: string, price: number) => void
  onDelete: () => void
}) {
  const { single, line } = selection
  if (single === null) return null
  return (
    <Paper
      className={classes.editor}
      data-shot="depot-line-editor"
      role="group"
      aria-label="Selected line"
    >
      <ColourSwatches value={single.role} onPick={onRole} />
      <LineLabelField key={single.id} label={single.label} onApply={onLabel} />
      {line !== null && (
        <LinePriceField
          key={`${line.id}:${line.price}`}
          price={line.price}
          onApply={(price) => onPrice(line.id, price)}
        />
      )}
      <Tooltip label="Delete this line" openDelay={250} withArrow>
        <ActionIcon variant="default" aria-label="Delete this line" onClick={onDelete}>
          <IconTrash />
        </ActionIcon>
      </Tooltip>
    </Paper>
  )
}
