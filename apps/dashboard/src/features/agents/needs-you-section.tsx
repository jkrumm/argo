import { Box, Code, Stack, Text } from '@mantine/core'
import { useClipboard } from '@mantine/hooks'
import { Section } from 'basalt-ui'
import { IconCheck, IconCopy } from '@tabler/icons-react'
import { useState } from 'react'
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
}

/** Mono inset: the command or blocker, clamped to three lines with a toggle past that. */
function Inset({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.split('\n').length > COLLAPSED_LINES || text.length > 240
  return (
    <Stack gap={4}>
      <Code block className={open || !long ? classes.code : `${classes.code} ${classes.clamped}`}>
        {text}
      </Code>
      {long ? (
        <Text
          component="button"
          type="button"
          size="xs"
          c="dimmed"
          className={classes.toggle}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Show less' : 'Show all'}
        </Text>
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
      {...(card.copy !== null && {
        primary: {
          label: clipboard.copied ? 'Copied' : card.copy.label,
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
export function NeedsYouSection({ humanQueue, agents }: Props) {
  const cards = needsYouCards(humanQueue, agents, useNow())
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
