import { useCallback, useMemo, useState } from 'react'
import { Anchor, Badge, Card, Group, Stack, Text, Tooltip } from '@mantine/core'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/data/table'
import { EmptyState, Section } from 'basalt-ui'
import { IconCircleCheck } from '@tabler/icons-react'
import type { WardenActionVerb } from '../../lib/queries/warden'
import { StateBadge } from './board-item-cells'
import {
  ActionButtons,
  ActionPromptModal,
  needsPrompt,
  type PromptState,
  type PromptVerb,
} from './issues-section'
import {
  isSafeHttpUrl,
  type AwaitingOwnerRow,
  type PendingAction,
  type PendingActions,
} from './model'

type OnAction = (eventId: number, verb: WardenActionVerb, payload?: Record<string, unknown>) => void

type Props = {
  rows: AwaitingOwnerRow[]
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

/** A `stranded_pr` row carries no board `state` at all — it renders its own badge rather than a
 * blank/`unknown` `StateBadge`. */
function StateCell({ row }: { row: AwaitingOwnerRow }) {
  if (row.kind === 'stranded_pr') {
    return (
      <Badge variant="light" color="blue" style={{ flexShrink: 0 }}>
        stranded PR
      </Badge>
    )
  }
  return <StateBadge state={row.state ?? 'unknown'} />
}

/** The full reason always reaches the tooltip — the cell itself clamps to two lines so a long
 * warden-written reason never blows out the row height. */
function ReasonCell({ reason }: { reason: string | null }) {
  if (!reason) return <Text c="dimmed">—</Text>
  return (
    <Tooltip label={reason} multiline maw={360} withArrow>
      <Text size="sm" lineClamp={2}>
        {reason}
      </Text>
    </Tooltip>
  )
}

/** "recurred N× since parked" and "revision N" — only the ones with something to say, joined onto
 * one dimmed line. */
function flagParts(row: AwaitingOwnerRow): string[] {
  return [
    row.parkedRecurrences > 0 ? `recurred ${row.parkedRecurrences}× since parked` : null,
    row.revisionCount > 0 ? `revision ${row.revisionCount}` : null,
  ].filter((part): part is string => part !== null)
}

function FlagsCell({ row }: { row: AwaitingOwnerRow }) {
  const parts = flagParts(row)
  if (parts.length === 0) return <Text c="dimmed">—</Text>
  return (
    <Text size="xs" c="dimmed">
      {parts.join(' · ')}
    </Text>
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

const columnHelper = createColumnHelper<AwaitingOwnerRow>()

function columnsFor({
  pending,
  onFire,
  onPrompt,
}: {
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
      id: 'state',
      header: 'State',
      cell: (ctx) => <StateCell row={ctx.row.original} />,
    }),
    columnHelper.display({
      id: 'age',
      header: 'Waiting',
      cell: (ctx) => <AgeCell row={ctx.row.original} />,
    }),
    columnHelper.display({
      id: 'reason',
      header: 'Reason',
      cell: (ctx) => <ReasonCell reason={ctx.row.original.reason} />,
    }),
    columnHelper.display({
      id: 'flags',
      header: 'Flags',
      cell: (ctx) => <FlagsCell row={ctx.row.original} />,
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
        const row = ctx.row.original
        if (row.kind !== 'item' || row.eventId === null) return <Text c="dimmed">—</Text>
        const eventId = row.eventId
        return (
          <ActionButtons
            item={row}
            pendingAction={pending[eventId]}
            onFire={(verb) => onFire(eventId, verb)}
            onPrompt={(verb) => onPrompt(eventId, verb)}
          />
        )
      },
    }),
  ]
}

function AwaitingOwnerCard({
  row,
  pendingAction,
  onFire,
  onPrompt,
}: {
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
            <StateCell row={row} />
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
        <FlagsCell row={row} />
        <PrCell prUrl={row.prUrl} />
        {row.kind === 'item' && row.eventId !== null ? (
          <ActionButtons
            item={row}
            pendingAction={pendingAction}
            onFire={onFire}
            onPrompt={onPrompt}
          />
        ) : null}
      </Stack>
    </Card>
  )
}

/**
 * "Waiting on you" — everything warden's snapshot itself flags as unable to proceed without the
 * owner (`board.awaiting_owner`), rendered first on `/warden` so nothing here rots invisibly.
 * `kind: "item"` rows reuse the same action buttons/prompt flow as `GithubIssuesSection`
 * (`ActionButtons`/`ActionPromptModal`, exported from `issues-section.tsx`); `kind: "stranded_pr"`
 * rows carry no actions — the PR link and the reason are all there is to show.
 */
export function AwaitingOwnerSection({ rows, pending, onSelectItem, onAction }: Props) {
  const [prompt, setPrompt] = useState<PromptState>(null)

  const openPrompt = useCallback(
    (eventId: number, verb: PromptVerb) => setPrompt({ eventId, verb }),
    [],
  )

  function fireOrPrompt(eventId: number, verb: WardenActionVerb) {
    if (needsPrompt(verb)) openPrompt(eventId, verb)
    else onAction(eventId, verb)
  }

  function submitPrompt(text: string) {
    if (!prompt) return
    const payload = prompt.verb === 'dismiss' ? { reason: text } : { note: text }
    onAction(prompt.eventId, prompt.verb, payload)
    setPrompt(null)
  }

  const columns = useMemo(
    () => columnsFor({ pending, onFire: fireOrPrompt, onPrompt: openPrompt }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pending, onAction, openPrompt],
  )

  return (
    <>
      <Section title="Waiting on you" count={rows.length}>
        {rows.length === 0 ? (
          <EmptyState
            tier="section"
            icon={<IconCircleCheck size={28} />}
            title="Nothing waiting on you"
            description="Warden has nothing parked that needs your decision right now."
          />
        ) : (
          <BasaltDataTable
            data={rows}
            columns={columns}
            getRowId={(row, index) => `${row.kind}-${row.eventId ?? 'none'}-${index}`}
            onRowActivate={(row) => {
              if (row.kind === 'item' && row.eventId !== null) onSelectItem(row.eventId)
            }}
            renderCard={(row) => (
              <AwaitingOwnerCard
                row={row}
                pendingAction={row.eventId !== null ? pending[row.eventId] : undefined}
                onFire={(verb) => row.eventId !== null && fireOrPrompt(row.eventId, verb)}
                onPrompt={(verb) => row.eventId !== null && openPrompt(row.eventId, verb)}
              />
            )}
          />
        )}
      </Section>

      <ActionPromptModal prompt={prompt} onClose={() => setPrompt(null)} onSubmit={submitPrompt} />
    </>
  )
}
