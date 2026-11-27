import {
  Alert,
  Anchor,
  Badge,
  Box,
  Card,
  Center,
  CopyButton,
  Button,
  Grid,
  Group,
  Image,
  Loader,
  ScrollArea,
  Stack,
  Text,
} from '@mantine/core'
import { IconDownload, IconNotebook, IconPrinter } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { EmptyState, PageBar, PageSummary, Section, useSizeClass } from 'basalt-ui'
import { overlays } from 'basalt-ui/commands'
import { CONTAINER_GRID_BREAKPOINTS } from 'basalt-ui/tokens'
import { format } from 'date-fns'
import type { ReactNode } from 'react'
import { paperError, paperQueries } from '../../../lib/queries/paper'
import { useNow } from '../../../lib/use-now'
import { RetryButton } from '../../calendar/retry-button'
import { useObjectUrl, usePaperBlob } from '../paper-blob'
import { PdfViewer } from '../pdf-viewer'
import { AttentionBadges } from './attention-badges'
import { attentionOf, downloadName, isPdf, obsidianUrl, shareLocation, type Doc } from './model'

const BackLink = () => (
  <Anchor size="sm" renderRoot={(props) => <Link {...props} to="/documents" />}>
    All documents
  </Anchor>
)

export function DocumentPage({ id }: { id: string }) {
  const query = useQuery(paperQueries.document(id))

  if (query.data === undefined) {
    return query.isError ? (
      <EmptyState
        tier="page"
        title="This document could not be read"
        description={paperError(query.error)}
        action={
          <Group>
            <RetryButton
              label="Retry the document"
              loading={query.isFetching}
              onClick={() => void query.refetch()}
            />
            <BackLink />
          </Group>
        }
      />
    ) : (
      <PageSummary loading />
    )
  }
  return <Document key={id} doc={query.data} />
}

function Document({ doc }: { doc: Doc }) {
  const today = format(useNow(), 'yyyy-MM-dd')
  const original = usePaperBlob(
    doc.fileExists ? `/paper/docs/${encodeURIComponent(doc.id)}/pdf` : null,
  )
  const reasons = attentionOf(doc, today)
  const compact = useSizeClass() === 'compact'

  const download = () => {
    if (!original.data) return
    const url = URL.createObjectURL(original.data)
    const link = window.document.createElement('a')
    link.href = url
    link.download = downloadName(doc)
    link.click()
    // The browser reads the URL after the click returns.
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  return (
    <>
      <PageBar
        actions={[
          {
            key: 'print',
            label: 'Print',
            primary: true,
            icon: <IconPrinter size={16} />,
            disabled: !doc.fileExists,
            onClick: () => overlays.open('documents:print', { id: doc.id, title: doc.title }),
          },
          {
            key: 'download',
            label: 'Download',
            icon: <IconDownload size={16} />,
            disabled: original.data === undefined,
            onClick: download,
          },
          {
            key: 'obsidian',
            label: 'Open in Obsidian',
            icon: <IconNotebook size={16} />,
            onClick: () => window.location.assign(obsidianUrl(doc.id)),
          },
        ]}
      />

      <Stack gap="md">
        <Box>
          <BackLink />
          <PageSummary
            sentence={doc.title}
            facts={[doc.date ?? 'Undated', doc.kind ?? null, doc.issuer ?? null]}
          />
        </Box>
        <AttentionBadges reasons={reasons} />

        <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
          <Grid.Col span={{ base: 12, md: 5 }}>
            <Stack gap="md">
              <Section title="Summary">
                <Card>
                  <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                    {doc.summary || 'The note has no summary.'}
                  </Text>
                </Card>
              </Section>
              <Fields doc={doc} />
              {!compact && <ExtractedText doc={doc} />}
            </Stack>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 7 }}>
            <Section title={isPdf(doc) ? 'PDF' : 'Original'}>
              <Original
                doc={doc}
                blob={original.data}
                error={original.error}
                loading={original.isFetching}
                onRetry={() => void original.refetch()}
              />
            </Section>
          </Grid.Col>
          {compact && (
            <Grid.Col span={12}>
              <ExtractedText doc={doc} />
            </Grid.Col>
          )}
        </Grid>
      </Stack>
    </>
  )
}

