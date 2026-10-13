import { describe, expect, test } from 'bun:test'
import { isAlwaysAllowedPermission } from './site-permissions.ts'

describe('isAlwaysAllowedPermission', () => {
  test('clipboard writes and fullscreen are allowed like Chrome', () => {
    expect(isAlwaysAllowedPermission('clipboard-sanitized-write')).toBe(true)
    expect(isAlwaysAllowedPermission('fullscreen')).toBe(true)
  })
  test('clipboard reads and sensitive permissions still need site settings', () => {
    for (const permission of ['clipboard-read', 'media', 'geolocation', 'notifications', 'openExternal']) {
      expect(isAlwaysAllowedPermission(permission)).toBe(false)
    }
  })
})
