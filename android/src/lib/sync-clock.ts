/**
 * Ids + hybrid logical clock for sync-ready rows. Same stamp format as desktop's
 * src/shared/sync-clock.ts (feat/sqlite-store): `<wall ms, 13 digits>:<counter, 4 hex>:<device id>`.
 * Once that lands on main this file should just re-export it.
 */
const HEX = '0123456789abcdef'

function randomBytes(count: number): Uint8Array {
  const bytes = new Uint8Array(count)
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto
  if (c?.getRandomValues) c.getRandomValues(bytes)
  else for (let i = 0; i < count; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  return bytes
}

export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16)
  let ms = Math.max(0, Math.floor(now))
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = ms % 256
    ms = Math.floor(ms / 256)
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  let out = ''
  bytes.forEach((byte, index) => {
    if (index === 4 || index === 6 || index === 8 || index === 10) out += '-'
    out += HEX[byte >> 4]! + HEX[byte & 15]!
  })
  return out
}

export function formatHlc(wall: number, counter: number, deviceId: string): string {
  return `${String(Math.max(0, Math.floor(wall))).padStart(13, '0')}:${counter.toString(16).padStart(4, '0')}:${deviceId}`
}

export class HybridLogicalClock {
  private wall = 0
  private counter = 0

  constructor(readonly deviceId: string, last?: string | null) {
    const match = last ? /^(\d{13}):([0-9a-f]{4}):/.exec(last) : null
    if (match) {
      this.wall = Number(match[1])
      this.counter = Number.parseInt(match[2]!, 16)
    }
  }

  /** Stamp for a local write. */
  now(): string {
    const wall = Date.now()
    if (wall > this.wall) {
      this.wall = wall
      this.counter = 0
    } else {
      this.counter = Math.min(this.counter + 1, 0xffff)
    }
    return formatHlc(this.wall, this.counter, this.deviceId)
  }
}
