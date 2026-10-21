import { useCallback, useState } from 'react'
import { Anchor, Box, SimpleGrid, Text } from '@mantine/core'
import { EmptyState, Section } from 'basalt-ui'
import { CONTAINER_KEYS as CQ } from 'basalt-ui/tokens'
import { IconCircleCheck, IconListDetails } from '@tabler/icons-react'
import type { WardenActionVerb, WardenItems } from '../../lib/queries/warden'
import classes from '../../components/upstream/decision-card.module.css'
import queueClasses from './decision-queues.module.css'
import { useNow } from '../../lib/use-now'
import { BreakableTitle } from './breakable-title'
import { HistoryPreview } from './history-preview'
import { DecisionCard, type DecisionCardAction } from '../../components/upstream/decision-card'
import { capFacts } from '../../components/upstream/decision-card-model'
import { ActionPromptModal } from './action-prompt'
import { VERB_LABEL, needsPrompt, type PromptState, type PromptVerb } from './action-verbs'
import {
  isSafeHttpUrl,
  type AwaitingOwnerRow,
  type AwaitingOwnerView,
  type PendingActions,
} from './model'
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
  type ActionPlan,
  type QueueKind,
  type WardenAsk,
} from './page-model'
import { StatusChip } from './status-chip'

type OnAction = (eventId: number, verb: WardenActionVerb, payload?: Record<string, unknown>) => void

type Props = {
  view: AwaitingOwnerView
  /** When the snapshot was received: the card's `age_days` is frozen there. */
  receivedAt: string | null
  items: WardenItems | undefined
  pending: PendingActions
  onSelectItem: (eventId: number) => void
  onAction: OnAction
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

/**
 * Slots are explicit. The card's own verbs fill primary and secondary in that order. The timeline is
 * always an action: with no verb it is the primary, with one verb the secondary, and otherwise it
 * leads the menu.
 */
function cardSlots(
  plan: ActionPlan,
  toAction: (verb: WardenActionVerb) => DecisionCardAction,
  timeline: DecisionCardAction,
): {
  primary: DecisionCardAction
  secondary: DecisionCardAction | undefined
  menu: DecisionCardAction[]
} {
  const rest = plan.menu.map(toAction)
  if (plan.primary === null) return { primary: timeline, secondary: undefined, menu: rest }
  if (plan.secondary === null)
    return { primary: toAction(plan.primary), secondary: timeline, menu: rest }
  return {
    primary: toAction(plan.primary),
    secondary: toAction(plan.secondary),
    menu: [timeline, ...rest],
  }
}

function QueueCard({
  row,
  kind,
  ask,
  pending,
  history,
  now,
  elapsedMs,
  onFire,
  onSelectItem,
}: {
  row: AwaitingOwnerRow
  kind: QueueKind
  ask: WardenAsk
  pending: PendingActions[number] | undefined
  history: TransitionHistory
  /** The page clock and the time since the snapshot arrived, read once by `DecisionQueues`. */
  now: number
  elapsedMs: number
  onFire: (verb: WardenActionVerb) => void
  onSelectItem: () => void
}) {
  const { plan, repo, tag, copy } = ask
  const toAction = (verb: WardenActionVerb): DecisionCardAction => ({
    label: VERB_LABEL[verb],
    onClick: () => onFire(verb),
    disabled: pending !== undefined,
  })
  const timeline: DecisionCardAction = {
    label: 'Timeline',
    onClick: onSelectItem,
    icon: <IconListDetails size={14} />,
  }
  const { primary, secondary, menu } = cardSlots(plan, toAction, timeline)
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
          cardFacts(row, repo, { elapsedMs, historyAgeMs: latestHistoryAgeMs(history, now) }),
        )}
        status={status}
        subject={copy.entity ? <BreakableTitle text={copy.entity} /> : null}
        evidenceLine={copy.evidenceLine}
        {...(copy.detail !== null
          ? { disclosure: { label: 'Full reason', content: <FullAsk text={copy.detail} /> } }
          : {})}
        {...(view !== null ? { preview: <HistoryPreview view={view} now={now} /> } : {})}
        {...(view?.layout === 'inline' ? { previewPlacement: 'inline' as const } : {})}
        primary={primary}
        secondary={secondary}
        menu={menu}
        meta={
          pending !== undefined || row.prUrl !== null ? (
            <>
              {row.prUrl !== null ? <PrLink prUrl={row.prUrl} /> : null}
              {row.prUrl !== null && pending !== undefined ? ' · ' : null}
              {pending !== undefined
                ? `Queued: ${VERB_LABEL[pending.verb]} — warden applies it on its next poll`
                : null}
            </>
          ) : undefined
        }
      />
    </Box>
  )
}

