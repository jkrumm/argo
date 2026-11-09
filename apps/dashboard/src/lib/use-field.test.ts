import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'

const SRC = join(import.meta.dir, '..')

describe('useField', () => {
  it('is the only place a field handle is read with .use()', async () => {
    const offenders: string[] = []
    for await (const file of new Bun.Glob('**/*.{ts,tsx}').scan({ cwd: SRC })) {
      if (/\.test\.tsx?$/.test(file) || file === 'lib/use-field.ts') continue
      const text = await Bun.file(join(SRC, file)).text()
      if (/\.use\(/.test(text)) offenders.push(file)
    }
    expect(
      offenders,
      'call field.use() through useField() — React Compiler memoizes bare member hooks',
    ).toEqual([])
  })
})
