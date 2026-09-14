import type { ReactNode } from 'react'
import { Anchor, Badge, Divider, Group, Modal, Stack, Text } from '@mantine/core'
import { relativeTime } from 'basalt-ui/format'
import {
  buildItemFacts,
  formatSourceLine,
  formatVerdictLine,
  resolveItemModal,
  str,
  summarizeRow,
  type ItemFacts,
  type Row,
  type TimelineView,
} from './model'
import type { WardenItems } from '../../lib/queries/warden'

type Props = {
  eventId: number | null
  items: WardenItems | undefined
  onClose: () => void
}

function SubHeading({
  title,
  count,
  total,
}: {
  title: string
  count: number
  total?: number | null | undefined
}) {
  const truncated = total !== undefined && total !== null && total > count
  return (
    <Text size="sm" fw={700}>
      {title}{' '}
      <Text span c="dimmed" fw={400}>
        ({truncated ? `showing last ${count} of ${total}` : count})
      </Text>
    </Text>
  )
}

function EmptyLine() {
  return (
    <Text size="xs" c="dimmed">
      none
    </Text>
  )
}

function TransitionLabel({ transition }: { transition: Row }) {
  if (transition['synthetic'] === true) return <Text size="sm">created</Text>
  const from = str(transition['from_state']) ?? '—'
  const to = str(transition['to_state']) ?? '—'
  return (
    <Text size="sm">
      {from} → {to}
    </Text>
  )
}

function TransitionRow({ transition }: { transition: Row }) {
  const at = str(transition['at'])
  const reason = str(transition['reason'])
  return (
    <Group gap="xs" wrap="nowrap">
      <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
        {at ? relativeTime(at) : '—'}
      </Text>
      <TransitionLabel transition={transition} />
      {reason ? (
        <Text size="xs" c="dimmed">
          ({reason})
        </Text>
      ) : null}
    </Group>
  )
}

function TransitionsBlock({
  transitions,
  total,
}: {
  transitions: Row[]
  total?: number | null | undefined
}) {
  return (
    <Stack gap={4}>
      <SubHeading title="Transitions" count={transitions.length} total={total} />
      {transitions.length === 0 ? (
        <EmptyLine />
      ) : (
        transitions.map((t, i) => <TransitionRow key={i} transition={t} />)
      )}
    </Stack>
  )
}

function DispatchBadges({ dispatch }: { dispatch: Row }) {
  const createdAt = str(dispatch['created_at'])
  return (
    <Group gap="xs" wrap="nowrap">
      <Badge variant="light" color="gray">
        {str(dispatch['tier']) ?? '—'}
      </Badge>
      <Badge variant="light" color="blue">
        {str(dispatch['status']) ?? '—'}
      </Badge>
      {createdAt ? (
        <Text size="xs" c="dimmed">
          {relativeTime(createdAt)}
        </Text>
      ) : null}
    </Group>
  )
}

function DispatchVerdictLine({ dispatch }: { dispatch: Row }) {
  const verdict = (dispatch['verdict'] as Row | null) ?? null
  return verdict ? <Text size="sm">{formatVerdictLine(verdict)}</Text> : null
}

function DispatchMeta({ dispatch }: { dispatch: Row }) {
  const artifactUrl = str(dispatch['artifact_url'])
  const validationStatus = str(dispatch['validation_status'])
  const mergedAt = str(dispatch['merged_at'])
  return (
    <>
      {artifactUrl ? (
        <Anchor href={artifactUrl} target="_blank" rel="noreferrer" size="xs">
          Artifact
        </Anchor>
      ) : null}
      {validationStatus ? (
        <Text size="xs" c="dimmed">
          Validation: {validationStatus}
        </Text>
      ) : null}
      {mergedAt ? (
        <Text size="xs" c="dimmed">
          Merged {relativeTime(mergedAt)}
        </Text>
      ) : null}
    </>
  )
}

