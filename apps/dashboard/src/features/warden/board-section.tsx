import { useMemo } from 'react'
import { Anchor, Badge, Card, Group, Stack, Text } from '@mantine/core'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/data/table'
import { Section, useBreakpoint } from 'basalt-ui'
import { relativeTime } from 'basalt-ui/format'
import type { WardenBoardItem } from '../../lib/queries/warden'
import type { Bucket } from './model'

type Props = {
  buckets: Bucket[]
  onSelectItem: (eventId: number) => void
}

const columnHelper = createColumnHelper<WardenBoardItem>()

function noteColor(bucketKey: string): string | undefined {
  return bucketKey === 'deferred' ? 'orange' : undefined
}

function columnsFor(bucketKey: string) {
  return [
    columnHelper.accessor((row) => row.origin ?? '—', {
      id: 'origin',
      header: 'Origin',
      cell: (ctx) => <Text size="sm">{ctx.getValue()}</Text>,
    }),
    columnHelper.accessor((row) => row.repo ?? '—', {
      id: 'repo',
      header: 'Repo',
      cell: (ctx) => <Text size="sm">{ctx.getValue()}</Text>,
    }),
    columnHelper.accessor((row) => row.title ?? '—', {
      id: 'title',
      header: 'Title',
      cell: (ctx) => (
        <Text size="sm" lineClamp={2}>
          {ctx.getValue()}
        </Text>
      ),
    }),
    columnHelper.accessor('state', {
      header: 'State',
      cell: (ctx) => (
        // Mantine's Badge clips to an ellipsis by default (`width: fit-content` + `overflow:
        // hidden`), which collapses its min-content width to ~0 under table-layout auto — so the
        // browser happily shrinks the column and truncates `liveness_pending` to `NE…`. Overriding
        // overflow back to visible restores the badge's real min-content width, which is the
        // column's own fixed-width floor — the TITLE column (lineClamp) is the one meant to give.
        <Badge variant="light" color="gray" style={{ overflow: 'visible', textOverflow: 'clip' }}>
          {ctx.getValue()}
        </Badge>
      ),
    }),
    columnHelper.accessor((row) => row.updated_at ?? row.created_at ?? '', {
      id: 'age',
      header: 'Age',
      cell: (ctx) => {
        const at = ctx.getValue()
        return at ? <Text size="sm">{relativeTime(at)}</Text> : <Text c="dimmed">—</Text>
      },
    }),
    columnHelper.display({
      id: 'pr',
      header: 'PR',
      cell: (ctx) =>
        ctx.row.original.pr_url ? (
          <Anchor
            href={ctx.row.original.pr_url}
            target="_blank"
            rel="noreferrer"
            size="sm"
            onClick={(e) => e.stopPropagation()}
          >
            PR
          </Anchor>
        ) : (
          <Text c="dimmed">—</Text>
        ),
    }),
    columnHelper.accessor((row) => row.note ?? '', {
      id: 'note',
      header: 'Note',
      cell: (ctx) => {
        const note = ctx.getValue()
        if (!note) return <Text c="dimmed">—</Text>
        const color = noteColor(bucketKey)
        return (
          <Text
            size="sm"
            {...(color ? { c: color } : {})}
            {...(bucketKey === 'deferred' ? { fw: 600 } : {})}
            lineClamp={2}
          >
            {note}
          </Text>
        )
      },
    }),
  ]
}

function ItemCard({
  item,
  bucketKey,
  onSelect,
}: {
  item: WardenBoardItem
  bucketKey: string
  onSelect: () => void
}) {
  const color = noteColor(bucketKey)
  const label = item.title ?? item.repo ?? item.origin ?? `event ${item.event_id}`
  return (
    <Card
      padding="sm"
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        onSelect()
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open ${label}`}
      style={{ cursor: 'pointer' }}
    >
      <Stack gap={4}>
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Group gap="xs" wrap="nowrap" miw={0}>
            <Badge variant="light" color="gray" style={{ flexShrink: 0 }}>
              {item.state}
            </Badge>
            <Text size="sm" fw={600} lineClamp={1}>
              {item.repo ?? item.origin ?? '—'}
            </Text>
          </Group>
          {(item.updated_at ?? item.created_at) ? (
            <Text size="xs" c="dimmed" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
              {relativeTime(item.updated_at ?? item.created_at!)}
            </Text>
          ) : null}
        </Group>
        {item.title ? (
          <Text size="sm" lineClamp={2}>
            {item.title}
          </Text>
        ) : null}
        {item.note ? (
          <Text
            size="sm"
            {...(color ? { c: color } : {})}
            {...(bucketKey === 'deferred' ? { fw: 600 } : {})}
            lineClamp={3}
          >
            {item.note}
          </Text>
        ) : null}
        {item.pr_url ? (
          <Anchor
            href={item.pr_url}
            target="_blank"
            rel="noreferrer"
            size="xs"
            onClick={(e) => e.stopPropagation()}
          >
            {item.pr_url}
          </Anchor>
        ) : null}
      </Stack>
    </Card>
  )
}

function BucketBlock({
  bucket,
  onSelectItem,
}: {
  bucket: Bucket
  onSelectItem: (eventId: number) => void
}) {
  const isDesktop = useBreakpoint('sm')
  const columns = useMemo(() => columnsFor(bucket.key), [bucket.key])

  if (!isDesktop) {
    return (
      <Section title={bucket.label} count={bucket.items.length}>
        <Stack gap="xs">
          {bucket.items.map((item) => (
            <ItemCard
              key={item.event_id}
              item={item}
              bucketKey={bucket.key}
              onSelect={() => onSelectItem(item.event_id)}
            />
          ))}
        </Stack>
      </Section>
    )
  }

  return (
    <BasaltDataTable
      title={bucket.label}
      data={bucket.items}
      columns={columns}
      getRowId={(row) => String(row.event_id)}
      onRowActivate={(row) => onSelectItem(row.event_id)}
    />
  )
}

/** One `Section`/table per non-empty bucket, in `deriveBoard`'s fixed order. The `deferred` bucket
 * (a budget-blocked `verdict`) carries its own label and a prominently-colored note column/line —
 * it must never blend into a plain `verdict` block. */
export function BoardSections({ buckets, onSelectItem }: Props) {
  const nonEmpty = buckets.filter((b) => b.items.length > 0)
  if (nonEmpty.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        No open items on the board.
      </Text>
    )
  }
  return (
    <Stack gap="md">
      {nonEmpty.map((bucket) => (
        <BucketBlock key={bucket.key} bucket={bucket} onSelectItem={onSelectItem} />
      ))}
    </Stack>
  )
}
