import { Elysia } from 'elysia'
import { basename } from 'node:path'
import { z } from 'zod'
import { QueryBool } from '../lib/query-bool.js'
import { DoctorSchema, defaultPaper, type Paper, type PaperResult } from '../lib/paper.js'
import {
  CliDocShowSchema,
  CliPathSchema,
  CliScanStatusSchema,
  CliThumbsSchema,
  DecideBodySchema,
  DecideResultSchema,
  DocIdSchema,
  DocSchema,
  DocsListSchema,
  DoctorResponseSchema,
  ErrorSchema,
  InboxListSchema,
  InboxNameSchema,
  JobIdSchema,
  PrintBodySchema,
  PrintCancelSchema,
  PrintJobAnswerSchema,
  PrintResultSchema,
  PrintStatusSchema,
  ScanActionSchema,
  ScanCheckSchema,
  ScanModeSchema,
  ScanStatusSchema,
  WordsSchema,
} from '../lib/paper-schemas.js'

/**
 * `/paper/*` — the `paper` CLI (scanner, document inbox, document index, printer) as an API. The CLI
 * is the source of truth and Argo keeps no copy: every route runs one verb through lib/paper.ts
 * (`hc exec`, so the SMB share, the scanner and CUPS are reachable from a launchd process) and
 * returns its JSON, typed. A scan starts only on `POST /paper/scan/start`.
 *
 * Document text, issuers and titles are private: nothing here logs them and no path leaves the API.
 */

const HEAVY = 120
const LIGHT = 30

type Failure = Exclude<PaperResult<unknown>, { kind: 'ok' }>

/** The HTTP answer of a call that did not succeed. `lookup`: a refusal means the thing is not there. */
function describeFailure(
  failure: Failure,
  lookup: boolean,
): { code: 404 | 409 | 502 | 503 | 504; error: string } {
  switch (failure.kind) {
    case 'refused':
      return { code: lookup ? 404 : 409, error: failure.message }
    case 'timeout':
      return { code: 504, error: 'paper did not answer in time' }
    case 'unparseable':
      return { code: 502, error: 'paper answered with output this API cannot read' }
    case 'failed':
      return { code: 502, error: failure.message }
    case 'unavailable':
      return { code: 503, error: `paper is unavailable: ${failure.message}` }
  }
}

