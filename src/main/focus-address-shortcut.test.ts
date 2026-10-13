import { describe, expect, test } from 'bun:test'
import { isFocusAddressShortcut } from './browser-shell'

const key = (input: Partial<Parameters<typeof isFocusAddressShortcut>[0]>): Parameters<typeof isFocusAddressShortcut>[0] => ({
  type: 'keyDown', key: '', code: '', alt: false, control: false, meta: false, shift: false, ...input
})

describe('isFocusAddressShortcut', () => {
  test('bare F6 focuses the address bar', () => {
    expect(isFocusAddressShortcut(key({ key: 'F6', code: 'F6' }))).toBe(true)
  })
  test('modified F6 and key-up are ignored', () => {
    expect(isFocusAddressShortcut(key({ key: 'F6', shift: true }))).toBe(false)
    expect(isFocusAddressShortcut(key({ key: 'F6', meta: true }))).toBe(false)
    expect(isFocusAddressShortcut(key({ type: 'keyUp', key: 'F6' }))).toBe(false)
  })
  test('Alt+D only off macOS', () => {
    expect(isFocusAddressShortcut(key({ key: 'd', code: 'KeyD', alt: true }))).toBe(process.platform !== 'darwin')
    expect(isFocusAddressShortcut(key({ key: 'd', code: 'KeyD' }))).toBe(false)
  })
})
