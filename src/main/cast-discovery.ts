import { spawn, type ChildProcess } from 'node:child_process'
import { createSocket, type Socket } from 'node:dgram'
import { lookup } from 'node:dns'
import { networkInterfaces } from 'node:os'
import {
  CAST_SERVICE,
  MDNS_ADDRESS,
  MDNS_PORT,
  MDNS_TYPE,
  MdnsRecordCache,
  castInterfaces,
  decodeMdnsRecords,
  encodeMdnsQuestions,
  interfaceForAddress,
  nextQueryDelay,
  parseDnsSdZoneLine,
  type CastDeviceRecord,
  type CastInterface,
  type MdnsQuestion
} from '../shared/cast-mdns'

/**
 * mDNS browsing for `_googlecast._tcp` (shared/cast-mdns.ts does the packets and the record cache).
 * Nothing listens or sends in the background: a browse runs while the cast picker is open, a short
 * scan runs, or a cast is live.
 *
 * Each round of questions goes out on EVERY non-internal IPv4 interface (LAN first, VPN tunnels
 * last), two ways:
 *  - from an ephemeral-port socket bound to that interface, with the QU bit: a responder answers a
 *    query from a port other than 5353 straight back to that port (RFC 6762 §6.7 "legacy unicast"),
 *    so this works even when the shared 5353 socket never sees multicast replies (mDNSResponder owns
 *    5353 on macOS) and whichever interface the OS would pick by default (the VPN's utun);
 *  - from the shared 5353 socket (reuseAddr, like every mDNS library), with the multicast interface
 *    set per send: ordinary multicast answers, plus whatever other askers' answers we overhear.
 * Rounds at 0, 250 ms, 1, 2, 4, 8 s, then every 30 s; a round that couldn't be delivered anywhere
 * (no route yet, or macOS still asking for Local Network access) is retried every 2 s. An answer
 * that names an instance without its SRV/TXT/A gets those asked for at once.
 *
 * macOS also asks mDNSResponder while the picker is open (`/usr/bin/dns-sd -Z`, killed when it
 * closes): it already knows the right interfaces and often has the Chromecast cached (Chrome, Google
 * Home), so it answers in milliseconds. It is a parallel path; the sockets don't depend on it.
 *
 * `SURFFISH_CAST_MDNS_TARGET=host:port` (smokes) sends the questions there instead, from one
 * ephemeral port (the same legacy-unicast path). `SURFFISH_CAST_DEBUG=1` logs every send, answer
 * (arrival time, sender, interface) and device.
 */

export type DeviceListener = (devices: CastDeviceRecord[]) => void

const DEBUG = process.env.SURFFISH_CAST_DEBUG === '1'
const DNS_SD = '/usr/bin/dns-sd'

function testTarget(): { host: string; port: number } | null {
  const raw = process.env.SURFFISH_CAST_MDNS_TARGET
  const match = raw ? /^([^:]+):(\d+)$/.exec(raw) : null
  return match ? { host: match[1]!, port: Number(match[2]) } : null
}

interface QuerySocket {
  socket: Socket
  /** debug label: the interface name, `5353` or `target` */
  label: string
  /** ephemeral-port socket bound to one interface (null: the shared 5353 socket / smoke target) */
  iface: CastInterface | null
  ready: boolean
}

export class CastBrowser {
  private sockets: QuerySocket[] = []
  private interfaces: CastInterface[] = []
  private cache = new MdnsRecordCache()
  private timer: ReturnType<typeof setTimeout> | null = null
  private followUpTimer: ReturnType<typeof setTimeout> | null = null
  private rounds = 0
  private startedAt = 0
  private active = false
  private lastPublished = ''
  private dnsSd: ChildProcess | null = null
  private dnsSdWanted = false
  private readonly resolving = new Set<string>()

  constructor(private readonly onDevices: DeviceListener) {}

  get running(): boolean {
    return this.active
  }

  private debug(message: string): void {
    if (DEBUG) console.log(`[cast-debug +${Date.now() - this.startedAt}ms] ${message}`)
  }

  start(): void {
    if (this.active) return
    this.active = true
    this.startedAt = Date.now()
    this.rounds = 0
    this.cache = new MdnsRecordCache()
    this.lastPublished = ''
    const target = testTarget()
    if (target) {
      this.openSocket('target', null, 0, undefined)
    } else {
      this.interfaces = castInterfaces(networkInterfaces())
      this.debug(`browse start; interfaces: ${this.interfaces.map((entry) => `${entry.name}=${entry.address}${entry.tunnel ? '(tunnel)' : ''}`).join(', ') || 'none'}`)
      for (const iface of this.interfaces) this.openSocket(iface.name, iface, 0, iface.address)
      this.openSocket('5353', null, MDNS_PORT, undefined)
    }
    this.syncDnsSd()
    // First round as soon as the sockets are bound (or now, if none bind).
    this.schedule(0)
  }

