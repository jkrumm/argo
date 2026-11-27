/**
 * Keeps the document index out of browser telemetry. A document's issuer and title are private, and
 * under `/documents` the address holds both (the filters in the query, the id in the path) while the
 * HyperDX SDK stamps `location.href` on its spans. Requests to `/api/paper/*` are not traced at all
 * (`hyperdx-options.ts`); this scrubs what is left, the page address, on every span before export.
 */

/** Sub-pages of `/documents` that are not a document id. */
const PAGES: ReadonlySet<string> = new Set(['', 'scan', 'review'])

export function scrubDocumentUrls(value: string): string {
  return (
    value
      // A login redirect carries the target encoded.
      .replace(/redirect=[^&#\s"']*documents[^&#\s"']*/gi, 'redirect=%2Fdocuments')
      .replace(/\/documents(\/[^?#\s"']*)?([?#][^\s"']*)?/g, (_all, path: string | undefined) => {
        const first = path?.split('/')[1] ?? ''
        return PAGES.has(first) ? `/documents${path ?? ''}` : '/documents/:id'
      })
  )
}

type Attributed = { attributes: Record<string, unknown> }
type Endable = Attributed & { end: (...args: never[]) => void }

export function scrubSpan(span: Attributed): void {
  for (const [key, value] of Object.entries(span.attributes)) {
    if (typeof value === 'string' && value.includes('documents')) {
      span.attributes[key] = scrubDocumentUrls(value)
    }
  }
}

/**
 * A span processor that scrubs before any other processor sees the end of a span. It wraps `end`
 * instead of using `onEnd`: processors run in the order they were added, the SDK's batch processor
 * comes first, and it exports (serialises) inside its own `onEnd` when the batch is full.
 */
export const documentPrivacyProcessor = {
  onStart(span: Endable): void {
    const end = span.end.bind(span)
    span.end = (...args) => {
      scrubSpan(span)
      end(...args)
    }
    // What is set at the start (`location.href`) is clean even for a span that never ends.
    scrubSpan(span)
  },
  onEnd(): void {},
  forceFlush: (): Promise<void> => Promise.resolve(),
  shutdown: (): Promise<void> => Promise.resolve(),
}

/** Adds the processor to the tracer provider the HyperDX SDK registered. False: there is none. */
export function installDocumentPrivacy(tracerProvider: unknown): boolean {
  const proxy = tracerProvider as { getDelegate?: () => unknown }
  const provider = (proxy.getDelegate?.() ?? tracerProvider) as {
    addSpanProcessor?: (processor: typeof documentPrivacyProcessor) => void
  }
  if (typeof provider.addSpanProcessor !== 'function') return false
  provider.addSpanProcessor(documentPrivacyProcessor)
  return true
}
