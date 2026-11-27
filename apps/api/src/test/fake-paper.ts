// A stand-in for the `paper` executable in the paper tests. The answer of a verb is a file
// $FAKE_PAPER_DIR/<verb>.json ({ code?, stdout, sleepMs? }, the verb being "scan status", "docs list", …
// with spaces as underscores); every call's argv is appended to $FAKE_PAPER_DIR/calls.log.
import { appendFileSync } from 'node:fs'

const dir = process.env['FAKE_PAPER_DIR'] ?? '.'
const args = process.argv.slice(2)
appendFileSync(`${dir}/calls.log`, JSON.stringify(args) + '\n')

const second = args[1]
const verb = [args[0], second && /^[a-z]+$/.test(second) ? second : ''].filter(Boolean).join('_')
const scenario = Bun.file(`${dir}/${verb}.json`)
if (!(await scenario.exists())) {
  process.stdout.write(JSON.stringify({ ok: false, message: 'no scenario for this verb' }))
  process.exit(2)
}
const {
  code = 0,
  stdout,
  sleepMs = 0,
} = (await scenario.json()) as {
  code?: number
  stdout: string
  sleepMs?: number
}
if (sleepMs) await Bun.sleep(sleepMs)
process.stdout.write(stdout)
process.exit(code)
