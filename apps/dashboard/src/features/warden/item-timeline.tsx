import { Anchor, Badge, Divider, Group, Modal, Stack, Text } from '@mantine/core'
import { relativeTime } from 'basalt-ui/format'
import type { WardenItems } from '../../lib/queries/warden'

type Props = {
  eventId: number | null
  items: WardenItems | undefined
  onClose: () => void
}

type Row = Record<string, unknown>

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Matches by name, not an exact list — `secret`/`token` alone missed `password`, `nonce`,
 * `signature` and any `*_key` field a producer might add later. */
const SENSITIVE_KEY_PATTERN = /secret|token|password|nonce|signature|key$/i

/** A compact `"key: value"` line over every field but the ones already rendered explicitly and
 * any field whose name looks sensitive — defensive against field names varying slightly between
 * warden's producers. */
function summarizeRow(row: Row, skip: string[]): string {
  const skipSet = new Set(skip)
  return Object.entries(row)
    .filter(
      ([key, value]) =>
        !skipSet.has(key) &&
        !SENSITIVE_KEY_PATTERN.test(key) &&
        value !== null &&
        value !== undefined,
    )
    .map(
      ([key, value]) =>
        `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`,
    )
    .join(' · ')
}

function SubHeading({ title, count }: { title: string; count: number }) {
  return (
    <Text size="sm" fw={700}>
      {title}{' '}
      <Text span c="dimmed" fw={400}>
        ({count})
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

function TransitionsBlock({ transitions }: { transitions: Row[] }) {
  return (
    <Stack gap={4}>
      <SubHeading title="Transitions" count={transitions.length} />
      {transitions.length === 0 ? (
        <EmptyLine />
      ) : (
        transitions.map((t, i) => (
          <Group key={i} gap="xs" wrap="nowrap">
            <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
              {str(t['at']) ? relativeTime(str(t['at'])!) : '—'}
            </Text>
            <Text size="sm">
              {str(t['from_state']) ?? '—'} → {str(t['to_state']) ?? '—'}
            </Text>
            {str(t['reason']) ? (
              <Text size="xs" c="dimmed">
                ({str(t['reason'])})
              </Text>
            ) : null}
          </Group>
        ))
      )}
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
        dispatches.map((d, i) => {
          const verdict = (d['verdict'] as Row | null) ?? null
          return (
            <Stack key={i} gap={2}>
              <Group gap="xs" wrap="nowrap">
                <Badge variant="light" color="gray">
                  {str(d['tier']) ?? '—'}
                </Badge>
                <Badge variant="light" color="blue">
                  {str(d['status']) ?? '—'}
                </Badge>
                {str(d['created_at']) ? (
                  <Text size="xs" c="dimmed">
                    {relativeTime(str(d['created_at'])!)}
                  </Text>
                ) : null}
              </Group>
              {verdict ? (
                <Text size="sm">
                  {str(verdict['summary']) ?? '—'}
                  {str(verdict['nextAction']) ? ` · next: ${str(verdict['nextAction'])}` : ''}
                  {str(verdict['confidence']) ? ` · confidence: ${str(verdict['confidence'])}` : ''}
                  {str(verdict['outcome']) ? ` · outcome: ${str(verdict['outcome'])}` : ''}
                </Text>
              ) : null}
              {str(d['artifact_url']) ? (
                <Anchor href={str(d['artifact_url'])!} target="_blank" rel="noreferrer" size="xs">
                  Artifact
                </Anchor>
              ) : null}
              {str(d['validation_status']) ? (
                <Text size="xs" c="dimmed">
                  Validation: {str(d['validation_status'])}
                </Text>
              ) : null}
              {str(d['merged_at']) ? (
                <Text size="xs" c="dimmed">
                  Merged {relativeTime(str(d['merged_at'])!)}
                </Text>
              ) : null}
            </Stack>
          )
        })
      )}
    </Stack>
  )
}

function OperationsBlock({ operations }: { operations: Row[] }) {
  return (
    <Stack gap={4}>
      <SubHeading title="Operations" count={operations.length} />
      {operations.length === 0 ? (
        <EmptyLine />
      ) : (
        operations.map((o, i) => (
          <Group key={i} gap="xs" wrap="nowrap">
            <Badge variant="light" color="gray">
              {str(o['kind']) ?? '—'}
            </Badge>
            <Text size="sm">
              {str(o['repo']) ?? '—'}
              {str(o['outcome']) ? ` · ${str(o['outcome'])}` : ' · pending'}
            </Text>
            {str(o['started_at']) ? (
              <Text size="xs" c="dimmed">
                {relativeTime(str(o['started_at'])!)}
              </Text>
            ) : null}
          </Group>
        ))
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

/**
 * The per-item timeline, opened by clicking a board row. Reads `snapshot.items[event_id]` — when
 * the id is absent (the snapshot truncates per-item timelines past a cap) it says so rather than
 * rendering an empty, misleadingly-complete block. Field names inside dispatches/operations/
 * transitions vary slightly between producers, so every read here is defensive (`??`, optional
 * chaining, generic key/value fallbacks) rather than assuming one exact shape.
 */
export function ItemTimeline({ eventId, items, onClose }: Props) {
  const opened = eventId !== null
  const timeline = eventId !== null ? items?.[String(eventId)] : undefined

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={eventId !== null ? `Item #${eventId}` : ''}
      size="lg"
    >
      {!timeline ? (
        <Text size="sm" c="dimmed">
          This item's timeline was not included in the snapshot — the item list is capped and this
          one was truncated. Only its board summary is known.
        </Text>
      ) : (
        <Stack gap="sm">
          {timeline.item ? (
            <Text size="sm">{str((timeline.item as Row)['brief']) ?? 'No brief recorded.'}</Text>
          ) : null}
          <Divider />
          <TransitionsBlock transitions={(timeline.transitions as Row[] | undefined) ?? []} />
          <Divider />
          <DispatchesBlock dispatches={(timeline.dispatches as Row[] | undefined) ?? []} />
          <Divider />
          <OperationsBlock operations={(timeline.operations as Row[] | undefined) ?? []} />
          <Divider />
          <ApprovalsBlock approvals={(timeline.approvals as Row[] | undefined) ?? []} />
        </Stack>
      )}
    </Modal>
  )
}
