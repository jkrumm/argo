import { TextInput } from '@mantine/core'
import { useRef, useState } from 'react'
import { decimalText, parseDecimal } from '../lib/depot-number'
import classes from './depot.module.css'

/**
 * The exact price of the selected horizontal line, typed the German way (`150,5`, `95.000`). Enter and leaving the
 * field apply it and write it back with grouping; Escape puts the line's own price back; text that is no price
 * reverts. The page keys it by the line and its price, so a drag of the line shows in it.
 */
export function LinePriceField({
  price,
  onApply,
}: {
  price: number
  onApply: (price: number) => void
}) {
  const [text, setText] = useState(decimalText(price))
  const cancelled = useRef(false)
  const apply = () => {
    const next = parseDecimal(text)
    if (next === null) {
      setText(decimalText(price))
      return
    }
    setText(decimalText(next))
    if (next !== price) onApply(next)
  }
  return (
    <TextInput
      className={classes.priceField}
      aria-label="Price of the selected line"
      placeholder="Price"
      inputMode="decimal"
      enterKeyHint="done"
      value={text}
      onChange={(event) => setText(event.currentTarget.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={() => {
        if (cancelled.current) cancelled.current = false
        else apply()
      }}
      onKeyDown={(event) => {
        // An IME confirms its candidate with Enter: not an apply.
        if (event.nativeEvent.isComposing || event.keyCode === 229) return
        if (event.key === 'Enter') {
          event.currentTarget.blur()
        } else if (event.key === 'Escape') {
          cancelled.current = true
          setText(decimalText(price))
          event.currentTarget.blur()
        }
      }}
    />
  )
}
