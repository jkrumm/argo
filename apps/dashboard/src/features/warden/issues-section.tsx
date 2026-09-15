import { useCallback, useMemo, useState } from 'react'
import { Anchor, Badge, Button, Card, Group, Modal, Stack, Text, Textarea } from '@mantine/core'
import { useForm } from '@mantine/form'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/data/table'
import { Section, useBreakpoint } from 'basalt-ui'
import {
  isKnownActionVerb,
  type WardenActionVerb,
  type WardenBoardItem,
} from '../../lib/queries/warden'
import { AgeText, StateBadge } from './board-item-cells'
import {
  isSafeHttpUrl,
  issueRefLabel,
  type IssueGroup,
  type PendingAction,
  type PendingActions,
} from './model'

type OnAction = (eventId: number, verb: WardenActionVerb, payload?: Record<string, unknown>) => void

type Props = {
  groups: IssueGroup[]
  pending: PendingActions
  onSelectItem: (eventId: number) => void
  onAction: OnAction
}

/** The two verbs that ask for a short reason/note before they fire — every other verb fires
 * immediately with no payload. */
type PromptVerb = 'dismiss' | 'note'
type PromptState = { eventId: number; verb: PromptVerb } | null

const VERB_LABEL: Record<WardenActionVerb, string> = {
  implement: 'Implement',
  merge: 'Merge',
  dismiss: 'Dismiss',
  reinvestigate: 'Re-investigate',
  note: 'Note',
}

function needsPrompt(verb: WardenActionVerb): verb is PromptVerb {
  return verb === 'dismiss' || verb === 'note'
}

const columnHelper = createColumnHelper<WardenBoardItem>()

function ActionButtons({
  item,
  pendingAction,
  onFire,
  onPrompt,
}: {
  item: WardenBoardItem
  pendingAction: PendingAction | undefined
  onFire: (verb: WardenActionVerb) => void
  onPrompt: (verb: PromptVerb) => void
}) {
  // `item.availableActions` is an unconstrained string on the wire (see `WardenActionVerb`'s own
  // doc comment) — filter to the verbs this dashboard actually knows how to render/fire, rather
  // than rendering an "undefined"-labelled button that would still submit an unsupported verb.
  const verbs = (item.availableActions ?? []).filter(isKnownActionVerb)
  if (verbs.length === 0) return <Text c="dimmed">—</Text>
  return (
    <Group gap="xs" wrap="wrap">
      {verbs.map((verb) =>
        pendingAction?.verb === verb ? (
          <Badge key={verb} variant="light" color="gray">
            Queued: {VERB_LABEL[verb]}
          </Badge>
        ) : (
          <Button
            key={verb}
            size="xs"
            variant="light"
            disabled={pendingAction !== undefined}
            onClick={(e) => {
              e.stopPropagation()
              if (needsPrompt(verb)) onPrompt(verb)
              else onFire(verb)
            }}
          >
            {VERB_LABEL[verb]}
          </Button>
        ),
      )}
    </Group>
  )
}

function IssueRefLink({ item }: { item: WardenBoardItem }) {
  if (!item.issue) return <Text c="dimmed">—</Text>
  const label = issueRefLabel(item.issue)
  // `issue.url` can originate from a third-party author's GitHub payload — never render a
  // non-http(s) scheme (`javascript:`, `data:`, …) as a clickable link.
  if (!isSafeHttpUrl(item.issue.url)) return <Text size="sm">{label}</Text>
  return (
    <Anchor
      href={item.issue.url}
      target="_blank"
      rel="noreferrer"
      size="sm"
      onClick={(e) => e.stopPropagation()}
    >
      {label}
    </Anchor>
  )
}

/** `fallback` renders a dimmed "—" for a trusted (or issue-less) item — used by the table's Trust
 * column, which needs every row to fill a cell; the card layout omits the prop to skip rendering
 * entirely instead, since there it sits inline with other badges. */
