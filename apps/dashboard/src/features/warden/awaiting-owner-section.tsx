import { useCallback, useMemo, useState } from 'react'
import { Anchor, Card, Group, Stack, Text, Tooltip } from '@mantine/core'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/data/table'
import { EmptyState, Section } from 'basalt-ui'
import { IconCircleCheck } from '@tabler/icons-react'
import type { WardenActionVerb } from '../../lib/queries/warden'
import { FailureInfo, StateBadge } from './board-item-cells'
import {
  ActionButtons,
  ActionPromptModal,
  needsPrompt,
  type PromptState,
  type PromptVerb,
} from './issues-section'
import {
  isSafeHttpUrl,
  pluralize,
  type AwaitingOwnerRow,
  type AwaitingOwnerView,
  type PendingAction,
  type PendingActions,
} from './model'

type OnAction = (eventId: number, verb: WardenActionVerb, payload?: Record<string, unknown>) => void

type Props = {
  view: AwaitingOwnerView
  pending: PendingActions
  onSelectItem: (eventId: number) => void
  onAction: OnAction
}

/** Emphasized once an entry has waited `AWAITING_OWNER_STALE_DAYS` or longer (`row.stale`) — a
 * plain dimmed em dash otherwise mirrors `AgeText`'s no-timestamp case. */
function AgeCell({ row }: { row: AwaitingOwnerRow }) {
  return (
    <Text size="sm" {...(row.stale ? { fw: 700, c: 'orange' } : {})}>
      {row.ageLabel}
    </Text>
  )
}

/** The full text always reaches the tooltip — the cell itself clamps to three lines so a long
 * warden-written decision question never blows out the row height. */
function ReasonCell({ reason }: { reason: string | null }) {
  if (!reason) return <Text c="dimmed">—</Text>
  return (
    <Tooltip label={reason} multiline maw={360} withArrow>
      <Text size="sm" lineClamp={3}>
        {reason}
      </Text>
    </Tooltip>
  )
}

/** `failed` rows only: "N strikes · revision N" — only the parts with something to say, joined
 * onto one dimmed line. */
