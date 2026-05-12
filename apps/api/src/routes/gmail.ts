import { Elysia } from 'elysia'
import { z } from 'zod'
import { listEmails, getEmail } from '../clients/google.js'

const AddressSchema = z.object({
  name: z.string().describe('Display name'),
  email: z.string().describe('Email address'),
})

const AttachmentSchema = z.object({
  filename: z.string(),
  mimeType: z.string(),
  size: z.number().describe('Size in bytes'),
})

const EmailListItemSchema = z.object({
  id: z.string().describe('Gmail message ID'),
  subject: z.string(),
  from: AddressSchema,
  to: z.array(AddressSchema),
  date: z.string().describe('RFC 2822 date string'),
  snippet: z.string().describe('200-char preview'),
  isRead: z.boolean(),
  labels: z.array(z.string()).describe('Gmail label IDs'),
  hasAttachments: z.boolean(),
})

const EmailDetailSchema = z.object({
  id: z.string(),
  subject: z.string(),
  from: AddressSchema,
  to: z.array(AddressSchema),
  date: z.string(),
  snippet: z.string(),
  isRead: z.boolean(),
  labels: z.array(z.string()),
  hasAttachments: z.boolean(),
  body: z.string().describe('Decoded plaintext body (HTML stripped as fallback)'),
  attachments: z.array(AttachmentSchema),
})

export const gmailRoutes = new Elysia({ prefix: '/gmail' })
  .get(
    '/emails',
    async ({ query, set }) => {
      try {
        return await listEmails({
          ...(query.days ? { days: Number(query.days) } : {}),
          ...(query.maxResults ? { maxResults: Number(query.maxResults) } : {}),
          ...(query.query !== undefined ? { query: query.query } : {}),
          ...(query.label !== undefined ? { label: query.label } : {}),
          unread: query.unread === 'true',
          important: query.important === 'true',
          starred: query.starred === 'true',
          ...(query.excludeCategories
            ? { excludeCategories: query.excludeCategories.split(',').map((s) => s.trim()) }
            : {}),
          ...(query.scope === 'all' || query.scope === 'inbox' ? { scope: query.scope } : {}),
        })
      } catch (error) {
        set.status = 503
        return error instanceof Error ? error.message : 'Google API error'
      }
    },
    {
      query: z.object({
        days: z.string().describe('Days back to search (default: 7)').optional(),
        maxResults: z.string().describe('Max emails returned (default: 50)').optional(),
        query: z
          .string()
          .describe(
            "Free-text Gmail search string. Supports full Gmail query syntax e.g. 'from:boss@work.com' or 'subject:invoice'",
          )
          .optional(),
        label: z
          .string()
          .describe(
            'Filter by Gmail label name. System labels: STARRED, IMPORTANT, SENT, DRAFT. Category labels: CATEGORY_PERSONAL, CATEGORY_UPDATES, CATEGORY_SOCIAL, CATEGORY_FORUMS, CATEGORY_PROMOTIONS.',
          )
          .optional(),
        unread: z.string().describe("Set to 'true' to return only unread emails").optional(),
        important: z
          .string()
          .describe("Set to 'true' to return only emails marked important by Gmail")
          .optional(),
        starred: z.string().describe("Set to 'true' to return only starred emails").optional(),
        excludeCategories: z
          .string()
          .describe(
            'Comma-separated Gmail categories to exclude in addition to the defaults (spam, promotions, forums). Options: personal, social, updates',
          )
          .optional(),
        scope: z
          .string()
          .describe(
            "Search scope: 'inbox' (default, active inbox only) or 'all' (entire mailbox including archived). Defaults to 'all' when label is set, since user-labeled emails are often archived.",
          )
          .optional(),
      }),
      response: { 200: z.array(EmailListItemSchema), 503: z.string() },
      detail: {
        tags: ['Productivity'],
        summary: 'List emails',
        description:
          "Returns inbox emails. Spam, promotions, and forums are excluded by default. Labels are resolved to human-readable names (e.g. 'Rechnungen' instead of 'Label_25'). Supports label filters, read/starred/important flags, and full Gmail query syntax.",
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/emails/:id',
    async ({ params: { id }, set }) => {
      try {
        return await getEmail(id)
      } catch (error) {
        set.status = 404
        return error instanceof Error ? error.message : 'Email not found'
      }
    },
    {
      params: z.object({ id: z.string().describe('Gmail message ID') }),
      response: { 200: EmailDetailSchema, 404: z.string() },
      detail: {
        tags: ['Productivity'],
        summary: 'Get email detail',
        description:
          'Returns full email with decoded body (plaintext preferred, HTML stripped as fallback) and attachment metadata.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