function ThirdPartyBadge({
  item,
  fallback = false,
}: {
  item: WardenBoardItem
  fallback?: boolean
}) {
  if (item.issue && !item.issue.trusted) {
    return (
      <Badge color="orange" variant="light" style={{ flexShrink: 0 }}>
        third-party
      </Badge>
    )
  }
  return fallback ? <Text c="dimmed">—</Text> : null
}

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
    columnHelper.display({
      id: 'issue',
      header: 'Issue',
      cell: (ctx) => <IssueRefLink item={ctx.row.original} />,
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
      id: 'trust',
      header: 'Trust',
      cell: (ctx) => <ThirdPartyBadge item={ctx.row.original} fallback />,
    }),
    columnHelper.accessor('state', {
      header: 'State',
      cell: (ctx) => <StateBadge state={ctx.getValue()} />,
    }),
    columnHelper.accessor((row) => row.note ?? '', {
      id: 'note',
      header: 'Note',
      cell: (ctx) => {
        const note = ctx.getValue()
        return note ? (
          <Text size="sm" lineClamp={2}>
            {note}
          </Text>
        ) : (
          <Text c="dimmed">—</Text>
        )
      },
    }),
    columnHelper.accessor((row) => row.updated_at ?? row.created_at ?? '', {
      id: 'age',
      header: 'Age',
      cell: (ctx) => <AgeText at={ctx.getValue()} />,
    }),
    columnHelper.display({
      id: 'actions',
      header: 'Actions',
      cell: (ctx) => (
        <ActionButtons
          item={ctx.row.original}
          pendingAction={pending[ctx.row.original.event_id]}
          onFire={(verb) => onFire(ctx.row.original.event_id, verb)}
          onPrompt={(verb) => onPrompt(ctx.row.original.event_id, verb)}
        />
      ),
    }),
  ]
}

function issueCardLabel(item: WardenBoardItem): string {
  if (item.title) return item.title
  if (item.issue) return issueRefLabel(item.issue)
  return `event ${item.event_id}`
}

