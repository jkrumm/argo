import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  listChannels,
  getMessages,
  getThread,
  searchMessages,
  listUsers,
  sendMessage,
  getUnreads,
} from '../clients/slack.js'

// ─── Schemas ────────────────────────────────────────────────────────────────

const SlackChannelSchema = z.object({
  id: z.string().describe('Slack channel ID (e.g. C01ABC123)'),
  name: z.string().describe('Channel name or "DM: Display Name" for DMs'),
  is_channel: z.boolean(),
  is_group: z.boolean(),
  is_im: z.boolean().describe('Direct message'),
  is_mpim: z.boolean().describe('Multi-party direct message'),
  is_private: z.boolean(),
  is_archived: z.boolean(),
  topic: z.string(),
  purpose: z.string(),
  num_members: z.number(),
  updated: z.number().describe('Unix timestamp of last activity'),
})

const SlackUserSchema = z.object({
  id: z.string().describe('Slack user ID (e.g. U01ABC123)'),
  name: z.string().describe('Slack username'),
  real_name: z.string(),
  display_name: z.string(),
  is_bot: z.boolean(),
  is_app_user: z.boolean(),
  avatar: z.string().describe('URL to 48x48 avatar image'),
})

const FileSchema = z.object({
  name: z.string(),
  mimetype: z.string(),
  url_private: z.string().describe('Authenticated URL to the file'),
})

const ReactionSchema = z.object({
  name: z.string().describe('Emoji name (without colons)'),
  count: z.number(),
})

const SlackMessageSchema = z.object({
  ts: z.string().describe('Message timestamp (unique ID within channel)'),
  user: z.string().describe('User ID or bot ID of the sender'),
  text: z.string().describe('Message text (may contain Slack mrkdwn formatting)'),
  type: z.string(),
  thread_ts: z.string().nullable().describe('Parent thread timestamp, null if not in a thread'),
  reply_count: z.number().nullable().describe('Number of replies if this is a thread parent'),
  reply_users_count: z.number().nullable().describe('Number of unique users in thread'),
  reactions: z.array(ReactionSchema).nullable(),
  files: z.array(FileSchema).nullable(),
  edited: z.boolean(),
})

const PaginatedMessagesSchema = z.object({
  messages: z.array(SlackMessageSchema),
  has_more: z.boolean().describe('Whether more messages are available'),
  next_cursor: z.string().nullable().describe('Cursor for next page, null if no more'),
})

const SearchResultSchema = z.object({
  matches: z.array(
    z.object({
      channel: z.string().describe('Channel ID'),
      channel_name: z.string(),
      messages: z.array(SlackMessageSchema),
      total: z.number(),
    }),
  ),
  total: z.number().describe('Total matches across all channels'),
  page: z.number(),
  pages: z.number().describe('Total pages available'),
})

const UnreadSchema = z.object({
  channel_id: z.string(),
  channel_name: z.string(),
  unread_count: z.number(),
  latest_message: SlackMessageSchema.nullable().describe(
    'Latest message (only for top 10 channels by unread count)',
  ),
})

const SendMessageBodySchema = z.object({
  text: z.string().describe('Message text (supports Slack mrkdwn)'),
  unfurl_links: z.boolean().describe('Whether to unfurl URLs. Default: true').optional(),
})

const SendMessageResponseSchema = z.object({
  ts: z.string().describe('Timestamp of the sent message'),
  channel: z.string().describe('Channel the message was sent to'),
})

// ─── Routes ─────────────────────────────────────────────────────────────────

