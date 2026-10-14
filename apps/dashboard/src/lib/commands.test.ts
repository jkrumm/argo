import { describe, expect, test } from 'bun:test'
import { validateHotkey } from '@tanstack/react-hotkeys'
import { COMMANDS } from './commands'

const entries = Object.entries(COMMANDS)

describe('COMMANDS', () => {
  test('registers no nav commands: the provider lists NAV destinations itself', () => {
    expect(Object.keys(COMMANDS).filter((id) => id.startsWith('nav:'))).toEqual([])
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
