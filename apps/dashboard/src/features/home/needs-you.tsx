import { Box, Button, Group, Stack, Text } from '@mantine/core'
import { EmptyState, Section } from 'basalt-ui'
import { Link } from '@tanstack/react-router'
import { IconCircleCheck, IconCircleDashed } from '@tabler/icons-react'
import { DecisionCard, type DecisionCardAction } from '../../components/upstream/decision-card'
import { useCopyAction } from '../../components/upstream/use-copy-action'
import type { Decision } from '../../lib/decisions'
import { allUnknown, needsYouEmptyTitle, restLabel, unknownPhrase, unknownSentence } from './model'
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
  /** Sources still being read: unknown for now, never an empty inbox. */
  loading: readonly string[]
  /** Sources that settled without a snapshot: unknown, never an empty inbox. */
  noSnapshot: readonly string[]
}

const COPY_LABEL = { queue: 'Copy command', agent: 'Copy blocker', warden: 'Copy PR link' } as const

/**
 * The card's two actions, explicit. A human-queue ask leads with the command it carries (copying is
 * the in-place verb) and opens its page second; an agent leads with opening and offers its blocker
 * to copy, a Warden item its PR link; with nothing to copy, opening is the one action.
 */
function actionsFor(
  source: Decision['source'],
  open: DecisionCardAction,
  copy: DecisionCardAction | undefined,
): { primary: DecisionCardAction; secondary?: DecisionCardAction } {
  if (copy === undefined) return { primary: open }
  return source === 'queue'
    ? { primary: copy, secondary: open }
    : { primary: open, secondary: copy }
}

function Card({ decision }: { decision: Decision }) {
  const open: DecisionCardAction = {
    label: `Open in ${PAGE_LABEL[decision.href]}`,
    href: decision.href,
  }
  const copy = useCopyAction(COPY_LABEL[decision.source], decision.evidence)
  const actions = actionsFor(decision.source, open, copy)
  const view = historyView(decision.history, 'leading')
  return (
    <DecisionCard
      question={decision.headline}
      facts={decision.facts}
      evidenceLine={decision.evidenceLine}
      subject={decision.entity}
      {...(view !== null && { preview: <HistoryPreview view={view} /> })}
      {...(view?.layout === 'inline' && { previewPlacement: 'inline' as const })}
      {...(decision.abandoned && { status: <StatusChip tone="bad" label="Abandoned" /> })}
      {...(decision.detail !== null && {
        disclosure: {
          label: 'Full reason',
          content: <Text size="sm">{decision.detail}</Text>,
        },
      })}
      {...actions}
    />
  )
}

/**
 * The merged inbox: the first {@link CARD_LIMIT} decisions as cards, then one `{n} more on/in {page}` button
 * per page that owns each remaining item. The heading count is the whole list, not the cards shown.
 */
export function NeedsYou({ decisions, unavailable, loading, noSnapshot }: Props) {
  const shown = decisions.slice(0, CARD_LIMIT)
  const rest = decisions.slice(CARD_LIMIT)
  const sources = { unavailable, loading, noSnapshot }
  const unknown = allUnknown(sources)
  const phrase = unknownPhrase(unavailable, loading, noSnapshot)
  const restBy = (href: Decision['href']) => rest.filter((d) => d.href === href).length
  return (
    <Section title="Needs you" {...(unknown ? { value: '—' } : { count: decisions.length })}>
      <Stack gap="sm" data-shot="needs-you" data-shot-states="empty">
        {decisions.length === 0 ? (
          <EmptyState
            tier="section"
            // A check is an all-clear; with the list unknown there is none to give.
            icon={unknown ? <IconCircleDashed size={28} /> : <IconCircleCheck size={28} />}
            title={needsYouEmptyTitle(sources)}
            description={
              unknown
                ? `${unknownSentence(phrase)}, so what is waiting is unknown.`
                : phrase === ''
                  ? 'No decision is waiting in Warden or on an agent.'
                  : `Nothing waiting in the source that loaded; ${phrase}.`
            }
          />
        ) : (
          shown.map((decision, i) => (
            <Box key={decision.id} data-shot={`decision-card-${i + 1}`} data-shot-absent="empty">
              <Card decision={decision} />
            </Box>
          ))
        )}
        {rest.length > 0 ? (
          <Group gap="xs" data-shot="show-more" data-shot-absent="empty">
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
                  {restLabel(href, restBy(href))}
                </Button>
              ) : null,
            )}
          </Group>
        ) : null}
        {decisions.length > 0 && phrase !== '' ? (
          <Text size="xs" c="dimmed">
            {phrase}: the list may be incomplete.
          </Text>
        ) : null}
      </Stack>
    </Section>
  )
}
