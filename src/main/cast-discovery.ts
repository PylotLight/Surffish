import { createSocket, type Socket } from 'node:dgram'
import { networkInterfaces } from 'node:os'
import { CAST_SERVICE, MDNS_ADDRESS, MDNS_PORT, castDevicesFromRecords, decodeMdnsRecords, encodeMdnsQuery, type CastDeviceRecord } from '../shared/cast-mdns'

/**
 * mDNS browsing for `_googlecast._tcp` (shared/cast-mdns.ts does the packets). Nothing listens or
 * sends in the background: a browse runs while the cast picker is open or a cast is live, and asks
 * again with backoff (1 s, 3 s, 9 s, then every 30 s) on one socket. Port 5353 is shared with the
 * OS responder (reuseAddr, like every mDNS library); when it can't be bound, an ephemeral port with
 * QU questions gets unicast answers instead.
 *
 * `SURFFISH_CAST_MDNS_TARGET=host:port` (smokes) sends the questions there instead of the multicast
 * group, from an ephemeral port: the "legacy unicast" path a responder answers directly.
 */

export type DeviceListener = (devices: CastDeviceRecord[]) => void

const QUERY_DELAYS_MS = [0, 1_000, 3_000, 9_000]
const STEADY_INTERVAL_MS = 30_000

function ipv4Interfaces(): string[] {
  const out: string[] = []
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) if (entry.family === 'IPv4' && !entry.internal) out.push(entry.address)
  }
  return out
}

function testTarget(): { host: string; port: number } | null {
  const raw = process.env.SURFFISH_CAST_MDNS_TARGET
  const match = raw ? /^([^:]+):(\d+)$/.exec(raw) : null
  return match ? { host: match[1]!, port: Number(match[2]) } : null
}

export class CastBrowser {
  private socket: Socket | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private queries = 0
  private unicast = false

  constructor(private readonly onDevices: DeviceListener) {}

  get running(): boolean {
    return this.socket !== null
  }

  start(): void {
    if (this.socket) return
    const target = testTarget()
    // Port 5353 first (multicast answers); an ephemeral port with QU questions if that bind fails.
    this.open(target !== null || this.unicast, target !== null)
  }

  private open(unicast: boolean, toTarget: boolean): void {
    const socket = createSocket({ type: 'udp4', reuseAddr: true })
    this.socket = socket
    this.queries = 0
    this.unicast = unicast
    let listening = false
    socket.on('message', (packet, info) => {
      try {
        const devices = castDevicesFromRecords(decodeMdnsRecords(packet), info.address)
        if (devices.length > 0) this.onDevices(devices)
      } catch {
        // someone else's malformed packet on the shared port
      }
    })
    socket.on('error', (error) => {
      if (this.socket !== socket) return
      this.stop()
      if (!listening && !unicast) {
        this.open(true, false)
        return
      }
      console.warn('[cast] mdns socket error:', error.message)
    })
    socket.on('listening', () => {
      listening = true
      if (this.socket !== socket) return
      if (!toTarget && !unicast) {
        try { socket.setMulticastTTL(255) } catch { /* not fatal */ }
        try { socket.setMulticastLoopback(true) } catch { /* not fatal */ }
        const interfaces = ipv4Interfaces()
        for (const address of interfaces) {
          try { socket.addMembership(MDNS_ADDRESS, address) } catch { /* interface without multicast */ }
        }
        if (interfaces.length === 0) {
          try { socket.addMembership(MDNS_ADDRESS) } catch { /* no multicast at all */ }
        }
      }
      this.schedule(0)
    })
    socket.bind(unicast ? 0 : MDNS_PORT)
  }

  private schedule(delay: number): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.query()
      this.queries += 1
      const next = QUERY_DELAYS_MS[this.queries]
      this.schedule(next !== undefined ? next - (QUERY_DELAYS_MS[this.queries - 1] ?? 0) : STEADY_INTERVAL_MS)
    }, delay)
    this.timer.unref?.()
  }

  /** Ask again now (the picker was opened again). */
  refresh(): void {
    if (!this.socket) return
    this.queries = 0
    this.schedule(0)
  }

  private query(): void {
    const socket = this.socket
    if (!socket) return
    const target = testTarget()
    const packet = encodeMdnsQuery(CAST_SERVICE, this.unicast)
    const send = (host: string, port: number): void => {
      socket.send(packet, port, host, (error) => {
        if (error && this.socket === socket) console.warn('[cast] mdns query failed:', error.message)
      })
    }
    if (target) send(target.host, target.port)
    else send(MDNS_ADDRESS, MDNS_PORT)
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const socket = this.socket
    this.socket = null
    if (socket) {
      try { socket.close() } catch { /* already closed */ }
    }
  }
}