const errorResponse = (code: number, error: string): Response =>
  new Response(JSON.stringify({ error }), {
    status: code,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

const failure = (result: Failure, lookup = false): Response => {
  const { code, error } = describeFailure(result, lookup)
  return errorResponse(code, error)
}

/** The body of a successful call, or the typed error answer. */
async function answer<T, R>(
  call: Promise<PaperResult<T>>,
  map: (data: T) => R,
  lookup = false,
): Promise<R> {
  const result = await call
  // The error Response is typed away: the route's `response` map lists those statuses for the spec.
  return result.kind === 'ok' ? map(result.data) : (failure(result, lookup) as never)
}

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

const privateHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }

const detail = (summary: string, description: string) => ({
  tags: ['Paper'],
  summary,
  description,
  security: [{ BearerAuth: [] }],
})

const withFiles = {
  200: z.unknown(),
  404: ErrorSchema,
  409: ErrorSchema,
  502: ErrorSchema,
  503: ErrorSchema,
  504: ErrorSchema,
}

export type PaperRoutesConfig = { paper: Paper }

export function createPaperRoutes({ paper }: PaperRoutesConfig) {
  /** A local file of paper's state dir as a response, or the 404/502 the caller names. */
  async function sendFile(path: string): Promise<Response> {
    const real = await paper.servable(path)
    if (!real) return errorResponse(502, 'paper returned a file this API does not serve')
    const extension = real.slice(real.lastIndexOf('.')).toLowerCase()
    const type = MIME[extension]
    if (!type) return errorResponse(502, 'unsupported file type')
    return new Response(Bun.file(real), {
      headers: {
        ...privateHeaders,
        'Content-Type': type,
        'Content-Disposition': `inline; filename="${encodeURIComponent(basename(real))}"`,
      },
    })
  }

  return (
    new Elysia({ prefix: '/paper' })
      .onAfterHandle(({ set }) => {
        set.headers['cache-control'] = 'no-store'
      })

      // ── doctor ────────────────────────────────────────────────────────────────
      .get(
        '/doctor',
        async () => {
          const result = await paper.run({
            verb: 'doctor',
            args: ['doctor'],
            timeoutSec: LIGHT,
            schema: DoctorSchema,
          })
          if (result.kind === 'ok') return { ok: result.data.ok, checks: result.data.checks }
          if (result.kind === 'refused' && result.data)
            return { ok: result.data.ok, checks: result.data.checks }
          return failure(result, false) as never
        },
        {
          response: {
            200: DoctorResponseSchema,
            404: ErrorSchema,
            409: ErrorSchema,
            502: ErrorSchema,
            503: ErrorSchema,
            504: ErrorSchema,
          },
          detail: detail(
            'Paper health: share, state dir, print queue, scanner',
            'Runs `paper doctor` (read-only). One row per check: config, share (the Dokumente scan inbox), state dir, print queue, scanner. `ok:false` with the failing rows is still a 200: the rows are the answer. Messages name local paths. 503 when the herdr core or the paper executable is not available to the API, 504 when paper does not answer in time.',
          ),
        },
      )

      // ── scan ──────────────────────────────────────────────────────────────────
      .get(
        '/scan/status',
        () =>
          answer(
            paper.run({
              verb: 'scan status',
              args: ['scan', 'status'],
              timeoutSec: LIGHT,
              schema: CliScanStatusSchema,
            }),
            (data) => ({
              pending: data.pending && {
                parts: data.pending.parts.map((part, index) => ({
                  mode: part.mode,
                  fileName: part.fileName,
                  pages: part.pages,
                  at: part.at,
                  thumbUrls: part.thumbPaths.map((path, page) =>
                    path === null ? null : `/paper/scan/pages/${index}/${page}`,
                  ),
                  pageUrls: part.pagePaths.map(
                    (_path, page) => `/paper/scan/pages/${index}/${page}?size=page`,
                  ),
                })),
                scanning: data.pending.scanning,
                needsAttention: data.pending.needsAttention,
                attention: data.pending.attention ?? null,
              },
              progress: data.progress ?? null,
              lastResult: data.lastResult ?? null,
              actions: data.actions,
            }),
          ),
        {
          response: {
            200: ScanStatusSchema,
            404: ErrorSchema,
            409: ErrorSchema,
            502: ErrorSchema,
            503: ErrorSchema,
            504: ErrorSchema,
          },
          detail: detail(
            'The scan in progress, the pending scan and the allowed next actions',
            'Runs `paper scan status` (no scanner access). `pending` is a finished scan waiting for POST /paper/scan/submit or /discard, with one part per scan call (feeder, fronts, backs, flatbed, more) and per-page thumbnail URLs; `progress` is set while a scan runs (poll this route every second or two); `lastResult` is how the last scan, submit or discard ended; `actions` are the next steps the CLI allows right now. Start a scan only when a person asks for one.',
          ),
        },
      )
      .get(
        '/scan/check',
        async ({ query }) => {
          const args = ['scan', 'check']
          if (query.mode) args.push('--mode', query.mode)
          if (query.dpi) args.push('--dpi', String(query.dpi))
          if (query.gray) args.push('--gray')
          const result = await paper.run({
            verb: 'scan check',
            args,
            timeoutSec: 60,
            schema: ScanCheckSchema,
          })
          if (result.kind === 'ok') return result.data
          if (result.kind === 'refused')
            return result.data ?? { ok: false, message: result.message }
          return failure(result, false)
        },
        {
          query: z.object({
            mode: ScanModeSchema.optional().describe('Default feeder.'),
            dpi: z.coerce
              .number()
              .int()
              .min(75)
              .max(1200)
              .optional()
              .describe('Default 300; one the scanner offers.'),
            gray: QueryBool.optional(),
          }),
          response: {
            200: ScanCheckSchema,
            404: ErrorSchema,
            409: ErrorSchema,
            502: ErrorSchema,
            503: ErrorSchema,
            504: ErrorSchema,
          },
          detail: detail(
            'Would a scan start now?',
            'Runs `paper scan check`, a read-only pre-flight: scanner reachable and idle, paper in the feeder, inbox there, nothing pending that refuses it. Starts no scan. `ok:false` with a `message` (for example no document in the feeder) is a 200 answer, not an error.',
          ),
        },
      )
      .post(
        '/scan/start',
        ({ body }) => {
          const args = ['scan', 'start', '--mode', body.mode]
          if (body.dpi) args.push('--dpi', String(body.dpi))
          if (body.gray) args.push('--gray')
          return answer(
            paper.run({ verb: 'scan start', args, timeoutSec: 60, schema: ScanActionSchema }),
            (data) => data,
          )
        },
        {
          body: z.object({
            mode: ScanModeSchema.describe(
              'feeder: both sides of the stack; fronts then backs: collate a double-sided stack; flatbed: one sheet on the glass; more: continue the pending scan.',
            ),
            dpi: z
              .number()
              .int()
              .min(75)
              .max(1200)
              .optional()
              .describe('Default 300; "more" and "backs" continue the pending scan\'s.'),
            gray: z.boolean().optional(),
          }),
          response: {
            200: ScanActionSchema,
            404: ErrorSchema,
            409: ErrorSchema,
            502: ErrorSchema,
            503: ErrorSchema,
            504: ErrorSchema,
          },
          detail: detail(
            'Start a scan',
            "Runs `paper scan start`: checks, then starts the scan in a process of its own and returns as soon as it runs. Poll GET /paper/scan/status for progress; a finished scan stays pending until POST /paper/scan/submit. **This moves the scanner and uses the sheets in its feeder: call it only when a person asked for a scan.** 409 with the CLI's reason when a scan would not start (empty feeder, a scan already running, a pending scan that refuses the mode).",
          ),
        },
      )
      .post(
        '/scan/submit',
        ({ body }) =>
          answer(
            paper.run({
              verb: 'scan submit',
              args: body?.force ? ['scan', 'submit', '--force'] : ['scan', 'submit'],
              timeoutSec: HEAVY,
              schema: ScanActionSchema,
            }),
            (data) => data,
          ),
        {
          body: z
            .object({
              force: z
                .boolean()
                .optional()
                .describe('File even though the last "scan more" failed.'),
            })
            .optional(),
          response: {
            200: ScanActionSchema,
            404: ErrorSchema,
            409: ErrorSchema,
            502: ErrorSchema,
            503: ErrorSchema,
            504: ErrorSchema,
          },
          detail: detail(
            'File the pending scan in the inbox',
            'Runs `paper scan submit`. Nothing reaches the inbox without it. 409 with the reason when there is nothing pending or the last "scan more" failed (repeat with force:true to file anyway).',
          ),
        },
      )
      .post(
        '/scan/discard',
        () =>
          answer(
            paper.run({
              verb: 'scan discard',
              args: ['scan', 'discard'],
              timeoutSec: LIGHT,
              schema: ScanActionSchema,
            }),
            (data) => data,
          ),
        {
          response: {
            200: ScanActionSchema,
            404: ErrorSchema,
            409: ErrorSchema,
            502: ErrorSchema,
            503: ErrorSchema,
            504: ErrorSchema,
          },
          detail: detail(
            'Drop the pending scan',
            'Runs `paper scan discard`: the pending scan and its pages are deleted. 409 when nothing is pending.',
          ),
        },
      )
      .get(
        '/scan/pages/:part/:page',
        async ({ params, query }) => {
          const result = await paper.run({
            verb: 'scan status',
            args: ['scan', 'status'],
            timeoutSec: LIGHT,
            schema: CliScanStatusSchema,
          })
          if (result.kind !== 'ok') {
            return failure(result, false)
          }
          const part = result.data.pending?.parts[params.part]
          const path =
            query.size === 'page' ? part?.pagePaths[params.page] : part?.thumbPaths[params.page]
          if (!path) return errorResponse(404, 'no such page')
          return sendFile(path)
        },
        {
          params: z.object({
            part: z.coerce.number().int().min(0).max(99),
            page: z.coerce.number().int().min(0).max(999),
          }),
          query: z.object({ size: z.enum(['thumb', 'page']).default('thumb') }),
          response: {
            200: z.unknown(),
            404: ErrorSchema,
            409: ErrorSchema,
            502: ErrorSchema,
            503: ErrorSchema,
            504: ErrorSchema,
          },
          detail: detail(
            'A page of the pending scan as an image',
            "The thumbnail (default) or, with size=page, the full JPEG of one page of one part of the pending scan, read from paper's state dir. `part` and `page` are the zero-based positions in GET /paper/scan/status `pending.parts[part]`; its `thumbUrls` and `pageUrls` are these URLs. 404 when the part, the page or its thumbnail does not exist.",
          ),
        },
      )

      // ── inbox ─────────────────────────────────────────────────────────────────
      .get(
        '/inbox',
        () =>
          answer(
            paper.run({
              verb: 'inbox list',
              args: ['inbox', 'list'],
              timeoutSec: 90,
              schema: InboxListSchema,
            }),
            (data) => data,
          ),
        {
          response: {
            200: InboxListSchema,
            404: ErrorSchema,
            409: ErrorSchema,
            502: ErrorSchema,
            503: ErrorSchema,
            504: ErrorSchema,
          },
          detail: detail(
            'The scan inbox: waiting files, files held for review, newest filed documents',
            'Runs `paper inbox list` (read-only). `review` holds files the pipeline could not file by itself, each with its `reason`, its `proposal` (kind, date, a split of a stack) and the `sides` of a collated front/back pair: decide each with POST /paper/inbox/{name}/decide. `waiting` files are taken by the next pipeline run; `done` are recent ones; `filed` is a short tail of the document index (GET /paper/docs is the index). Every file has a first-page GET /paper/inbox/{name}/thumb and a GET /paper/inbox/{name}/pdf.',
          ),
        },
      )
      .post(
        '/inbox/:name/decide',
        ({ params, body }) => {
          const args = ['inbox', 'decide', params.name]
          if (body.single) args.push('--single')
          if (body.split) args.push('--split', body.split)
          if (body.kind) args.push('--kind', body.kind)
          if (body.issuer) args.push('--issuer', body.issuer)
          if (body.date) args.push('--date', body.date)
          if (body.title) args.push('--title', body.title)
          if (body.object) args.push('--object', body.object)
          return answer(
            paper.run({ verb: 'inbox decide', args, timeoutSec: 60, schema: DecideResultSchema }),
            (data) => data,
          )
        },
        {
          params: z.object({ name: InboxNameSchema }),
          body: DecideBodySchema,
          response: {
            200: DecideResultSchema,
            404: ErrorSchema,
            409: ErrorSchema,
            502: ErrorSchema,
            503: ErrorSchema,
            504: ErrorSchema,
          },
          detail: detail(
            'Decide a file held for review',
            'Runs `paper inbox decide`: the file moves into the inbox under a name that carries the decision and the next pipeline run files it. Send `single:true` (one document), `split` (first pages of the documents after the first) or values for one document (kind, issuer, date, title, object); what is not given is classified as usual. `split` cannot be combined with the values. 409 with the reason when the file is not in review, the combination is invalid, or the pipeline is filing right now (try again shortly).',
          ),
        },
      )
      .get(
        '/inbox/:name/pdf',
        async ({ params }) => {
          const result = await paper.run({
            verb: 'inbox fetch',
            args: ['inbox', 'fetch', params.name],
            timeoutSec: HEAVY,
            schema: CliPathSchema,
          })
          if (result.kind !== 'ok') {
            return failure(result, true)
          }
          return sendFile(result.data.path)
        },
        {
          params: z.object({ name: InboxNameSchema }),
          response: withFiles,
          detail: detail(
            'The file of an inbox item',
            "Copies the file from the share into paper's local cache (`paper inbox fetch`) and returns it, usually as application/pdf. Looks in review, then the waiting files, then done. 404 when no inbox file has that name.",
          ),
        },
      )
      .get(
        '/inbox/:name/thumb',
        async ({ params }) => {
          const result = await paper.run({
            verb: 'inbox thumbs',
            args: ['inbox', 'thumbs'],
            timeoutSec: 90,
            schema: CliThumbsSchema,
          })
          if (result.kind !== 'ok') {
            return failure(result, false)
          }
          const found = result.data.thumbs.find((entry) => basename(entry.path) === params.name)
          if (!found) return errorResponse(404, 'no thumbnail for that file')
          return sendFile(found.thumbPath)
        },
        {
          params: z.object({ name: InboxNameSchema }),
          response: withFiles,
          detail: detail(
            'First-page thumbnail of an inbox item',
            'The cached first-page image of a file GET /paper/inbox lists (waiting, review and the newest done files), from `paper inbox thumbs`. 404 when the file is not listed or has no thumbnail.',
          ),
        },
      )

      // ── docs ──────────────────────────────────────────────────────────────────
      .get(
        '/docs',
        ({ query }) => {
          const args = ['docs', 'list']
          if (query.kind) args.push('--kind', query.kind)
          if (query.issuer) args.push('--issuer', query.issuer)
          if (query.year) args.push('--year', query.year)
          if (query.taxYear) args.push('--tax-year', query.taxYear)
          if (query.tag) args.push('--tag', query.tag)
          if (query.query) args.push('--query', query.query)
          if (query.limit) args.push('--limit', String(query.limit))
          return answer(
            paper.run({ verb: 'docs list', args, timeoutSec: 60, schema: DocsListSchema }),
            (data) => data,
          )
        },
        {
          query: z.object({
            kind: WordsSchema.optional().describe('Document kind, e.g. invoice.'),
            issuer: WordsSchema.optional(),
            year: z
              .string()
              .regex(/^\d{4}$/)
              .optional()
              .describe('Year of the document date.'),
            taxYear: z
              .string()
              .regex(/^\d{4}$/)
              .optional(),
            tag: WordsSchema.optional(),
            query: WordsSchema.optional().describe('Words searched in the index.'),
            limit: z.coerce
              .number()
              .int()
              .min(1)
              .max(1000)
              .optional()
              .describe('Newest N; `total` counts every match.'),
          }),
          response: {
            200: DocsListSchema,
            404: ErrorSchema,
            409: ErrorSchema,
            502: ErrorSchema,
            503: ErrorSchema,
            504: ErrorSchema,
          },
          detail: detail(
            'The document index, newest first',
            'Runs `paper docs list`: one record per filed document, read from its note in the brain, filtered by kind, issuer, year, taxYear, tag or words. `total` is every match, `count` the records returned (limit). Each record has an `id` for GET /paper/docs/{id}, /pdf, /text and POST /paper/docs/{id}/print. Document contents are private: do not copy summaries or text into logs or tickets.',
          ),
        },
      )
      .get(
        '/docs/:id',
        ({ params }) =>
          answer(
            paper.run({
              verb: 'docs show',
              args: ['docs', 'show', params.id],
              timeoutSec: LIGHT,
              schema: CliDocShowSchema,
            }),
            (data) => data.document,
            true,
          ),
        {
          params: z.object({ id: DocIdSchema }),
          response: {
            200: DocSchema,
            404: ErrorSchema,
            409: ErrorSchema,
            502: ErrorSchema,
            503: ErrorSchema,
            504: ErrorSchema,
          },
          detail: detail(
            'One document of the index',
            'Runs `paper docs show`: every field of a GET /paper/docs record. 404 when the id is not in the index.',
          ),
        },
      )
      .get(
        '/docs/:id/pdf',
        async ({ params }) => {
          const result = await paper.run({
            verb: 'docs fetch',
            args: ['docs', 'fetch', params.id],
            timeoutSec: HEAVY,
            schema: CliPathSchema,
          })
          if (result.kind !== 'ok') {
            return failure(result, true)
          }
          return sendFile(result.data.path)
        },
        {
          params: z.object({ id: DocIdSchema }),
          response: withFiles,
          detail: detail(
            'The original file of a document',
            "Copies the original from the Dokumente share into paper's local cache (`paper docs fetch`) and returns it, as application/pdf for a PDF. 404 when the id is unknown or the original is gone from the share (`fileExists:false`).",
          ),
        },
      )
      .get(
        '/docs/:id/text',
        async ({ params }) => {
          const located = await paper.run({
            verb: 'docs text',
            args: ['docs', 'text', params.id],
            timeoutSec: LIGHT,
            schema: CliPathSchema,
          })
          if (located.kind !== 'ok') {
            return failure(located, true)
          }
          const text = await paper.brainText(located.data.path)
          if (text.kind !== 'ok') {
            return failure(text, false)
          }
          return new Response(text.data, {
            headers: { ...privateHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
          })
        },
        {
          params: z.object({ id: DocIdSchema }),
          response: withFiles,
          detail: detail(
            'The extracted text of a document',
            'The text paper extracted from the original, as text/plain (`paper docs text` names the file, the API reads it). 404 when the id is unknown or the document has no text file. Private: read it, do not store it elsewhere.',
          ),
        },
      )

      // ── print ─────────────────────────────────────────────────────────────────
      .post(
        '/docs/:id/print',
        ({ params, body }) =>
          answer(
            paper.run({
              verb: 'print',
              args: ['print', '--doc', params.id, ...printFlags(body)],
              timeoutSec: 90,
              schema: PrintResultSchema,
            }),
            (data) => data,
          ),
        {
          params: z.object({ id: DocIdSchema }),
          body: PrintBodySchema,
          response: {
            200: PrintResultSchema,
            404: ErrorSchema,
            409: ErrorSchema,
            502: ErrorSchema,
            503: ErrorSchema,
            504: ErrorSchema,
          },
          detail: detail(
            'Print a filed document',
            'Runs `paper print --doc`. **Prints on the real printer: call it only when a person asked.** The CLI picks the edge from the file (two-sided long edge, short edge for a landscape first page, one-sided for a job that fits one sheet side) and says which and why in `sides` and `sidesWhy`. `dryRun:true` reports that decision without a job; `hold:true` submits the job on hold (cancel it with POST /paper/print/jobs/{jobId}/cancel). 409 with the reason when the queue is not idle enough to take a job (stopped, jammed, toner) or the original is missing.',
          ),
        },
      )
      .post(
        '/inbox/:name/print',
        async ({ params, body }) => {
          const fetched = await paper.run({
            verb: 'inbox fetch',
            args: ['inbox', 'fetch', params.name],
            timeoutSec: HEAVY,
            schema: CliPathSchema,
          })
          if (fetched.kind !== 'ok') {
            return failure(fetched, true) as never
          }
          const file = await paper.servable(fetched.data.path)
          if (!file)
            return errorResponse(502, 'paper returned a file this API does not serve') as never
          return answer(
            paper.run({
              verb: 'print',
              args: ['print', file, ...printFlags(body)],
              timeoutSec: 90,
              schema: PrintResultSchema,
            }),
            (data) => data,
          )
        },
        {
          params: z.object({ name: InboxNameSchema }),
          body: PrintBodySchema,
          response: {
            200: PrintResultSchema,
            404: ErrorSchema,
            409: ErrorSchema,
            502: ErrorSchema,
            503: ErrorSchema,
            504: ErrorSchema,
          },
          detail: detail(
            'Print an inbox file',
            'Copies the file from the inbox into the local cache and runs `paper print` on it. **Prints on the real printer: call it only when a person asked.** Body and answer as POST /paper/docs/{id}/print. 404 when no inbox file has that name.',
          ),
        },
      )
      .get(
        '/print/status',
        () =>
          answer(
            paper.run({
              verb: 'print status',
              args: ['print', 'status'],
              timeoutSec: LIGHT,
              schema: PrintStatusSchema,
            }),
            (data) => data,
          ),
        {
          response: {
            200: PrintStatusSchema,
            404: ErrorSchema,
            409: ErrorSchema,
            502: ErrorSchema,
            503: ErrorSchema,
            504: ErrorSchema,
          },
          detail: detail(
            'Printer state, toner and active jobs',
            'Runs `paper print status`. `accepting` is whether the queue takes a job now (`reasons` says why not), `tonerPercent`/`tonerLow` the toner, `jobs` the active jobs.',
          ),
        },
      )
      .get(
        '/print/jobs/:jobId',
        ({ params }) =>
          answer(
            paper.run({
              verb: 'print status job',
              args: ['print', 'status', params.jobId],
              timeoutSec: LIGHT,
              schema: PrintJobAnswerSchema,
            }),
            (data) => data,
            true,
          ),
        {
          params: z.object({ jobId: JobIdSchema }),
          response: {
            200: PrintJobAnswerSchema,
            404: ErrorSchema,
            409: ErrorSchema,
            502: ErrorSchema,
            503: ErrorSchema,
            504: ErrorSchema,
          },
          detail: detail(
            'One print job',
            'Runs `paper print status <jobId>`: `job` (state, reasons, sheets; a cancelled job reads state `canceled`). 404 when the queue does not know the job.',
          ),
        },
      )
      .post(
        '/print/jobs/:jobId/cancel',
        ({ params }) =>
          answer(
            paper.run({
              verb: 'print cancel',
              args: ['print', 'cancel', params.jobId],
              timeoutSec: LIGHT,
              schema: PrintCancelSchema,
            }),
            (data) => data,
            true,
          ),
        {
          params: z.object({ jobId: JobIdSchema }),
          response: {
            200: PrintCancelSchema,
            404: ErrorSchema,
            409: ErrorSchema,
            502: ErrorSchema,
            503: ErrorSchema,
            504: ErrorSchema,
          },
          detail: detail(
            'Cancel a print job',
            'Runs `paper print cancel <jobId>`. 404 when the queue does not know the job.',
          ),
        },
      )
  )
}

function printFlags(body: z.infer<typeof PrintBodySchema>): string[] {
  const flags: string[] = []
  if (body.sides === 'simplex') flags.push('--simplex')
  if (body.sides === 'long-edge') flags.push('--long-edge')
  if (body.sides === 'short-edge') flags.push('--short-edge')
  if (body.pages) flags.push('--pages', body.pages)
  if (body.copies) flags.push('--copies', String(body.copies))
  if (body.hold) flags.push('--hold')
  if (body.dryRun) flags.push('--dry-run')
  return flags
}

export const paperRoutes = createPaperRoutes({ paper: defaultPaper() })
