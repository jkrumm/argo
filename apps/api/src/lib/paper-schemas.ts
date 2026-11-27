import { z } from 'zod'

/**
 * The shapes of the `paper` CLI's JSON (`paper schema` lists every verb), as this API promises them.
 * Each one parses the CLI's output and describes the response: a field the CLI adds later is dropped,
 * and a field it stops sending fails the parse (an `unparseable` answer), never a silent hole.
 * No schema carries a filesystem path: paths stay inside lib/paper.ts.
 */

/** An id from `docs list`: letters, digits, dot, hyphen, underscore; never a leading hyphen. */
export const DocIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/)
  .describe('Document id from GET /paper/docs.')

/** A file name of the scan inbox. No path separator, no leading hyphen. */
export const InboxNameSchema = z
  .string()
  .regex(/^[\p{L}\p{N}][\p{L}\p{N}._ ()-]{0,199}$/u)
  .describe('File name as GET /paper/inbox lists it (review, waiting or done).')

export const JobIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/)
  .describe('CUPS job id as the print status lists it, e.g. Printer_Name-26.')

/** Free text that reaches the CLI as one argument: one line, never a leading hyphen (an option). */
export const WordsSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^\p{Cc}-][^\p{Cc}]*$/u)

export const ErrorSchema = z.object({ error: z.string() })

export const ErrorResponses = {
  404: ErrorSchema,
  409: ErrorSchema,
  502: ErrorSchema,
  503: ErrorSchema,
  504: ErrorSchema,
} as const

// ── scan ──────────────────────────────────────────────────────────────────────

export const ScanModeSchema = z.enum(['feeder', 'fronts', 'backs', 'flatbed', 'more'])

/** `paper scan status` as the CLI prints it. The part's paths are read by the API, never returned. */
export const CliScanStatusSchema = z.object({
  pending: z
    .object({
      parts: z.array(
        z.object({
          mode: z.string(),
          fileName: z.string(),
          pages: z.number().int(),
          at: z.number(),
          pagePaths: z.array(z.string()),
          thumbPaths: z.array(z.string().nullable()),
        }),
      ),
      scanning: z.boolean(),
      needsAttention: z.boolean(),
      attention: z.string().optional(),
    })
    .nullable(),
  progress: z
    .object({
      mode: z.string(),
      page: z.number().int(),
      startedAt: z.number(),
      pid: z.number().int(),
    })
    .optional(),
  lastResult: z
    .object({
      at: z.number(),
      action: z.string(),
      ok: z.boolean(),
      message: z.string(),
      pages: z.number().int().nullish(),
    })
    .optional(),
  actions: z.array(z.object({ id: z.string(), group: z.string(), command: z.string() })),
})
export type CliScanStatus = z.infer<typeof CliScanStatusSchema>

export const ScanStatusSchema = z.object({
  pending: z
    .object({
      parts: z.array(
        z.object({
          mode: z.string(),
          fileName: z.string(),
          pages: z.number().int().describe('Pages in the part: compare with the sheets you fed.'),
          at: z.number(),
          thumbUrls: z
            .array(z.string().nullable())
            .describe(
              'One API path per page (GET it with the bearer); null where no thumbnail exists.',
            ),
          pageUrls: z.array(z.string()).describe('The full page JPEG per page, same order.'),
        }),
      ),
      scanning: z.boolean().describe('true while a live process holds the scan lock.'),
      needsAttention: z.boolean().describe('The last "scan more" failed; submit needs force.'),
      attention: z.string().nullable(),
    })
    .nullable()
    .describe('The finished scan waiting for submit or discard; null when there is none.'),
  progress: z
    .object({
      mode: z.string(),
      page: z.number().int(),
      startedAt: z.number(),
      pid: z.number().int(),
    })
    .nullable()
    .describe('A running scan: mode and the page it is on.'),
  lastResult: z
    .object({
      at: z.number(),
      action: z.string(),
      ok: z.boolean(),
      message: z.string(),
      pages: z.number().int().nullish(),
    })
    .nullable()
    .describe('How the last scan, submit or discard ended.'),
  actions: z
    .array(z.object({ id: z.string(), group: z.string(), command: z.string() }))
    .describe(
      'The next actions the CLI allows now. `command` is informational; use the POST routes.',
    ),
})

export const ScanCheckSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  mode: z.string().optional(),
  scanner: z.string().optional().describe("The scanner's own state (Idle, Processing…)."),
  feeder: z.string().optional().describe('ScannerAdfLoaded or ScannerAdfEmpty.'),
})

export const ScanActionSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  started: z.boolean().optional().describe('Start only: the worker holds the scan lock.'),
  mode: z.string().optional(),
  pid: z.number().int().optional(),
})

// ── inbox ─────────────────────────────────────────────────────────────────────

const InboxFileSchema = z.object({ name: z.string(), mtime: z.number() })

