// A stand-in for `hc exec --json --timeout N -- <cmd…>` in the paper tests: runs the command, ends it at
// the timeout and answers in hc's JSON (stdout and stderr base64). Calls go to $FAKE_PAPER_DIR/hc-calls.log.
import { appendFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const dir = process.env['FAKE_PAPER_DIR'] ?? '.'
appendFileSync(`${dir}/hc-calls.log`, JSON.stringify(argv) + '\n')

const separator = argv.indexOf('--')
const command = argv.slice(separator + 1)
const timeoutSec = Number(argv[argv.indexOf('--timeout') + 1] ?? 60)
const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64')

const started = performance.now()
let timedOut = false
try {
  const proc = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, timeoutSec * 1000)
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const code = await proc.exited
  clearTimeout(timer)
  process.stdout.write(
    JSON.stringify({
      code: timedOut ? null : code,
      ms: Math.round(performance.now() - started),
      signal: timedOut ? 15 : null,
      stderr: b64(err),
      stdout: b64(out),
      timed_out: timedOut,
      truncated: false,
    }),
  )
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      error: {
        kind: 'spawn_failed',
        message: error instanceof Error ? error.message : 'cannot start the command',
      },
    }),
  )
  process.exit(1)
}