function Original({
  doc,
  blob,
  error,
  loading,
  onRetry,
}: {
  doc: Doc
  blob: Blob | undefined
  error: unknown
  loading: boolean
  onRetry: () => void
}) {
  if (!doc.fileExists) {
    return (
      <Alert color="red" variant="light">
        The note is there but the original is gone from the share.
      </Alert>
    )
  }
  if (!blob) {
    return error ? (
      <Alert color="red" variant="light">
        <Group justify="space-between">
          <Text size="sm">{paperError(error)}</Text>
          <RetryButton label="Retry the file" loading={loading} onClick={onRetry} />
        </Group>
      </Alert>
    ) : (
      <Center mih={240}>
        <Loader size="sm" aria-label="Loading the file" />
      </Center>
    )
  }
  if (isPdf(doc)) return <PdfViewer blob={blob} title={doc.title} />
  return <BlobImage blob={blob} alt={doc.title} />
}

/** An original that is a picture. */
function BlobImage({ blob, alt }: { blob: Blob; alt: string }) {
  const url = useObjectUrl(blob)
  return url ? <Image src={url} alt={alt} /> : null
}

function Fields({ doc }: { doc: Doc }) {
  const rows: [string, ReactNode][] = [
    ['Kind', doc.kind],
    ['Issuer', doc.issuer],
    ['Date', doc.date],
    ['Tax year', doc.taxYear],
    ['Valid until', doc.validUntil],
    ['Subject', doc.subject],
    [
      'Tags',
      doc.tags.length === 0 ? null : (
        <Group key="tags" gap={4}>
          {doc.tags.map((tag) => (
            <Badge key={tag} variant="light" color="gray" tt="none">
              {tag}
            </Badge>
          ))}
        </Group>
      ),
    ],
    ['Vault id', doc.vaultId],
    ['Note', doc.id],
  ]
  return (
    <Section title="Fields">
      <Card>
        <Stack gap="xs">
          {rows.map(([label, value]) => (
            <Field key={label} label={label}>
              {value}
            </Field>
          ))}
          <Field label="On the share">
            {doc.sharePath ? <SharePath path={shareLocation(doc.sharePath)} /> : null}
          </Field>
        </Stack>
      </Card>
    </Section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  const empty = children === null || children === undefined || children === ''
  return (
    <Group gap="sm" wrap="nowrap" align="flex-start">
      <Text size="sm" c="dimmed" w={96} style={{ flexShrink: 0 }}>
        {label}
      </Text>
      <Box miw={0} fz="sm" style={{ wordBreak: 'break-word' }}>
        {empty ? (
          <Text size="sm" c="dimmed">
            —
          </Text>
        ) : (
          children
        )}
      </Box>
    </Group>
  )
}

function SharePath({ path }: { path: string }) {
  return (
    <Stack gap={4} align="flex-start">
      <Text size="sm">{path}</Text>
      <CopyButton value={path}>
        {({ copied, copy }) => (
          <Button variant="default" size="compact-sm" onClick={copy}>
            {copied ? 'Copied' : 'Copy path'}
          </Button>
        )}
      </CopyButton>
    </Stack>
  )
}

function ExtractedText({ doc }: { doc: Doc }) {
  const text = useQuery({ ...paperQueries.documentText(doc.id), enabled: Boolean(doc.textPath) })
  return (
    <Section title="Extracted text">
      <Card>
        {!doc.textPath ? (
          <Text size="sm" c="dimmed">
            This document has no text file.
          </Text>
        ) : text.data === undefined ? (
          <Text size="sm" c="dimmed">
            {text.isError ? paperError(text.error) : 'Loading the text'}
          </Text>
        ) : (
          <ScrollArea.Autosize mah={360}>
            <Text size="xs" ff="monospace" style={{ whiteSpace: 'pre-wrap' }}>
              {text.data}
            </Text>
          </ScrollArea.Autosize>
        )}
      </Card>
    </Section>
  )
}
