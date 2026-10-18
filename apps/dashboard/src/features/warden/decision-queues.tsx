import { useCallback, useState } from 'react'
import { Anchor, Box, SimpleGrid, Text } from '@mantine/core'
import { EmptyState, Section } from 'basalt-ui'
import { CONTAINER_KEYS as CQ } from 'basalt-ui/tokens'
import { IconCircleCheck, IconListDetails } from '@tabler/icons-react'
import type { WardenActionVerb, WardenItems } from '../../lib/queries/warden'
import classes from '../../components/upstream/decision-card.module.css'
import { HistoryPreview } from './history-preview'
import { DecisionCard, type DecisionCardAction } from '../../components/upstream/decision-card'
import { capFacts } from '../../components/upstream/decision-card-model'
import { softBreaks } from '../../lib/text'
import { ActionPromptModal } from './action-prompt'
import { VERB_LABEL, needsPrompt, type PromptState, type PromptVerb } from './action-verbs'
import {
  isSafeHttpUrl,
  type AwaitingOwnerRow,
  type AwaitingOwnerView,
  type PendingActions,
} from './model'
import {
  askCopy,
  cardCategory,
  cardFacts,
  historyView,
  needsCards,
  planActions,
  recentTransitions,
  type TransitionHistory,
  type QueueKind,
} from './page-model'
import { StatusChip } from './status-chip'

type OnAction = (eventId: number, verb: WardenActionVerb, payload?: Record<string, unknown>) => void

type Props = {
  view: AwaitingOwnerView
  items: WardenItems | undefined
  pending: PendingActions
  onSelectItem: (eventId: number) => void
  onAction: OnAction
}

/** The whole ask, behind the card's disclosure; long identifiers and URLs wrap anywhere. */
function FullAsk({ text }: { text: string }) {
  return (
    <Text size="sm" className={classes.wrap}>
      {softBreaks(text)}
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
  pending,
  history,
  onFire,
  onSelectItem,
}: {
  row: AwaitingOwnerRow
  kind: QueueKind
  pending: PendingActions[number] | undefined
  history: TransitionHistory
  onFire: (verb: WardenActionVerb) => void
  onSelectItem: () => void
}) {
  const plan = planActions(row.availableActions, kind)
  const toAction = (verb: WardenActionVerb): DecisionCardAction => ({
    label: VERB_LABEL[verb],
    onClick: () => onFire(verb),
    disabled: pending !== undefined,
  })
  // Primary and secondary are the first two offered verbs; the timeline is always an action, so a
  // card with one verb (or none) still has a second (or first) one and never reads as dead.
  const timeline: DecisionCardAction = {
    label: 'Timeline',
    onClick: onSelectItem,
    icon: <IconListDetails size={14} />,
  }
  const [primary, secondary, ...menu] = [
    ...(plan.primary ? [toAction(plan.primary)] : []),
    ...(plan.secondary ? [toAction(plan.secondary)] : []),
    timeline,
    ...plan.menu.map(toAction),
  ]

  const ask = askCopy({
    eventId: row.eventId,
    title: row.title,
    reason: row.reason,
    failed: kind === 'failed',
    question: row.question,
    repo: row.repo,
    primary: plan.primary,
  })
  const { copy } = ask
  const category = cardCategory(kind, ask.tag, row.failureClass)
  const status =
    category !== null ? (
      <StatusChip label={category} />
    ) : row.state !== 'needs_decision' && row.state !== 'failed' && row.state !== null ? (
      <StatusChip label={row.state} />
    ) : undefined
  const view = historyView(history)

  return (
    <Box data-shot={`${kind}-${row.eventId}`}>
      <DecisionCard
        question={copy.question}
        facts={capFacts(cardFacts(row))}
        status={status}
        actor={
          ask.entity !== null ? (
            <Text component="span" fz="xs" className={classes.wrap}>
              {softBreaks(ask.entity)}
            </Text>
          ) : undefined
        }
        evidenceLine={copy.evidenceLine}
        {...(copy.detail !== null
          ? { disclosure: { label: 'Full reason', content: <FullAsk text={copy.detail} /> } }
          : {})}
        {...(view !== null ? { preview: <HistoryPreview view={view} /> } : {})}
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

function CardGrid({
  rows,
  kind,
  pending,
  items,
  onFire,
  onSelectItem,
}: {
  rows: readonly AwaitingOwnerRow[]
  kind: QueueKind
  items: WardenItems | undefined
  pending: PendingActions
  onFire: (eventId: number, verb: WardenActionVerb) => void
  onSelectItem: (eventId: number) => void
}) {
  return (
    <SimpleGrid type="container" cols={{ base: 1, [CQ.wide]: 2 }} spacing="sm">
      {rows.map((row) => (
        <QueueCard
          key={row.eventId}
          row={row}
          kind={kind}
          pending={pending[row.eventId]}
          history={recentTransitions(items?.[String(row.eventId)])}
          onFire={(verb) => onFire(row.eventId, verb)}
          onSelectItem={() => onSelectItem(row.eventId)}
        />
      ))}
    </SimpleGrid>
  )
}

/**
 * `Needs you <n>` and `Failed <n>` as decision cards, from `board.awaiting_owner`. Each card carries
 * one primary and at most one secondary action; every other offered verb sits in the card's menu.
 * `dismiss`/`note` collect a short text first (`ActionPromptModal`); the write contract
 * (`onAction` → `use-warden-actions`) is unchanged.
 */
export function DecisionQueues({ view, items, pending, onSelectItem, onAction }: Props) {
  const [prompt, setPrompt] = useState<PromptState>(null)
  const needs = needsCards(view)

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
            title="Nothing needs you"
            description="Warden has no decision waiting on you right now."
          />
        ) : (
          <CardGrid
            rows={needs}
            kind="decision"
            items={items}
            pending={pending}
            onFire={fire}
            onSelectItem={onSelectItem}
          />
        )}
      </Section>
      {view.failed.length > 0 ? (
        <Section title="Failed" count={view.failed.length}>
          <CardGrid
            rows={view.failed}
            kind="failed"
            items={items}
            pending={pending}
            onFire={fire}
            onSelectItem={onSelectItem}
          />
        </Section>
      ) : null}
      <ActionPromptModal prompt={prompt} onClose={() => setPrompt(null)} onSubmit={submitPrompt} />
    </>
  )
}
