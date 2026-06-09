import { formatDistanceToNowStrict } from 'date-fns'
import { Badge, Box, Collapse, Group, Text, UnstyledButton } from '@mantine/core'
import { IconChevronDown, IconChevronRight, IconPin } from '@tabler/icons-react'
import type { HermesThread, HermesThreadType } from '../../lib/queries/hermes'
import { ChatView } from './chat-view'
import classes from './thread-feed-row.module.css'

// Allowed Mantine accents only (DESIGN.md: no teal/violet/grape/indigo/pink).
const TYPE_COLOR: Record<HermesThreadType, string> = {
  todo: 'blue',
  podcast: 'orange',
  infra: 'gray',
  note: 'yellow',
  research: 'green',
  general: 'gray',
}

const TYPE_LABEL: Record<HermesThreadType, string> = {
  todo: 'Todo',
  podcast: 'Podcast',
  infra: 'Infra',
  note: 'Note',
  research: 'Research',
  general: 'General',
}

// Height of the inline conversation pane — bounded so the feed remains navigable.
const CONV_HEIGHT = 480

export function ThreadFeedRow({
  thread,
  expanded,
  onToggle,
}: {
  thread: HermesThread
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <Box className={classes.wrapper} data-expanded={expanded || undefined}>
      <UnstyledButton className={classes.header} onClick={onToggle} aria-expanded={expanded}>
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
          {thread.pinned > 0 && <IconPin size={12} className={classes.pin} />}
          {thread.type && (
            <Badge
              size="xs"
              variant="light"
              color={TYPE_COLOR[thread.type]}
              radius="sm"
              style={{ flexShrink: 0 }}
            >
              {TYPE_LABEL[thread.type]}
            </Badge>
          )}
          <Box style={{ minWidth: 0, flex: 1 }}>
            <Text size="sm" fw="semibold" lineClamp={1}>
              {thread.title ?? 'New chat'}
            </Text>
            {thread.summary && (
              <Text size="xs" c="dimmed" lineClamp={1}>
                {thread.summary}
              </Text>
            )}
          </Box>
        </Group>
        <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
          <Text size="xs" c="dimmed">
            {formatDistanceToNowStrict(new Date(thread.updated_at), { addSuffix: false })}
          </Text>
          {expanded ? (
            <IconChevronDown size={14} className={classes.chevron} />
          ) : (
            <IconChevronRight size={14} className={classes.chevron} />
          )}
        </Group>
      </UnstyledButton>

      <Collapse expanded={expanded}>
        <Box className={classes.conversationWrapper} h={CONV_HEIGHT}>
          <ChatView thread={thread} hideHeader />
        </Box>
      </Collapse>
    </Box>
  )
}
