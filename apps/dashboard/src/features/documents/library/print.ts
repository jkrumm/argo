/** The pure half of the print dialog: what the form accepts and what `POST …/print` gets. */
import { z } from 'zod'

/** The API's own page-selection shape (`PrintBodySchema`), e.g. `1-3,5,8-`. */
const PAGES = /^\d{1,4}(-\d{0,4})?(,\d{1,4}(-\d{0,4})?){0,20}$/

export const PrintSchema = z.object({
  sides: z.enum(['auto', 'simplex']),
  pages: z
    .string()
    .refine((value) => value.trim() === '' || PAGES.test(value.replaceAll(' ', '')), {
      message: 'Like 1-3,5',
    }),
  copies: z.coerce.number().int().min(1, 'At least 1').max(99, 'At most 99'),
})

export type PrintValues = z.infer<typeof PrintSchema>

/** `sides: auto` is two-sided: the printer's CLI picks the edge, one sheet side stays one-sided. */
export function printBody(values: PrintValues) {
  const pages = values.pages.replaceAll(' ', '')
  return {
    sides: values.sides,
    copies: Number(values.copies),
    ...(pages === '' ? {} : { pages }),
  }
}

/** One line of what the printer took: sides, why, and the sheets' page count. */
export function printSummary(result: {
  sides?: string | undefined
  sidesWhy?: string | undefined
  pageCount?: number | null | undefined
  copies?: number | undefined
  jobId?: string | null | undefined
}): string {
  return [
    result.sides,
    result.sidesWhy,
    result.pageCount ? `${result.pageCount} ${result.pageCount === 1 ? 'page' : 'pages'}` : null,
    result.copies && result.copies > 1 ? `${result.copies} copies` : null,
    result.jobId ? `job ${result.jobId}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}
