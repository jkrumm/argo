import { Elysia } from 'elysia'
import { z } from 'zod'
import { listTools, seedTokens, listUpcomingCalendarEvents } from '../clients/m365.js'

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
          'Introspection endpoint — returns the three meta-tools exposed by the IU M365 MCP server (search-tools, get-tool-schema, execute-tool) that dispatch to ~270 Microsoft Graph operations. Agents do NOT call these meta-tools directly through argo; argo wraps individual operations as curated REST routes (e.g. GET /m365/calendar/upcoming). Use this endpoint only to confirm the MCP surface is reachable and tokens are valid — for actual data, use the curated routes. Returns 503 with "M365 not authenticated" when tokens are missing/expired (re-seed via `bun m365:auth:prod`).',
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
        summary: 'Seed M365 OAuth tokens (internal — bootstrap script only)',
        description:
          'INTERNAL — agents should NOT call this. Token-install endpoint used exclusively by the laptop bootstrap script (`bun m365:auth:prod`, runs apps/api/scripts/m365-bootstrap.ts). Writes a full OAuth grant (clientId, access + refresh tokens, expiry, scope) to /app/data/oauth-tokens.json. Required because the IU AAD app\'s redirect-URI allow-list only includes the MCP-inspector callback (localhost:6274), so the SSO dance happens on a laptop and the result is shipped here. When /m365/* routes return 503 "M365 not authenticated", the user re-runs the bootstrap script — agents do not orchestrate this.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
