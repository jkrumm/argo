import { type z } from 'zod'
import { Badge, Card, Checkbox, Group, Stack, Text, ThemeIcon } from '@mantine/core'
import { IconAlertTriangle, IconCircleCheck, IconCircleX, IconNote } from '@tabler/icons-react'
import { settledOnly, type FenceRenderer } from 'basalt-ui/content'
import { AudioPlayerCard } from './voice/audio-player-card'
import {
  AudioCard,
  InfraCard,
  NoteCard,
  TodoCard,
  parseCard,
  type AudioCardData,
  type SmartCardData,
} from './smart-card-schema'

// Fenced ` ```card ` blocks. The agent emits JSON; this renders it as a Mantine
// component themed to DESIGN.md. Parsing is total: any malformed / unknown shape
// returns null so the fence renderer declines to a plain code block (never throws,
// and only ever runs once the fence has fully settled — see `cardFenceRenderer`).
// Card catalog v1: infra / todo / note / audio.
// See docs/HERMES-CHAT-PRD.md → Rendering, "Cards live in markdown".

export type { AudioCardData, SmartCardData }
export { AudioCard, parseCard }

const STATUS_META = {
  ok: { color: 'green', Icon: IconCircleCheck, label: 'OK' },
  warn: { color: 'yellow', Icon: IconAlertTriangle, label: 'Warn' },
  err: { color: 'red', Icon: IconCircleX, label: 'Error' },
} as const

type StatusKind = keyof typeof STATUS_META

function StatusDot({ status }: { status: StatusKind }) {
  const { color, Icon } = STATUS_META[status]
  return (
    <ThemeIcon size="sm" radius="xl" variant="light" color={color}>
      <Icon size={14} />
    </ThemeIcon>
  )
}

function InfraView({ card }: { card: z.infer<typeof InfraCard> }) {
  return (
    <Card padding="sm">
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
          {card.items.map((item) => (
            <Group key={item.label} justify="space-between" wrap="nowrap" gap="xs">
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
    <Card padding="sm">
      {card.title && (
        <Text fw="semibold" size="sm" mb="xs">
          {card.title}
        </Text>
      )}
      <Stack gap={6}>
        {card.items.map((item) => (
          <Checkbox
            key={item.text}
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
    <Card padding="sm">
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

export function SmartCard({ card }: { card: SmartCardData }) {
  switch (card.type) {
    case 'infra':
      return <InfraView card={card} />
    case 'todo':
      return <TodoView card={card} />
    case 'note':
      return <NoteView card={card} />
    case 'audio':
      return <AudioPlayerCard card={card} />
  }
}

// Fence renderer for ```card blocks — registered into `hermesFenceRenderers`
// (markdown-part.tsx). Wrapped in `settledOnly`: SmartCard (particularly the audio variant) is
// heavyweight and must not render against a half-streamed fence. A parse failure DECLINES
// (returns undefined) so basalt falls back to its default CodeBlock rather than a bespoke error
// box — basalt already wraps fence renderers in a sync try/catch and a keyed error boundary.
export const cardFenceRenderer: FenceRenderer = settledOnly(({ code }) => {
  const card = parseCard(code)
  return card ? <SmartCard card={card} /> : undefined
})
