import { Box, Stack, Text } from '@mantine/core'
import { useClipboard } from '@mantine/hooks'
import { Section } from 'basalt-ui'
import { IconCheck, IconCopy } from '@tabler/icons-react'
import { DecisionCard, type DecisionCardAction } from '../../components/upstream/decision-card'
import decisionClasses from '../../components/upstream/decision-card.module.css'
import { softBreaks } from '../../lib/text'
import type { HumanQueueItem } from '../../lib/queries/agents'
import { useNow } from '../../lib/use-now'
import { needsYouCards, type AgentRow, type NeedsYouCard } from './model'
import { StatusChip } from './status-chip'
import classes from './needs-you-section.module.css'

type Props = {
  humanQueue: HumanQueueItem[]
  agents: AgentRow[]
  /** No snapshot is loaded: what needs the human is unknown, not empty. */
  unknown?: boolean
  /** Producer host and snapshot age, for the card facts and the evidence fallback. */
  machine?: string | null
  snapshotAgeMs?: number | null
}

/** Copies a payload field; the label reads `Copied` (or `Copy failed`) for a moment afterwards. */
function copyAction(
  clipboard: ReturnType<typeof useClipboard>,
  action: NeedsYouCard['actions'][number],
): DecisionCardAction {
  return {
    label: clipboard.error ? 'Copy failed' : clipboard.copied ? 'Copied' : action.label,
    icon: clipboard.copied ? <IconCheck size={14} /> : <IconCopy size={14} />,
    onClick: () => clipboard.copy(action.value),
  }
}

function Card({ card }: { card: NeedsYouCard }) {
  const primaryClip = useClipboard({ timeout: 1500 })
  const secondaryClip = useClipboard({ timeout: 1500 })
  const [primary, secondary] = card.actions
  const { disclosure } = card
  return (
    <DecisionCard
      question={card.question}
      facts={card.facts}
      {...(card.entity !== null && {
        actor: (
          <Text component="span" fz="xs" className={decisionClasses.wrap}>
            {softBreaks(card.entity)}
          </Text>
        ),
      })}
      {...(card.abandoned && { status: <StatusChip tone="bad" label="Abandoned" /> })}
      evidenceLine={card.evidenceLine}
      {...(card.preview !== null && {
        preview: <Text className={classes.preview}>{card.preview}</Text>,
      })}
      {...(primary !== undefined && { primary: copyAction(primaryClip, primary) })}
      {...(secondary !== undefined && { secondary: copyAction(secondaryClip, secondary) })}
      {...(disclosure !== null && {
        disclosure: {
          label: disclosure.label,
          content: (
            <Stack gap="xs">
              {disclosure.text !== null && <Text className={classes.ask}>{disclosure.text}</Text>}
              {disclosure.command !== null && (
                <Text ff="monospace" size="sm" className={classes.code}>
                  {disclosure.command}
                </Text>
              )}
            </Stack>
          ),
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
