import { describe, expect, mock, test } from 'bun:test'
import { validateHotkey } from '@tanstack/react-hotkeys'
import { flattenNav } from 'basalt-ui'
import { NAV } from './nav'

// The real router singleton pulls the whole route tree (and `window`) in; commands only call it at
// run time, so the pure registry shape is testable without it.
void mock.module('./router', () => ({ router: { navigate: () => undefined } }))
const { COMMANDS } = await import('./commands')

const entries = Object.entries(COMMANDS)
const navIds = Object.keys(COMMANDS).filter((id) => id.startsWith('nav:'))

describe('COMMANDS', () => {
  test('nav commands mirror the enabled NAV destinations, in sidebar order', () => {
    const expected = flattenNav(NAV)
      .filter((d) => !d.disabled)
      .map((d) => `nav:${d.id}`)
    expect(navIds).toEqual(expected)
  })

  test('nav destination ids are unique', () => {
    const ids = flattenNav(NAV).map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('every shortcut is a valid hotkey, or absent', () => {
    for (const [id, cmd] of entries) {
      if (cmd.shortcut === undefined) continue
      expect({ id, valid: validateHotkey(cmd.shortcut).valid }).toEqual({ id, valid: true })
    }
  })

  test('no two commands share a shortcut', () => {
    const shortcuts = entries.flatMap(([, cmd]) => (cmd.shortcut ? [cmd.shortcut] : []))
    expect(new Set(shortcuts).size).toBe(shortcuts.length)
  })
})
