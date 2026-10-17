import { useCallback, useState } from 'react'
import { Anchor, Box, Button, SimpleGrid, Stack, Text } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { EmptyState, Section, useSizeClass } from 'basalt-ui'
import { CONTAINER_KEYS as CQ } from 'basalt-ui/tokens'
import { IconCircleCheck, IconListDetails } from '@tabler/icons-react'
import type { WardenActionVerb } from '../../lib/queries/warden'
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
  cardFacts,
  failureChip,
  needsCards,
  planActions,
  splitReason,
  type QueueKind,
} from './page-model'
import { StatusChip } from './status-chip'

type OnAction = (eventId: number, verb: WardenActionVerb, payload?: Record<string, unknown>) => void

type Props = {
  view: AwaitingOwnerView
  pending: PendingActions
  onSelectItem: (eventId: number) => void
  onAction: OnAction
}

/** Past this many characters the evidence is worth a clamp + expand; shorter text never needs one. */
const CLAMP_MIN_CHARS = 220

function ClampedText({ text }: { text: string }) {
  const [expanded, { toggle }] = useDisclosure(false)
  const clampable = text.length > CLAMP_MIN_CHARS
  return (
    <Stack gap={4} align="flex-start">
      <Text size="sm" {...(clampable && !expanded ? { lineClamp: 3 } : {})}>
        {text}
      </Text>
      {clampable ? (
        <Button variant="subtle" color="gray" size="compact-xs" onClick={toggle}>
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
  onFire,
  onSelectItem,
}: {
  row: AwaitingOwnerRow
  kind: QueueKind
  pending: PendingActions[number] | undefined
  narrow: boolean
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
      ? { question: `Retry ${title}?`, rest: row.reason }
      : splitReason(row.reason, title)
  const chip = kind === 'failed' ? failureChip(row.failureClass) : null
  const status =
    chip !== null ? (
      <StatusChip tone={chip.tone} label={chip.label} />
    ) : row.state !== 'needs_decision' && row.state !== 'failed' && row.state !== null ? (
      <StatusChip tone="neutral" label={row.state} />
    ) : undefined
  const evidence = split.rest !== null ? <ClampedText text={split.rest} /> : undefined

  return (
    <Box data-shot={`${kind}-${row.eventId}`}>
      <DecisionCard
        question={split.question}
        facts={cardFacts(row)}
        status={status}
        actor={kind === 'decision' && split.question !== title ? title : undefined}
        {...(!narrow && evidence ? { evidence } : {})}
        {...(narrow && evidence ? { disclosure: { label: 'Full reason', content: evidence } } : {})}
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
  onFire,
  onSelectItem,
}: {
  rows: readonly AwaitingOwnerRow[]
  kind: QueueKind
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
export function DecisionQueues({ view, pending, onSelectItem, onAction }: Props) {
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
