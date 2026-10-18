import { Box, Button, Group, Stack, Text } from '@mantine/core'
import { EmptyState, Section } from 'basalt-ui'
import { Link } from '@tanstack/react-router'
import { useClipboard } from '@mantine/hooks'
import { IconCheck, IconCircleCheck, IconCopy } from '@tabler/icons-react'
import { DecisionCard, type DecisionCardAction } from '../../components/upstream/decision-card'
import { softBreaks } from '../../lib/text'
import type { Decision } from '../../lib/decisions'
import { NEEDS_YOU_SOURCES } from './model'
import { StatusChip } from '../agents/status-chip'
import { HistoryPreview } from '../warden/history-preview'
import { historyView } from '../warden/page-model'

/** Cards shown before the rest is left to the Agents and Warden pages. */
const CARD_LIMIT = 3

const PAGE_LABEL = { '/agents': 'Agents', '/warden': 'Warden' } as const

type Props = {
  decisions: readonly Decision[]
  /** Sources whose feed is not loaded: what needs the owner there is unknown, not empty. */
  unavailable: readonly string[]
}

function Card({ decision }: { decision: Decision }) {
  const primaryClip = useClipboard({ timeout: 1500 })
  const open = {
    label: `Open in ${PAGE_LABEL[decision.href]}`,
    href: decision.href,
  }
  // The payload carries a command only on a human-queue ask, and a blocker only on an agent:
  // copying it is the in-place verb. A Warden item has nothing to copy, so opening it is the one action.
  const copyLabel =
    decision.source === 'queue'
      ? 'Copy command'
      : decision.source === 'agent'
        ? 'Copy blocker'
        : null
  const copyValue = copyLabel === null ? null : decision.evidence
  const copy: DecisionCardAction | null =
    copyLabel === null || copyValue === null
      ? null
      : {
          label: primaryClip.error ? 'Copy failed' : primaryClip.copied ? 'Copied' : copyLabel,
          icon: primaryClip.copied ? <IconCheck size={14} /> : <IconCopy size={14} />,
          onClick: () => primaryClip.copy(copyValue),
        }
  const view = historyView(decision.history)
  return (
    <DecisionCard
      question={decision.headline}
      facts={decision.facts}
      evidenceLine={decision.evidenceLine}
      {...(decision.entity !== null && {
        actor: (
          <Text span fz="xs">
            {softBreaks(decision.entity)}
          </Text>
        ),
      })}
      {...(view !== null && { preview: <HistoryPreview view={view} /> })}
      {...(view?.layout === 'inline' && { previewPlacement: 'inline' as const })}
      {...(decision.abandoned && { status: <StatusChip tone="bad" label="Abandoned" /> })}
      {...(decision.detail !== null && {
        disclosure: {
          label: 'Full reason',
          content: <Text size="sm">{softBreaks(decision.detail)}</Text>,
        },
      })}
      {...(copy !== null && decision.source === 'queue'
        ? { primary: copy, secondary: open }
        : copy !== null
          ? { primary: open, secondary: copy }
          : { primary: open })}
    />
  )
}

/**
 * The merged inbox: the first {@link CARD_LIMIT} decisions as cards, then `Show n more` pointing at
 * the page that owns each remaining item. The heading count is the whole list, not the cards shown.
 */
export function NeedsYou({ decisions, unavailable }: Props) {
  const shown = decisions.slice(0, CARD_LIMIT)
  const rest = decisions.slice(CARD_LIMIT)
  const unknown = unavailable.length >= NEEDS_YOU_SOURCES
  const restBy = (href: Decision['href']) => rest.filter((d) => d.href === href).length
  return (
    <Section title="Needs you" {...(unknown ? { value: '—' } : { count: decisions.length })}>
      <Stack gap="sm">
        {decisions.length === 0 ? (
          <EmptyState
            tier="section"
            icon={<IconCircleCheck size={28} />}
            title={unknown ? "Can't tell" : 'Nothing needs you'}
            description={
              unknown
                ? `${unavailable.join(' and ')} unavailable, so what is waiting is unknown.`
                : unavailable.length === 0
                  ? 'No decision is waiting in Warden or on an agent.'
                  : `Nothing waiting in the source that loaded; ${unavailable.join(' and ')} unavailable.`
            }
          />
        ) : (
          shown.map((decision, i) => (
            <Box key={decision.id} data-shot={`decision-card-${i + 1}`}>
              <Card decision={decision} />
            </Box>
          ))
        )}
        {rest.length > 0 ? (
          <Group gap="xs" data-shot="show-more">
            <Text size="sm" c="dimmed">
              Show {rest.length} more
            </Text>
            {(['/agents', '/warden'] as const).map((href) =>
              restBy(href) > 0 ? (
                <Button
                  key={href}
                  component={Link}
                  to={href}
                  variant="subtle"
                  color="gray"
                  size="compact-sm"
                >
                  {PAGE_LABEL[href]} ({restBy(href)})
                </Button>
              ) : null,
            )}
          </Group>
        ) : null}
        {decisions.length > 0 && unavailable.length > 0 ? (
          <Text size="xs" c="dimmed">
            {unavailable.join(' and ')} unavailable: the list may be incomplete.
          </Text>
        ) : null}
      </Stack>
    </Section>
  )
}