function IssueCard({
  item,
  pendingAction,
  onSelect,
  onFire,
  onPrompt,
}: {
  item: WardenBoardItem
  pendingAction: PendingAction | undefined
  onSelect: () => void
  onFire: (verb: WardenActionVerb) => void
  onPrompt: (verb: PromptVerb) => void
}) {
  return (
    <Card
      padding="sm"
      onClick={onSelect}
      onKeyDown={(e) => {
        // Nested real controls (the action Buttons, the issue Anchor) have their own keyboard
        // behaviour — only a key landing on the Card itself (not bubbled from a focused child)
        // should open the timeline modal.
        if (e.target !== e.currentTarget) return
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        onSelect()
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open ${issueCardLabel(item)}`}
      style={{ cursor: 'pointer' }}
    >
      <Stack gap={4}>
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Group gap="xs" wrap="nowrap" miw={0}>
            <StateBadge state={item.state} style={{ flexShrink: 0 }} />
            <IssueRefLink item={item} />
            <ThirdPartyBadge item={item} />
          </Group>
          <AgeText
            at={item.updated_at ?? item.created_at}
            style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
          />
        </Group>
        {item.title ? (
          <Text size="sm" lineClamp={2}>
            {item.title}
          </Text>
        ) : null}
        {item.note ? (
          <Text size="sm" lineClamp={3}>
            {item.note}
          </Text>
        ) : null}
        <ActionButtons
          item={item}
          pendingAction={pendingAction}
          onFire={onFire}
          onPrompt={onPrompt}
        />
      </Stack>
    </Card>
  )
}

function IssueGroupBlock({
  group,
  pending,
  isDesktop,
  onSelectItem,
  onFire,
  onPrompt,
}: {
  group: IssueGroup
  pending: PendingActions
  isDesktop: boolean
  onSelectItem: (eventId: number) => void
  onFire: (eventId: number, verb: WardenActionVerb) => void
  onPrompt: (eventId: number, verb: PromptVerb) => void
}) {
  const columns = useMemo(
    () => columnsFor({ pending, onFire, onPrompt }),
    [pending, onFire, onPrompt],
  )

  if (!isDesktop) {
    return (
      <Section title={group.label} count={group.items.length}>
        <Stack gap="xs">
          {group.items.map((item) => (
            <IssueCard
              key={item.event_id}
              item={item}
              pendingAction={pending[item.event_id]}
              onSelect={() => onSelectItem(item.event_id)}
              onFire={(verb) => onFire(item.event_id, verb)}
              onPrompt={(verb) => onPrompt(item.event_id, verb)}
            />
          ))}
        </Stack>
      </Section>
    )
  }

  return (
    <BasaltDataTable
      title={group.label}
      data={group.items}
      columns={columns}
      getRowId={(row) => String(row.event_id)}
      onRowActivate={(row) => onSelectItem(row.event_id)}
    />
  )
}

function ActionPromptModal({
  prompt,
  onClose,
  onSubmit,
}: {
  prompt: PromptState
  onClose: () => void
  onSubmit: (text: string) => void
}) {
  const form = useForm({ initialValues: { text: '' } })

  // The modal is one shared instance (only `opened` toggles) reused across every item/verb prompt
  // — reset on every close path (submit, X, overlay click, ESC) so a closed-without-submitting
  // prompt never leaves stale text pre-filled (and already valid) for the next item's prompt.
  function handleClose() {
    form.reset()
    onClose()
  }

  return (
    <Modal
      opened={prompt !== null}
      onClose={handleClose}
      title={prompt?.verb === 'dismiss' ? 'Dismiss reason' : 'Add a note'}
    >
      <form
        onSubmit={form.onSubmit((values) => {
          onSubmit(values.text)
          form.reset()
        })}
      >
        <Stack gap="sm">
          <Textarea
            autosize
            minRows={2}
            placeholder={prompt?.verb === 'dismiss' ? 'Why dismiss this item?' : 'Note text'}
            {...form.getInputProps('text')}
          />
          <Group justify="flex-end">
            <Button type="submit" disabled={form.values.text.trim().length === 0}>
              Submit
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}

/**
 * A separate, action-oriented view over `origin: "github_issue"` board items, grouped by pipeline
 * stage (`groupIssueItems`, `./model.ts`) rather than raw state. Row click opens the existing
 * `ItemTimeline` via `onSelectItem` — this component never builds a second modal for that. The
 * per-verb action buttons queue an owner action (`onAction`) against warden's action queue;
 * `dismiss`/`note` first collect a short text via `ActionPromptModal`.
 */
export function GithubIssuesSection({ groups, pending, onSelectItem, onAction }: Props) {
  const isDesktop = useBreakpoint('sm')
  const [prompt, setPrompt] = useState<PromptState>(null)
  const nonEmpty = groups.filter((g) => g.items.length > 0)

  const openPrompt = useCallback(
    (eventId: number, verb: PromptVerb) => setPrompt({ eventId, verb }),
    [],
  )

  function submitPrompt(text: string) {
    if (!prompt) return
    const payload = prompt.verb === 'dismiss' ? { reason: text } : { note: text }
    onAction(prompt.eventId, prompt.verb, payload)
    setPrompt(null)
  }

  return (
    <>
      {nonEmpty.length === 0 ? (
        <Text size="sm" c="dimmed">
          No GitHub issues tracked.
        </Text>
      ) : (
        <Stack gap="md">
          {nonEmpty.map((group) => (
            <IssueGroupBlock
              key={group.key}
              group={group}
              pending={pending}
              isDesktop={isDesktop}
              onSelectItem={onSelectItem}
              onFire={onAction}
              onPrompt={openPrompt}
            />
          ))}
        </Stack>
      )}

      <ActionPromptModal prompt={prompt} onClose={() => setPrompt(null)} onSubmit={submitPrompt} />
    </>
  )
}
