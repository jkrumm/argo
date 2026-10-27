import { useState } from 'react'
import { Anchor, Box, SimpleGrid, Text } from '@mantine/core'
import { EmptyState, Section } from 'basalt-ui'
import { CONTAINER_KEYS as CQ } from 'basalt-ui/tokens'
import { IconCircleCheck, IconListDetails } from '@tabler/icons-react'
import type { WardenItems } from '../../lib/queries/warden'
import classes from '../../components/upstream/decision-card.module.css'
import queueClasses from './decision-queues.module.css'
import { useNow } from '../../lib/use-now'
import { BreakableTitle } from './breakable-title'
import { HistoryPreview } from './history-preview'
import { DecisionCard } from '../../components/upstream/decision-card'
import { capFacts } from '../../components/upstream/decision-card-model'
import { isSafeHttpUrl, type AwaitingOwnerRow, type AwaitingOwnerView } from './model'
import {
  cardCategory,
  latestHistoryAgeMs,
  sinceSnapshotMs,
  cardFacts,
  alertGroupFacts,
  alertGroupSubject,
  alertMonitorName,
  historyView,
  needsCards,
  splitAlertQueue,
  resolveQueueAsks,
  recentTransitions,
  type AlertEntry,
  type AlertGroup,
  type TransitionHistory,
  type QueueKind,
  type WardenAsk,
} from './page-model'
import { StatusChip } from './status-chip'

type Props = {
  view: AwaitingOwnerView
  /** When the snapshot was received: the card's `age_days` is frozen there. */
  receivedAt: string | null
  items: WardenItems | undefined
  onSelectItem: (eventId: number) => void
}

/** The whole ask, behind the card's disclosure; long identifiers and URLs wrap anywhere. */
function FullAsk({ text }: { text: string }) {
  return (
    <Text size="sm" className={classes.wrap}>
      {text}
    </Text>
  )
}

function PrLink({ prUrl }: { prUrl: string }) {
  if (!isSafeHttpUrl(prUrl)) return <Text span>{prUrl}</Text>
  return (
    <Anchor href={prUrl} target="_blank" rel="noreferrer" size="xs">
      Open PR
    </Anchor>
  )
}

function QueueCard({
  row,
  kind,
  ask,
  history,
  now,
  elapsedMs,
  onSelectItem,
}: {
  row: AwaitingOwnerRow
  kind: QueueKind
  ask: WardenAsk
  history: TransitionHistory
  /** The page clock and the time since the snapshot arrived, read once by `DecisionQueues`. */
  now: number
  elapsedMs: number
  onSelectItem: () => void
}) {
  const { tag, copy } = ask
  const category = cardCategory(kind, tag, row.failureClass)
  const status =
    category !== null ? (
      <StatusChip label={category} />
    ) : row.state !== 'needs_decision' && row.state !== 'failed' && row.state !== null ? (
      <StatusChip label={row.state} />
    ) : undefined
  const view = historyView(history)

  return (
    <Box data-shot={`${kind}-${row.eventId}`} data-shot-absent="empty">
      <DecisionCard
        question={copy.question}
        facts={capFacts(
          cardFacts(row, ask.repo, { elapsedMs, historyAgeMs: latestHistoryAgeMs(history, now) }),
        )}
        status={status}
        subject={copy.entity ? <BreakableTitle text={copy.entity} /> : null}
        evidenceLine={copy.evidenceLine}
        {...(copy.detail !== null
          ? { disclosure: { label: 'Full reason', content: <FullAsk text={copy.detail} /> } }
          : {})}
        {...(view !== null ? { preview: <HistoryPreview view={view} now={now} /> } : {})}
        {...(view?.layout === 'inline' ? { previewPlacement: 'inline' as const } : {})}
        primary={{ label: 'Timeline', onClick: onSelectItem, icon: <IconListDetails size={14} /> }}
        meta={row.prUrl !== null ? <PrLink prUrl={row.prUrl} /> : undefined}
      />
    </Box>
  )
}

type GridProps = {
  items: WardenItems | undefined
  now: number
  elapsedMs: number
  onSelectItem: (eventId: number) => void
}

const GRID_COLS = { base: 1, [CQ.wide]: 2 }

/** One row's ordinary card, bound to its own history. */
function RowCard({
  row,
  kind,
  ask,
  items,
  now,
  elapsedMs,
  onSelectItem,
}: GridProps & { row: AwaitingOwnerRow; kind: QueueKind; ask: WardenAsk }) {
  return (
    <QueueCard
      row={row}
      kind={kind}
      ask={ask}
      history={recentTransitions(items?.[String(row.eventId)])}
      now={now}
      elapsedMs={elapsedMs}
      onSelectItem={() => onSelectItem(row.eventId)}
    />
  )
}