export const InboxListSchema = z.object({
  waiting: z.array(InboxFileSchema).describe('Files in the inbox the pipeline has not taken yet.'),
  review: z
    .array(
      z.object({
        name: z.string(),
        mtime: z.number(),
        reason: z.string().nullish().describe('Why the pipeline holds the file.'),
        proposal: z
          .object({
            kind: z.string().nullish(),
            date: z.string().nullish(),
            split: z
              .object({
                documents: z.number().int(),
                ranges: z.array(z.string()),
                starts: z.array(z.number().int()),
              })
              .nullish(),
          })
          .nullish()
          .describe(
            "The pipeline's suggestion; a split lists the first page of every document after the first.",
          ),
        sides: z
          .object({ fronts: z.array(z.string()), backs: z.array(z.string()) })
          .nullish()
          .describe('The two files of a collated front/back pair.'),
        sideOf: z.string().nullish(),
      }),
    )
    .describe('Files held for a decision (POST /paper/inbox/{name}/decide).'),
  done: z.array(InboxFileSchema).describe('Recently processed files.'),
  filed: z
    .array(
      z.object({
        title: z.string(),
        kind: z.string().nullable(),
        issuer: z.string().nullable(),
        date: z.string().nullable(),
        tags: z.array(z.string()),
        summary: z.string(),
        exists: z.boolean(),
      }),
    )
    .describe('The newest filed documents (the full index is GET /paper/docs).'),
  filedAsOf: z.number().nullish(),
})

export const DecideBodySchema = z.object({
  single: z.boolean().optional().describe('The file is one document; do not split it.'),
  split: z
    .string()
    .regex(/^\d{1,3}(,\d{1,3}){0,30}$/)
    .optional()
    .describe(
      'First pages of the documents after the first, e.g. "9,10,12". Not with kind, issuer, date, title or object.',
    ),
  kind: WordsSchema.optional(),
  issuer: WordsSchema.optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('YYYY-MM-DD.'),
  title: WordsSchema.optional(),
  object: WordsSchema.optional().describe('Target folder of the document.'),
})

export const DecideResultSchema = z.object({
  message: z.string(),
  name: z.string().describe('The new name of the file in the inbox, which carries the decision.'),
})

// ── docs ──────────────────────────────────────────────────────────────────────

export const DocSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.string().nullish(),
  issuer: z.string().nullish(),
  date: z.string().nullish().describe('YYYY-MM-DD.'),
  taxYear: z.number().int().nullish(),
  validUntil: z.string().nullish(),
  subject: z.string().nullish(),
  tags: z.array(z.string()),
  summary: z.string(),
  sharePath: z.string().nullish().describe('Path of the original relative to the Dokumente share.'),
  textPath: z.string().nullish(),
  vaultId: z.string().nullish(),
  fileExists: z
    .boolean()
    .describe('false when the note exists but the original is gone from the share.'),
})

export const DocsListSchema = z.object({
  total: z.number().int().describe('Documents matching the filters.'),
  count: z.number().int().describe('Documents in this response.'),
  asOf: z.number().nullish(),
  documents: z.array(DocSchema),
})

export const CliDocShowSchema = z.object({ document: DocSchema })

export const CliPathSchema = z.object({ path: z.string() })

// ── print ─────────────────────────────────────────────────────────────────────

export const PrintBodySchema = z.object({
  sides: z
    .enum(['auto', 'simplex', 'long-edge', 'short-edge'])
    .default('auto')
    .describe(
      'auto: the CLI chooses from the file (two-sided long edge, short edge for a landscape first page, one-sided for one sheet side) and says why.',
    ),
  pages: z
    .string()
    .regex(/^\d{1,4}(-\d{0,4})?(,\d{1,4}(-\d{0,4})?){0,20}$/)
    .optional()
    .describe('Page selection, e.g. "1-3,5,8-".'),
  copies: z.number().int().min(1).max(99).optional(),
  hold: z
    .boolean()
    .optional()
    .describe('Submit the job on hold: it does not print until released or cancelled.'),
  dryRun: z
    .boolean()
    .optional()
    .describe('Decide and report (sides, pages, media) without submitting a job.'),
})

export const PrintResultSchema = z.object({
  message: z.string(),
  action: z.string().optional(),
  jobId: z.string().nullish(),
  printer: z.string().optional(),
  sides: z.string().optional(),
  sidesWhy: z.string().optional(),
  media: z.string().optional(),
  mediaType: z.string().nullish(),
  scaling: z.string().optional(),
  manualFeed: z.boolean().optional(),
  documentPages: z.number().int().nullish(),
  pageCount: z.number().int().nullish(),
  pages: z.string().nullish(),
  copies: z.number().int().optional(),
  state: z.string().optional(),
  warnings: z.array(z.string()).optional(),
})

const PrintJobSchema = z.object({
  id: z.string(),
  title: z.string().nullish(),
  state: z.string(),
  reasons: z.array(z.string()).optional(),
  user: z.string().nullish(),
  submittedAt: z.number().nullish(),
  sheets: z.number().nullish(),
})

export const PrintStatusSchema = z.object({
  printer: z.string(),
  state: z.string(),
  accepting: z.boolean(),
  reasons: z.array(z.string()),
  tonerPercent: z.number().nullish(),
  tonerLow: z.boolean(),
  warnings: z.array(z.string()),
  jobs: z
    .array(PrintJobSchema)
    .optional()
    .describe('Active jobs (absent when one job was asked for).'),
  job: PrintJobSchema.optional().describe('The one job asked for.'),
})

export const PrintCancelSchema = z.object({
  message: z.string(),
  cancelled: z.array(z.string()),
})

// ── doctor ────────────────────────────────────────────────────────────────────

export const DoctorResponseSchema = z.object({
  ok: z.boolean(),
  checks: z.array(z.object({ name: z.string(), ok: z.boolean(), message: z.string() })),
})

export const CliThumbsSchema = z.object({
  thumbs: z.array(z.object({ path: z.string(), thumbPath: z.string() })),
})
