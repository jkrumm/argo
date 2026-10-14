import { expect, test } from 'bun:test'
import { MantineProvider } from '@mantine/core'
import { prerender } from 'react-dom/static'

// bun test has no DOM; `lib/api-base.ts` reads `window.location.origin` at import.
Object.assign(globalThis, {
  window: {
    location: { origin: 'http://localhost' },
    addEventListener() {},
    removeEventListener() {},
  },
})

const { hermesRenderers } = await import('./markdown-part')

const Text = hermesRenderers['text']!
const ctx = (text: string, settled: boolean) =>
  ({
    part: { type: 'text', id: 'p', text },
    messageId: 'm',
    partId: 'p',
    settled,
    role: 'assistant',
  }) as never

// `prerender` waits out the Suspense boundary around Markdown's lazy react-markdown import, so
// this is the real markdown pipeline, not the plain-text fallback `renderToString` would emit.
async function render(text: string, settled = true): Promise<string> {
  const { prelude } = await prerender(
    <MantineProvider>
      <Text {...ctx(text, settled)} />
    </MantineProvider>,
  )
  return new Response(prelude).text()
}

test('an untrusted remote image is blocked and renders its alt text, not an <img>', async () => {
  const html = await render('![tracking pixel](https://evil.example/x.png)')
  expect(html).not.toContain('<span style="white-space:pre-wrap">') // real pipeline, not fallback
  expect(html).not.toContain('<img')
  expect(html).toContain('tracking pixel')
})

test('raw HTML from the model is sanitized', async () => {
  const html = await render('hello\n\n<script>alert(1)</script>')
  expect(html).not.toContain('<script')
  expect(html).toContain('hello')
})

test("argo's own accent directive still renders through the sanitizer", async () => {
  const html = await render('status :badge[ok]{color=green} and ==marked==')
  expect(html).toContain('ok')
  expect(html).toContain('<mark')
})
