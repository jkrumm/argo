import { NumberInput } from '@mantine/core'
import { useState } from 'react'
import classes from './depot.module.css'

/**
 * The exact price of the selected horizontal line. Enter applies, Escape puts the line's own price
 * back; the page keys it by the line and its price, so a drag of the line shows in it.
 */
export function LinePriceField({
  price,
  onApply,
}: {
  price: number
  onApply: (price: number) => void
}) {
  const [value, setValue] = useState<string | number>(price)
  return (
    <NumberInput
      className={classes.priceField}
      aria-label="Price of the selected line"
      placeholder="Price"
      hideControls
      allowNegative={false}
      decimalScale={4}
      value={value}
      onChange={setValue}
      onKeyDown={(event) => {
        // An IME confirms its candidate with Enter: not an apply.
        if (event.nativeEvent.isComposing || event.keyCode === 229) return
        if (event.key === 'Enter') {
          const next = typeof value === 'number' ? value : Number.parseFloat(value)
          if (Number.isFinite(next) && next > 0 && next !== price) onApply(next)
        } else if (event.key === 'Escape') {
          setValue(price)
          event.currentTarget.blur()
        }
      }}
    />
  )
}
