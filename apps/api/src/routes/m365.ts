import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  listTools,
  seedTokens,
  listUpcomingCalendarEvents,
  listJoinedTeams,
  listTeamChannels,
  listChats,
  listChatMessages,
  listChannelMessages,
} from '../clients/m365.js'
import type { ChatMessage as M365ChatMessage } from '../clients/m365.js'
import {
  deleteLabel as storeDeleteLabel,
  deleteTag as storeDeleteTag,
  listLabels as storeListLabels,
  renameTag as storeRenameTag,
  upsertLabel as storeUpsertLabel,
} from '../clients/m365-labels-store.js'
import { readTeam } from '../clients/m365-team-store.js'

const ToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.unknown().optional(),
})

const SeedBody = z.object({
  clientId: z.string().min(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number().int(),
  scope: z.string().min(1),
})

const TeamSchema = z.object({
  id: z.string().describe('Team UUID — pass to /m365/teams/{teamId}/channels'),
  displayName: z.string(),
  description: z.string().nullable(),
  webUrl: z.string().nullable().describe('Teams web URL for the team root'),
  isArchived: z.boolean(),
})

const ChannelSchema = z.object({
  id: z
    .string()
    .describe('Channel id — pass to /m365/teams/{teamId}/channels/{channelId}/messages'),
  displayName: z.string(),
  description: z.string().nullable(),
  webUrl: z.string().nullable(),
  membershipType: z
    .string()
    .describe('e.g. "standard", "private", "shared" — only standard/private are member-default'),
  createdAt: z.string().nullable().describe('ISO 8601 timestamp or null'),
})

const ChatMemberSchema = z.object({
  name: z.string(),
  email: z.string().nullable(),
  userId: z.string().nullable().describe('AAD user GUID — null for external/federated members'),
})

const LastMessagePreviewSchema = z.object({
  from: z.string().nullable().describe('Sender display name or null'),
  text: z.string().describe('Plain-text snippet (HTML stripped, capped ~280 chars)'),
  createdAt: z.string().nullable().describe('ISO 8601 timestamp or null'),
})

const ChatSchema = z.object({
  id: z.string().describe('Chat id — pass to /m365/chats/{chatId}/messages or label as important'),
  topic: z
    .string()
    .nullable()
    .describe('Group/meeting chat title; null for 1:1 chats (use members[].name as the label)'),
  chatType: z
    .enum(['oneOnOne', 'group', 'meeting', 'unknownFutureValue'])
    .describe(
      'oneOnOne = direct DM; group = ad-hoc group chat; meeting = chat attached to a Teams meeting',
    ),
  webUrl: z.string().nullable().describe('Teams deep-link to the chat'),
  createdAt: z.string().nullable(),
  lastUpdatedAt: z
    .string()
    .nullable()
    .describe('ISO 8601 timestamp — sort desc for most-recently-active'),
  members: z
    .array(ChatMemberSchema)
    .describe('Includes the authenticated user; filter client-side if you want "others"'),
  lastMessagePreview: LastMessagePreviewSchema.nullable().describe(
    'null when the chat has no messages yet',
  ),
})

const MessageAttachmentSchema = z.object({
  name: z.string().nullable(),
  contentType: z.string().nullable().describe('e.g. "reference", "messageReference", MIME type'),
  contentUrl: z.string().nullable(),
})

const MessageFromSchema = z.object({
  name: z.string(),
  email: z
    .string()
    .nullable()
    .describe('Currently null — Graph does not expose email on message.from.user'),
})

const ChatMessageSchema = z.object({
  id: z
    .string()
    .describe('Graph message id. Stable per chat/channel; not globally unique across sources.'),
  createdAt: z
    .string()
    .nullable()
    .describe('ISO 8601 timestamp. Use to sort or window message lists.'),
  lastModifiedAt: z
    .string()
    .nullable()
    .describe('ISO 8601. Non-null when the author edited the message after sending.'),
  from: MessageFromSchema.nullable().describe(
    'null for system messages (member added, app posts, etc.)',
  ),
  subject: z
    .string()
    .nullable()
    .describe('Channel posts can have a subject; chat messages are usually null'),
  importance: z.string().describe('e.g. "normal", "high", "urgent"'),
  bodyText: z.string().describe('Plain-text body (HTML stripped if needed)'),
  bodyHtml: z
    .string()
    .nullable()
    .describe('Original HTML body when the message was sent as HTML; null for text-only'),
  webUrl: z
    .string()
    .nullable()
    .describe('Teams deep-link to the specific message. Pastable into chat or browser.'),
  attachments: z
    .array(MessageAttachmentSchema)
    .describe('Files, message-quote references, or external links attached to the message.'),
  replyCount: z.number().int().describe('Number of replies (channel only). 0 for chat messages.'),
  isSystem: z
    .boolean()
    .describe(
      'True for Graph system events (join/leave, meeting started). Filtered out by default; pass ?includeSystem=true to keep them.',
    ),
})

// /important strips bodyHtml by default — that field is by far the heaviest
// part of the payload and agents almost always work off bodyText.
const ImportantChatMessageSchema = ChatMessageSchema.omit({ bodyHtml: true })

// --- Labels --------------------------------------------------------------

const LabelKindSchema = z
  .enum(['chat', 'channel'])
  .describe(
    'Source kind. `chat` references /me/chats (1:1, group, meeting). `channel` references /teams/{teamId}/channels/{channelId}.',
  )

const LabelSchema = z.object({
  sourceId: z
    .string()
    .describe(
      'Composite id: `chat:<chatId>` for chats, `channel:<teamId>:<channelId>` for channels. Stable across restarts; primary key of the labels table.',
    ),
  kind: LabelKindSchema,
  label: z
    .string()
    .describe(
      'Free-form tag. Conventions: "alerts" (infra/monitoring), "pr-reviews" (PR/code-review notifications), "general" (regular comms). Multiple chats may share a label — that is the join key for GET /m365/important.',
    ),
  displayName: z
    .string()
    .nullable()
    .describe(
      'Cached topic/channel name for UI (may be stale; the live chat list is authoritative).',
    ),
  notes: z.string().nullable(),
  updatedAt: z.string().nullable().describe('ISO 8601 timestamp of the last upsert'),
})

const LabelUpsertBody = z.object({
  sourceId: z
    .string()
    .min(1)
    .describe(
      'Composite id — see LabelSchema.sourceId. The dashboard builds this from chat/channel ids before POSTing.',
    ),
  kind: LabelKindSchema,
  label: z.string().min(1),
  displayName: z.string().nullish(),
  notes: z.string().nullish(),
})

const ImportantMessageSchema = z.object({
  source: z.enum(['chat', 'channel']),
  sourceId: z.string(),
  label: z.string(),
  displayName: z.string().nullable(),
  notes: z
    .string()
    .nullable()
    .describe('User-supplied notes on the labeled source (from /m365/labels)'),
  message: ImportantChatMessageSchema,
})

// --- Team roster --------------------------------------------------------

const RoleSchema = z.enum(['PO', 'EM', 'TechLead', 'UX', 'AgileCoach', 'Dev'])

const RosterMemberSchema = z.object({
  alias: z
    .string()
    .describe(
      'Stable short key (lowercase first name) — use as the canonical id when referencing a teammate across systems.',
    ),
  displayName: z
    .string()
    .nullable()
    .describe('Teams format "Last, First". null when not yet resolved.'),
  role: RoleSchema,
  self: z.boolean().optional().describe('True for the authenticated user.'),
  ms: z.object({
    userId: z
      .string()
      .nullable()
      .describe('Azure AD object id (UUID). Matches `from.user.id` on chat/channel messages.'),
  }),
  atlassian: z.object({
    accountId: z
      .string()
      .nullable()
      .describe('Jira/Confluence cloud accountId. null until resolved.'),
  }),
  gitlab: z.object({
    username: z
      .string()
      .nullable()
      .describe(
        "GitLab username (stable handle, e.g. 'johannes.krumm'). null for non-devs (PO/EM/UX/AgileCoach have no GitLab activity). Use as the canonical join key with /gitlab/merge-requests `author.username` / `assignees[].username` / `reviewers[].username`.",
      ),
  }),
})

const RepoKindSchema = z.enum(['backend', 'frontend', 'internal'])

const RepoSchema = z.object({
  alias: z.string().describe('Stable short key (e.g. "studentEnrolment") — cross-reference id'),
  purpose: z.string().describe('One-line human description of what the repo is for.'),
  kind: RepoKindSchema,
  domains: z
    .array(z.string())
    .describe('Domain tags (e.g. ["booking","profile"]) — links the repo to a feature area.'),
  gitlab: z.object({
    projectId: z
      .number()
      .int()
      .describe(
        'Numeric GitLab project id — pass straight to /gitlab/projects/{projectId}/* routes.',
      ),
    path: z.string().describe('Canonical project path (e.g. "iu-group/epos/prometheus/...").'),
    defaultBranch: z.string(),
    webUrl: z.string(),
  }),
})

const RosterSchema = z.object({
  team: z.string().describe('Team display name (e.g. "EPOS Team Prometheus").'),
  members: z.array(RosterMemberSchema),
  repos: z
    .array(RepoSchema)
    .describe(
      "Team's GitLab repos with semantic metadata (purpose, kind, domains) and the numeric projectId — agents use this to navigate from a domain/topic to the right repo without scraping URLs.",
    ),
})

const AttendeeSchema = z.object({
  name: z.string(),
  email: z.string(),
  status: z
    .string()
    .describe('accepted | declined | tentative | needsAction | organizer | unknown'),
})

const CalendarEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  start: z.string().describe('ISO 8601 timestamp (UTC) for timed events, YYYY-MM-DD for all-day'),
  end: z.string().describe('ISO 8601 timestamp (UTC) for timed events, YYYY-MM-DD for all-day'),
  isAllDay: z.boolean(),
  isOnlineMeeting: z.boolean().describe('True when Outlook flagged this as a Teams meeting'),
  location: z.string().optional(),
  organizer: z.object({ name: z.string(), email: z.string() }).optional(),
  attendees: z.array(AttendeeSchema),
  bodyPreview: z.string().describe('Plain-text body preview from Outlook (~250 chars)').optional(),
  videoLink: z.string().describe('Teams meeting joinUrl when present').optional(),
  webLink: z.string().describe('Outlook web URL for this event').optional(),
})

