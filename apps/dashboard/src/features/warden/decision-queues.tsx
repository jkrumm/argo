import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react'
import { Anchor, Box, Button, SimpleGrid, Stack, Text } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { EmptyState, Section, useSizeClass } from 'basalt-ui'
import { CONTAINER_KEYS as CQ } from 'basalt-ui/tokens'
import { IconCircleCheck, IconListDetails } from '@tabler/icons-react'
import type { WardenActionVerb, WardenItems } from '../../lib/queries/warden'
import { HistoryPreview } from './history-preview'
import { DecisionCard, type DecisionCardAction } from '../../components/upstream/decision-card'
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
  cardFacts,
  needsCards,
  planActions,
  retryQuestion,
  recentTransitions,
  type TransitionHistory,
  splitReason,
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

/** True while the element's content overflows its clamped box; re-measured whenever it resizes. */
function useOverflows(active: boolean, text: string) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [overflows, setOverflows] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!active || el === null) return
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [active, text])
  return { ref, overflows }
}

/** The reason, clamped to three lines with an in-place expand/collapse whenever it is cut off at
 * the current width — measured, not guessed from the character count. */
function ClampedText({ text }: { text: string }) {
  const [expanded, { toggle }] = useDisclosure(false)
  const textId = useId()
  const { ref, overflows } = useOverflows(!expanded, text)
  // Expanded text no longer overflows, so the toggle stays while expanded to let the owner collapse.
  const canToggle = overflows || expanded
  return (
    <Stack gap={4} align="flex-start">
      <Text id={textId} ref={ref} size="sm" lineClamp={expanded ? undefined : 3}>
        {text}
      </Text>
      {canToggle ? (
        <Button
          variant="subtle"
          color="gray"
          size="compact-xs"
          onClick={toggle}
          aria-expanded={expanded}
          aria-controls={textId}
        >
          {expanded ? 'Show less' : 'Show more'}
        </Button>
      ) : null}
    </Stack>
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
  narrow,
  history,
  onFire,
  onSelectItem,
}: {
  row: AwaitingOwnerRow
  kind: QueueKind
  pending: PendingActions[number] | undefined
  narrow: boolean
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
  const menu: DecisionCardAction[] = [
    ...plan.menu.map(toAction),
    { label: 'Timeline', onClick: onSelectItem, icon: <IconListDetails size={14} /> },
  ]

  const title = row.title ?? `Item #${row.eventId}`
  const split =
    kind === 'failed'
      ? { question: retryQuestion(title), rest: row.reason }
      : splitReason(row.reason, title)
  const category = cardCategory(kind, 'tag' in split ? split.tag : null, row.failureClass)
  const status =
    category !== null ? (
      <StatusChip label={category} />
    ) : row.state !== 'needs_decision' && row.state !== 'failed' && row.state !== null ? (
      <StatusChip label={row.state} />
    ) : undefined
  const evidence = split.rest !== null ? <ClampedText text={split.rest} /> : undefined

  return (
    <Box data-shot={`${kind}-${row.eventId}`}>
      <DecisionCard
        question={split.question}
        facts={cardFacts(row)}
        status={status}
        actor={
          kind === 'decision' && split.question !== title ? (
            <Text component="span" fz="xs" title={title}>
              {title}
            </Text>
          ) : undefined
        }
        {...(!narrow && evidence ? { evidence } : {})}
        {...(narrow && evidence ? { disclosure: { label: 'Full reason', content: evidence } } : {})}
        {...(!narrow && history.length > 0 ? { preview: <HistoryPreview lines={history} /> } : {})}
        primary={plan.primary ? toAction(plan.primary) : undefined}
        secondary={plan.secondary ? toAction(plan.secondary) : undefined}
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
  const narrow = useSizeClass() === 'compact'
  return (
    <SimpleGrid type="container" cols={{ base: 1, [CQ.wide]: 2 }} spacing="sm">
      {rows.map((row) => (
        <QueueCard
          key={row.eventId}
          row={row}
          kind={kind}
          pending={pending[row.eventId]}
          narrow={narrow}
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
