import { describe, expect, it } from 'bun:test'
import { scanView, sidesMismatch } from './model'
import { SCAN_STATES } from './status-fixtures'

const labels = (view: ReturnType<typeof scanView>) => view.buttons.map((button) => button.label)

describe('scanView', () => {
  it('idle: the three starts, from the actions the API allows', () => {
    const view = scanView(SCAN_STATES.idle)
    expect(view.phase).toBe('idle')
    expect(labels(view)).toEqual(['Document', 'Fronts', 'Flatbed'])
    expect(view.buttons.map((b) => b.mode)).toEqual(['feeder', 'fronts', 'flatbed'])
    expect(view.figure).toBeNull()
  })

  it('shows only the buttons the API allows', () => {
    const view = scanView({ ...SCAN_STATES.idle, actions: SCAN_STATES.idle.actions.slice(0, 1) })
    expect(labels(view)).toEqual(['Document'])
  })

  it('scanning: the running page count and no buttons', () => {
    const view = scanView(SCAN_STATES.scanning)
    expect(view.phase).toBe('scanning')
    expect(view.figure).toBe('7')
    expect(view.buttons).toEqual([])
  })

  it('pending: the total, thumbnails numbered in order, new-scan actions left out', () => {
    const view = scanView(SCAN_STATES.pending)
    expect(view.phase).toBe('pending')
    expect(view.figure).toBe('12')
    expect(view.thumbs).toHaveLength(12)
    expect(view.thumbs[0]?.label).toBe('Page 1')
    expect(view.thumbs[11]?.label).toBe('Page 12')
    expect(labels(view)).toEqual(['Submit', 'Scan More', 'Discard'])
    expect(view.buttons[0]?.primary).toBe(true)
    expect(view.buttons[0]?.confirm).toBeUndefined()
  })

  it('fronts pending: Scan Backs first with the flip hint, submit asks first', () => {
    const view = scanView(SCAN_STATES.frontsPending)
    expect(view.phase).toBe('fronts')
    expect(labels(view)).toEqual(['Scan Backs', 'Scan More', 'Submit fronts only', 'Discard'])
    expect(view.buttons[0]).toMatchObject({ mode: 'backs', hint: 'Flip the stack', primary: true })
    expect(view.buttons[2]?.confirm?.title).toBe('File the fronts only?')
  })

  it('pair pending: two rows with their counts and no mismatch', () => {
    const view = scanView(SCAN_STATES.pairPending)
    expect(view.phase).toBe('pair')
    expect(view.figure).toBe('8 + 8')
    expect(view.rows.map((row) => [row.label, row.value])).toEqual([
      ['Fronts', '8 pages'],
      ['Backs', '8 pages'],
    ])
    expect(view.mismatch).toBeNull()
    expect(view.thumbs.map((thumb) => thumb.label).slice(7, 9)).toEqual(['Front 8', 'Back 1'])
  })

  it('pair with different counts says so in words and Submit asks first', () => {
    const view = scanView(SCAN_STATES.pairMismatch)
    expect(view.mismatch).toBe('Fronts have 8 pages, backs only 7: 1 page missing on the backs.')
    expect(view.rows.every((row) => row.bad)).toBe(true)
    const submit = view.buttons.find((button) => button.id === 'submit')
    expect(submit?.confirm?.body).toContain('backs only 7')
  })

  it('failed batch: the scanner message, Submit not involved', () => {
    const view = scanView(SCAN_STATES.failedBatch)
    expect(view.failure).toMatchObject({
      message: 'Scan stopped: all 6 pages look blank. Stack upside down?',
      needsForce: false,
    })
    expect(view.phase).toBe('idle')
  })

  it('failed scan more: Submit asks and files with force', () => {
    const view = scanView(SCAN_STATES.failedMore)
    expect(view.failure?.needsForce).toBe(true)
    const submit = view.buttons.find((button) => button.id === 'submit')
    expect(submit?.submit).toEqual({ force: true })
    expect(submit?.confirm?.title).toBe('File without the failed pages?')
    expect(submit?.confirm?.body).toContain('did not pick up the paper')
  })

  it('a failure is not shown while a scan runs', () => {
    const view = scanView({
      ...SCAN_STATES.scanning,
      lastResult: SCAN_STATES.failedBatch.lastResult,
    })
    expect(view.failure).toBeNull()
  })

  it('Discard asks first and is the dangerous one', () => {
    const discard = scanView(SCAN_STATES.pending).buttons.find((button) => button.discard)
    expect(discard?.confirm).toMatchObject({ confirmLabel: 'Discard', danger: true })
  })
})

describe('sidesMismatch', () => {
  it('is null for equal counts', () => expect(sidesMismatch(4, 4)).toBeNull())
  it('names more backs than fronts', () =>
    expect(sidesMismatch(3, 5)).toBe(
      'Backs have 5 pages, fronts only 3: 2 pages missing on the fronts.',
    ))
})
