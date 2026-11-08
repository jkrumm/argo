// Fails the dashboard build when no emitted chunk carries React Compiler output: a plugin/peer
// mismatch makes the compiler compile nothing without any error. The runtime is inlined, so the
// marker is its memo-cache sentinel. Run from apps/dashboard after `vite build`.
import { Glob } from 'bun'

const MARKER = 'react.memo_cache_sentinel'
const glob = new Glob('dist/assets/*.js')

let compiled = 0
for await (const file of glob.scan('.')) {
  if ((await Bun.file(file).text()).includes(MARKER)) compiled++
}

if (compiled === 0) {
  console.error(
    `check-compiler: no chunk in dist/assets contains "${MARKER}"; React Compiler compiled nothing`,
  )
  process.exit(1)
}
console.log(`check-compiler: ${compiled} chunks carry compiler output`)
