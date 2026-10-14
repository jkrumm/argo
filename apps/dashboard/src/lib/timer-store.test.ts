import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, test } from 'bun:test'
import { timerMode, useTimerStore } from './timer-store'

/** Render the field's `use()` once and hand back what a bound control would see. */
function bind() {
  let setter: (next: 'rest' | 'interval') => void = () => {}
  let value = ''
  renderToString(
    createElement(() => {
      const [v, set] = timerMode.use()
      value = v
      setter = set
      return null
    }),
  )
  return { value, set: setter }
}

describe('timerMode field', () => {
  test('reads the zustand store mode', () => {
    useTimerStore.setState({ mode: 'interval' })
    expect(bind().value).toBe('interval')
    useTimerStore.setState({ mode: 'rest' })
    expect(bind().value).toBe('rest')
  })

  test('writes land in the zustand store', () => {
    useTimerStore.setState({ mode: 'rest' })
    bind().set('interval')
    expect(useTimerStore.getState().mode).toBe('interval')
  })

  test('clear writes the fallback', () => {
    useTimerStore.setState({ mode: 'interval' })
    timerMode.clear()
    expect(useTimerStore.getState().mode).toBe('rest')
  })
})
