import { ScrollArea, Skeleton, UnstyledButton } from '@mantine/core'
import { useState } from 'react'
import {
  CHAT_TYPE_LABEL,
  channelSourceId,
  chatSourceId,
  formatTime,
  groupByRecency,
  matchesTag,
  plural,
  sourceIdFor,
  type ChannelState,
  type ChatRow,
  type SourceRef,
} from './model'
import { SourceRow } from './source-row'
import classes from './m365.module.css'

type Team = { id: string; displayName: string }
type Channel = { id: string; displayName: string; membershipType: string }

export type TeamChannels = {
  state: ChannelState
  channels: readonly Channel[]
  retry: () => void
}

/** One team with the state of its channel list. */
export type TeamRow = { team: Team; channels: TeamChannels }

export type SourceListProps = {
  view: 'chats' | 'teams'
  chats: readonly ChatRow[]
  teamRows: readonly TeamRow[]
  labelOf: (sourceId: string) => { label: string } | undefined
  tag: string
  query: string
  /** Reference time for the recency groups: when the chats were fetched, so render stays pure. */
  now: Date
  selected: SourceRef | null
  onSelect: (ref: SourceRef) => void
}

export function SourceList(props: SourceListProps) {
  return (
    <ScrollArea
      className={classes.paneScroll}
      classNames={{ scrollbar: classes.scrollbar }}
      type="auto"
      scrollbars="y"
    >
      {props.view === 'chats' ? <ChatGroups {...props} /> : <TeamTree {...props} />}
    </ScrollArea>
  )
}

function ChatGroups(props: SourceListProps) {
  const term = props.query.trim().toLowerCase()
  const rows = props.chats.filter(
    (c) =>
      matchesTag(props.tag, props.labelOf(chatSourceId(c.ref.chatId))) &&
      (term === '' || c.searchText.includes(term)),
  )
  if (rows.length === 0) {
    return (
      <p className={classes.empty}>
        {term ? `No chats match "${props.query.trim()}"` : 'No chats with this label'}
      </p>
    )
  }
  const selectedId = props.selected?.kind === 'chat' ? props.selected.chatId : null
  return (
    <>
      {groupByRecency(rows, props.now).map((g) => (
        <section key={g.group} aria-label={g.group}>
          <h3 className={classes.groupHeading}>
            {g.group} · {g.rows.length}
          </h3>
          {g.rows.map((c) => (
            <SourceRow
              key={c.ref.chatId}
              glyph={c.chatType}
              name={c.ref.displayName}
              meta={`${CHAT_TYPE_LABEL[c.chatType]} · ${plural(c.memberCount, 'member')}`}
              time={formatTime(c.lastUpdatedAt, props.now)}
              selected={selectedId === c.ref.chatId}
              starLabel={props.labelOf(chatSourceId(c.ref.chatId))?.label}
              onSelect={() => props.onSelect(c.ref)}
            />
          ))}
        </section>
      ))}
    </>
  )
}

function TeamTree(props: SourceListProps) {
  const [openId, setOpenId] = useState<string | null>(null)
  const term = props.query.trim().toLowerCase()
  const visible = props.teamRows.flatMap(({ team, channels: entry }) => {
    const teamMatches = term === '' || team.displayName.toLowerCase().includes(term)
    const channels = entry.channels.filter(
      (ch) =>
        (teamMatches || ch.displayName.toLowerCase().includes(term)) &&
        matchesTag(props.tag, props.labelOf(channelSourceId(team.id, ch.id))),
    )
    const keep = props.tag === '' ? teamMatches || channels.length > 0 : channels.length > 0
    if (!keep) return []
    return [{ team, entry, channels, autoOpen: term !== '' && !teamMatches && channels.length > 0 }]
  })
  if (visible.length === 0) {
    return (
      <p className={classes.empty}>
        {term ? `No teams or channels match "${props.query.trim()}"` : 'No teams with this label'}
      </p>
    )
  }
  return (
    <section aria-label="Teams">
      <h3 className={classes.groupHeading}>Teams · {visible.length}</h3>
      {visible.map(({ team, entry, channels, autoOpen }) => {
        const isOpen = autoOpen || openId === team.id
        const state = entry.state
        const all = entry.channels.length
        const filtered = props.tag !== '' || term !== ''
        const meta =
          state === 'loaded'
            ? filtered && channels.length !== all
              ? `${channels.length} of ${plural(all, 'channel')}`
              : plural(all, 'channel')
            : state === 'failed'
              ? 'channels failed to load'
              : '— channels'
        return (
          <div key={team.id}>
            <SourceRow
              glyph="team"
              name={team.displayName}
              meta={meta}
              expanded={isOpen}
              onSelect={() => setOpenId(openId === team.id ? null : team.id)}
            />
            {isOpen ? (
              <ChannelRows
                {...props}
                team={team}
                state={state}
                channels={channels}
                retry={entry.retry}
              />
            ) : null}
          </div>
        )
      })}
    </section>
  )
}

function ChannelRows(
  props: SourceListProps & {
    team: Team
    state: ChannelState
    channels: readonly Channel[]
    retry: (() => void) | undefined
  },
) {
  if (props.state === 'loading') {
    return (
      <div className={classes.empty} aria-busy>
        <Skeleton h={14} w="60%" />
      </div>
    )
  }
  if (props.state === 'failed') {
    return (
      <p className={classes.empty}>
        Channels failed to load{' '}
        <UnstyledButton className={classes.retry} onClick={props.retry}>
          Retry
        </UnstyledButton>
      </p>
    )
  }
  const selectedId = props.selected?.kind === 'channel' ? props.selected.channelId : null
  return (
    <>
      {props.channels.map((ch) => {
        const ref: SourceRef = {
          kind: 'channel',
          teamId: props.team.id,
          channelId: ch.id,
          displayName: ch.displayName,
          teamName: props.team.displayName,
        }
        return (
          <SourceRow
            key={ch.id}
            child
            glyph="channel"
            name={ch.displayName}
            meta={`team channel · ${ch.membershipType}`}
            selected={selectedId === ch.id}
            starLabel={props.labelOf(sourceIdFor(ref))?.label}
            onSelect={() => props.onSelect(ref)}
          />
        )
      })}
    </>
  )
}