function failureFlags(row: AwaitingOwnerRow): string {
  return [
    row.strikes > 0 ? pluralize(row.strikes, 'strike') : null,
    row.revisionCount > 0 ? `revision ${row.revisionCount}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')
}

function FailureFlagsCell({ row }: { row: AwaitingOwnerRow }) {
  const flags = failureFlags(row)
  if (!flags && !row.failureClass && row.redrives === 0) return <Text c="dimmed">—</Text>
  return (
    <Stack gap={2} align="flex-start">
      <FailureInfo failureClass={row.failureClass} redrives={row.redrives} />
      {flags ? (
        <Text size="xs" c="dimmed">
          {flags}
        </Text>
      ) : null}
    </Stack>
  )
}

function PrCell({ prUrl }: { prUrl: string | null }) {
  if (!prUrl) return <Text c="dimmed">—</Text>
  if (!isSafeHttpUrl(prUrl)) return <Text size="sm">{prUrl}</Text>
  return (
    <Anchor
      href={prUrl}
      target="_blank"
      rel="noreferrer"
      size="sm"
      onClick={(e) => e.stopPropagation()}
    >
      PR
    </Anchor>
  )
}

type QueueKind = 'needs_decision' | 'failed' | 'other'

const columnHelper = createColumnHelper<AwaitingOwnerRow>()

function columnsFor({
  kind,
  pending,
  onFire,
  onPrompt,
}: {
  kind: QueueKind
  pending: PendingActions
  onFire: (eventId: number, verb: WardenActionVerb) => void
  onPrompt: (eventId: number, verb: PromptVerb) => void
}) {
  return [
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
    columnHelper.display({
      id: 'reason',
      header: kind === 'needs_decision' ? 'Decision' : 'Note',
      cell: (ctx) => <ReasonCell reason={ctx.row.original.reason} />,
    }),
    ...(kind !== 'needs_decision'
      ? [
          columnHelper.display({
            id: 'flags',
            header: 'Flags',
            cell: (ctx) => <FailureFlagsCell row={ctx.row.original} />,
          }),
        ]
      : []),
    columnHelper.display({
      id: 'age',
      header: 'Waiting',
      cell: (ctx) => <AgeCell row={ctx.row.original} />,
    }),
    columnHelper.display({
      id: 'pr',
      header: 'PR',
      cell: (ctx) => <PrCell prUrl={ctx.row.original.prUrl} />,
    }),
    columnHelper.display({
      id: 'actions',
      header: 'Actions',
      cell: (ctx) => {
        const eventId = ctx.row.original.eventId
        return (
          <ActionButtons
            item={ctx.row.original}
            pendingAction={pending[eventId]}
            onFire={(verb) => onFire(eventId, verb)}
            onPrompt={(verb) => onPrompt(eventId, verb)}
          />
        )
      },
    }),
  ]
}

function QueueCard({
  kind,
  row,
  pendingAction,
  onFire,
  onPrompt,
}: {
  kind: QueueKind
  row: AwaitingOwnerRow
  pendingAction: PendingAction | undefined
  onFire: (verb: WardenActionVerb) => void
  onPrompt: (verb: PromptVerb) => void
}) {
  return (
    <Card padding="sm">
      <Stack gap={4}>
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Group gap="xs" wrap="nowrap" miw={0}>
            <StateBadge state={row.state ?? 'unknown'} style={{ flexShrink: 0 }} />
            <Text size="sm" fw={600} lineClamp={1}>
              {row.repo ?? '—'}
            </Text>
          </Group>
          <AgeCell row={row} />
        </Group>
        {row.title ? (
          <Text size="sm" lineClamp={2}>
            {row.title}
          </Text>
        ) : null}
        <ReasonCell reason={row.reason} />
        {kind !== 'needs_decision' ? <FailureFlagsCell row={row} /> : null}
        <PrCell prUrl={row.prUrl} />
        <ActionButtons
          item={row}
          pendingAction={pendingAction}
          onFire={onFire}
          onPrompt={onPrompt}
        />
      </Stack>
    </Card>
  )
}

function QueueTable({
  kind,
  rows,
  pending,
  onSelectItem,
  onFire,
  onPrompt,
}: {
  kind: QueueKind
  rows: AwaitingOwnerRow[]
  pending: PendingActions
  onSelectItem: (eventId: number) => void
  onFire: (eventId: number, verb: WardenActionVerb) => void
  onPrompt: (eventId: number, verb: PromptVerb) => void
}) {
  const columns = useMemo(
    () => columnsFor({ kind, pending, onFire, onPrompt }),
    [kind, pending, onFire, onPrompt],
  )

  return (
    <BasaltDataTable
      data={rows}
      columns={columns}
      getRowId={(row) => String(row.eventId)}
      onRowActivate={(row) => onSelectItem(row.eventId)}
      renderCard={(row) => (
        <QueueCard
          kind={kind}
          row={row}
          pendingAction={pending[row.eventId]}
          onFire={(verb) => onFire(row.eventId, verb)}
          onPrompt={(verb) => onPrompt(row.eventId, verb)}
        />
      )}
    />
  )
}

/**
 * The one "Needs you" list — every `needs_decision` item, the decision question (the item note)
 * beside the actions that answer it — rendered first on `/warden` so nothing here rots invisibly.
 * `failed` items (a step that struck out; only an owner action moves them) get their own quieter
 * list below it, rendered only when there is one; an entry in any other state gets an "Unknown
 * state" list after that, so nothing awaiting the owner is ever dropped. Both come from `board.awaiting_owner` (see
 * `deriveAwaitingOwner`) and reuse the action buttons/prompt flow of `GithubIssuesSection`
 * (`ActionButtons`/`ActionPromptModal`, exported from `issues-section.tsx`).
 */
export function AwaitingOwnerSection({ view, pending, onSelectItem, onAction }: Props) {
  const [prompt, setPrompt] = useState<PromptState>(null)

  const openPrompt = useCallback(
    (eventId: number, verb: PromptVerb) => setPrompt({ eventId, verb }),
    [],
  )

  const fireOrPrompt = useCallback(
    (eventId: number, verb: WardenActionVerb) => {
      if (needsPrompt(verb)) openPrompt(eventId, verb)
      else onAction(eventId, verb)
    },
    [onAction, openPrompt],
  )

  function submitPrompt(text: string) {
    if (!prompt) return
    const payload = prompt.verb === 'dismiss' ? { reason: text } : { note: text }
    onAction(prompt.eventId, prompt.verb, payload)
    setPrompt(null)
  }

  return (
    <>
      <Section title="Needs you" count={view.needsDecision.length}>
        {view.needsDecision.length === 0 ? (
          <EmptyState
            tier="section"
            icon={<IconCircleCheck size={28} />}
            title="Nothing needs you"
            description="Warden has no decision waiting on you right now."
          />
        ) : (
          <QueueTable
            kind="needs_decision"
            rows={view.needsDecision}
            pending={pending}
            onSelectItem={onSelectItem}
            onFire={fireOrPrompt}
            onPrompt={openPrompt}
          />
        )}
      </Section>

      {view.failed.length > 0 ? (
        <Section title="Failed" count={view.failed.length}>
          <QueueTable
            kind="failed"
            rows={view.failed}
            pending={pending}
            onSelectItem={onSelectItem}
            onFire={fireOrPrompt}
            onPrompt={openPrompt}
          />
        </Section>
      ) : null}

      {view.other.length > 0 ? (
        <Section title="Unknown state" count={view.other.length}>
          <QueueTable
            kind="other"
            rows={view.other}
            pending={pending}
            onSelectItem={onSelectItem}
            onFire={fireOrPrompt}
            onPrompt={openPrompt}
          />
        </Section>
      ) : null}

      <ActionPromptModal prompt={prompt} onClose={() => setPrompt(null)} onSubmit={submitPrompt} />
    </>
  )
}
