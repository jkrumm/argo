import { Elysia } from 'elysia'
import { bearer } from '@elysiajs/bearer'
import { z } from 'zod'
import { env } from '../env.js'
import { listTools, seedTokens } from '../clients/m365.js'

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

// Self-contained bearer guard at the plugin level — argo's outer authGuard
// doesn't reliably propagate to sibling instances mounted after it. We
// duplicate the check here because /m365/seed is a WRITE endpoint that
// affects token state and must not be reachable without API_SECRET.
export const m365Routes = new Elysia({ prefix: '/m365' })
  .use(bearer())
  .onBeforeHandle(({ bearer: token, set }) => {
    if (!token || token !== env.API_SECRET) {
      set.status = 401
      return 'Unauthorized'
    }
  })
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
        summary: 'Discover available M365 MCP tools',
        description:
          'Calls tools/list on the IU Microsoft 365 MCP server (a Microsoft Graph wrapper covering Outlook calendar, mail, Teams chats/channels/messages, OneDrive, OneNote, etc.) and returns each tool definition with its JSON-Schema input shape. Phase 1 discovery endpoint — used to plan which tools to wrap as first-class REST endpoints (calendar, channel messages, mail). Requires that /oauth/m365/init has been completed once (or /m365/seed has been used to ship tokens from a laptop bootstrap).',
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
        summary: 'Seed M365 tokens from a laptop bootstrap',
        description:
          'Writes a full M365 OAuth grant (clientId, access + refresh tokens, expiry, scope) into the persistent token store. Companion to apps/api/scripts/m365-bootstrap.ts, which runs the IU SSO dance on a laptop against an AAD-allowed redirect URI (MCP inspector default localhost:6274) and POSTs the result here. This avoids needing the VPS to host a browser-reachable callback URI when the AAD app does not allow our argo.jkrumm.com callback. Bearer-auth gated — API_SECRET required.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
