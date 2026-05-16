import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  getPage,
  getPageChildren,
  getRecentlyUpdated,
  listSpaces,
  searchByCql,
} from '../clients/confluence.js'

// --- Shared response schemas ----------------------------------------------

const SpaceSchema = z.object({
  id: z
    .string()
    .describe('Numeric string — pass to /atlassian/confluence/recently-updated?spaceId='),
  key: z.string().describe('Human-friendly space key (e.g. "EP", "TECH")'),
  name: z.string(),
  type: z.string().describe('e.g. "global", "personal", "collaboration", "knowledge_base"'),
  url: z.string().describe('Browse URL — open this in a browser for the space home'),
  homepageId: z.string().nullable().describe('Page id of the space home; null if unset'),
  description: z.string().nullable().describe('Plain-text description, may be null'),
})

const PageSummarySchema = z.object({
  id: z.string().describe('Numeric page id — pass to /atlassian/confluence/pages/{id}'),
  title: z.string(),
  spaceId: z.string(),
  parentId: z.string().nullable().describe('null for top-level pages'),
  status: z.string().describe('e.g. "current", "draft", "archived"'),
  url: z.string().describe('Browse URL — open this in a browser for the rendered page'),
  createdAt: z.string().describe('ISO 8601 timestamp'),
  version: z.number().int().describe('Monotonic version counter (1 on first publish)'),
})

const PageSchema = PageSummarySchema.extend({
  body: z
    .object({
      format: z
        .enum(['view', 'storage', 'atlas_doc_format'])
        .describe(
          'view = rendered HTML (easiest for agents to read); storage = XHTML source; atlas_doc_format = structured ADF JSON-as-string',
        ),
      value: z.string(),
    })
    .nullable()
    .describe('null when the requested body format is unavailable for this page'),
  authorId: z.string().nullable(),
  ownerId: z.string().nullable(),
})

const SearchResultSchema = z.object({
  id: z
    .string()
    .describe(
      'Content id of the matched page/blogpost/comment (may be empty for non-content hits)',
    ),
  title: z.string(),
  type: z.string().describe('e.g. "page", "blogpost", "comment", "attachment"'),
  url: z.string().describe('Browse URL pointing at the match'),
  spaceKey: z.string().nullable(),
  spaceName: z.string().nullable(),
  excerpt: z.string().describe('Snippet around the match with highlight markers stripped'),
  lastModified: z.string().nullable().describe('ISO 8601 timestamp or null'),
})

// --- Plugin ---------------------------------------------------------------

