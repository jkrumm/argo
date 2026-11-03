// theme-allow-file control-outside-home, raw-selection-control — inline editors of one booking's category and tax tag: their state is the booking itself, saved at once, not a page filter
import { Select } from '@mantine/core'
import { VX } from 'basalt-ui/tokens'
import { reportWriteError, useCurate } from '../api/mutations'
import { useMeta } from '../api/queries'
import type { SetTagRequest, TxRow } from '../api/types'
import { TAX_TAGS, categoryGroups, tagLabel } from '../lib/categories'

const NO_TAG = ''

/** The category of one booking as an inline select; a pick is saved at once (optimistic, rolled back on a failure). */
export function CategoryPicker({
  row,
  onSaved,
  width,
}: {
  row: TxRow
  onSaved?: () => void
  /** A fixed width in px for a table cell; omitted, the select fills its parent. */
  width?: number
}) {
  const meta = useMeta()
  const curate = useCurate()
  const data = categoryGroups(meta.data?.categories)
  return (
    <Select
      aria-label={`Category of ${row.merchant ?? row.counterparty ?? 'booking'}`}
      placeholder="Choose category"
      data={data}
      value={row.category}
      searchable
      {...(width !== undefined && { w: width })}
      allowDeselect={false}
      nothingFoundMessage="No such category"
      disabled={meta.data === undefined}
      {...(row.category === null && { c: VX.status.warn })}
      onChange={(value) => {
        if (value === null || value === row.category) return
        curate.setCategory(row, value).then(onSaved, reportWriteError)
      }}
    />
  )
}

/** The tax tag of one booking as an inline select; `No tag` clears it. */
export function TagPicker({
  row,
  onSaved,
  width,
}: {
  row: TxRow
  onSaved?: () => void
  width?: number
}) {
  const curate = useCurate()
  return (
    <Select
      aria-label={`Tax tag of ${row.merchant ?? row.counterparty ?? 'booking'}`}
      placeholder="No tag"
      data={[
        { value: NO_TAG, label: 'No tag' },
        ...TAX_TAGS.map((tag) => ({ value: tag, label: tagLabel(tag) })),
      ]}
      value={row.tax_tag ?? NO_TAG}
      {...(width !== undefined && { w: width })}
      allowDeselect={false}
      onChange={(value) => {
        if (value === null || value === (row.tax_tag ?? NO_TAG)) return
        const tag = value === NO_TAG ? null : (value as SetTagRequest['tag'])
        curate.setTag(row, tag).then(onSaved, reportWriteError)
      }}
    />
  )
}
