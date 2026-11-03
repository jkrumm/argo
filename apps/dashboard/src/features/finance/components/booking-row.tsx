import { Box, Text } from '@mantine/core'
import { date } from 'basalt-ui/format'
import { VX } from 'basalt-ui/tokens'
import type { ReactNode } from 'react'
import type { TxRow } from '../api/types'
import { eurExact } from '../lib/format'
import { CategoryPicker, TagPicker } from './pickers'
import classes from './finance.module.css'

/** Who a booking was with: the merchant the rules found, else the bank's counterparty. */
export const bookingName = (row: Pick<TxRow, 'merchant' | 'counterparty'>): string =>
  row.merchant ?? row.counterparty ?? 'Unknown'

/** The signed, exact amount of a booking; income reads in the good ink. */
export function BookingAmount({ cents }: { cents: number }) {
  return (
    <Text span inherit className={classes.amount} {...(cents > 0 && { c: VX.status.good })}>
      {eurExact(cents)}
    </Text>
  )
}

/**
 * One booking as a line that edits in place: who and how much, when and what for, then the category
 * (and, with `tags`, the tax tag) as selects. `extra` adds a row of buttons below (the tax queue).
 * The line sits in a container, so the editors go side by side only where the width allows.
 */
export function BookingRow({
  row,
  tags = false,
  inline = false,
  extra,
}: {
  row: TxRow
  tags?: boolean
  /** One editor beside the date instead of below it; not with `tags` or `extra`. */
  inline?: boolean
  extra?: ReactNode
}) {
  return (
    <Box className={`${classes.booking} ${inline ? classes.bookingInline : ''}`}>
      <Text size="sm" fw={500} className={classes.merchant} title={bookingName(row)}>
        {bookingName(row)}
      </Text>
      <Text size="sm" className={classes.amountCell}>
        <BookingAmount cents={row.amount_cents} />
      </Text>
      <Text
        size="xs"
        c="dimmed"
        className={classes.meta}
        title={row.purpose === null || row.purpose === '' ? undefined : row.purpose}
      >
        {date(row.booked_on)}
        {row.purpose === null || row.purpose === '' ? '' : ` · ${row.purpose}`}
      </Text>
      <Box className={`${classes.editors} ${tags ? classes.editorsPair : ''}`}>
        <CategoryPicker row={row} />
        {tags && <TagPicker row={row} />}
      </Box>
      {extra}
    </Box>
  )
}

/** The lines of `rows`; the container query of each line follows this wrapper's width. */
export function BookingList({
  rows,
  tags = false,
  inline = false,
}: {
  rows: readonly TxRow[]
  tags?: boolean
  inline?: boolean
}) {
  return (
    <Box className={classes.bookings}>
      {rows.map((row) => (
        <BookingRow key={row.id} row={row} tags={tags} inline={inline} />
      ))}
    </Box>
  )
}
