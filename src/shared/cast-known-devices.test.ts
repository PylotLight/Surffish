import { describe, expect, test } from 'bun:test'
import { knownCastDevicesChanged, parseKnownCastDevices, rememberCastDevices, serializeKnownCastDevices } from './cast-known-devices'

const day = 24 * 60 * 60 * 1000
const tv = { id: 'abc', name: 'Living Room', model: 'Chromecast', host: '192.168.1.50', port: 8009 }

describe('known Chromecasts', () => {
  test('parses the saved list, dropping junk, duplicates and very old devices', () => {
    const now = 100 * day
    const raw = { version: 1, devices: [
      { ...tv, seenAt: now - day },
      { ...tv, name: 'dup', seenAt: now - 2 * day },
      { id: 'old', name: 'Old', model: '', host: '192.168.1.9', port: 8009, seenAt: now - 90 * day },
      { id: 'bad', name: 'Bad', host: 'evil.example; rm', port: 8009, seenAt: now },
      { id: 'noport', name: 'x', host: '192.168.1.8', port: 0, seenAt: now },
      'junk'
    ] }
    expect(parseKnownCastDevices(raw, now)).toEqual([{ ...tv, seenAt: now - day }])
    expect(parseKnownCastDevices(null, now)).toEqual([])
    expect(parseKnownCastDevices({ devices: 'nope' }, now)).toEqual([])
  })
  test('mDNS updates the address and seenAt; newest first', () => {
    const known = [{ ...tv, seenAt: 1 }, { id: 'b', name: 'Bedroom', model: '', host: '192.168.1.60', port: 8009, seenAt: 5 }]
    const next = rememberCastDevices(known, [{ ...tv, host: '192.168.1.77' }], 10)
    expect(next.map((device) => [device.id, device.host, device.seenAt])).toEqual([['abc', '192.168.1.77', 10], ['b', '192.168.1.60', 5]])
    expect(knownCastDevicesChanged(known, next)).toBe(true)
  })
  test('only a real change (or a stale seenAt) is worth a write', () => {
    const known = rememberCastDevices([], [tv], 1_000)
    expect(knownCastDevicesChanged(known, rememberCastDevices(known, [tv], 2_000))).toBe(false)
    expect(knownCastDevicesChanged(known, rememberCastDevices(known, [tv], 1_000 + day))).toBe(true)
    expect(knownCastDevicesChanged(known, rememberCastDevices(known, [{ ...tv, name: 'TV' }], 2_000))).toBe(true)
  })
  test('round-trips through the file format', () => {
    const known = rememberCastDevices([], [tv], 5 * day)
    expect(parseKnownCastDevices(JSON.parse(JSON.stringify(serializeKnownCastDevices(known))), 6 * day)).toEqual(known)
  })
})
