import { Box, Stack, Text, UnstyledButton } from '@mantine/core'
import { useClipboard } from '@mantine/hooks'
import { Section } from 'basalt-ui'
import { IconCheck, IconCopy } from '@tabler/icons-react'
import { useId, useState } from 'react'
import { DecisionCard } from '../../components/upstream/decision-card'
import type { HumanQueueItem } from '../../lib/queries/agents'
import { useNow } from '../../lib/use-now'
import { needsYouCards, type AgentRow, type NeedsYouCard } from './model'
import { StatusChip } from './status-chip'
import classes from './needs-you-section.module.css'

const COLLAPSED_LINES = 3

type Props = {
  humanQueue: HumanQueueItem[]
  agents: AgentRow[]
  /** No snapshot is loaded: what needs the human is unknown, not empty. */
  unknown?: boolean
  /** Producer host and snapshot age, for the card facts and the evidence fallback. */
  machine?: string | null
  snapshotAgeMs?: number | null
}

/** Mono inset: the command or blocker, clamped to three lines with a toggle past that. */
function Inset({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const long = text.split('\n').length > COLLAPSED_LINES || text.length > 240
  return (
    <Stack gap={4}>
      <Text
        id={bodyId}
        ff="monospace"
        size="sm"
        className={open || !long ? classes.code : `${classes.code} ${classes.clamped}`}
      >
        {text}
      </Text>
      {long ? (
        <UnstyledButton
          className={classes.toggle}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
        >
          <Text size="xs" c="dimmed" span>
            {open ? 'Show less' : 'Show all'}
          </Text>
        </UnstyledButton>
      ) : null}
    </Stack>
  )
}

function Card({ card }: { card: NeedsYouCard }) {
  const clipboard = useClipboard({ timeout: 1500 })
  return (
    <DecisionCard
      question={card.headline}
      facts={card.facts}
      {...(card.abandoned && { status: <StatusChip tone="bad" label="Abandoned" /> })}
      {...(card.inset !== null && { evidence: <Inset text={card.inset} /> })}
      {...(card.preview !== null && {
        preview: <Text className={classes.preview}>{card.preview}</Text>,
      })}
      {...(card.copy !== null && {
        primary: {
          label: clipboard.error ? 'Copy failed' : clipboard.copied ? 'Copied' : card.copy.label,
          icon: clipboard.copied ? <IconCheck size={14} /> : <IconCopy size={14} />,
          onClick: () => clipboard.copy(card.copy?.value ?? ''),
        },
      })}
      {...(card.fullAsk !== null && {
        disclosure: {
          label: card.fullAsk.label,
          content: <Text className={classes.ask}>{card.fullAsk.text}</Text>,
        },
      })}
    />
  )
}

/**
 * Everything waiting on the human: the mini's human-queue asks and the agents agent-gateway marks
 * `needs_you`, longest wait first. Read-only — the payload has no write endpoint, so the one action
 * is a client-side copy of a field the payload carries. Hidden when nothing waits.
 */
export function NeedsYouSection({
  humanQueue,
  agents,
  unknown = false,
  machine = null,
  snapshotAgeMs = null,
}: Props) {
  const cards = needsYouCards(humanQueue, agents, useNow(), { machine, snapshotAgeMs })
  if (unknown) {
    return (
      <Section title="Needs you" value="—">
        <Text size="sm" c="dimmed">
          Unknown: no agent snapshot is loaded, so nothing can be said about what is waiting.
        </Text>
      </Section>
    )
  }
  if (cards.length === 0) return null
  return (
    <Section title="Needs you" count={cards.length}>
      <Stack gap="sm">
        {cards.map((card, i) => (
          <Box key={card.key} data-shot={`decision-card-${i + 1}`}>
            <Card card={card} />
          </Box>
        ))}
      </Stack>
    </Section>
  )
}