export const slackRoutes = new Elysia({ prefix: '/slack' })

  // ── Channels ────────────────────────────────────────────────────────────

  .get(
    '/channels',
    async ({ query }) => {
      return listChannels({
        ...(query.types !== undefined ? { types: query.types } : {}),
        exclude_archived: query.exclude_archived !== 'false',
        ...(query.limit ? { limit: Number(query.limit) } : {}),
      })
    },
    {
      query: z.object({
        types: z
          .string()
          .describe('Comma-separated: public_channel,private_channel,mpim,im. Default: all types')
          .optional(),
        exclude_archived: z.string().describe('"true" or "false". Default: true').optional(),
        limit: z.string().describe('Max channels to return. Default: 500').optional(),
      }),
      response: z.array(SlackChannelSchema),
      detail: {
        tags: ['Productivity'],
        summary: 'List all accessible channels, groups, DMs',
        description:
          "Returns all conversations the user has access to — public channels, private channels, group DMs, and direct messages. DMs show the other user's display name.",
        security: [{ BearerAuth: [] }],
      },
    },
  )

  // ── Messages ────────────────────────────────────────────────────────────

  .get(
    '/channels/:channelId/messages',
    async ({ params, query }) => {
      return getMessages(params.channelId, {
        ...(query.limit ? { limit: Number(query.limit) } : {}),
        ...(query.oldest !== undefined ? { oldest: query.oldest } : {}),
        ...(query.latest !== undefined ? { latest: query.latest } : {}),
        ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
      })
    },
    {
      params: z.object({
        channelId: z.string().describe('Slack channel ID'),
      }),
      query: z.object({
        limit: z.string().describe('Messages per page (max 100). Default: 50').optional(),
        oldest: z.string().describe('Unix timestamp — only messages after this').optional(),
        latest: z.string().describe('Unix timestamp — only messages before this').optional(),
        cursor: z.string().describe('Pagination cursor from previous response').optional(),
      }),
      response: PaginatedMessagesSchema,
      detail: {
        tags: ['Productivity'],
        summary: 'Get message history for a channel',
        description:
          'Returns messages in reverse chronological order (newest first). Use oldest/latest for time ranges, cursor for pagination.',
        security: [{ BearerAuth: [] }],
      },
    },
  )

  // ── Thread ──────────────────────────────────────────────────────────────

  .get(
    '/channels/:channelId/messages/:threadTs/thread',
    async ({ params, query }) => {
      return getThread(params.channelId, params.threadTs, {
        ...(query.limit ? { limit: Number(query.limit) } : {}),
        ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
      })
    },
    {
      params: z.object({
        channelId: z.string().describe('Slack channel ID'),
        threadTs: z.string().describe('Thread parent message timestamp'),
      }),
      query: z.object({
        limit: z.string().describe('Messages per page (max 200). Default: 100').optional(),
        cursor: z.string().describe('Pagination cursor').optional(),
      }),
      response: PaginatedMessagesSchema,
      detail: {
        tags: ['Productivity'],
        summary: 'Get all replies in a thread',
        description: 'Returns the parent message plus all replies in chronological order.',
        security: [{ BearerAuth: [] }],
      },
    },
  )

  // ── Search ──────────────────────────────────────────────────────────────

  .get(
    '/search',
    async ({ query }) => {
      return searchMessages(query.q, {
        ...(query.sort ? { sort: query.sort as 'score' | 'timestamp' } : {}),
        ...(query.sortDir ? { sort_dir: query.sortDir as 'asc' | 'desc' } : {}),
        ...(query.count ? { count: Number(query.count) } : {}),
        ...(query.page ? { page: Number(query.page) } : {}),
      })
    },
    {
      query: z.object({
        q: z
          .string()
          .describe('Search query (supports Slack search syntax: in:#channel, from:@user, etc.)'),
        sort: z.string().describe('"score" or "timestamp". Default: timestamp').optional(),
        sortDir: z.string().describe('"asc" or "desc". Default: desc').optional(),
        count: z.string().describe('Results per page. Default: 20').optional(),
        page: z.string().describe('Page number (1-based). Default: 1').optional(),
      }),
      response: SearchResultSchema,
      detail: {
        tags: ['Productivity'],
        summary: 'Search messages across all channels',
        description:
          'Full-text search across all accessible messages. Supports Slack search operators: in:#channel, from:@user, has:link, before:2024-01-01, after:2024-01-01, etc.',
        security: [{ BearerAuth: [] }],
      },
    },
  )

  // ── Users ───────────────────────────────────────────────────────────────

  .get(
    '/users',
    async () => {
      return listUsers()
    },
    {
      response: z.array(SlackUserSchema),
      detail: {
        tags: ['Productivity'],
        summary: 'List all workspace users',
        description:
          'Returns all users in the workspace (cached for 5 minutes). Useful for resolving user IDs in messages to display names.',
        security: [{ BearerAuth: [] }],
      },
    },
  )

  // ── Unreads ─────────────────────────────────────────────────────────────

  .get(
    '/unreads',
    async () => {
      return getUnreads()
    },
    {
      response: z.array(UnreadSchema),
      detail: {
        tags: ['Productivity'],
        summary: 'Get channels with unread messages',
        description:
          'Returns all channels with unread messages, sorted by unread count descending. The latest message is included for the top 10 channels.',
        security: [{ BearerAuth: [] }],
      },
    },
  )

  // ── Send Message ────────────────────────────────────────────────────────

  .post(
    '/channels/:channelId/messages',
    async ({ params, body }) => {
      return sendMessage(
        params.channelId,
        body.text,
        body.unfurl_links !== undefined ? { unfurl_links: body.unfurl_links } : undefined,
      )
    },
    {
      params: z.object({
        channelId: z.string().describe('Slack channel ID'),
      }),
      body: SendMessageBodySchema,
      response: SendMessageResponseSchema,
      detail: {
        tags: ['Productivity'],
        summary: 'Send a message to a channel',
        description:
          'Posts a new top-level message to the channel. `text` supports Slack mrkdwn (bold *foo*, italic _foo_, code `foo`, link <url|label>). To reply inside a thread use POST /slack/channels/{channelId}/messages/{threadTs}/reply instead. `unfurl_links` defaults to true on the Slack side.',
        security: [{ BearerAuth: [] }],
      },
    },
  )

  // ── Reply to Thread ─────────────────────────────────────────────────────

  .post(
    '/channels/:channelId/messages/:threadTs/reply',
    async ({ params, body }) => {
      return sendMessage(params.channelId, body.text, {
        thread_ts: params.threadTs,
        ...(body.unfurl_links !== undefined ? { unfurl_links: body.unfurl_links } : undefined),
      })
    },
    {
      params: z.object({
        channelId: z.string().describe('Slack channel ID'),
        threadTs: z.string().describe('Thread parent message timestamp'),
      }),
      body: SendMessageBodySchema,
      response: SendMessageResponseSchema,
      detail: {
        tags: ['Productivity'],
        summary: 'Reply to a thread',
        description: 'Sends a message as a reply in the specified thread.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
