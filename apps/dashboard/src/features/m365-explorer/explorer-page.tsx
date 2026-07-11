import * as React from 'react'
import { useMemo, useState } from 'react'
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Code,
  CopyButton,
  Divider,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { PageActions } from 'basalt-ui'
import {
  IconCheck,
  IconCopy,
  IconRefresh,
  IconStar,
  IconStarFilled,
  IconTag,
  IconTrash,
} from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { m365Mutations, m365Queries, type LabelKind } from '../../lib/queries/m365'

const SUGGESTED_LABELS = ['alerts', 'pr-reviews', 'general', 'noise']

type SourceRef =
  | { kind: 'chat'; chatId: string; displayName: string }
  | {
      kind: 'channel'
      teamId: string
      channelId: string
      displayName: string
      teamName: string
    }

function chatSourceId(chatId: string): string {
  return `chat:${chatId}`
}

function channelSourceId(teamId: string, channelId: string): string {
  return `channel:${teamId}:${channelId}`
}

function sourceIdFor(ref: SourceRef): string {
  return ref.kind === 'chat' ? chatSourceId(ref.chatId) : channelSourceId(ref.teamId, ref.channelId)
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const today = new Date()
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleString([], {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function chatTitle(chat: { topic: string | null; members: Array<{ name: string }> }): string {
  if (chat.topic) return chat.topic
  const names = chat.members
    .map((m) => m.name)
    .filter(Boolean)
    .slice(0, 3)
    .join(', ')
  return names || '(no topic)'
}

export function M365ExplorerPage(): React.ReactElement {
  const qc = useQueryClient()
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<SourceRef | null>(null)
  const [tagsModalOpened, tagsModal] = useDisclosure(false)

  const { data: chatsData } = useSuspenseQuery(m365Queries.chats(50))
  const { data: teamsData } = useSuspenseQuery(m365Queries.teams())
  const { data: labelsData } = useSuspenseQuery(m365Queries.labels())

  const labelsBySourceId = useMemo(() => {
    const m = new Map<string, { label: string; notes: string | null }>()
    for (const l of labelsData.labels) {
      m.set(l.sourceId, { label: l.label, notes: l.notes })
    }
    return m
  }, [labelsData])

  const tagCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of labelsData.labels) {
      m.set(l.label, (m.get(l.label) ?? 0) + 1)
    }
    return [...m.entries()].toSorted((a, b) => b[1] - a[1])
  }, [labelsData])

  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null)
  const channelsQuery = useQuery({ ...m365Queries.channels(expandedTeamId ?? '') })

  const chats = useMemo(() => {
    const term = filter.trim().toLowerCase()
    const rows = chatsData.chats.map((c) => ({
      ref: { kind: 'chat' as const, chatId: c.id, displayName: chatTitle(c) },
      chatType: c.chatType,
      lastPreview: c.lastMessagePreview,
      lastUpdatedAt: c.lastUpdatedAt,
      memberCount: c.members.length,
    }))
    if (!term) return rows
    return rows.filter((r) => r.ref.displayName.toLowerCase().includes(term))
  }, [chatsData, filter])

  function invalidateLabels(): void {
    void qc.invalidateQueries({ queryKey: [...m365Queries.all(), 'labels'] })
    void qc.invalidateQueries({ queryKey: [...m365Queries.all(), 'important'] })
  }

  const upsertLabel = useMutation({
    ...m365Mutations.upsertLabel(),
    onSuccess: invalidateLabels,
  })
  const deleteLabel = useMutation({
    ...m365Mutations.deleteLabel(),
    onSuccess: invalidateLabels,
  })

  function openLabeled(sourceId: string, kind: LabelKind): void {
    if (kind === 'chat') {
      const chatId = sourceId.replace(/^chat:/, '')
      const c = chatsData.chats.find((x) => x.id === chatId)
      if (c) setSelected({ kind: 'chat', chatId, displayName: chatTitle(c) })
      return
    }
    const [, teamId, channelId] = sourceId.split(':')
    if (!teamId || !channelId) return
    setExpandedTeamId(teamId)
    const team = teamsData.teams.find((t) => t.id === teamId)
    if (team) {
      setSelected({
        kind: 'channel',
        teamId,
        channelId,
        displayName: channelId,
        teamName: team.displayName,
      })
    }
  }

  return (
    <Stack gap="md">
      {/* Page actions live in the shared top-bar slot; the breadcrumb names the page. */}
      <PageActions>
        <Group gap="xs" wrap="nowrap">
          <Button
            variant="light"
            size="xs"
            leftSection={<IconTag size={14} />}
            onClick={tagsModal.open}
            disabled={tagCounts.length === 0}
          >
            Manage tags ({tagCounts.length})
          </Button>
          <Tooltip label="Refresh chats + channels">
            <ActionIcon
              variant="light"
              onClick={() => {
                void qc.invalidateQueries({ queryKey: m365Queries.all() })
              }}
            >
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </PageActions>

      <Text c="dimmed" size="sm">
        Browse your Teams chats and channels, then star the ones worth surfacing in agent feeds.
        Labels persist to <Code>apps/api/m365-labels.json</Code> (git-tracked) and drive{' '}
        <Code>GET /m365/important</Code>.
      </Text>

      <LabelsStrip
        labels={labelsData.labels}
        tagCounts={tagCounts}
        onOpen={openLabeled}
        onRemove={(id) => deleteLabel.mutate(id)}
        removing={deleteLabel.isPending}
      />

      <Group align="stretch" gap="md" wrap="nowrap" style={{ minHeight: '70vh' }}>
        <Card
          withBorder
          p={0}
          style={{ flex: '0 0 360px', display: 'flex', flexDirection: 'column' }}
        >
          <Box p="sm">
            <TextInput
              placeholder="Filter chats / teams…"
              value={filter}
              onChange={(e) => setFilter(e.currentTarget.value)}
              size="xs"
            />
          </Box>
          <Divider />
          <ScrollArea style={{ flex: 1 }} type="auto">
            <Stack gap={2} p="xs">
              <Text fw={600} size="xs" c="dimmed" tt="uppercase" pl={4}>
                Chats ({chats.length})
              </Text>
              {chats.map((c) => {
                const id = sourceIdFor(c.ref)
                const labeled = labelsBySourceId.get(id)
                const isSelected = selected?.kind === 'chat' && selected.chatId === c.ref.chatId
                return (
                  <SourceRow
                    key={id}
                    title={c.ref.displayName}
                    subtitle={
                      c.lastPreview?.text
                        ? `${c.lastPreview.from ?? '?'}: ${c.lastPreview.text}`
                        : 'No messages yet'
                    }
                    rightTop={formatTime(c.lastUpdatedAt)}
                    badge={c.chatType}
                    badgeColor={
                      c.chatType === 'meeting' ? 'gray' : c.chatType === 'group' ? 'blue' : 'green'
                    }
                    selected={isSelected}
                    label={labeled?.label}
                    onClick={() => setSelected(c.ref)}
                  />
                )
              })}

              <Text fw={600} size="xs" c="dimmed" tt="uppercase" pl={4} mt="md">
                Teams ({teamsData.teams.length})
              </Text>
              {teamsData.teams.map((team) => {
                const isOpen = expandedTeamId === team.id
                return (
                  <Stack gap={2} key={team.id}>
                    <SourceRow
                      title={team.displayName}
                      subtitle={team.description ?? ''}
                      badge={isOpen ? 'open' : 'team'}
                      badgeColor={isOpen ? 'green' : 'gray'}
                      onClick={() => setExpandedTeamId(isOpen ? null : team.id)}
                    />
                    {isOpen && (
                      <Stack gap={2} pl="md">
                        {channelsQuery.isLoading && expandedTeamId === team.id && (
                          <Group gap="xs" pl="md">
                            <Loader size="xs" />
                            <Text size="xs" c="dimmed">
                              Loading channels…
                            </Text>
                          </Group>
                        )}
                        {channelsQuery.data?.channels.map((ch) => {
                          const ref: SourceRef = {
                            kind: 'channel',
                            teamId: team.id,
                            channelId: ch.id,
                            displayName: ch.displayName,
                            teamName: team.displayName,
                          }
                          const id = sourceIdFor(ref)
                          const labeled = labelsBySourceId.get(id)
                          const isSelected =
                            selected?.kind === 'channel' && selected.channelId === ch.id
                          return (
                            <SourceRow
                              key={id}
                              title={`# ${ch.displayName}`}
                              subtitle={ch.description ?? ''}
                              badge={ch.membershipType}
                              badgeColor="blue"
                              selected={isSelected}
                              label={labeled?.label}
                              onClick={() => setSelected(ref)}
                            />
                          )
                        })}
                      </Stack>
                    )}
                  </Stack>
                )
              })}
            </Stack>
          </ScrollArea>
        </Card>

        <Card withBorder style={{ flex: 1, display: 'flex', flexDirection: 'column' }} p={0}>
          {!selected ? (
            <Stack
              gap="xs"
              p="lg"
              style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
            >
              <Text c="dimmed">
                Pick a chat or channel on the left to preview its latest messages.
              </Text>
              <Text c="dimmed" size="xs">
                {labelsData.labels.length} sources labeled so far
              </Text>
            </Stack>
          ) : (
            <DetailPane
              selected={selected}
              existing={labelsBySourceId.get(sourceIdFor(selected)) ?? null}
              suggestedLabels={[...new Set([...SUGGESTED_LABELS, ...tagCounts.map(([t]) => t)])]}
              onSave={(label, notes) =>
                upsertLabel.mutate({
                  sourceId: sourceIdFor(selected),
                  kind: selected.kind,
                  label,
                  displayName: selected.displayName,
                  notes,
                })
              }
              onRemove={() => deleteLabel.mutate(sourceIdFor(selected))}
              saving={upsertLabel.isPending}
              removing={deleteLabel.isPending}
            />
          )}
        </Card>
      </Group>

      <TagsModal opened={tagsModalOpened} onClose={tagsModal.close} tagCounts={tagCounts} />
    </Stack>
  )
}