type GridProps = {
  items: WardenItems | undefined
  now: number
  elapsedMs: number
  pending: PendingActions
  onFire: (eventId: number, verb: WardenActionVerb) => void
  onSelectItem: (eventId: number) => void
}

const GRID_COLS = { base: 1, [CQ.wide]: 2 }

/** One row's ordinary card, bound to its own pending write and history. */
function RowCard({
  row,
  kind,
  ask,
  items,
  now,
  elapsedMs,
  pending,
  onFire,
  onSelectItem,
}: GridProps & { row: AwaitingOwnerRow; kind: QueueKind; ask: WardenAsk }) {
  return (
    <QueueCard
      row={row}
      kind={kind}
      ask={ask}
      pending={pending[row.eventId]}
      history={recentTransitions(items?.[String(row.eventId)])}
      now={now}
      elapsedMs={elapsedMs}
      onFire={(verb) => onFire(row.eventId, verb)}
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
 * One repo's alerts as one card; Show/Hide toggles the members, which render as ordinary cards in
 * the same grid directly after it. No write lives on the group: every verb stays on a member.
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
 * `Needs you <n>`, `Failed <n>` and `Alerts <n>` as decision cards, from `board.awaiting_owner`; alert-origin
 * asks fold out of Needs you, one group card per repo with two or more. Each card carries
 * one primary and at most one secondary action; every other offered verb sits in the card's menu.
 * `dismiss`/`note` collect a short text first (`ActionPromptModal`); the write contract
 * (`onAction` → `use-warden-actions`) is unchanged.
 */
export function DecisionQueues({
  view,
  receivedAt,
  items,
  pending,
  onSelectItem,
  onAction,
}: Props) {
  const [prompt, setPrompt] = useState<PromptState>(null)
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
  const grid = { items, now, elapsedMs, pending, onSelectItem }

  const fire = useCallback(
    (eventId: number, verb: WardenActionVerb) => {
      if (needsPrompt(verb))
        setPrompt({ eventId, verb } satisfies { eventId: number; verb: PromptVerb })
      else onAction(eventId, verb)
    },
    [onAction],
  )

  function submitPrompt(text: string) {
    if (!prompt) return
    onAction(
      prompt.eventId,
      prompt.verb,
      prompt.verb === 'dismiss' ? { reason: text } : { note: text },
    )
    setPrompt(null)
  }

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
          <CardGrid rows={needs} kind="decision" asks={needsAsks} {...grid} onFire={fire} />
        )}
      </Section>
      {view.failed.length > 0 ? (
        <Section title="Failed" count={view.failed.length}>
          <CardGrid rows={view.failed} kind="failed" asks={failedAsks} {...grid} onFire={fire} />
        </Section>
      ) : null}
      {alertCount > 0 ? (
        <Section title="Alerts" count={alertCount}>
          <AlertGrid entries={alertEntries} asks={askById} {...grid} onFire={fire} />
        </Section>
      ) : null}
      <ActionPromptModal prompt={prompt} onClose={() => setPrompt(null)} onSubmit={submitPrompt} />
    </>
  )
}