export const confluenceRoutes = new Elysia({ prefix: '/atlassian/confluence' })
  .get(
    '/spaces',
    async ({ query, set }) => {
      try {
        return await listSpaces({
          limit: query.limit ?? 50,
          ...(query.type ? { type: query.type } : {}),
        })
      } catch (error) {
        set.status = 503
        return error instanceof Error ? error.message : 'Confluence error'
      }
    },
    {
      query: z.object({
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(250)
          .default(50)
          .describe('Max spaces to return (default 50, max 250)')
          .optional(),
        type: z
          .enum(['global', 'personal', 'collaboration', 'knowledge_base'])
          .describe('Filter by space type. Omit to include all types.')
          .optional(),
      }),
      response: { 200: z.object({ spaces: z.array(SpaceSchema) }), 503: z.string() },
      detail: {
        tags: ['Atlassian'],
        summary: 'List Confluence spaces the user can access',
        description:
          "Returns the spaces visible to the Atlassian token's user, with their numeric id (use as spaceId on other routes), human-friendly key, and browse URL. Use this for discovery — agents typically need a space id before they can scope /recently-updated or build a CQL filter like `space = TECH`. For full-text search across all spaces use GET /atlassian/confluence/search.",
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/search',
    async ({ query, set }) => {
      try {
        return await searchByCql({
          cql: query.cql,
          limit: query.limit ?? 25,
          start: query.start ?? 0,
        })
      } catch (error) {
        set.status = 503
        return error instanceof Error ? error.message : 'Confluence error'
      }
    },
    {
      query: z.object({
        cql: z
          .string()
          .min(1)
          .describe(
            'Raw CQL expression. Examples: `text ~ "rollout" AND space = TECH`, `type = page AND lastmodified >= "-7d"`, `title ~ "runbook"`. Read-only — write operations are not supported. CQL reference: https://developer.atlassian.com/cloud/confluence/advanced-searching-using-cql/',
          ),
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(100)
          .default(25)
          .describe('Page size (default 25, max 100)')
          .optional(),
        start: z.coerce
          .number()
          .int()
          .min(0)
          .default(0)
          .describe('Zero-based offset for pagination')
          .optional(),
      }),
      response: {
        200: z.object({
          results: z.array(SearchResultSchema),
          start: z.number().int(),
          limit: z.number().int(),
          totalSize: z.number().int().describe('Total matches across all pages'),
          isLast: z.boolean().describe('true when no more pages remain'),
        }),
        503: z.string(),
      },
      detail: {
        tags: ['Atlassian'],
        summary: 'Run a CQL search across Confluence content',
        description:
          'Full-text + structured Confluence search via the v1 CQL endpoint (`/wiki/rest/api/search`). Use this for any "find a page" question — title match, body match, restrict by space, restrict by date. Hits return id + url + excerpt; to read the full body for a hit follow up with GET /atlassian/confluence/pages/{id}. For a flat "what changed recently in space X" feed use GET /atlassian/confluence/recently-updated which is cheaper than `lastmodified >= "-7d"` CQL.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/pages/:id',
    async ({ params, query, set }) => {
      try {
        return await getPage(params.id, {
          bodyFormat: query.bodyFormat ?? 'view',
        })
      } catch (error) {
        set.status = error instanceof Error && error.message.includes('404') ? 404 : 503
        return error instanceof Error ? error.message : 'Confluence error'
      }
    },
    {
      params: z.object({
        id: z
          .string()
          .describe(
            'Numeric page id (string) — from /search or /spaces (homepageId) or /pages/{id}/children',
          ),
      }),
      query: z.object({
        bodyFormat: z
          .enum(['view', 'storage', 'atlas_doc_format'])
          .default('view')
          .describe(
            'Body representation: view = rendered HTML (easiest for agents), storage = XHTML source, atlas_doc_format = structured ADF as a JSON string. Default `view`.',
          )
          .optional(),
      }),
      response: { 200: PageSchema, 404: z.string(), 503: z.string() },
      detail: {
        tags: ['Atlassian'],
        summary: 'Fetch a Confluence page (with body) by id',
        description:
          'Returns full page metadata plus the body in the requested format. Default `view` is rendered HTML — preferred for agents that just need to read the content. Use `storage` if you need editable XHTML source, `atlas_doc_format` for structured ADF. To list child pages call /atlassian/confluence/pages/{id}/children. To search rather than navigate use /atlassian/confluence/search. 404 if the id is unknown or the user has no permission.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/pages/:id/children',
    async ({ params, query, set }) => {
      try {
        return await getPageChildren(params.id, { limit: query.limit ?? 50 })
      } catch (error) {
        set.status = error instanceof Error && error.message.includes('404') ? 404 : 503
        return error instanceof Error ? error.message : 'Confluence error'
      }
    },
    {
      params: z.object({
        id: z
          .string()
          .describe(
            'Parent page id — start from a space homepage (Space.homepageId) to walk the tree',
          ),
      }),
      query: z.object({
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(250)
          .default(50)
          .describe('Max children to return (default 50, max 250)')
          .optional(),
      }),
      response: {
        200: z.object({ pages: z.array(PageSummarySchema) }),
        404: z.string(),
        503: z.string(),
      },
      detail: {
        tags: ['Atlassian'],
        summary: 'List the direct child pages of a Confluence page',
        description:
          "Returns one level of children under the given page (does not recurse). Pair with /atlassian/confluence/spaces (use the returned homepageId as the root) to walk a space tree without loading bodies. To read a child's body follow up with /atlassian/confluence/pages/{id}.",
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/recently-updated',
    async ({ query, set }) => {
      try {
        return await getRecentlyUpdated({
          ...(query.spaceId ? { spaceId: query.spaceId } : {}),
          limit: query.limit ?? 25,
        })
      } catch (error) {
        set.status = 503
        return error instanceof Error ? error.message : 'Confluence error'
      }
    },
    {
      query: z.object({
        spaceId: z
          .string()
          .describe('Restrict to a single space (numeric id from /spaces). Omit for site-wide.')
          .optional(),
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(100)
          .default(25)
          .describe('Max pages to return (default 25, max 100)')
          .optional(),
      }),
      response: { 200: z.object({ pages: z.array(PageSummarySchema) }), 503: z.string() },
      detail: {
        tags: ['Atlassian'],
        summary: 'List recently-edited Confluence pages',
        description:
          'Returns pages sorted by most recently modified (descending). Use ?spaceId to scope to a single space, omit for site-wide. Cheaper than the equivalent CQL `ORDER BY lastmodified DESC` because it hits the v2 pages list directly. Bodies are not included — follow up with /atlassian/confluence/pages/{id} to read a hit.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