function SourceRow(props: {
  title: string
  subtitle: string
  rightTop?: string
  badge?: string
  badgeColor?: string
  selected?: boolean
  label?: string
  onClick: () => void
}) {
  return (
    <Box
      onClick={props.onClick}
      style={{
        padding: '8px 10px',
        borderRadius: 6,
        cursor: 'pointer',
        background: props.selected ? 'var(--mantine-color-default-hover)' : undefined,
        border: props.selected ? '1px solid var(--mantine-color-blue-5)' : '1px solid transparent',
      }}
    >
      <Group justify="space-between" gap={6} wrap="nowrap">
        <Text fw={600} size="sm" truncate>
          {props.title}
        </Text>
        <Group gap={4} wrap="nowrap">
          {props.label && (
            <Badge
              size="xs"
              color="yellow"
              variant="filled"
              leftSection={<IconStarFilled size={10} />}
            >
              {props.label}
            </Badge>
          )}
          {props.badge && (
            <Badge size="xs" color={props.badgeColor ?? 'gray'} variant="light">
              {props.badge}
            </Badge>
          )}
        </Group>
      </Group>
      {props.subtitle && (
        <Text size="xs" c="dimmed" truncate>
          {props.subtitle}
        </Text>
      )}
      {props.rightTop && (
        <Text size="xs" c="dimmed" mt={2}>
          {props.rightTop}
        </Text>
      )}
    </Box>
  )
}

