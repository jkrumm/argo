import { describe, expect, it } from 'bun:test'
import {
  documentPrivacyProcessor,
  installDocumentPrivacy,
  scrubDocumentUrls,
  scrubSpan,
} from './private-telemetry'
import { HYPERDX_IGNORE_URLS } from './hyperdx-options'

const HOST = 'https://argo.example.com'

describe('document pages stay out of telemetry', () => {
  it('drops the filters and the document id', () => {
    expect(scrubDocumentUrls(`${HOST}/documents?issuer=Acme+Energy&q=policy`)).toBe(
      `${HOST}/documents`,
    )
    expect(scrubDocumentUrls(`${HOST}/documents/2026-01-02-Acme_Policy?x=1`)).toBe(
      `${HOST}/documents/:id`,
    )
    expect(scrubDocumentUrls(`${HOST}/login?redirect=%2Fdocuments%2F2026-Acme`)).toBe(
      `${HOST}/login?redirect=%2Fdocuments`,
    )
  })

  it('keeps the sub-pages and every other address', () => {
    expect(scrubDocumentUrls(`${HOST}/documents/review?x=1`)).toBe(`${HOST}/documents/review`)
    expect(scrubDocumentUrls(`${HOST}/documents/scan`)).toBe(`${HOST}/documents/scan`)
    expect(scrubDocumentUrls(`${HOST}/documents`)).toBe(`${HOST}/documents`)
    expect(scrubDocumentUrls(`${HOST}/usage-tracking?tab=flow`)).toBe(
      `${HOST}/usage-tracking?tab=flow`,
    )
  })

  it('scrubs every string attribute of a span', () => {
    const span = {
      attributes: {
        'location.href': `${HOST}/documents/2026-Acme`,
        'prev.href': `${HOST}/documents?tag=flat`,
        count: 3,
      } as Record<string, unknown>,
    }
    scrubSpan(span)
    expect(span.attributes).toEqual({
      'location.href': `${HOST}/documents/:id`,
      'prev.href': `${HOST}/documents`,
      count: 3,
    })
  })

  it('scrubs before the span reaches any processor’s end', () => {
    const seen: unknown[] = []
    const span = {
      attributes: { 'location.href': `${HOST}/documents?tag=flat` } as Record<string, unknown>,
      end: () => void seen.push({ ...span.attributes }),
    }
    documentPrivacyProcessor.onStart(span)
    expect(span.attributes['location.href']).toBe(`${HOST}/documents`)
    span.attributes['prev.href'] = `${HOST}/documents/2026-Acme`
    span.end()
    expect(seen).toEqual([
      { 'location.href': `${HOST}/documents`, 'prev.href': `${HOST}/documents/:id` },
    ])
  })

  it('installs on the provider behind the API proxy', () => {
    const added: unknown[] = []
    const delegate = { addSpanProcessor: (p: unknown) => void added.push(p) }
    expect(installDocumentPrivacy({ getDelegate: () => delegate })).toBe(true)
    expect(added).toHaveLength(1)
    expect(installDocumentPrivacy({ getDelegate: () => ({}) })).toBe(false)
  })

  it('never traces a paper request', () => {
    const ignored = (url: string) => HYPERDX_IGNORE_URLS.some((re) => re.test(url))
    expect(ignored(`${HOST}/api/paper/docs/2026-Acme/pdf`)).toBe(true)
    expect(ignored(`${HOST}/api/paper/docs`)).toBe(true)
  })
})
