import { Box, Button, Group, ScrollArea, TextInput } from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'
import type { HermesThreadType } from '../../lib/queries/hermes'
import { THREAD_TYPES, TYPE_LABEL } from './thread-list-model'
import classes from './thread-toolbar.module.css'

export type TypeFilter = HermesThreadType | 'all' | 'untitled' | 'archived'

/**
 * Counted filter chips (`All {n}`, `Infra {n}`, …; the active one filled) plus a search field.
 * Standalone counted-chip toolbar prototype — docs/design/UPSTREAM.md. Types with no thread are
 * not offered, unless one is the active filter.
 */
export function ThreadToolbar({
  allCount,
  typeCounts,
  untitledCount,
  archivedCount,
  type,
  query,
  onType,
  onQuery,
}: {
  allCount: number
  typeCounts: Record<HermesThreadType, number>
  untitledCount: number
  archivedCount: number
  type: TypeFilter
  query: string
  onType: (next: TypeFilter) => void
  onQuery: (next: string) => void
}) {
  const chips: { key: TypeFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: allCount },
    ...THREAD_TYPES.filter((t) => typeCounts[t] > 0 || t === type).map((t) => ({
      key: t,
      label: TYPE_LABEL[t],
      count: typeCounts[t],
    })),
    ...(untitledCount > 0 || type === 'untitled'
      ? [{ key: 'untitled' as const, label: 'Untitled', count: untitledCount }]
      : []),
    ...(archivedCount > 0 || type === 'archived'
      ? [{ key: 'archived' as const, label: 'Archived', count: archivedCount }]
      : []),
  ]

  return (
    <Box className={classes['root']} data-shot="thread-toolbar">
      <ScrollArea className={classes['chips']} type="never" scrollbars="x">
        <Group gap="xs" wrap="nowrap" p={4}>
          {chips.map((chip) => (
            <Button
              key={chip.key}
              size="compact-sm"
              color="gray"
              variant={chip.key === type ? 'filled' : 'outline'}
              aria-pressed={chip.key === type}
              onClick={() => onType(chip.key)}
              className={classes['chip']}
              style={{ flexShrink: 0 }}
            >
              {chip.key === 'untitled' && chip.count === 0
                ? chip.label
                : `${chip.label} ${chip.count}`}
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