function LabelsStrip(props: {
  labels: Array<{
    sourceId: string
    kind: LabelKind
    label: string
    displayName: string | null
  }>
  tagCounts: Array<[string, number]>
  onOpen: (sourceId: string, kind: LabelKind) => void
  onRemove: (sourceId: string) => void
  removing: boolean
}) {
  if (props.labels.length === 0) {
    return (
      <Card withBorder p="sm">
        <Text c="dimmed" size="sm">
          No labels yet. Pick a chat or channel below, give it a tag, and it'll surface here and in{' '}
          <Code>GET /m365/important</Code>.
        </Text>
      </Card>
    )
  }
  return (
    <Card withBorder p="sm">
      <Stack gap="xs">
        <Group gap="xs" wrap="wrap">
          {props.tagCounts.map(([tag, count]) => (
            <Badge
              key={tag}
              color="yellow"
              variant="filled"
              leftSection={<IconStarFilled size={10} />}
            >
              {tag} · {count}
            </Badge>
          ))}
        </Group>
        <Divider />
        <Group gap="xs" wrap="wrap">
          {props.labels.map((l) => (
            <Card
              key={l.sourceId}
              withBorder
              p={6}
              radius="sm"
              style={{ minWidth: 220, maxWidth: 320 }}
            >
              <Group gap={6} justify="space-between" wrap="nowrap">
                <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
                  <Group gap={6} wrap="nowrap">
                    <Badge size="xs" color="yellow" variant="filled">
                      {l.label}
                    </Badge>
                    <Text size="sm" fw={500} truncate>
                      {l.displayName ?? l.sourceId}
                    </Text>
                  </Group>
                </Stack>
                <Group gap={2} wrap="nowrap">
                  <Tooltip label="Open in detail pane">
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      onClick={() => props.onOpen(l.sourceId, l.kind)}
                    >
                      <IconStar size={14} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Remove label">
                    <ActionIcon
                      size="sm"
                      color="red"
                      variant="subtle"
                      onClick={() => props.onRemove(l.sourceId)}
                      loading={props.removing}
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Group>
            </Card>
          ))}
        </Group>
      </Stack>
    </Card>
  )
}

