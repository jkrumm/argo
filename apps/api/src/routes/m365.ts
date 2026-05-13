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
          'Calls tools/list on the IU Microsoft 365 MCP server. The server exposes 3 meta-tools (search-tools, get-tool-schema, execute-tool) that dispatch to ~270 underlying Microsoft Graph operations (calendar, mail, Teams, OneDrive, OneNote, etc.). Requires prior seeding via `bun m365:auth` (local) or `bun m365:auth:prod` (prod). Returns "M365 not authenticated" if no tokens are present — re-run the bootstrap to reseed.',
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
          "Writes a full M365 OAuth grant (clientId, access + refresh tokens, expiry, scope) into the persistent token store under the `m365` key in /app/data/oauth-tokens.json. Canonical way to install or replace tokens on this argo instance — the IU AAD app only allows the MCP-inspector callback (localhost:6274), so the SSO dance has to happen on a laptop and the result has to be shipped here. Companion: apps/api/scripts/m365-bootstrap.ts, invoked via `bun m365:auth:prod` from the repo root (op-injected API_SECRET). When tokens expire / are revoked / disappear, /m365/* routes return 'M365 not authenticated' — re-run the same `bun m365:auth:prod` command to reseed. Bearer-auth gated.",
        security: [{ BearerAuth: [] }],
      },
    },
  )
