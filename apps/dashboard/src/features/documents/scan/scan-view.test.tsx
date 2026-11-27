import { describe, expect, it } from 'bun:test'
import { renderMarkup } from '../test-render'
import { scanView } from './model'
import { SCAN_STATES } from './status-fixtures'
import { ScanViewPanel, type ScanViewProps } from './scan-view'

const noop = () => undefined

const render = (state: keyof typeof SCAN_STATES, over: Partial<ScanViewProps> = {}) =>
  renderMarkup(
    <ScanViewPanel
      view={scanView(SCAN_STATES[state])}
      busy={false}
      pressed={null}
      filed={null}
      error={null}
      onPress={noop}
      onOpenPage={noop}
      onDismissFailure={noop}
      onDismissFiled={noop}
      {...over}
    />,
  )

describe('Scan page states', () => {
  it('idle: three ways to start, nothing to submit', async () => {
    const html = await render('idle')
    for (const label of ['Document', 'Fronts', 'Flatbed']) expect(html).toContain(label)
    expect(html).toContain('data-phase="idle"')
    expect(html).not.toContain('Submit')
    expect(html).not.toContain('Compare with your sheets')
  })

  it('scanning: the running count, no buttons', async () => {
    const html = await render('scanning')
    expect(html).toContain('data-phase="scanning"')
    expect(html).toContain('Pages scanned so far')
    expect(html).toContain('>7<')
    expect(html).toContain('Updated every 2 seconds')
    expect(html).not.toContain('Submit')
    expect(html).not.toContain('Discard')
  })

  it('pending: the count, the line to compare, thumbnails and the next steps', async () => {
    const html = await render('pending')
    expect(html).toContain('>12<')
    expect(html).toContain('Compare with your sheets')
    expect(html).toContain('Page 12')
    for (const label of ['Submit', 'Scan More', 'Discard']) expect(html).toContain(label)
    expect(html).not.toContain('Scan Backs')
  })

  it('fronts pending: Scan Backs asks to flip the stack', async () => {
    const html = await render('frontsPending')
    expect(html).toContain('Scan Backs')
    expect(html).toContain('Flip the stack')
    expect(html).toContain('Fronts, no backs yet')
    expect(html).toContain('Submit fronts only')
  })

  it('pair pending: fronts and backs as two rows', async () => {
    const html = await render('pairPending')
    expect(html).toContain('8 + 8')
    expect(html).toContain('Fronts')
    expect(html).toContain('Backs')
    expect(html).not.toContain('do not match')
  })

  it('pair with a mismatch says it in words', async () => {
    const html = await render('pairMismatch')
    expect(html).toContain('Fronts and backs do not match')
    expect(html).toContain('backs only 7')
  })

  it('failed batch: a banner with the scanner message', async () => {
    const html = await render('failedBatch')
    expect(html).toContain('The scan did not finish')
    expect(html).toContain('all 6 pages look blank')
  })

  it('failed scan more: the banner stays and cannot be closed', async () => {
    const html = await render('failedMore')
    expect(html).toContain('The last scan failed')
    expect(html).toContain('did not pick up the paper')
    expect(html).not.toContain('mantine-CloseButton')
  })

  it('after Submit: the filed line and a link to Review', async () => {
    const html = await render('idle', { filed: 'Filed: 8 + 8 pages' })
    expect(html).toContain('Filed: 8 + 8 pages')
    expect(html).toContain('href="/documents/review"')
  })

  it('a refused call shows the API words', async () => {
    const html = await render('idle', { error: 'no document in the feeder' })
    expect(html).toContain('no document in the feeder')
  })
})