  /** macOS: also ask mDNSResponder while this is on (the picker is open). */
  setSystemResolver(on: boolean): void {
    this.dnsSdWanted = on
    this.syncDnsSd()
  }

  private openSocket(label: string, iface: CastInterface | null, port: number, address: string | undefined): void {
    const socket = createSocket({ type: 'udp4', reuseAddr: true })
    const entry: QuerySocket = { socket, label, iface, ready: false }
    this.sockets.push(entry)
    socket.on('message', (packet, info) => this.onPacket(packet, info.address, entry))
    socket.on('error', (error) => {
      this.debug(`socket ${label} error: ${error.message}`)
      this.closeSocket(entry)
    })
    socket.on('listening', () => {
      if (!this.sockets.includes(entry)) return
      entry.ready = true
      try { socket.setMulticastTTL(255) } catch { /* not fatal */ }
      if (iface) {
        try { socket.setMulticastInterface(iface.address) } catch (error) { this.debug(`setMulticastInterface ${label}: ${(error as Error).message}`) }
      }
      if (port === MDNS_PORT) {
        try { socket.setMulticastLoopback(true) } catch { /* not fatal */ }
        for (const candidate of this.interfaces) {
          try { socket.addMembership(MDNS_ADDRESS, candidate.address) } catch { /* interface without multicast */ }
        }
        if (this.interfaces.length === 0) {
          try { socket.addMembership(MDNS_ADDRESS) } catch { /* no multicast at all */ }
        }
      }
      // A socket that came up after the first round was sent joins in straight away.
      if (this.rounds > 0) this.sendRound([{ name: CAST_SERVICE, type: MDNS_TYPE.PTR }, ...this.cache.followUps(Date.now())], [entry])
    })
    try {
      socket.bind(port, address)
    } catch (error) {
      this.debug(`bind ${label}: ${(error as Error).message}`)
      this.closeSocket(entry)
    }
  }

  private closeSocket(entry: QuerySocket): void {
    this.sockets = this.sockets.filter((candidate) => candidate !== entry)
    try { entry.socket.close() } catch { /* already closed */ }
  }

  private onPacket(packet: Buffer, sender: string, entry: QuerySocket): void {
    let records
    try {
      records = decodeMdnsRecords(packet)
    } catch {
      return // someone else's malformed packet on the shared port
    }
    if (records.length === 0) return
    const now = Date.now()
    const changed = this.cache.ingest(records, sender, now)
    if (!changed) return
    if (DEBUG) {
      const via = entry.iface?.name ?? interfaceForAddress(this.interfaces, sender)?.name ?? '?'
      this.debug(`answer from ${sender} on socket ${entry.label} (iface ${via}): ${records.map((record) => `${record.type}:${record.name}`).join(' ').slice(0, 300)}`)
    }
    this.afterIngest(now)
  }

  private afterIngest(now: number): void {
    const devices = this.cache.devices(now)
    const key = JSON.stringify(devices)
    if (devices.length > 0 && key !== this.lastPublished) {
      this.lastPublished = key
      this.debug(`devices: ${devices.map((device) => `${device.name} ${device.host}:${device.port}`).join(', ')}`)
      this.onDevices(devices)
    }
    if (this.cache.followUps(now).length > 0 && !this.followUpTimer) {
      // Ask for the missing SRV/TXT/A right away instead of waiting for the next round.
      this.followUpTimer = setTimeout(() => {
        this.followUpTimer = null
        const questions = this.cache.followUps(Date.now())
        if (questions.length > 0 && this.active) {
          this.debug(`follow-up: ${questions.map((question) => `${question.type}:${question.name}`).join(' ')}`)
          this.sendRound(questions)
        }
      }, 20)
      this.followUpTimer.unref?.()
    }
  }

