import { ScrollArea, Skeleton } from '@mantine/core'
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
  type ChatRow,
  type SourceRef,
} from './model'
import { SourceRow } from './source-row'
import classes from './m365.module.css'

type Team = { id: string; displayName: string }
type Channel = { id: string; displayName: string; membershipType: string }

export type SourceListProps = {
  view: 'chats' | 'teams'
  chats: readonly ChatRow[]
  teams: readonly Team[]
  channelsByTeam: ReadonlyMap<string, readonly Channel[] | undefined>
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
    <ScrollArea className={classes.paneScroll} type="auto">
      {props.view === 'chats' ? <ChatGroups {...props} /> : <TeamTree {...props} />}
    </ScrollArea>
  )
}

function ChatGroups(props: SourceListProps) {
  const term = props.query.trim().toLowerCase()
  const rows = props.chats.filter(
    (c) =>
      matchesTag(props.tag, props.labelOf(chatSourceId(c.ref.chatId))) &&
      (term === '' || c.ref.displayName.toLowerCase().includes(term)),
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
              time={formatTime(c.lastUpdatedAt)}
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
  const teams = props.teams.filter((t) => {
    if (term && !t.displayName.toLowerCase().includes(term)) return false
    if (props.tag === '') return true
    return (props.channelsByTeam.get(t.id) ?? []).some((ch) =>
      matchesTag(props.tag, props.labelOf(channelSourceId(t.id, ch.id))),
    )
  })
  if (teams.length === 0) {
    return (
      <p className={classes.empty}>
        {term ? `No teams match "${props.query.trim()}"` : 'No teams with this label'}
      </p>
    )
  }
  return (
    <section aria-label="Teams">
      <h3 className={classes.groupHeading}>Teams · {teams.length}</h3>
      {teams.map((team) => {
        const channels = props.channelsByTeam.get(team.id)
        const isOpen = openId === team.id
        return (
          <div key={team.id}>
            <SourceRow
              glyph="team"
              name={team.displayName}
              meta={channels ? plural(channels.length, 'channel') : '— channels'}
              expanded={isOpen}
              onSelect={() => setOpenId(isOpen ? null : team.id)}
            />
            {isOpen ? <ChannelRows team={team} channels={channels} {...props} /> : null}
          </div>
        )
      })}
    </section>
  )
}

function ChannelRows(
  props: SourceListProps & { team: Team; channels: readonly Channel[] | undefined },
) {
  if (!props.channels) {
    return (
      <div className={classes.empty} aria-busy>
        <Skeleton h={14} w="60%" />
      </div>
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
        const labeled = props.labelOf(sourceIdFor(ref))
        if (!matchesTag(props.tag, labeled)) return null
        return (
          <SourceRow
            key={ch.id}
            child
            glyph="channel"
            name={ch.displayName}
            meta={`team channel · ${ch.membershipType}`}
            selected={selectedId === ch.id}
            starLabel={labeled?.label}
            onSelect={() => props.onSelect(ref)}
          />
        )
      })}
    </>
  )
}