function DetailPane(props: {
  selected: SourceRef
  existing: { label: string; notes: string | null } | null
  suggestedLabels: string[]
  onSave: (label: string, notes: string | null) => void
  onRemove: () => void
  saving: boolean
  removing: boolean
}) {
  const { selected, existing } = props
  const sourceId = sourceIdFor(selected)

  const [labelDraft, setLabelDraft] = useState(existing?.label ?? '')
  const [notesDraft, setNotesDraft] = useState(existing?.notes ?? '')
  const formKey = sourceId + '|' + (existing?.label ?? '') + '|' + (existing?.notes ?? '')
  const lastKey = React.useRef(formKey)
  if (lastKey.current !== formKey) {
    lastKey.current = formKey
    setLabelDraft(existing?.label ?? '')
    setNotesDraft(existing?.notes ?? '')
  }

  const chatMessagesQuery = useQuery({
    ...m365Queries.chatMessages(selected.kind === 'chat' ? selected.chatId : '', 20),
    enabled: selected.kind === 'chat',
  })
  const channelMessagesQuery = useQuery({
    ...m365Queries.channelMessages(
      selected.kind === 'channel' ? selected.teamId : '',
      selected.kind === 'channel' ? selected.channelId : '',
      20,
    ),
    enabled: selected.kind === 'channel',
  })
  const messagesQuery = selected.kind === 'chat' ? chatMessagesQuery : channelMessagesQuery

  const dirty =
    labelDraft.trim().length > 0 &&
    (labelDraft.trim() !== (existing?.label ?? '') ||
      (notesDraft || null) !== (existing?.notes ?? null))

  function handleSave(): void {
    if (!labelDraft.trim()) return
    props.onSave(labelDraft.trim(), notesDraft.trim() ? notesDraft.trim() : null)
  }

  return (
    <Stack gap={0} style={{ flex: 1 }}>
      <Box p="md">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Text fw={700} size="lg" truncate>
              {selected.displayName}
            </Text>
            <Group gap="xs">
              <Badge variant="light">{selected.kind}</Badge>
              {selected.kind === 'channel' && (
                <Text c="dimmed" size="xs">
                  in {selected.teamName}
                </Text>
              )}
              <CopyButton value={sourceId} timeout={1200}>
                {({ copied, copy }) => (
                  <Tooltip label={copied ? 'Copied' : 'Copy sourceId'}>
                    <ActionIcon variant="subtle" size="sm" onClick={copy}>
                      {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            </Group>
            <Code style={{ fontSize: 11 }}>{sourceId}</Code>
          </Stack>
          <Stack gap="xs" w={320}>
            <Select
              size="xs"
              placeholder="Pick a label"
              value={null}
              data={props.suggestedLabels}
              searchable
              clearable
              onChange={(v) => v && setLabelDraft(v)}
              comboboxProps={{ withinPortal: true }}
            />
            <TextInput
              size="xs"
              placeholder="custom label"
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave()
              }}
            />
            <Textarea
              size="xs"
              placeholder="notes (optional — visible to agents via GET /m365/labels)"
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.currentTarget.value)}
              autosize
              minRows={2}
              maxRows={6}
            />
            <Group justify="space-between" gap="xs">
              <Button
                size="xs"
                leftSection={<IconStar size={14} />}
                onClick={handleSave}
                loading={props.saving}
                disabled={!dirty}
              >
                {existing ? 'Update' : 'Star'}
              </Button>
              {existing && (
                <Button
                  size="xs"
                  variant="subtle"
                  color="red"
                  leftSection={<IconTrash size={12} />}
                  onClick={props.onRemove}
                  loading={props.removing}
                >
                  Remove
                </Button>
              )}
            </Group>
          </Stack>
        </Group>
      </Box>
      <Divider />
      <ScrollArea style={{ flex: 1 }} type="auto">
        <Stack gap="sm" p="md">
          {messagesQuery.isLoading && (
            <Group gap="xs">
              <Loader size="xs" />
              <Text size="sm" c="dimmed">
                Loading messages…
              </Text>
            </Group>
          )}
          {messagesQuery.error && (
            <Alert color="red" variant="light">
              {messagesQuery.error instanceof Error
                ? messagesQuery.error.message
                : 'Failed to load messages'}
            </Alert>
          )}
          {messagesQuery.data?.messages.map((m) => (
            <Box
              key={m.id}
              style={{
                borderLeft: '2px solid var(--mantine-color-default-border)',
                paddingLeft: 12,
              }}
            >
              <Group gap="xs" mb={2}>
                <Text fw={600} size="sm">
                  {m.from?.name ?? 'system'}
                </Text>
                <Text size="xs" c="dimmed">
                  {formatTime(m.createdAt)}
                </Text>
                {m.replyCount > 0 && (
                  <Badge size="xs" variant="light">
                    {m.replyCount} {m.replyCount === 1 ? 'reply' : 'replies'}
                  </Badge>
                )}
              </Group>
              {m.subject && (
                <Text fw={500} size="sm" mb={2}>
                  {m.subject}
                </Text>
              )}
              <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                {m.bodyText || (
                  <Text component="span" c="dimmed" fs="italic">
                    (empty)
                  </Text>
                )}
              </Text>
            </Box>
          ))}
          {messagesQuery.data?.messages.length === 0 && (
            <Text c="dimmed" size="sm">
              No messages.
            </Text>
          )}
        </Stack>
      </ScrollArea>
    </Stack>
  )
}