function DispatchRow({ dispatch }: { dispatch: Row }) {
  return (
    <Stack gap={2}>
      <DispatchBadges dispatch={dispatch} />
      <DispatchVerdictLine dispatch={dispatch} />
      <DispatchMeta dispatch={dispatch} />
    </Stack>
  )
}

function DispatchesBlock({ dispatches }: { dispatches: Row[] }) {
  return (
    <Stack gap={4}>
      <SubHeading title="Dispatches" count={dispatches.length} />
      {dispatches.length === 0 ? (
        <EmptyLine />
      ) : (
        dispatches.map((d, i) => <DispatchRow key={i} dispatch={d} />)
      )}
    </Stack>
  )
}

function OperationSummaryText({ operation }: { operation: Row }) {
  const repo = str(operation['repo']) ?? '—'
  const outcome = str(operation['outcome'])
  return (
    <Text size="sm">
      {repo}
      {outcome ? ` · ${outcome}` : ' · pending'}
    </Text>
  )
}

function OperationRow({ operation }: { operation: Row }) {
  const startedAt = str(operation['started_at'])
  return (
    <Group gap="xs" wrap="nowrap">
      <Badge variant="light" color="gray">
        {str(operation['kind']) ?? '—'}
      </Badge>
      <OperationSummaryText operation={operation} />
      {startedAt ? (
        <Text size="xs" c="dimmed">
          {relativeTime(startedAt)}
        </Text>
      ) : null}
    </Group>
  )
}

function OperationsBlock({
  operations,
  total,
}: {
  operations: Row[]
  total?: number | null | undefined
}) {
  return (
    <Stack gap={4}>
      <SubHeading title="Operations" count={operations.length} total={total} />
      {operations.length === 0 ? (
        <EmptyLine />
      ) : (
        operations.map((o, i) => <OperationRow key={i} operation={o} />)
      )}
    </Stack>
  )
}

function ApprovalsBlock({ approvals }: { approvals: Row[] }) {
  return (
    <Stack gap={4}>
      <SubHeading title="Approvals" count={approvals.length} />
      {approvals.length === 0 ? (
        <EmptyLine />
      ) : (
        approvals.map((a, i) => (
          <Text key={i} size="xs" c="dimmed">
            {summarizeRow(a, ['secret', 'token'])}
          </Text>
        ))
      )}
    </Stack>
  )
}

function FactLine({ children }: { children: ReactNode }) {
  return (
    <Text size="xs" c="dimmed">
      {children}
    </Text>
  )
}

function ItemTitle({ title }: { title: string | null }) {
  return title ? (
    <Text size="sm" fw={700}>
      {title}
    </Text>
  ) : null
}

function ItemSourceLine({
  source,
  externalId,
}: {
  source: string | null
  externalId: string | null
}) {
  if (source === null && externalId === null) return null
  return (
    <Text size="xs" c="dimmed">
      {formatSourceLine(source, externalId)}
    </Text>
  )
}

function StateBadge({ state }: { state: string | null }) {
  return state ? (
    <Badge variant="light" color="gray">
      {state}
    </Badge>
  ) : null
}

function OriginBadge({ origin }: { origin: string | null }) {
  return origin ? (
    <Badge variant="light" color="blue">
      {origin}
    </Badge>
  ) : null
}

function ItemBadges({ state, origin }: { state: string | null; origin: string | null }) {
  if (!state && !origin) return null
  return (
    <Group gap="xs">
      <StateBadge state={state} />
      <OriginBadge origin={origin} />
    </Group>
  )
}

function ItemSignature({ signature }: { signature: string | null }) {
  return signature ? (
    <Text size="xs" c="dimmed" ff="monospace" lineClamp={1}>
      {signature}
    </Text>
  ) : null
}

/** Identity block: title, `source:external_id`, state/origin badges, signature — each piece
 * renders (or hides) itself independently. */