  private schedule(delay: number): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      if (!this.active) return
      this.rounds += 1
      const round = this.rounds
      void this.sendRound([{ name: CAST_SERVICE, type: MDNS_TYPE.PTR }, ...this.cache.followUps(Date.now())]).then((delivered) => {
        if (this.active && this.rounds === round && !this.timer) this.schedule(nextQueryDelay(round, delivered))
      })
    }, delay)
    this.timer.unref?.()
  }

  /** Ask again now (the picker was opened again). */
  refresh(): void {
    if (!this.active) return
    this.rounds = 0
    this.schedule(0)
  }

  /** One send per socket (per interface on the shared 5353 socket). Resolves true when any send went out. */
  private async sendRound(questions: MdnsQuestion[], only?: QuerySocket[]): Promise<boolean> {
    const target = testTarget()
    const qu = encodeMdnsQuestions(questions, true)
    const qm = encodeMdnsQuestions(questions, false)
    const sendOne = (entry: QuerySocket, packet: Uint8Array, host: string, port: number, label: string): Promise<boolean> => new Promise((done) => {
      try {
        entry.socket.send(packet, port, host, (error) => {
          this.debug(`send ${label} -> ${host}:${port} ${error ? `failed: ${error.message}` : 'ok'}`)
          done(!error)
        })
      } catch (error) {
        this.debug(`send ${label} threw: ${(error as Error).message}`)
        done(false)
      }
    })
    const jobs: Promise<boolean>[] = []
    for (const entry of only ?? this.sockets) {
      if (!entry.ready) continue
      if (target) jobs.push(sendOne(entry, qu, target.host, target.port, 'target (QU)'))
      else if (entry.iface) jobs.push(sendOne(entry, qu, MDNS_ADDRESS, MDNS_PORT, `${entry.label} ${entry.iface.address} (QU)`))
      else {
        // The shared socket: one interface at a time (the option applies to the next send).
        jobs.push((async () => {
          let any = false
          for (const iface of this.interfaces) {
            if (!this.sockets.includes(entry)) break
            try { entry.socket.setMulticastInterface(iface.address) } catch { continue }
            any = (await sendOne(entry, qm, MDNS_ADDRESS, MDNS_PORT, `5353 via ${iface.name} ${iface.address} (QM)`)) || any
          }
          if (this.interfaces.length === 0) any = await sendOne(entry, qm, MDNS_ADDRESS, MDNS_PORT, '5353 default (QM)')
          return any
        })())
      }
    }
    const results = await Promise.all(jobs)
    return results.some(Boolean)
  }

  private syncDnsSd(): void {
    const want = this.active && this.dnsSdWanted && process.platform === 'darwin' && !testTarget() && process.env.SURFFISH_CAST_DNSSD !== '0'
    if (want && !this.dnsSd) this.startDnsSd()
    else if (!want && this.dnsSd) this.stopDnsSd()
  }

  private startDnsSd(): void {
    let child: ChildProcess
    try {
      child = spawn(DNS_SD, ['-Z', '_googlecast._tcp', 'local'], { stdio: ['ignore', 'pipe', 'ignore'] })
    } catch (error) {
      this.debug(`dns-sd spawn failed: ${(error as Error).message}`)
      return
    }
    this.dnsSd = child
    this.debug('dns-sd started')
    let pending = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      pending += chunk
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      if (pending.length > 8_192) pending = ''
      const records = lines.map(parseDnsSdZoneLine).filter((record) => record !== null)
      if (records.length === 0 || this.dnsSd !== child) return
      const now = Date.now()
      if (this.cache.ingest(records, '', now)) {
        this.debug(`dns-sd: ${records.map((record) => `${record.type}:${record.name}`).join(' ').slice(0, 300)}`)
        this.resolveHosts(now)
        this.afterIngest(now)
      }
    })
    child.on('error', (error) => {
      this.debug(`dns-sd error: ${error.message}`)
      if (this.dnsSd === child) this.dnsSd = null
    })
    child.on('exit', () => {
      if (this.dnsSd === child) this.dnsSd = null
    })
  }

  /** dns-sd gives SRV hosts (`xxxx.local`), not addresses: the system resolver (mDNSResponder) has them. */
  private resolveHosts(now: number): void {
    for (const host of this.cache.unresolvedHosts(now)) {
      if (this.resolving.has(host)) continue
      this.resolving.add(host)
      lookup(host, { family: 4 }, (error, address) => {
        this.resolving.delete(host)
        if (!this.active) return
        this.debug(`resolve ${host}: ${error ? error.message : address}`)
        if (error || !address) return
        const at = Date.now()
        if (this.cache.ingest([{ name: host, type: MDNS_TYPE.A, ttl: 120, address }], '', at)) this.afterIngest(at)
      })
    }
  }

  private stopDnsSd(): void {
    const child = this.dnsSd
    this.dnsSd = null
    if (child) {
      this.debug('dns-sd stopped')
      try { child.kill() } catch { /* already gone */ }
    }
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    if (this.followUpTimer) clearTimeout(this.followUpTimer)
    this.timer = null
    this.followUpTimer = null
    if (this.active) this.debug('browse stop')
    this.active = false
    for (const entry of [...this.sockets]) this.closeSocket(entry)
    this.stopDnsSd()
  }
}