function TagsModal(props: {
  opened: boolean
  onClose: () => void
  tagCounts: Array<[string, number]>
}) {
  const qc = useQueryClient()
  const renameTag = useMutation({
    ...m365Mutations.renameTag(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: m365Queries.all() })
    },
  })
  const deleteTag = useMutation({
    ...m365Mutations.deleteTag(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: m365Queries.all() })
    },
  })

  return (
    <Modal opened={props.opened} onClose={props.onClose} title="Manage tags" size="md">
      <Stack gap="md">
        <Text c="dimmed" size="sm">
          Rename a tag to update every source carrying it. Deleting a tag removes the label from
          every source — the chats/channels themselves are not touched.
        </Text>
        {props.tagCounts.length === 0 ? (
          <Text c="dimmed" size="sm">
            No tags yet.
          </Text>
        ) : (
          <Stack gap="xs">
            {props.tagCounts.map(([tag, count]) => (
              <TagRow
                key={tag}
                tag={tag}
                count={count}
                onRename={(to) => renameTag.mutate({ tag, to })}
                onDelete={() => deleteTag.mutate(tag)}
                renaming={renameTag.isPending}
                deleting={deleteTag.isPending}
              />
            ))}
          </Stack>
        )}
      </Stack>
    </Modal>
  )
}

function TagRow(props: {
  tag: string
  count: number
  onRename: (to: string) => void
  onDelete: () => void
  renaming: boolean
  deleting: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(props.tag)
  return (
    <Group gap="xs" justify="space-between" wrap="nowrap">
      <Group gap="xs" style={{ flex: 1, minWidth: 0 }} wrap="nowrap">
        <Badge color="yellow" variant="filled" leftSection={<IconStarFilled size={10} />}>
          {props.tag}
        </Badge>
        <Text size="sm" c="dimmed">
          {props.count} {props.count === 1 ? 'source' : 'sources'}
        </Text>
      </Group>
      {editing ? (
        <Group gap={4} wrap="nowrap">
          <TextInput
            size="xs"
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim() && draft.trim() !== props.tag) {
                props.onRename(draft.trim())
                setEditing(false)
              }
              if (e.key === 'Escape') {
                setEditing(false)
                setDraft(props.tag)
              }
            }}
          />
          <Button
            size="xs"
            onClick={() => {
              if (draft.trim() && draft.trim() !== props.tag) props.onRename(draft.trim())
              setEditing(false)
            }}
            loading={props.renaming}
          >
            Save
          </Button>
        </Group>
      ) : (
        <Group gap={4} wrap="nowrap">
          <Button size="xs" variant="subtle" onClick={() => setEditing(true)}>
            Rename
          </Button>
          <ActionIcon
            size="sm"
            color="red"
            variant="subtle"
            onClick={() => props.onDelete()}
            loading={props.deleting}
          >
            <IconTrash size={14} />
          </ActionIcon>
        </Group>
      )}
    </Group>
  )
}