function ItemIdentity({ facts }: { facts: ItemFacts }) {
  return (
    <>
      <ItemTitle title={facts.title} />
      <ItemSourceLine source={facts.source} externalId={facts.externalId} />
      <ItemBadges state={facts.state} origin={facts.origin} />
      <ItemSignature signature={facts.signature} />
    </>
  )
}

/** The tracking-fact lines (seen/occurrences, resolved, deadline, the two reminder counts) —
 * `buildItemFacts` already dropped the ones with nothing to say. */
function ItemFactLines({ lines }: { lines: string[] }) {
  return (
    <>
      {lines.map((line, i) => (
        <FactLine key={i}>{line}</FactLine>
      ))}
    </>
  )
}

function ItemNote({ note }: { note: string | null }) {
  return note ? <Text size="sm">{note}</Text> : null
}

function ItemBrief({ brief }: { brief: string | null }) {
  return brief ? <Text size="sm">{brief}</Text> : null
}

function ItemPayloadSummary({ summary }: { summary: string | null }) {
  return summary ? (
    <Text size="xs" c="dimmed" lineClamp={2}>
      {summary}
    </Text>
  ) : null
}

function UnmappedNotice({ show }: { show: boolean }) {
  return show ? (
    <Text size="xs" c="dimmed">
      Unmapped — no policy rule matches this signature, so warden only tracks it.
    </Text>
  ) : null
}

/** The prose: the note, the brief when one exists or — for a brief-less alert-origin item — the
 * event payload, and the "no policy rule maps this" notice. */
function ItemBody({ facts }: { facts: ItemFacts }) {
  return (
    <>
      <ItemNote note={facts.note} />
      <ItemBrief brief={facts.brief} />
      <ItemPayloadSummary summary={facts.payloadSummary} />
      <UnmappedNotice show={facts.unmapped} />
    </>
  )
}

/**
 * The header above the timeline's Divider sections — identity, the tracking-fact lines and the
 * prose. All derivation lives in `buildItemFacts` (`./model.ts`, unit-tested); this component only
 * composes the small pieces above it.
 */
function ItemSummary({ item, event }: { item: Row | null; event: Row | null }) {
  const facts = buildItemFacts(item, event)
  return (
    <Stack gap={4}>
      <ItemIdentity facts={facts} />
      <ItemFactLines lines={facts.lines} />
      <ItemBody facts={facts} />
    </Stack>
  )
}

function MissingTimelineNotice() {
  return (
    <Text size="sm" c="dimmed">
      This item's timeline was not included in the snapshot — the item list is capped and this one
      was truncated. Only its board summary is known.
    </Text>
  )
}

function TimelineBody({ facts }: { facts: TimelineView }) {
  return (
    <Stack gap="sm">
      {facts.item || facts.event ? <ItemSummary item={facts.item} event={facts.event} /> : null}
      <Divider />
      <TransitionsBlock transitions={facts.transitions} total={facts.transitionsTotal} />
      <Divider />
      <DispatchesBlock dispatches={facts.dispatches} />
      <Divider />
      <OperationsBlock operations={facts.operations} total={facts.operationsTotal} />
      <Divider />
      <ApprovalsBlock approvals={facts.approvals} />
    </Stack>
  )
}

/**
 * The per-item timeline, opened by clicking a board row. Reads `snapshot.items[event_id]` via
 * `resolveItemModal` (`./model.ts`) — when the id is absent (the snapshot truncates per-item
 * timelines past a cap) it says so rather than rendering an empty, misleadingly-complete block.
 */
export function ItemTimeline({ eventId, items, onClose }: Props) {
  const modal = resolveItemModal(eventId, items)

  return (
    <Modal opened={modal.opened} onClose={onClose} title={modal.title} size="lg">
      {!modal.timeline ? <MissingTimelineNotice /> : <TimelineBody facts={modal.facts} />}
    </Modal>
  )
}
