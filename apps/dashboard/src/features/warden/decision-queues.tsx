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
import { ActionPromptModal } from './action-prompt'
import { VERB_LABEL, needsPrompt, type PromptState, type PromptVerb } from './action-verbs'
import {
  isSafeHttpUrl,
  type AwaitingOwnerRow,
  type AwaitingOwnerView,
  type PendingActions,
} from './model'
import {
  wardenAsk,
  cardCategory,
  cardFacts,
  historyView,
  needsCards,
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
  const { plan, tag, copy, repoNamed } = wardenAsk(
    {
      eventId: row.eventId,
      repo: row.repo,
      title: row.title,
      reason: row.reason,
      question: row.question,
      availableActions: row.availableActions,
    },
    kind,
  )
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
  // Slots are explicit. The card's own verbs fill primary and secondary in that order. The timeline
  // is always an action: it takes the first slot nothing else fills, and otherwise sits in the menu.
  const primary = plan.primary === null ? timeline : toAction(plan.primary)
  const secondary =
    plan.primary === null
      ? undefined
      : plan.secondary === null
        ? timeline
        : toAction(plan.secondary)
  const menu = [
    ...(plan.primary !== null && plan.secondary !== null ? [timeline] : []),
    ...plan.menu.map(toAction),
  ]
  const category = cardCategory(kind, tag, row.failureClass)
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
        facts={capFacts(cardFacts(row, repoNamed))}
        status={status}
        actor={
          copy.entity !== null ? (
            <Text component="span" fz="xs" className={classes.wrap}>
              {copy.entity}
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
