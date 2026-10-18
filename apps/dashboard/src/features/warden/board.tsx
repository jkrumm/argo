import { useEffect } from 'react'
import { Anchor, Box, Card, Group, Stack, Text, UnstyledButton } from '@mantine/core'
import { Section, useSizeClass } from 'basalt-ui'
import { VX } from 'basalt-ui/tokens'
import { ViewTabs } from 'basalt-ui/controls'
import { IconBell, IconBrandGithub, IconBriefcase, IconUser, type Icon } from '@tabler/icons-react'
import type { WardenBoardItem } from '../../lib/queries/warden'
import { stripShortcodes } from '../../lib/text'
import { isSafeHttpUrl, issueRefLabel } from './model'
import { Ago } from './ago'
import classes from './board.module.css'
import { boardStore } from './board-store'
import {
  deferralOf,
  emptyColumnText,
  originKind,
  splitBoardColumns,
  type BoardColumn,
  type OriginKind,
} from './page-model'

const ORIGIN_ICON: Record<OriginKind, { Glyph: Icon; label: string }> = {
  alert: { Glyph: IconBell, label: 'Alert' },
  github_issue: { Glyph: IconBrandGithub, label: 'GitHub issue' },
  human: { Glyph: IconUser, label: 'Owner request' },
  job: { Glyph: IconBriefcase, label: 'Job' },
}

function OriginGlyph({ origin }: { origin: string | null | undefined }) {
  const kind = originKind(origin)
  if (kind === null) return null
  const { Glyph, label } = ORIGIN_ICON[kind]
  return <Glyph size={14} aria-label={label} role="img" />
}

/** `prUrl` and `issue.url` can come from a third party — only http(s) renders as a link. */
function PrLink({ url }: { url: string }) {
  if (!isSafeHttpUrl(url)) return null
  return (
    <Anchor href={url} target="_blank" rel="noreferrer" size="xs">
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
  const { deferred, detail } = deferralOf(item)
  const ref = item.issue ? issueRefLabel(item.issue) : null
  const source =
    stripShortcodes([item.repo, ref].filter(Boolean).join(' · ')) || `Item #${item.event_id}`
  const cleanTitle = stripShortcodes(item.title ?? '')
  const title = cleanTitle || `Item #${item.event_id}`
  return (
    <Card data-shot={`board-card-${item.event_id}`} data-shot-absent="empty">
      <Stack gap={6}>
        <Group gap="xs" wrap="nowrap" justify="space-between">
          <Text size="xs" c="dimmed" lineClamp={1} className={classes.text}>
            {source}
          </Text>
          <OriginGlyph origin={item.origin} />
        </Group>
        <UnstyledButton
          onClick={() => onOpen(item.event_id)}
          aria-label={`Open timeline: ${title} (${source})`}
          ta="left"
        >
          <Text size="sm" lineClamp={2} className={classes.text}>
            {cleanTitle || '—'}
          </Text>
        </UnstyledButton>
        {showState ? (
          <Text size="xs" c="dimmed" ff="monospace">
            {item.state}
          </Text>
        ) : null}
        {deferred ? (
          <Text size="xs" c="dimmed" lineClamp={2} className={classes.text}>
            <Text span size="xs" fw={600} c={VX.status.warn}>
              Deferred
            </Text>
            {detail === null ? null : ` · ${stripShortcodes(detail)}`}
          </Text>
        ) : null}
        <Group gap="xs" justify="space-between">
          <Text size="xs" c="dimmed">
            {at ? <Ago at={at} /> : '—'}
          </Text>
          {item.pr_url ? <PrLink url={item.pr_url} /> : null}
        </Group>
      </Stack>
    </Card>
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
          {emptyColumnText(column.key)}
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
 * `onOpen` per card. At 1440 only populated columns take the row's width; the empty ones fold into
 * one `Empty: A, B` line under it. At 390 one column at a time sits under a `ViewTabs` selector.
 * `data-shot="board"` wraps whichever layout renders, so the shot harness crops it at both widths.
 */
export function Board({
  columns,
  open,
  emptyText,
  onSelectItem,
}: {
  columns: readonly BoardColumn[]
  /** Items on the board (`deriveBoard`), shown as the section count. */
  open: number
  /** What the empty board says (a fact, from `emptyBoardText`). */
  emptyText: string
  onSelectItem: (eventId: number) => void
}) {
  const narrow = useSizeClass() === 'compact'
  const [picked, setPicked] = boardStore.field.column.use()
  const active = columns.find((column) => column.key === picked) ?? columns[0]
  // A persisted column that is not rendered (Other, once empty) snaps to the first real tab.
  useEffect(() => {
    if (active !== undefined && active.key !== picked) setPicked(active.key)
  }, [active, picked, setPicked])
  const tabs = narrow ? (
    <ViewTabs
      label="Board column"
      field={boardStore.field.column}
      options={columns.map((column) => ({
        value: column.key,
        label: `${column.label} ${column.items.length}`,
      }))}
    />
  ) : undefined
  const { populated, emptyLabels } = splitBoardColumns(columns)

  return (
    <Section title="Board" count={open} {...(tabs && open > 0 ? { tabs } : {})}>
      <Box data-shot="board">
        {open === 0 ? (
          <Text size="xs" c="dimmed">
            {emptyText}
          </Text>
        ) : narrow ? (
          active ? (
            <ColumnBody column={active} onOpen={onSelectItem} />
          ) : null
        ) : (
          <Stack gap="xs">
            {populated.length > 0 ? (
              <Box className={classes.columns}>
                {populated.map((column) => (
                  <Stack key={column.key} gap="xs" className={classes.column}>
                    <ColumnHeader column={column} />
                    <ColumnBody column={column} onOpen={onSelectItem} />
                  </Stack>
                ))}
              </Box>
            ) : null}
            {emptyLabels.length > 0 ? (
              <Text size="xs" c="dimmed">{`Empty: ${emptyLabels.join(', ')}`}</Text>
            ) : null}
          </Stack>
        )}
      </Box>
    </Section>
  )
}
