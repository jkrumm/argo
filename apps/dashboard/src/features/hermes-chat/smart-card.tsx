import { z } from 'zod'
import { Badge, Card, Checkbox, Group, Stack, Text, ThemeIcon } from '@mantine/core'
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCircleX,
  IconHeadphones,
  IconNote,
} from '@tabler/icons-react'

// Fenced ` ```card ` blocks. The agent emits JSON; this renders it as a Mantine
// component themed to DESIGN.md. Parsing is total: any malformed / unknown shape
// returns null so the caller falls back to a plain code block (never throws,
// never flashes broken mid-stream — `remend` defers incomplete fences upstream).
// Card catalog v1: infra / todo / note (+ audio reserved for Phase B).
// See docs/HERMES-CHAT-PRD.md → Rendering, "Cards live in markdown".

const Status = z.enum(['ok', 'warn', 'err'])

const InfraCard = z.object({
  type: z.literal('infra'),
  title: z.string().optional(),
  status: Status.optional(),
  detail: z.string().optional(),
  items: z
    .array(
      z.object({
        label: z.string(),
        value: z.string().optional(),
        status: Status.optional(),
      }),
    )
    .optional(),
})

const TodoCard = z.object({
  type: z.literal('todo'),
  title: z.string().optional(),
  items: z.array(z.object({ text: z.string(), done: z.boolean().optional() })),
})

const NoteCard = z.object({
  type: z.literal('note'),
  title: z.string().optional(),
  body: z.string(),
})

const AudioCard = z.object({
  type: z.literal('audio'),
  title: z.string().optional(),
  src: z.string().optional(),
  durationMs: z.number().optional(),
})

const CardSchema = z.discriminatedUnion('type', [InfraCard, TodoCard, NoteCard, AudioCard])
export type SmartCardData = z.infer<typeof CardSchema>

/** Parse a fenced `card` block body. Returns null on any malformed/unknown JSON. */
export function parseCard(raw: string): SmartCardData | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    const result = CardSchema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

const STATUS_META = {
  ok: { color: 'green', Icon: IconCircleCheck, label: 'OK' },
  warn: { color: 'yellow', Icon: IconAlertTriangle, label: 'Warn' },
  err: { color: 'red', Icon: IconCircleX, label: 'Error' },
} as const

function StatusDot({ status }: { status: 'ok' | 'warn' | 'err' }) {
  const { color, Icon } = STATUS_META[status]
  return (
    <ThemeIcon size="sm" radius="xl" variant="light" color={color}>
      <Icon size={14} />
    </ThemeIcon>
  )
}

function InfraView({ card }: { card: z.infer<typeof InfraCard> }) {
  return (
    <Card withBorder radius="md" padding="sm">
      <Group justify="space-between" wrap="nowrap" mb={card.items?.length ? 'xs' : 0}>
        <Group gap="xs" wrap="nowrap">
          {card.status && <StatusDot status={card.status} />}
          <Text fw="semibold" size="sm">
            {card.title ?? 'Status'}
          </Text>
        </Group>
        {card.status && (
          <Badge size="sm" variant="light" color={STATUS_META[card.status].color} radius="sm">
            {STATUS_META[card.status].label}
          </Badge>
        )}
      </Group>
      {card.detail && (
        <Text size="xs" c="dimmed" mb={card.items?.length ? 'xs' : 0}>
          {card.detail}
        </Text>
      )}
      {card.items?.length ? (
        <Stack gap={6}>
          {card.items.map((item, i) => (
            <Group key={i} justify="space-between" wrap="nowrap" gap="xs">
              <Group gap="xs" wrap="nowrap">
                {item.status && <StatusDot status={item.status} />}
                <Text size="sm">{item.label}</Text>
              </Group>
              {item.value && (
                <Text size="sm" c="dimmed" ff="monospace">
                  {item.value}
                </Text>
              )}
            </Group>
          ))}
        </Stack>
      ) : null}
    </Card>
  )
}

function TodoView({ card }: { card: z.infer<typeof TodoCard> }) {
  return (
    <Card withBorder radius="md" padding="sm">
      {card.title && (
        <Text fw="semibold" size="sm" mb="xs">
          {card.title}
        </Text>
      )}
      <Stack gap={6}>
        {card.items.map((item, i) => (
          <Checkbox
            key={i}
            size="xs"
            checked={item.done ?? false}
            readOnly
            label={item.text}
            styles={{
              label: {
                textDecoration: item.done ? 'line-through' : undefined,
                opacity: item.done ? 0.6 : 1,
              },
            }}
          />
        ))}
      </Stack>
    </Card>
  )
}

function NoteView({ card }: { card: z.infer<typeof NoteCard> }) {
  return (
    <Card withBorder radius="md" padding="sm">
      <Group gap="xs" wrap="nowrap" mb={6}>
        <ThemeIcon size="sm" radius="sm" variant="light" color="gray">
          <IconNote size={14} />
        </ThemeIcon>
        {card.title && (
          <Text fw="semibold" size="sm">
            {card.title}
          </Text>
        )}
      </Group>
      <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
        {card.body}
      </Text>
    </Card>
  )
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function AudioView({ card }: { card: z.infer<typeof AudioCard> }) {
  return (
    <Card withBorder radius="md" padding="sm">
      <Group gap="xs" wrap="nowrap" mb={card.src ? 'xs' : 0}>
        <ThemeIcon size="sm" radius="sm" variant="light" color="blue">
          <IconHeadphones size={14} />
        </ThemeIcon>
        <Text size="sm" fw="semibold">
          {card.title ?? 'Audio'}
        </Text>
        {card.durationMs && (
          <Text size="xs" c="dimmed">
            {formatDuration(card.durationMs)}
          </Text>
        )}
      </Group>
      {card.src ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio controls src={card.src} style={{ width: '100%', height: 32 }} />
      ) : (
        <Text size="xs" c="dimmed">
          No audio available
        </Text>
      )}
    </Card>
  )
}

export function SmartCard({ card }: { card: SmartCardData }) {
  switch (card.type) {
    case 'infra':
      return <InfraView card={card} />
    case 'todo':
      return <TodoView card={card} />
    case 'note':
      return <NoteView card={card} />
    case 'audio':
      return <AudioView card={card} />
  }
}