export const m365Routes = new Elysia({ prefix: '/m365' })
  .get(
    '/tools',
    async () => {
      const tools = await listTools()
      return { tools, count: tools.length }
    },
    {
      response: z.object({
        tools: z.array(ToolSchema),
        count: z.number().int(),
      }),
      detail: {
        tags: ['M365'],
        summary: 'List the M365 MCP meta-tool catalog',
        description:
          'Introspection endpoint — returns the three meta-tools exposed by the IU M365 MCP server (search-tools, get-tool-schema, execute-tool) that dispatch to ~270 Microsoft Graph operations. Agents do NOT call these meta-tools directly through argo; argo wraps individual operations as curated REST routes (e.g. GET /m365/calendar/upcoming). Use this endpoint only to confirm the MCP surface is reachable and tokens are valid — for actual data, use the curated routes. Returns 503 with "M365 not authenticated" when tokens are missing/expired (re-seed via `bun m365:auth:prod`).\n\nMost agents should use the curated routes — /m365/calendar/upcoming, /m365/chats, /m365/teams, /m365/important, /m365/team — instead of dispatching through this catalog. The curated routes return structured Zod-validated shapes; the meta-tools return opaque MCP payloads. Only reach for /m365/tools when the curated surface genuinely does not cover the capability.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/calendar/upcoming',
    async ({ query, set }) => {
      try {
        return await listUpcomingCalendarEvents(query.days ?? 14)
      } catch (error) {
        set.status = 503
        return error instanceof Error ? error.message : 'M365 calendar error'
      }
    },
    {
      query: z.object({
        days: z.coerce
          .number()
          .int()
          .min(1)
          .max(60)
          .default(14)
          .describe('Days window from now (default 14, max 60)')
          .optional(),
      }),
      response: { 200: z.array(CalendarEventSchema), 503: z.string() },
      detail: {
        tags: ['M365'],
        summary: 'List upcoming IU Outlook calendar events',
        description:
          'Returns events from the authenticated IU Outlook calendar within `[now, now + days)`, sorted ascending by start. Recurring series are flattened to individual occurrences. Timed events use ISO 8601 UTC timestamps for start/end; all-day events use YYYY-MM-DD. `videoLink` is the Teams meeting joinUrl when `isOnlineMeeting=true`. Use this for work calendar queries ("meetings tomorrow", "agenda this week", "my next call"). For personal/Google calendar use GET /calendar instead. Cap is 60 days; default 14. 503 with "M365 not authenticated" if tokens are missing/expired — user must re-seed via `bun m365:auth:prod`.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/teams',
    async ({ set }) => {
      try {
        const teams = await listJoinedTeams()
        return { teams }
      } catch (error) {
        set.status = 503
        return error instanceof Error ? error.message : 'M365 teams error'
      }
    },
    {
      response: { 200: z.object({ teams: z.array(TeamSchema) }), 503: z.string() },
      detail: {
        tags: ['M365'],
        summary: 'List Microsoft Teams the user is a member of',
        description:
          'Returns every Team the authenticated user belongs to. Use the returned `id` to fetch channels via GET /m365/teams/{teamId}/channels. Channels are where most "broadcast" traffic lands (infra alerts, PR notifications, team announcements) — for direct 1:1/group conversations use GET /m365/chats instead. Cap is 100 teams.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/teams/:teamId/channels',
    async ({ params, set }) => {
      try {
        const channels = await listTeamChannels(params.teamId)
        return { channels }
      } catch (error) {
        set.status = error instanceof Error && error.message.includes('404') ? 404 : 503
        return error instanceof Error ? error.message : 'M365 channels error'
      }
    },
    {
      params: z.object({
        teamId: z.string().describe('Team UUID from GET /m365/teams'),
      }),
      response: {
        200: z.object({ channels: z.array(ChannelSchema) }),
        404: z.string(),
        503: z.string(),
      },
      detail: {
        tags: ['M365'],
        summary: 'List channels in a Team',
        description:
          'Returns the channels in a given Team. Each channel has a `membershipType` (standard | private | shared) — only standard/private channels are exposed by default Graph membership. To read messages in a channel call GET /m365/teams/{teamId}/channels/{channelId}/messages. 404 if the team id is unknown or the user has no permission.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/teams/:teamId/channels/:channelId/messages',
    async ({ params, query, set }) => {
      try {
        const messages = await listChannelMessages({
          teamId: params.teamId,
          channelId: params.channelId,
          top: query.top ?? 20,
          includeSystem: query.includeSystem ?? false,
        })
        return { messages }
      } catch (error) {
        set.status = 503
        return error instanceof Error ? error.message : 'M365 channel messages error'
      }
    },
    {
      params: z.object({
        teamId: z.string(),
        channelId: z.string(),
      }),
      query: z.object({
        top: z.coerce
          .number()
          .int()
          .min(1)
          .max(50)
          .default(20)
          .describe('Number of messages to return, newest first (default 20, max 50)')
          .optional(),
        includeSystem: z.coerce
          .boolean()
          .default(false)
          .describe(
            'Include Graph system events (join/leave, meeting started/ended). Default false — these are usually noise.',
          )
          .optional(),
      }),
      response: { 200: z.object({ messages: z.array(ChatMessageSchema) }), 503: z.string() },
      detail: {
        tags: ['M365'],
        summary: 'List recent messages in a Team channel',
        description:
          "Returns the newest `top` user messages in the channel (replies are NOT included — `replyCount` indicates whether a thread has more). System events (join/leave, meeting started) are filtered by default; pass ?includeSystem=true to keep them. Sorted by createdDateTime desc. Use this to monitor 'broadcast' channels — infra alerts, PR notifications, release feeds. For direct chats use GET /m365/chats/{chatId}/messages. After labeling channels via /m365/labels you can also use GET /m365/important to fetch the latest across all labeled sources at once.",
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/chats',
    async ({ query, set }) => {
      try {
        const chats = await listChats({ top: query.top ?? 50 })
        return { chats }
      } catch (error) {
        set.status = 503
        return error instanceof Error ? error.message : 'M365 chats error'
      }
    },
    {
      query: z.object({
        top: z.coerce
          .number()
          .int()
          .min(1)
          .max(100)
          .default(50)
          .describe(
            'Number of chats to return, ordered by most-recent activity (default 50, max 100)',
          )
          .optional(),
      }),
      response: { 200: z.object({ chats: z.array(ChatSchema) }), 503: z.string() },
      detail: {
        tags: ['M365'],
        summary: 'List Teams chats (1:1, group, meeting)',
        description:
          'Returns the user\'s chats sorted by most-recent activity, with members expanded and a plain-text `lastMessagePreview` per chat. Use `chatType` to filter: `oneOnOne` for direct DMs, `group` for ad-hoc groups, `meeting` for the chat attached to a Teams meeting (these accumulate fast and are usually noise). For curated "important" feeds, label specific chat ids via POST /m365/labels and read them back with GET /m365/important. For channel traffic (infra alerts, team broadcasts) use GET /m365/teams instead.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/chats/:chatId/messages',
    async ({ params, query, set }) => {
      try {
        const messages = await listChatMessages({
          chatId: params.chatId,
          top: query.top ?? 20,
          includeSystem: query.includeSystem ?? false,
        })
        return { messages }
      } catch (error) {
        set.status = 503
        return error instanceof Error ? error.message : 'M365 chat messages error'
      }
    },
    {
      params: z.object({
        chatId: z
          .string()
          .describe('Chat id from GET /m365/chats — URL-encode the colons if hitting via curl'),
      }),
      query: z.object({
        includeSystem: z.coerce
          .boolean()
          .default(false)
          .describe(
            'Include Graph system events (join/leave, meeting started/ended). Default false — these are usually noise.',
          )
          .optional(),
        top: z.coerce
          .number()
          .int()
          .min(1)
          .max(50)
          .default(20)
          .describe('Number of messages to return, newest first (default 20, max 50)')
          .optional(),
      }),
      response: { 200: z.object({ messages: z.array(ChatMessageSchema) }), 503: z.string() },
      detail: {
        tags: ['M365'],
        summary: 'List recent messages in a chat (1:1, group, or meeting)',
        description:
          'Returns the newest `top` user messages in the chat, sorted by createdDateTime desc. System events (join/leave, meeting started/ended) are filtered by default; pass ?includeSystem=true to keep them. Bodies are exposed as both plain text (`bodyText`, HTML stripped) and original `bodyHtml` (null when the message was text-only). For channel messages use GET /m365/teams/{teamId}/channels/{channelId}/messages — the response shape is identical.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/labels',
    ({ query }) => ({
      labels: storeListLabels(query.label ? { label: query.label } : undefined),
    }),
    {
      query: z.object({
        label: z
          .string()
          .describe('Filter by exact label match (e.g. "alerts"). Omit to return everything.')
          .optional(),
      }),
      response: { 200: z.object({ labels: z.array(LabelSchema) }) },
      detail: {
        tags: ['M365'],
        summary: 'List user-curated chat/channel importance labels',
        description:
          'Returns every chat or channel the user has tagged via POST /m365/labels, optionally filtered to a single label. Backed by `apps/api/m365-labels.json` — committed to git, hand-editable, baked into the prod image at build time. Source of truth for the dashboard explorer and for GET /m365/important. Empty until the user starts labeling.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .post(
    '/labels',
    ({ body }) =>
      storeUpsertLabel({
        sourceId: body.sourceId,
        kind: body.kind,
        label: body.label,
        displayName: body.displayName ?? null,
        notes: body.notes ?? null,
      }),
    {
      body: LabelUpsertBody,
      response: { 200: LabelSchema },
      detail: {
        tags: ['M365'],
        summary: 'Upsert a chat/channel importance label',
        description:
          'Create or update a label for a chat or channel. Idempotent on `sourceId`: re-posting with a different `label`/`notes` overwrites the existing entry. Persists to `apps/api/m365-labels.json`. Use the dashboard /m365-explorer page to label interactively; agents typically read labels via GET /m365/labels rather than creating them.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .delete(
    '/labels/:sourceId',
    ({ params, set }) => {
      const ok = storeDeleteLabel(params.sourceId)
      if (!ok) {
        set.status = 404
        return 'Label not found'
      }
      return { ok: true }
    },
    {
      params: z.object({
        sourceId: z.string().describe('Composite source id from LabelSchema.sourceId'),
      }),
      response: { 200: z.object({ ok: z.boolean() }), 404: z.string() },
      detail: {
        tags: ['M365'],
        summary: 'Remove a label',
        description:
          'Delete the label for a single chat/channel. Returns 404 if no label exists for the given sourceId. To re-label, POST /m365/labels again — it upserts.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .patch(
    '/tags/:tag',
    ({ params, body, set }) => {
      const renamed = storeRenameTag(params.tag, body.to)
      if (renamed === 0) {
        set.status = 404
        return 'Tag not found'
      }
      return { updated: renamed }
    },
    {
      params: z.object({
        tag: z.string().describe('Current tag name (URL-encode if it contains punctuation)'),
      }),
      body: z.object({
        to: z
          .string()
          .min(1)
          .describe('New tag name. Every source carrying the old tag is rewritten.'),
      }),
      response: { 200: z.object({ updated: z.number().int() }), 404: z.string() },
      detail: {
        tags: ['M365'],
        summary: 'Rename a tag across all labeled sources',
        description:
          'Bulk rename: every entry in apps/api/m365-labels.json carrying `tag` switches to `body.to`. Returns the number of records updated. 404 if no source currently uses `tag`. Idempotent on no-op renames (same `tag` → `to`).',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .delete(
    '/tags/:tag',
    ({ params, set }) => {
      const removed = storeDeleteTag(params.tag)
      if (removed === 0) {
        set.status = 404
        return 'Tag not found'
      }
      return { removed }
    },
    {
      params: z.object({
        tag: z.string().describe('Tag name to drop (URL-encode if it contains punctuation)'),
      }),
      response: { 200: z.object({ removed: z.number().int() }), 404: z.string() },
      detail: {
        tags: ['M365'],
        summary: 'Delete a tag (cascades to all labeled sources)',
        description:
          'Bulk delete: every entry tagged `tag` is removed from the labels store. Returns the number of records dropped. 404 if no source currently uses `tag`. For deleting a single source while keeping its tag elsewhere, use DELETE /m365/labels/{sourceId} instead.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/important',
    async ({ query, set }) => {
      try {
        const rows = storeListLabels(query.label ? { label: query.label } : undefined)
        const top = query.top ?? 5
        const includeSystem = query.includeSystem ?? false
        const tasks = rows.map(async (row) => {
          let messages: M365ChatMessage[] = []
          try {
            if (row.kind === 'chat') {
              const chatId = row.sourceId.replace(/^chat:/, '')
              messages = await listChatMessages({ chatId, top, includeSystem })
            } else if (row.kind === 'channel') {
              const [, teamId, channelId] = row.sourceId.split(':')
              if (teamId && channelId) {
                messages = await listChannelMessages({ teamId, channelId, top, includeSystem })
              }
            }
          } catch {
            // Soft-fail per source — one revoked/missing chat shouldn't sink the whole feed.
            messages = []
          }
          return messages.map((m) => ({
            source: row.kind,
            sourceId: row.sourceId,
            label: row.label,
            displayName: row.displayName,
            notes: row.notes,
            // Drop bodyHtml from the merged feed — it's the heaviest field and
            // agents work off bodyText. Keep the full payload on the
            // single-source endpoints for callers that need rendering.
            message: {
              id: m.id,
              createdAt: m.createdAt,
              lastModifiedAt: m.lastModifiedAt,
              from: m.from,
              subject: m.subject,
              importance: m.importance,
              bodyText: m.bodyText,
              webUrl: m.webUrl,
              attachments: m.attachments,
              replyCount: m.replyCount,
              isSystem: m.isSystem,
            },
          }))
        })
        const grouped = await Promise.all(tasks)
        const merged = grouped.flat()
        const sorted = merged.toSorted((a, b) =>
          (b.message.createdAt ?? '').localeCompare(a.message.createdAt ?? ''),
        )
        return { messages: sorted.slice(0, query.limit ?? 100) }
      } catch (error) {
        set.status = 503
        return error instanceof Error ? error.message : 'M365 important feed error'
      }
    },
    {
      query: z.object({
        label: z
          .string()
          .describe('Restrict to a single label (e.g. "alerts"). Omit to merge across all labels.')
          .optional(),
        top: z.coerce
          .number()
          .int()
          .min(1)
          .max(20)
          .default(5)
          .describe(
            'Per-source message budget — how many messages to pull from each labeled chat/channel (default 5, max 20)',
          )
          .optional(),
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(200)
          .default(100)
          .describe('Final cap on the merged feed (default 100, max 200)')
          .optional(),
        includeSystem: z.coerce
          .boolean()
          .default(false)
          .describe('Include Graph system events. Default false — keeps the feed agent-friendly.')
          .optional(),
      }),
      response: {
        200: z.object({ messages: z.array(ImportantMessageSchema) }),
        503: z.string(),
      },
      detail: {
        tags: ['M365'],
        summary: 'Unified message feed across user-labeled chats/channels',
        description:
          'Curated alternative to walking /m365/chats and /m365/teams: fetches the latest `top` user messages from every chat/channel labeled via POST /m365/labels, merges them, returns them sorted by createdAt desc. System events (join/leave, meeting events) are filtered by default; pass ?includeSystem=true to keep them. Payload is intentionally slim — `bodyHtml` is omitted (use the single-source endpoints if you need HTML). Each entry carries `source` + `sourceId` + `label` + the user-supplied `notes` so callers can route + decide by category and intent. Use `?label=alerts` to scope. Empty until labels exist. One revoked chat soft-fails — the rest of the feed still returns.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get('/team', () => readTeam(), {
    response: { 200: RosterSchema },
    detail: {
      tags: ['M365'],
      summary: 'Team roster + repo registry (cross-system identities and repos)',
      description:
        "Returns the user's team in two parts: (1) `members` — who plays which role (PO/EM/TechLead/UX/AgileCoach/Dev) plus the opaque platform IDs that link a person across Microsoft 365 (`ms.userId`), Atlassian (`atlassian.accountId`), and GitLab (`gitlab.username`); (2) `repos` — the team's GitLab repos with `alias`, `purpose`, `kind` (backend/frontend/internal), `domains` (e.g. ['booking','profile']), and the numeric `gitlab.projectId` ready to pass into /gitlab/projects/{projectId}/* routes. Source of truth: `apps/api/m365-team.json`, committed to git, hand-editable. Agents use this to translate a Teams message author into the same person's Jira tickets or GitLab MRs, or to find which repo owns a given domain. Intentionally PII-light — no emails. `alias` is the stable canonical id for cross-referencing.",
      security: [{ BearerAuth: [] }],
    },
  })
  .post(
    '/seed',
    ({ body }) => {
      seedTokens(body)
      return { ok: true }
    },
    {
      body: SeedBody,
      response: z.object({ ok: z.boolean() }),
      detail: {
        tags: ['M365'],
        summary: 'INTERNAL — bootstrap script only. Do not call from agents.',
        description:
          'INTERNAL endpoint used by the laptop bootstrap script (`bun m365:auth:prod`, runs apps/api/scripts/m365-bootstrap.ts) to install OAuth tokens after a manual SSO flow. Agents must NEVER call this — it expects raw OAuth grant payloads (clientId, access + refresh tokens, expiry, scope) that only the bootstrap script produces. Writes to /app/data/oauth-tokens.json. Required because the IU AAD app\'s redirect-URI allow-list only includes the MCP-inspector callback (localhost:6274), so the SSO dance happens on a laptop and the result is shipped here. When /m365/* routes return 503 "M365 not authenticated", the human user re-runs the bootstrap script — agents do not orchestrate this.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
