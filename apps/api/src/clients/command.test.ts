import { describe, it, expect } from 'bun:test'
import { runCommand, splitCommand } from './command.js'

describe('splitCommand', () => {
  it('splits on any whitespace and drops empties', () => {
    expect(splitCommand('  ssh -o  BatchMode=yes\thomelab ~/bin/x ')).toEqual([
      'ssh',
      '-o',
      'BatchMode=yes',
      'homelab',
      '~/bin/x',
    ])
  })

  it('returns [] for an empty or blank string', () => {
    expect(splitCommand('')).toEqual([])
    expect(splitCommand('   ')).toEqual([])
  })
})

describe('runCommand', () => {
  it('captures stdout', async () => {
    expect(await runCommand(['/bin/echo', 'hi'], { timeoutMs: 5000 })).toBe('hi\n')
  })

  it('pipes stdin to the child', async () => {
    expect(await runCommand(['/bin/cat'], { stdin: '{"a":1}', timeoutMs: 5000 })).toBe('{"a":1}')
  })

  it('rejects with exit code and stderr on non-zero exit', async () => {
    const run = runCommand(['/bin/sh', '-c', 'echo boom >&2; exit 3'], { timeoutMs: 5000 })
    await expect(run).rejects.toThrow(/code 3: boom/)
  })

  it('truncates long stderr', async () => {
    const run = runCommand(['/bin/sh', '-c', 'head -c 5000 /dev/zero | tr "\\0" x >&2; exit 1'], {
      timeoutMs: 5000,
    })
    const err = await run.then(
      () => null,
      (e: Error) => e,
    )
    expect(err?.message.length).toBeLessThan(700)
  })

  it('kills the child and rejects on timeout', async () => {
    const started = Date.now()
    const run = runCommand(['/bin/sh', '-c', 'exec sleep 10'], { timeoutMs: 100 })
    await expect(run).rejects.toThrow(/timed out/)
    expect(Date.now() - started).toBeLessThan(3000)
  })

  it('kills the child and rejects when stdout exceeds the cap', async () => {
    const run = runCommand(['/bin/sh', '-c', 'exec yes'], { timeoutMs: 10_000 })
    await expect(run).rejects.toThrow(/exceeded/)
  })

  it('rejects an empty argv', async () => {
    await expect(runCommand([], { timeoutMs: 100 })).rejects.toThrow(/empty command/)
  })
})
