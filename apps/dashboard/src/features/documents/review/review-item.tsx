import {
  Alert,
  Anchor,
  Box,
  Button,
  Card,
  Collapse,
  Group,
  Skeleton,
  Stack,
  Text,
} from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import { formatDistanceToNow } from 'date-fns'
import { useState } from 'react'
import type { DecideBody, ReviewEntry } from '../../../lib/queries/paper'
import { AuthImage } from '../auth-image'
import { useObjectUrl, usePaperBlob } from '../paper-blob'
import { proposalOf, sidesLine, toMs, type Suggestions } from './model'
import { ReviewForm } from './review-form'

const inboxPath = (name: string, leaf: 'pdf' | 'thumb') =>
  `/paper/inbox/${encodeURIComponent(name)}/${leaf}`

function PdfView({ name, version }: { name: string; version: number }) {
  const blob = usePaperBlob(inboxPath(name, 'pdf'), version)
  const url = useObjectUrl(blob.data)
  if (blob.isError)
    return (
      <Text size="sm" c="dimmed">
        The PDF did not load.
      </Text>
    )
  if (!url) return <Skeleton h={480} />
  return (
    <Stack gap="xs">
      <Box component="iframe" src={url} title={`PDF of ${name}`} h={560} w="100%" data-private />
      <Anchor href={url} target="_blank" size="sm">
        Open the PDF in its own tab
      </Anchor>
    </Stack>
  )
}

type ReviewItemProps = {
  item: ReviewEntry
  busy: boolean
  error: string | null
  suggestions: Suggestions
  onDecide: (body: DecideBody) => void
  /** Tests open these without a tap. */
  initiallyByHand?: boolean
  initiallyPdf?: boolean
}

/** One file held for review: its first page, why it is held, and the three ways to decide it. */
export function ReviewItem({
  item,
  busy,
  error,
  suggestions,
  onDecide,
  initiallyByHand = false,
  initiallyPdf = false,
}: ReviewItemProps) {
  const [byHand, setByHand] = useState(initiallyByHand)
  const [pdf, setPdf] = useState(initiallyPdf)
  const proposal = proposalOf(item)
  const sides = sidesLine(item)

  return (
    <Card data-review-item>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Text fw={500} lineClamp={2} data-private>
            {item.name}
          </Text>
          <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
            {formatDistanceToNow(toMs(item.mtime), { addSuffix: true })}
          </Text>
        </Group>

        <Group align="flex-start" wrap="nowrap" gap="md">
          <Box w={96} h={136} style={{ flex: 'none' }} data-private>
            <AuthImage path={inboxPath(item.name, 'thumb')} version={item.mtime} alt="First page" />
          </Box>
          <Stack gap="xs">
            <Text size="sm" data-private>
              {item.reason
                ? `Held because: ${item.reason}`
                : 'The pipeline did not say why it holds this file.'}
            </Text>
            {sides && (
              <Text size="xs" c="dimmed">
                {sides}
              </Text>
            )}
            <Text size="sm" {...(!proposal && { c: 'dimmed' })}>
              {proposal ? `Proposal: ${proposal.label}` : 'The pipeline has no proposal.'}
            </Text>
          </Stack>
        </Group>

        {error && (
          <Alert color="red" icon={<IconAlertTriangle size={18} />} title="That did not work">
            {error}
          </Alert>
        )}

        <Stack gap="xs">
          {proposal && (
            <Button size="md" loading={busy} onClick={() => onDecide(proposal.body)}>
              Accept: {proposal.label}
            </Button>
          )}
          <Button
            size="md"
            variant={proposal ? 'default' : 'filled'}
            disabled={busy}
            onClick={() => onDecide({ single: true })}
          >
            One document
          </Button>
          <Group grow>
            <Button variant="subtle" onClick={() => setByHand((open) => !open)}>
              {byHand ? 'Hide the form' : 'Decide by hand'}
            </Button>
            <Button variant="subtle" onClick={() => setPdf((open) => !open)}>
              {pdf ? 'Hide the PDF' : 'View the PDF'}
            </Button>
          </Group>
        </Stack>

        <Collapse expanded={byHand}>
          {byHand && (
            <ReviewForm item={item} busy={busy} suggestions={suggestions} onDecide={onDecide} />
          )}
        </Collapse>
        <Collapse expanded={pdf}>
          {pdf && <PdfView name={item.name} version={item.mtime} />}
        </Collapse>
      </Stack>
    </Card>
  )
}
