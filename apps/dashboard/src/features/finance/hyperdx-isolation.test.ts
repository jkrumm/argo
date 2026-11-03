import { describe, expect, it } from 'bun:test'
import { Glob } from 'bun'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HYPERDX_BLOCK_CLASS, HYPERDX_IGNORE_URLS } from '../../lib/hyperdx-options'

const src = join(import.meta.dir, '../..')
const read = (rel: string) => readFileSync(join(src, rel), 'utf8')

describe('finance data stays out of HyperDX', () => {
  it('ignores every finance request URL, with or without a query string', () => {
    const matches = (url: string) => HYPERDX_IGNORE_URLS.some((re) => re.test(url))
    expect(matches('https://argo.jkrumm.com/api/finance/status')).toBe(true)
    expect(matches('https://argo.jkrumm.com/api/finance/api/transactions?search=landlord')).toBe(
      true,
    )
    expect(matches('http://localhost:7715/api/finance/unlock')).toBe(true)
    // Other API traffic is still traced.
    expect(matches('https://argo.jkrumm.com/api/workouts')).toBe(false)
    expect(matches('https://argo.jkrumm.com/finance')).toBe(false)
  })

  it('hyperdx.ts hands both the block class and the ignore list to HyperDX.init', () => {
    const init = read('lib/hyperdx.ts')
    expect(init).toContain('blockClass: HYPERDX_BLOCK_CLASS')
    expect(init).toContain('ignoreUrls: HYPERDX_IGNORE_URLS')
    expect(HYPERDX_BLOCK_CLASS).toBe('hdx-block')
  })

  it('the finance layout root carries the block class and pauses session replay while mounted', () => {
    const layout = read('features/finance/finance-layout.tsx')
    expect(layout).toContain('className={HYPERDX_BLOCK_CLASS}')
    expect(layout).toContain('pauseSessionRecording(HyperDX)')
  })

  it('no finance module writes to the console (consoleCapture would ship it)', () => {
    const offenders: string[] = []
    for (const file of new Glob('features/finance/**/*.{ts,tsx}').scanSync({ cwd: src })) {
      if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue
      if (/\bconsole\s*\./.test(read(file))) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })
})
