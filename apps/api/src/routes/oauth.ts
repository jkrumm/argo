import { Elysia } from 'elysia'
import { z } from 'zod'
import { getAuthUrl, exchangeCode } from '../clients/google.js'

export const oauthRoutes = new Elysia({ prefix: '/oauth' })
  .get('/google/init', ({ redirect }) => redirect(getAuthUrl()), {
    detail: {
      tags: ['OAuth'],
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
        tags: ['OAuth'],
        summary: 'Google OAuth callback',
        description:
          'Exchanges authorization code for access + refresh tokens and saves them to disk. Called automatically by Google after user consent. No auth required.',
        security: [],
      },
    },
  )
