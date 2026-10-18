import { Box, Button, Group, Stack, Text } from '@mantine/core'
import { EmptyState, Section, useSizeClass } from 'basalt-ui'
import { Link } from '@tanstack/react-router'
import { useClipboard } from '@mantine/hooks'
import { IconCheck, IconCircleCheck, IconCopy } from '@tabler/icons-react'
import { DecisionCard } from '../../components/upstream/decision-card'
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
  const clipboard = useClipboard({ timeout: 1500 })
  const open = {
    label: `Open in ${PAGE_LABEL[decision.href]}`,
    href: decision.href,
  }
  // A human-queue ask carries the command to run: copying it is the in-place verb. Everything
  // else has no command in its payload, so opening the owning page is the primary.
  const command = decision.source === 'queue' ? decision.evidence : null
  const narrow = useSizeClass() === 'compact'
  const view = historyView(decision.history)
  return (
    <DecisionCard
      question={decision.headline}
      facts={decision.facts}
      evidenceLine={decision.evidenceLine}
      {...(decision.entity !== null && {
        actor: (
          <Text span fz="xs" title={decision.entity}>
            {decision.entity}
          </Text>
        ),
      })}
      {...(view !== null &&
        (!narrow || view.layout === 'inline') && {
          preview: <HistoryPreview view={view} />,
        })}
      {...(view?.layout === 'inline' && { previewPlacement: 'inline' as const })}
      {...(decision.abandoned && { status: <StatusChip tone="bad" label="Abandoned" /> })}
      {...(decision.detail !== null && {
        disclosure: {
          label: 'Full text',
          content: <Text size="sm">{decision.detail}</Text>,
        },
      })}
      {...(command === null
        ? { primary: open }
        : {
            primary: {
              label: clipboard.error ? 'Copy failed' : clipboard.copied ? 'Copied' : 'Copy command',
              icon: clipboard.copied ? <IconCheck size={14} /> : <IconCopy size={14} />,
              onClick: () => clipboard.copy(command),
            },
            secondary: open,
          })}
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
