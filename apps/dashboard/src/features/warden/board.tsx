import { Anchor, Box, Card, Group, ScrollArea, Stack, Text, UnstyledButton } from '@mantine/core'
import { Section, useSizeClass } from 'basalt-ui'
import { VX } from 'basalt-ui/tokens'
import { ViewTabs } from 'basalt-ui/controls'
import { relativeTime } from 'basalt-ui/format'
import { IconBell, IconBrandGithub, IconBriefcase, IconUser, type Icon } from '@tabler/icons-react'
import type { WardenBoardItem } from '../../lib/queries/warden'
import { isSafeHttpUrl, issueRefLabel } from './model'
import classes from './board.module.css'
import { boardStore } from './board-store'
import { deferredNote, openCount, type BoardColumn } from './page-model'

const ORIGIN_ICON: Record<string, { Glyph: Icon; label: string }> = {
  alert: { Glyph: IconBell, label: 'Alert' },
  github_issue: { Glyph: IconBrandGithub, label: 'GitHub issue' },
  human: { Glyph: IconUser, label: 'Owner request' },
  job: { Glyph: IconBriefcase, label: 'Job' },
}

function OriginGlyph({ origin }: { origin: string | null | undefined }) {
  const entry = origin ? ORIGIN_ICON[origin] : undefined
  if (!entry) return null
  return <entry.Glyph size={14} aria-label={entry.label} />
}

/** `prUrl` and `issue.url` can come from a third party — only http(s) renders as a link. */
function PrLink({ url }: { url: string }) {
  if (!isSafeHttpUrl(url)) return null
  return (
    <Anchor
      href={url}
      target="_blank"
      rel="noreferrer"
      size="xs"
      onClick={(event) => event.stopPropagation()}
    >
      PR
    </Anchor>
  )
}

function BoardCard({
  item,
  showState,
  onOpen,
}: {
  item: WardenBoardItem
  showState: boolean
  onOpen: (eventId: number) => void
}) {
  const at = item.updated_at ?? item.created_at
  const deferred = deferredNote(item)
  const ref = item.issue ? issueRefLabel(item.issue) : null
  return (
    <UnstyledButton
      onClick={() => onOpen(item.event_id)}
      w="100%"
      aria-label={`Open item ${item.event_id}`}
    >
      <Card py="sm" px="md">
        <Stack gap={6}>
          <Group gap="xs" wrap="nowrap" justify="space-between">
            <Text size="xs" c="dimmed" lineClamp={1} className={classes.text}>
              {[item.repo, ref].filter(Boolean).join(' · ') || `Item #${item.event_id}`}
            </Text>
            <OriginGlyph origin={item.origin} />
          </Group>
          <Text size="sm" lineClamp={2} className={classes.text}>
            {item.title ?? '—'}
          </Text>
          {showState ? (
            <Text size="xs" c="dimmed" ff="monospace">
              {item.state}
            </Text>
          ) : null}
          {deferred !== null ? (
            <Text size="xs" c="dimmed" lineClamp={2} className={classes.text}>
              <Text span size="xs" fw={600} c={VX.status.warn}>
                Deferred
              </Text>
              {' · '}
              {deferred}
            </Text>
          ) : null}
          <Group gap="xs" justify="space-between">
            <Text size="xs" c="dimmed">
              {at ? relativeTime(at) : '—'}
            </Text>
            {item.pr_url ? <PrLink url={item.pr_url} /> : null}
          </Group>
        </Stack>
      </Card>
    </UnstyledButton>
  )
}

function ColumnHeader({ column }: { column: BoardColumn }) {
  return (
    <Stack gap={0}>
      <Text size="xs" fw={600} ff="monospace" tt="uppercase">
        {column.label}
      </Text>
      <Text size="xs" c="dimmed" ff="monospace">
        {column.items.length} {column.items.length === 1 ? 'item' : 'items'}
      </Text>
    </Stack>
  )
}

function ColumnBody({
  column,
  onOpen,
}: {
  column: BoardColumn
  onOpen: (eventId: number) => void
}) {
  return (
    <Stack gap="xs">
      {column.items.length === 0 ? (
        <Text size="xs" c="dimmed">
          No items in {column.label}
        </Text>
      ) : (
        column.items.map((item) => (
          <BoardCard
            key={item.event_id}
            item={item}
            showState={column.key === 'other'}
            onOpen={onOpen}
          />
        ))
      )}
    </Stack>
  )
}

/**
 * Board — prototype of the upstream `Board` (docs/design/UPSTREAM.md): `columns` with counts,
 * `onOpen` per card; each column scrolls alone at desktop and one column at a time sits under a
 * `SegmentedControl` at 390.
 */
export function Board({
  columns,
  onSelectItem,
}: {
  columns: readonly BoardColumn[]
  onSelectItem: (eventId: number) => void
}) {
  const narrow = useSizeClass() === 'compact'
  const [picked] = boardStore.field.column.use()
  const active = columns.find((column) => column.key === picked) ?? columns[0]
  const title = `Board · ${openCount(columns)} open`
  const tabs = narrow ? (
    <ViewTabs
      field={boardStore.field.column}
      options={columns.map((column) => ({
        value: column.key,
        label: `${column.label} ${column.items.length}`,
      }))}
    />
  ) : undefined

  return (
    <Section title={title} {...(tabs ? { tabs } : {})}>
      {narrow ? (
        active ? (
          <ColumnBody column={active} onOpen={onSelectItem} />
        ) : null
      ) : (
        <Box className={classes.columns} data-shot="board">
          {columns.map((column) => (
            <Stack
              key={column.key}
              gap="xs"
              className={column.items.length === 0 ? classes.empty : classes.column}
            >
              <ColumnHeader column={column} />
              <ScrollArea.Autosize mah="28rem" type="auto" scrollbars="y" offsetScrollbars>
                <ColumnBody column={column} onOpen={onSelectItem} />
              </ScrollArea.Autosize>
            </Stack>
          ))}
        </Box>
      )}
    </Section>
  )
}