function CardGrid({
  rows,
  kind,
  asks,
  ...grid
}: GridProps & {
  rows: readonly AwaitingOwnerRow[]
  kind: QueueKind
  /** One ask per row, in order. */
  asks: readonly WardenAsk[]
}) {
  return (
    <SimpleGrid type="container" cols={GRID_COLS} spacing="sm" className={queueClasses.queueGrid}>
      {rows.map((row, i) => (
        <RowCard key={row.eventId} row={row} kind={kind} ask={asks[i]!} {...grid} />
      ))}
    </SimpleGrid>
  )
}

/**
 * One repo's alerts folded into one card; Show/Hide toggles the members, which render as ordinary
 * cards in the same grid directly after it.
 */
function AlertGroupCards({
  group,
  asks,
  ...grid
}: GridProps & { group: AlertGroup; asks: ReadonlyMap<number, WardenAsk> }) {
  const [open, setOpen] = useState(false)
  const count = group.rows.length
  const names = group.rows.map((row) => alertMonitorName(row, asks.get(row.eventId)!))
  const facts = alertGroupFacts(group, (row) => ({
    elapsedMs: grid.elapsedMs,
    historyAgeMs: latestHistoryAgeMs(
      recentTransitions(grid.items?.[String(row.eventId)]),
      grid.now,
    ),
  }))
  return (
    <>
      <Box data-shot={`alert-group-${group.repo}`} data-shot-absent="empty">
        <DecisionCard
          question={`Decide on ${count} ${group.repo} alerts?`}
          facts={capFacts(facts)}
          subject={<BreakableTitle text={alertGroupSubject(names)} />}
          evidenceLine={group.sharedAsk}
          primary={{
            label: open ? 'Hide alerts' : `Show ${count} alerts`,
            onClick: () => setOpen(!open),
          }}
        />
      </Box>
      {open
        ? group.rows.map((row) => (
            <RowCard
              key={row.eventId}
              row={row}
              kind="decision"
              ask={asks.get(row.eventId)!}
              {...grid}
            />
          ))
        : null}
    </>
  )
}

function AlertGrid({
  entries,
  asks,
  ...grid
}: GridProps & { entries: readonly AlertEntry[]; asks: ReadonlyMap<number, WardenAsk> }) {
  return (
    <SimpleGrid type="container" cols={GRID_COLS} spacing="sm" className={queueClasses.queueGrid}>
      {entries.map((entry) =>
        entry.kind === 'group' ? (
          <AlertGroupCards key={`group-${entry.repo}`} group={entry} asks={asks} {...grid} />
        ) : (
          <RowCard
            key={entry.row.eventId}
            row={entry.row}
            kind="decision"
            ask={asks.get(entry.row.eventId)!}
            {...grid}
          />
        ),
      )}
    </SimpleGrid>
  )
}

/**
 * `Needs you <n>`, `Failed <n>` and `Alerts <n>` as decision cards, from `board.awaiting_owner`;
 * alert-origin asks fold out of Needs you, one group card per repo with two or more. Warden was
 * switched off 2026-10-27 — these cards are read-only history, so the only action they carry is
 * opening the item's Timeline.
 */
export function DecisionQueues({ view, receivedAt, items, onSelectItem }: Props) {
  const now = useNow()
  const elapsedMs = sinceSnapshotMs(receivedAt, now)
  const queue = needsCards(view)
  // One surface: every card (alerts included, in warden's order) and every failed one are told apart
  // together, so folding the alerts out of Needs you never changes a card's copy.
  const resolved = resolveQueueAsks([
    ...queue.map((row) => ({ row, kind: 'decision' as const })),
    ...view.failed.map((row) => ({ row, kind: 'failed' as const })),
  ])
  const askById = new Map(
    [...queue, ...view.failed].map((row, i) => [row.eventId, resolved[i]!] as const),
  )
  const { needs, alertEntries } = splitAlertQueue(queue)
  const alertCount = queue.length - needs.length
  const needsAsks = needs.map((row) => askById.get(row.eventId)!)
  const failedAsks = view.failed.map((row) => askById.get(row.eventId)!)
  const grid = { items, now, elapsedMs, onSelectItem }

  return (
    <>
      <Section title="Needs you" count={needs.length}>
        {needs.length === 0 ? (
          <EmptyState
            tier="section"
            icon={<IconCircleCheck size={28} />}
            title={alertCount > 0 ? 'No decision beyond alerts' : 'Nothing needs you'}
            description={
              alertCount > 0
                ? `Only alerts are waiting: ${alertCount} under Alerts below.`
                : 'Warden has no decision waiting on you right now.'
            }
          />
        ) : (
          <CardGrid rows={needs} kind="decision" asks={needsAsks} {...grid} />
        )}
      </Section>
      {view.failed.length > 0 ? (
        <Section title="Failed" count={view.failed.length}>
          <CardGrid rows={view.failed} kind="failed" asks={failedAsks} {...grid} />
        </Section>
      ) : null}
      {alertCount > 0 ? (
        <Section title="Alerts" count={alertCount}>
          <AlertGrid entries={alertEntries} asks={askById} {...grid} />
        </Section>
      ) : null}
    </>
  )
}
