import { ActionIcon, Alert, Badge, ScrollArea } from '@mantine/core'
import { IconX } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { m365Queries } from '../../lib/queries/m365'
import { LabelButton, type LabelButtonProps } from './label-button'
import { MessageRow, MessageSkeleton } from './message-row'
import { formatStamp, plural, sourceIdFor, type SourceRef } from './model'
import classes from './m365.module.css'

export type RecordPaneProps = {
  selected: SourceRef
  /** Chat facts the list already holds (kind, member count, last activity). */
  chatFacts: { chatType: string; memberCount: number; lastUpdatedAt: string | null } | null
  /** Back to the labeled-sources view; absent where the surface has its own back affordance. */
  onClose?: (() => void) | undefined
  /** The last failed label write for this record, shown inline. */
  error: string | null
} & Omit<LabelButtonProps, 'sourceId'>

const MESSAGE_TOP = 20

function useRecordMessages(selected: SourceRef) {
  const chat = useQuery({
    ...m365Queries.chatMessages(selected.kind === 'chat' ? selected.chatId : '', MESSAGE_TOP),
    enabled: selected.kind === 'chat',
  })
  const channel = useQuery({
    ...m365Queries.channelMessages(
      selected.kind === 'channel' ? selected.teamId : '',
      selected.kind === 'channel' ? selected.channelId : '',
      MESSAGE_TOP,
    ),
    enabled: selected.kind === 'channel',
  })
  return selected.kind === 'chat' ? chat : channel
}

function factsOf(props: RecordPaneProps, latest: string | null | undefined): string {
  const { selected, chatFacts } = props
  const last = latest ? `last message ${formatStamp(latest)}` : null
  if (selected.kind === 'channel') {
    return ['team channel', `in ${selected.teamName}`, last].filter(Boolean).join(' · ')
  }
  const parts = [
    chatFacts?.chatType ?? null,
    chatFacts ? plural(chatFacts.memberCount, 'member') : null,
    last ?? (chatFacts?.lastUpdatedAt ? `active ${formatStamp(chatFacts.lastUpdatedAt)}` : null),
  ]
  return parts.filter(Boolean).join(' · ')
}

export function RecordPane(props: RecordPaneProps) {
  const { selected } = props
  const q = useRecordMessages(selected)
  const messages = q.data?.messages
  const latest = messages?.[0]?.createdAt
  return (
    <>
      <header className={classes.recordHeader} data-shot="record-header">
        <div className={classes.recordTitle}>
          <h2 className={classes.recordName} tabIndex={-1}>
            {selected.displayName}
          </h2>
          <Badge variant="light" color="gray">
            {selected.kind}
          </Badge>
          {props.onClose ? (
            <ActionIcon
              ml="auto"
              variant="subtle"
              color="gray"
              aria-label="Close record"
              onClick={props.onClose}
            >
              <IconX size={14} />
            </ActionIcon>
          ) : null}
        </div>
        <span className={classes.facts}>{factsOf(props, latest)}</span>
        <div>
          <LabelButton
            key={sourceIdFor(selected)}
            existing={props.existing}
            tags={props.tags}
            saving={props.saving}
            onSave={props.onSave}
            onRemove={props.onRemove}
            sourceId={sourceIdFor(selected)}
          />
        </div>
        {props.error ? (
          <Alert color="red" variant="light">
            {props.error}
          </Alert>
        ) : null}
      </header>
      <ScrollArea className={classes.paneScroll} type="auto" scrollbars="y">
        {q.error ? (
          <Alert color="red" variant="light" m="sm">
            {q.error instanceof Error ? q.error.message : 'Failed to load messages'}
          </Alert>
        ) : null}
        {messages === undefined && !q.error ? (
          <>
            <MessageSkeleton />
            <MessageSkeleton />
            <MessageSkeleton />
          </>
        ) : null}
        {messages?.length === 0 ? <p className={classes.empty}>No messages</p> : null}
        {messages?.map((m) => (
          <MessageRow key={m.id} message={m} channel={selected.kind === 'channel'} />
        ))}
      </ScrollArea>
    </>
  )
}
