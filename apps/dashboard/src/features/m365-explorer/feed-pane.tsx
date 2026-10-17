import { Alert, ScrollArea } from '@mantine/core'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { m365Queries } from '../../lib/queries/m365'
import { MessageRow, MessageSkeleton } from './message-row'
import { plural } from './model'
import classes from './m365.module.css'

const FEED_TOP = 5
const FEED_LIMIT = 50

/** `GET /m365/important` for the active tag — exactly what an agent reading the feed gets. */
export function FeedPane({ tag }: { tag: string }) {
  const label = tag === '' || tag === '*' ? undefined : tag
  const q = useQuery({
    ...m365Queries.important({ ...(label ? { label } : {}), top: FEED_TOP, limit: FEED_LIMIT }),
    placeholderData: keepPreviousData,
  })
  const items = q.data?.messages
  return (
    <>
      <header className={classes.recordHeader} data-shot="feed-header">
        <h2 className={classes.recordName}>Agent feed{label ? ` · ${label}` : ''}</h2>
        <span className={classes.facts}>
          {items
            ? `${plural(items.length, 'message')} · newest first · top ${FEED_TOP} per source`
            : '—'}
        </span>
      </header>
      <ScrollArea className={classes.paneScroll} type="auto">
        {q.error ? (
          <Alert color="red" variant="light" m="sm">
            {q.error instanceof Error ? q.error.message : 'Failed to load the feed'}
          </Alert>
        ) : null}
        {items === undefined && !q.error ? (
          <>
            <MessageSkeleton />
            <MessageSkeleton />
          </>
        ) : null}
        {items?.length === 0 ? <p className={classes.empty}>No messages for this tag</p> : null}
        {items?.map((item) => (
          <MessageRow
            key={`${item.sourceId}:${item.message.id}`}
            message={item.message}
            channel={item.source === 'channel'}
            meta={[item.label, item.displayName, item.notes].filter(Boolean).join(' · ')}
          />
        ))}
      </ScrollArea>
    </>
  )
}
