import { useState } from 'react'
import { Box, Collapse, Group, Image, Paper, Text } from '@mantine/core'
import { IconFile, IconFileText } from '@tabler/icons-react'
import type { Attachment } from './types'

/** Format a byte count to a human-readable string. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function AttachmentDisplay({ attachment }: { attachment: Attachment }) {
  const [expanded, setExpanded] = useState(false)

  if (attachment.type === 'image') {
    return (
      <Box>
        {attachment.title && (
          <Text size="xs" c="dimmed" mb={4}>
            {attachment.title}
          </Text>
        )}
        <Image
          src={attachment.dataUrl}
          alt={attachment.title ?? attachment.fileName ?? 'Image'}
          maw={240}
          radius="sm"
          style={{ border: '1px solid var(--mantine-color-default-border)' }}
        />
      </Box>
    )
  }

  if (attachment.type === 'file') {
    return (
      <Group gap={6} wrap="nowrap">
        <IconFile size={14} color="var(--mantine-color-dimmed)" />
        <Text size="xs" c="dimmed" lineClamp={1}>
          {attachment.fileName}
          {attachment.sizeBytes > 0 && ` (${formatFileSize(attachment.sizeBytes)})`}
        </Text>
      </Group>
    )
  }

  // type === 'text'
  const hasContent = Boolean(attachment.content?.trim())
  return (
    <Box>
      <Group
        gap={6}
        wrap="nowrap"
        style={hasContent ? { cursor: 'pointer' } : undefined}
        onClick={hasContent ? () => setExpanded((v) => !v) : undefined}
      >
        <IconFileText size={14} color="var(--mantine-color-dimmed)" />
        <Text size="xs" c="dimmed">
          {attachment.title ?? 'Text attachment'}
        </Text>
        {hasContent && (
          <Text size="xs" c="dimmed">
            {expanded ? '▲' : '▼'}
          </Text>
        )}
      </Group>
      {hasContent && (
        <Collapse expanded={expanded}>
          <Paper
            radius="sm"
            p="xs"
            mt={6}
            style={{ background: 'var(--mantine-color-default-hover)' }}
          >
            <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>
              {attachment.content}
            </Text>
          </Paper>
        </Collapse>
      )}
    </Box>
  )
}
