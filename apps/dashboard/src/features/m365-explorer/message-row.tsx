import { Skeleton } from '@mantine/core'
import { formatStamp, plural } from './model'
import classes from './m365.module.css'

export type MessageLite = {
  id: string
  createdAt: string | null
  from: { name: string } | null
  subject: string | null
  importance: string
  bodyText: string
  replyCount: number
}

const HIGH = new Set(['high', 'urgent'])

export function MessageRow(props: { message: MessageLite; meta?: string; channel?: boolean }) {
  const m = props.message
  const high = HIGH.has(m.importance)
  return (
    <article className={classes.message} data-shot="message-row">
      <div className={classes.messageHead}>
        {high ? (
          <span className={classes.dot} role="img" aria-label={`${m.importance} importance`} />
        ) : null}
        <span className={classes.sender}>{m.from?.name ?? 'system'}</span>
        {props.channel && m.replyCount > 0 ? (
          <span className={classes.chipStatic}>{plural(m.replyCount, 'reply', 'replies')}</span>
        ) : null}
        <time className={classes.messageTime} dateTime={m.createdAt ?? undefined}>
          {formatStamp(m.createdAt)}
        </time>
      </div>
      {m.subject ? <span className={classes.sender}>{m.subject}</span> : null}
      <p className={classes.body}>{m.bodyText || '—'}</p>
      {props.meta ? <span className={classes.meta}>{props.meta}</span> : null}
    </article>
  )
}

export function MessageSkeleton() {
  return (
    <div className={classes.message} aria-busy>
      <Skeleton h={12} w="35%" />
      <Skeleton h={12} />
      <Skeleton h={12} w="80%" />
    </div>
  )
}
