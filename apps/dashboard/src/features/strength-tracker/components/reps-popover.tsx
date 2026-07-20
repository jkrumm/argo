import { useState, type ReactNode } from 'react'
import { Popover } from '@mantine/core'
import { NumberPad, formatNumber, parseBuffer, useNumberBuffer } from './number-pad'

export interface RepsPopoverProps {
  value: number
  onChange: (reps: number) => void
  opened: boolean
  onClose: () => void
  /**
   * The keystroke that opened the popover, when it was opened by typing a digit
   * on the trigger. Seeds the buffer so the first digit isn't swallowed.
   */
  seedDigit?: string | null
  /** Fires after a commit, so the caller can advance the row. */
  onCommit?: () => void
  children: ReactNode
}

const MIN_REPS = 1
const MAX_REPS = 100

/**
 * Rep-entry popover for a set-editor row — the same keypad as the weight cell, integer-only. Reps
 * are a count, so there is no decimal key and the steppers move by 1.
 */
export function RepsPopover({
  value,
  onChange,
  opened,
  onClose,
  seedDigit,
  onCommit,
  children,
}: RepsPopoverProps) {
  const pad = useNumberBuffer()
  const [wasOpened, setWasOpened] = useState(opened)

  // Reseed on the open transition only — never on `value` changes while already open. Adjusting
  // state during render on a prop transition avoids an extra render pass; see WeightPopover for
  // the same pattern.
  if (opened !== wasOpened) {
    setWasOpened(opened)
    if (opened) {
      const typed = seedDigit ?? null
      pad.reset(typed ?? formatNumber(value), typed === null)
    }
  }

  function commit() {
    const parsed = Math.round(parseBuffer(pad.buffer))
    onChange(Math.min(MAX_REPS, Math.max(MIN_REPS, parsed)))
    onCommit?.()
    onClose()
  }

  return (
    <Popover
      width="min(260px, calc(100vw - 2rem))"
      position="bottom"
      withArrow
      shadow="md"
      trapFocus
      opened={opened}
      onChange={(next) => {
        if (!next) onClose()
      }}
    >
      <Popover.Target>{children}</Popover.Target>

      <Popover.Dropdown
        p="sm"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onClose()
            return
          }
          if (event.key === 'Enter') {
            commit()
            return
          }
          if (event.key === 'Backspace') {
            pad.pressDigit('⌫')
            return
          }
          if (/^[0-9]$/.test(event.key)) pad.pressDigit(event.key)
        }}
      >
        <NumberPad
          buffer={pad.buffer}
          stepBy={1}
          onDigit={pad.pressDigit}
          onStep={(delta) => pad.step(delta, MIN_REPS)}
          onConfirm={commit}
        />
      </Popover.Dropdown>
    </Popover>
  )
}
