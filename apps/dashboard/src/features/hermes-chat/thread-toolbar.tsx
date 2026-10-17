import { Box, Button, Group, ScrollArea, TextInput } from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'
import type { HermesThreadType } from '../../lib/queries/hermes'
import { THREAD_TYPES, TYPE_LABEL } from './thread-list-model'
import classes from './thread-toolbar.module.css'

export type TypeFilter = HermesThreadType | 'all' | 'untitled'

/**
 * Counted filter chips (`All {n}`, `Infra {n}`, …; the active one filled) plus a search field.
 * Standalone counted-chip toolbar prototype — docs/design/UPSTREAM.md. Types with no thread are
 * not offered, unless one is the active filter.
 */
export function ThreadToolbar({
  total,
  typeCounts,
  untitledCount,
  type,
  query,
  onType,
  onQuery,
}: {
  total: number
  typeCounts: Record<HermesThreadType, number>
  untitledCount: number
  type: TypeFilter
  query: string
  onType: (next: TypeFilter) => void
  onQuery: (next: string) => void
}) {
  const chips: { key: TypeFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: total },
    ...THREAD_TYPES.filter((t) => typeCounts[t] > 0 || t === type).map((t) => ({
      key: t,
      label: TYPE_LABEL[t],
      count: typeCounts[t],
    })),
    ...(untitledCount > 0 || type === 'untitled'
      ? [{ key: 'untitled' as const, label: 'Untitled', count: untitledCount }]
      : []),
  ]

  return (
    <Box className={classes['root']}>
      <ScrollArea className={classes['chips']} type="never" scrollbars="x">
        <Group gap="xs" wrap="nowrap">
          {chips.map((chip) => (
            <Button
              key={chip.key}
              size="compact-sm"
              color="gray"
              variant={chip.key === type ? 'filled' : 'outline'}
              aria-pressed={chip.key === type}
              onClick={() => onType(chip.key)}
              style={{ flexShrink: 0 }}
            >
              {chip.label} {chip.count}
            </Button>
          ))}
        </Group>
      </ScrollArea>
      <TextInput
        className={classes['search']}
        placeholder="Search threads"
        aria-label="Search threads"
        leftSection={<IconSearch size={14} />}
        value={query}
        onChange={(event) => onQuery(event.currentTarget.value)}
      />
    </Box>
  )
}
