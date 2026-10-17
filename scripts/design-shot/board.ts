/** Static review board: `index.html` with relative image paths and no external assets. */
import type { RouteResult } from './types'

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

const img = (file: string | undefined, label: string): string =>
  file
    ? `<figure><figcaption>${esc(label)}</figcaption><a href="${esc(file)}"><img src="${esc(file)}" loading="lazy"></a></figure>`
    : `<figure><figcaption>${esc(label)} — missing</figcaption></figure>`

export function renderBoard(label: string, results: RouteResult[]): string {
  const sections = results.map((r) => {
    const crops = r.crops.filter((c) => c.scheme === 'dark')
    return `<section>
<h2>${esc(r.route)}</h2>
<div class="row">${img(r.full['dark--desktop'], 'dark desktop')}${img(r.full['light--desktop'], 'light desktop')}</div>
<div class="row">${img(r.full['dark--mobile'], 'dark mobile')}${img(r.full['light--mobile'], 'light mobile')}</div>
<h3>Crops (dark, ${crops.length})</h3>
<div class="grid">${crops
      .map((c) =>
        img(
          c.file,
          c.file
            .split('/')
            .pop()!
            .replace(/\.png$/, ''),
        ),
      )
      .join('')}</div>
${r.failures.length ? `<ul class="fail">${r.failures.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
</section>`
  })
  return `<!doctype html>
<meta charset="utf-8">
<title>design-shot — ${esc(label)}</title>
<style>
body{font:14px system-ui;margin:24px;background:#18181b;color:#e4e4e7}
h2{margin:40px 0 12px;font-family:ui-monospace,monospace}
.row{display:flex;gap:16px;align-items:flex-start;margin-bottom:16px}
.row figure{flex:1;min-width:0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
figure{margin:0}figcaption{font:12px ui-monospace,monospace;color:#a1a1aa;margin-bottom:4px}
img{max-width:100%;display:block;border:1px solid #3f3f46}
.fail{color:#f87171}
</style>
<h1>design-shot — ${esc(label)}</h1>
${sections.join('\n')}
`
}
