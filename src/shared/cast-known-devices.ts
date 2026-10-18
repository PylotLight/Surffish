/**
 * Chromecasts seen before (userData `cast-devices.json`): shown in the picker as soon as a quick
 * TCP connect to ip:8009 says they're still there, while mDNS confirms (and updates the address).
 * Pure: the file and the connect are in src/main/cast.ts.
 */
import type { CastDevice } from './cast'

export const CAST_DEVICES_FILE = 'cast-devices.json'

export interface KnownCastDevice extends CastDevice {
  /** ms since epoch, last time mDNS (or a cast) saw it */
  seenAt: number
}

const MAX_KNOWN = 12
const FORGET_AFTER_MS = 60 * 24 * 60 * 60 * 1000
/** A seenAt this stale is worth a write even when nothing else changed. */
const SEEN_WRITE_INTERVAL_MS = 6 * 60 * 60 * 1000

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '')

function cleanDevice(raw: unknown): KnownCastDevice | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  const id = text(value.id, 64)
  const host = text(value.host, 255)
  const port = typeof value.port === 'number' && Number.isInteger(value.port) && value.port > 0 && value.port <= 65535 ? value.port : 0
  const seenAt = typeof value.seenAt === 'number' && Number.isFinite(value.seenAt) ? value.seenAt : 0
  if (!id || !host || !port || !/^[0-9a-f.:]+$/i.test(host)) return null
  return { id, name: text(value.name, 80) || id, model: text(value.model, 80), host, port, seenAt }
}

/** The saved list (newest first), without junk or anything not seen for 60 days. */
export function parseKnownCastDevices(raw: unknown, now: number): KnownCastDevice[] {
  const list = typeof raw === 'object' && raw !== null && Array.isArray((raw as { devices?: unknown }).devices) ? (raw as { devices: unknown[] }).devices : []
  const byId = new Map<string, KnownCastDevice>()
  for (const item of list) {
    const device = cleanDevice(item)
    if (device && now - device.seenAt < FORGET_AFTER_MS && !byId.has(device.id)) byId.set(device.id, device)
  }
  return [...byId.values()].sort((a, b) => b.seenAt - a.seenAt).slice(0, MAX_KNOWN)
}

/** The list after mDNS found `found` (new address/name wins). */
export function rememberCastDevices(known: readonly KnownCastDevice[], found: readonly CastDevice[], now: number): KnownCastDevice[] {
  const byId = new Map(known.map((device) => [device.id, device]))
  for (const device of found) byId.set(device.id, { id: device.id, name: device.name, model: device.model, host: device.host, port: device.port, seenAt: now })
  return [...byId.values()].sort((a, b) => b.seenAt - a.seenAt).slice(0, MAX_KNOWN)
}

/** Whether `next` is worth writing over `previous` (a device, address or name changed, or seenAt went stale). */
export function knownCastDevicesChanged(previous: readonly KnownCastDevice[], next: readonly KnownCastDevice[]): boolean {
  if (previous.length !== next.length) return true
  const before = new Map(previous.map((device) => [device.id, device]))
  return next.some((device) => {
    const old = before.get(device.id)
    return !old || old.host !== device.host || old.port !== device.port || old.name !== device.name || old.model !== device.model || device.seenAt - old.seenAt > SEEN_WRITE_INTERVAL_MS
  })
}

export function serializeKnownCastDevices(devices: readonly KnownCastDevice[]): { version: 1; devices: KnownCastDevice[] } {
  return { version: 1, devices: devices.map((device) => ({ ...device })) }
}
