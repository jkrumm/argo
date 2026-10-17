import { Box, Button, Group, Stack, Text } from '@mantine/core'
import { EmptyState, Section, useSizeClass } from 'basalt-ui'
import { VX } from 'basalt-ui/tokens'
import { IconCircleCheck } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import { DecisionCard } from '../../components/upstream/decision-card'
import type { Decision } from '../../lib/decisions'
import { NEEDS_YOU_SOURCES } from './model'
import { StatusChip } from '../agents/status-chip'
import { HistoryPreview } from '../warden/history-preview'

/** Cards shown before the rest is left to the Agents and Warden pages. */
const CARD_LIMIT = 3

const PAGE_LABEL = { '/agents': 'Agents', '/warden': 'Warden' } as const

type Props = {
  decisions: readonly Decision[]
  /** Sources whose feed is not loaded: what needs the owner there is unknown, not empty. */
  unavailable: readonly string[]
}

/** `warden · <repo> · waiting 3.6 d` above the question; an age past its limit takes the status tone. */
function Kicker({ facts }: { facts: Decision['facts'] }) {
  return (
    <Text size="xs" c="dimmed">
      {facts.map((fact, i) => {
        const text = typeof fact === 'string' ? fact : fact.text
        const tone = typeof fact === 'string' ? undefined : fact.tone
        return (
          <span key={text}>
            {i > 0 ? ' · ' : ''}
            <Text
              span
              inherit
              {...(tone && { c: tone === 'bad' ? VX.status.bad : VX.status.warn })}
            >
              {text}
            </Text>
          </span>
        )
      })}
    </Text>
  )
}

function Card({ decision }: { decision: Decision }) {
  const narrow = useSizeClass() === 'compact'
  const evidence = decision.evidence ? (
    <Text size="sm" {...(!narrow && { lineClamp: 3 })}>
      {decision.evidence}
    </Text>
  ) : undefined
  return (
    <DecisionCard
      actor={<Kicker facts={decision.facts} />}
      question={decision.headline}
      facts={[]}
      {...(!narrow &&
        decision.history.length > 0 && { preview: <HistoryPreview lines={decision.history} /> })}
      {...(decision.abandoned && { status: <StatusChip tone="bad" label="Abandoned" /> })}
      {...(!narrow && evidence && { evidence })}
      {...(narrow && evidence && { disclosure: { label: 'Details', content: evidence } })}
      meta={
        <Button component={Link} to={decision.href} variant="default" size="xs">
          Open in {PAGE_LABEL[decision.href]}
        </Button>
      }
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
