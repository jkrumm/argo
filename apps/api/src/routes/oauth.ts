import { Elysia } from 'elysia'
import { z } from 'zod'
import { getAuthUrl, exchangeCode } from '../clients/google.js'
import { getAuthUrl as getM365AuthUrl, exchangeCode as exchangeM365Code } from '../clients/m365.js'

export const oauthRoutes = new Elysia({ prefix: '/oauth' })
  .get('/google/init', ({ redirect }) => redirect(getAuthUrl()), {
    detail: {
      tags: ['System'],
      summary: 'Initiate Google OAuth',
      description:
        'Redirects browser to Google consent screen. Visit in a browser to grant Gmail and Calendar read access. No auth required.',
      security: [],
    },
  })
  .get(
    '/google/callback',
    async ({ query, set }) => {
      if (query.error) {
        set.status = 400
        return `OAuth error: ${query.error}`
      }
      if (!query.code) {
        set.status = 400
        return 'Missing code parameter'
      }
      try {
        await exchangeCode(query.code)
        return 'Google OAuth successful — tokens saved. You can close this tab.'
      } catch (error) {
        set.status = 500
        return error instanceof Error ? error.message : 'Token exchange failed'
      }
    },
    {
      query: z.object({
        code: z.string().optional(),
        error: z.string().optional(),
        scope: z.string().optional(),
      }),
      response: { 200: z.string(), 400: z.string(), 500: z.string() },
      detail: {
        tags: ['System'],
        summary: 'Google OAuth callback',
        description:
          'Exchanges authorization code for access + refresh tokens and saves them to disk. Called automatically by Google after user consent. No auth required.',
        security: [],
      },
    },
  )
  .get(
    '/m365/init',
    async ({ redirect }) => {
      const url = await getM365AuthUrl()
      return redirect(url)
    },
    {
      detail: {
        tags: ['System'],
        summary: 'Initiate IU M365 OAuth (currently inactive — see /m365/seed)',
        description:
          "Redirects browser to the IU Microsoft 365 MCP consent screen with argo's own callback URL. NON-FUNCTIONAL at present: the upstream Azure AD application's redirect-URI allow-list does not include argo.jkrumm.com or localhost:4000, so the flow fails with AADSTS50011 after IU SSO. Kept as a future-proof entry point in case IT adds our callbacks to the AAD app. Until then, install tokens via the laptop bootstrap script: `bun m365:auth` (local) / `bun m365:auth:prod` (prod) — see /m365/seed and apps/api/scripts/m365-bootstrap.ts.",
        security: [],
      },
    },
  )
  .get(
    '/m365/callback',
    async ({ query, set }) => {
      if (query.error) {
        set.status = 400
        return `OAuth error: ${query.error}${query.error_description ? ` — ${query.error_description}` : ''}`
      }
      if (!query.code || !query.state) {
        set.status = 400
        return 'Missing code or state parameter'
      }
      try {
        await exchangeM365Code(query.code, query.state)
        return 'M365 OAuth successful — tokens saved. You can close this tab.'
      } catch (error) {
        set.status = 500
        return error instanceof Error ? error.message : 'Token exchange failed'
      }
    },
    {
      query: z.object({
        code: z.string().optional(),
        state: z.string().optional(),
        error: z.string().optional(),
        error_description: z.string().optional(),
      }),
      response: { 200: z.string(), 400: z.string(), 500: z.string() },
      detail: {
        tags: ['System'],
        summary: 'IU M365 OAuth callback',
        description:
          'Exchanges authorization code + PKCE verifier for access + refresh tokens against the IU MCP server and persists them under the m365 key in oauth-tokens.json. Called automatically by the MCP server after user consent. Validates the CSRF state parameter against an in-memory pending-auth map. No auth required.',
        security: [],
      },
    },
  )
