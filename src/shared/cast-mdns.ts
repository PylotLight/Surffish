/**
 * Chromecast discovery over multicast DNS (RFC 6762/6763): a PTR question for
 * `_googlecast._tcp.local`, answered with the device's PTR → SRV (host, port) → TXT (`fn` friendly
 * name, `md` model, `id` uuid) → A records. Hand-rolled (a query is 40 bytes; answers need name
 * compression and four record types) so Surffish carries no mDNS dependency. Pure (no Node/Electron): the socket is in
 * src/main/cast-discovery.ts.
 */
import { CAST_PORT } from './cast-protocol'

export const CAST_SERVICE = '_googlecast._tcp.local'
export const MDNS_ADDRESS = '224.0.0.251'
export const MDNS_PORT = 5353

const TYPE_A = 1
const TYPE_PTR = 12
const TYPE_TXT = 16
const TYPE_AAAA = 28
const TYPE_SRV = 33
export const MDNS_TYPE = { A: TYPE_A, PTR: TYPE_PTR, TXT: TYPE_TXT, SRV: TYPE_SRV } as const

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function encodeName(name: string, out: number[]): void {
  for (const label of name.split('.').filter(Boolean)) {
    const bytes = encoder.encode(label)
    if (bytes.length > 63) throw new Error('DNS label too long')
    out.push(bytes.length, ...bytes)
  }
  out.push(0)
}

function u16(value: number, out: number[]): void {
  out.push((value >> 8) & 0xff, value & 0xff)
}

export interface MdnsQuestion {
  name: string
  type: number
}

/**
 * One packet of questions (a PTR for the service, plus SRV/TXT/A follow-ups). `unicastResponse`
 * sets the QU bit (RFC 6762 §5.4), asking responders to reply straight to the querying socket.
 */
export function encodeMdnsQuestions(questions: readonly MdnsQuestion[], unicastResponse = false): Uint8Array {
  const out: number[] = []
  u16(0, out) // id: 0 for multicast queries
  u16(0, out) // flags: standard query
  u16(questions.length, out)
  u16(0, out); u16(0, out); u16(0, out)
  for (const question of questions) {
    encodeName(question.name, out)
    u16(question.type, out)
    u16(unicastResponse ? 0x8001 : 0x0001, out) // class IN (+ QU)
  }
  return Uint8Array.from(out)
}

/** One PTR question for the service (see encodeMdnsQuestions). */
export function encodeMdnsQuery(name = CAST_SERVICE, unicastResponse = false): Uint8Array {
  return encodeMdnsQuestions([{ name, type: MDNS_TYPE.PTR }], unicastResponse)
}

export interface DnsRecord {
  name: string
  type: number
  ttl: number
  /** PTR target / SRV target host */
  target?: string
  port?: number
  /** A / AAAA */
  address?: string
  /** TXT key=value pairs (lowercased keys) */
  txt?: Record<string, string>
}

function readName(bytes: Uint8Array, start: number): [string, number] {
  const labels: string[] = []
  let offset = start
  let end = -1
  let jumps = 0
  for (;;) {
    if (offset >= bytes.length) throw new Error('Truncated name')
    const length = bytes[offset]!
    if (length === 0) {
      offset += 1
      break
    }
    if ((length & 0xc0) === 0xc0) {
      if (offset + 1 >= bytes.length) throw new Error('Truncated pointer')
      if (++jumps > 32) throw new Error('Name pointer loop')
      if (end < 0) end = offset + 2
      offset = ((length & 0x3f) << 8) | bytes[offset + 1]!
      continue
    }
    if (offset + 1 + length > bytes.length) throw new Error('Truncated label')
    labels.push(decoder.decode(bytes.subarray(offset + 1, offset + 1 + length)))
    offset += 1 + length
  }
  return [labels.join('.'), end >= 0 ? end : offset]
}

function readTxt(bytes: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {}
  let offset = 0
  while (offset < bytes.length) {
    const length = bytes[offset]!
    const entry = decoder.decode(bytes.subarray(offset + 1, offset + 1 + length))
    offset += 1 + length
    const eq = entry.indexOf('=')
    if (eq > 0) out[entry.slice(0, eq).toLowerCase()] = entry.slice(eq + 1)
    else if (entry) out[entry.toLowerCase()] = ''
  }
  return out
}

/** Every answer/authority/additional record in one mDNS packet (questions skipped). Throws on garbage. */
export function decodeMdnsRecords(bytes: Uint8Array): DnsRecord[] {
  if (bytes.length < 12) throw new Error('Short DNS packet')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const questions = view.getUint16(4)
  const total = view.getUint16(6) + view.getUint16(8) + view.getUint16(10)
  let offset = 12
  for (let i = 0; i < questions; i++) {
    const [, next] = readName(bytes, offset)
    offset = next + 4
  }
  const records: DnsRecord[] = []
  for (let i = 0; i < total; i++) {
    const [name, next] = readName(bytes, offset)
    if (next + 10 > bytes.length) throw new Error('Truncated record')
    const type = view.getUint16(next)
    const ttl = view.getUint32(next + 4)
    const length = view.getUint16(next + 8)
    const data = next + 10
    if (data + length > bytes.length) throw new Error('Truncated record data')
    const record: DnsRecord = { name, type, ttl }
    if (type === TYPE_PTR) record.target = readName(bytes, data)[0]
    else if (type === TYPE_SRV && length >= 7) {
      record.port = view.getUint16(data + 4)
      record.target = readName(bytes, data + 6)[0]
    } else if (type === TYPE_TXT) record.txt = readTxt(bytes.subarray(data, data + length))
    else if (type === TYPE_A && length === 4) record.address = Array.from(bytes.subarray(data, data + 4)).join('.')
    else if (type === TYPE_AAAA && length === 16) {
      const parts: string[] = []
      for (let j = 0; j < 16; j += 2) parts.push(view.getUint16(data + j).toString(16))
      record.address = parts.join(':')
    }
    records.push(record)
    offset = data + length
  }
  return records
}

export interface CastDeviceRecord {
  /** Stable id: TXT `id`, else the service instance name. */
  id: string
  name: string
  model: string
  host: string
  port: number
}

const lower = (value: string): string => value.toLowerCase().replace(/\.$/, '')

interface InstanceState {
  srv?: { target: string; port: number }
  txt?: Record<string, string>
  /** Sender of the newest packet about it: stands in for a missing A record. */
  source: string
  expiresAt: number
}

/**
 * What mDNS has told us so far, across packets: a responder may answer the PTR alone and the
 * SRV/TXT/A in later packets (or only when asked). `followUps()` says what to ask for next;
 * `devices()` lists the instances complete enough to show (SRV + TXT, host from the A record or the
 * sender). Goodbyes (TTL 0) forget an instance. Pure; the clock is passed in.
 */
export class MdnsRecordCache {
  private readonly instances = new Map<string, InstanceState>()
  private readonly addresses = new Map<string, { address: string; expiresAt: number }>()

  /** Takes every record in one packet. True when something about a cast device changed. */
  ingest(records: readonly DnsRecord[], sourceAddress: string, now: number): boolean {
    const service = lower(CAST_SERVICE)
    let changed = false
    const touch = (instance: string, ttl: number): InstanceState | null => {
      if (ttl <= 0) {
        changed = this.instances.delete(instance) || changed
        return null
      }
      let state = this.instances.get(instance)
      if (!state) {
        state = { source: sourceAddress, expiresAt: 0 }
        this.instances.set(instance, state)
        changed = true
      }
      if (sourceAddress) state.source = sourceAddress
      state.expiresAt = Math.max(state.expiresAt, now + Math.min(ttl, 4_500) * 1_000)
      return state
    }
    for (const record of records) {
      const name = lower(record.name)
      if (record.type === TYPE_PTR && name === service && record.target) touch(lower(record.target), record.ttl)
      else if (record.type === TYPE_SRV && name.endsWith(`.${service}`) && record.target) {
        const state = touch(name, record.ttl)
        if (state && (state.srv?.target !== lower(record.target) || state.srv.port !== record.port)) {
          state.srv = { target: lower(record.target), port: record.port ?? 0 }
          changed = true
        }
      } else if (record.type === TYPE_TXT && name.endsWith(`.${service}`)) {
        const state = touch(name, record.ttl)
        if (state && JSON.stringify(state.txt) !== JSON.stringify(record.txt ?? {})) {
          state.txt = record.txt ?? {}
          changed = true
        }
      } else if (record.type === TYPE_A && record.address) {
        if (record.ttl <= 0) this.addresses.delete(name)
        else {
          if (this.addresses.get(name)?.address !== record.address) changed = true
          this.addresses.set(name, { address: record.address, expiresAt: now + Math.min(record.ttl, 4_500) * 1_000 })
        }
      }
    }
    return changed
  }

  private prune(now: number): void {
    for (const [name, state] of this.instances) if (state.expiresAt <= now) this.instances.delete(name)
    for (const [name, entry] of this.addresses) if (entry.expiresAt <= now) this.addresses.delete(name)
  }

  /** Questions that would complete what we know: SRV/TXT for a bare instance, A for an SRV host we can't reach otherwise. */
  followUps(now: number): MdnsQuestion[] {
    this.prune(now)
    const out: MdnsQuestion[] = []
    for (const [instance, state] of this.instances) {
      if (!state.srv) out.push({ name: instance, type: TYPE_SRV })
      if (!state.txt) out.push({ name: instance, type: TYPE_TXT })
      if (state.srv && !state.source && !this.addresses.has(state.srv.target)) out.push({ name: state.srv.target, type: TYPE_A })
    }
    return out.slice(0, 16)
  }

  /** SRV target hosts that have no address yet (the dns-sd path resolves these itself). */
  unresolvedHosts(now: number): string[] {
    this.prune(now)
    const out = new Set<string>()
    for (const state of this.instances.values()) if (state.srv && !state.source && !this.addresses.has(state.srv.target)) out.add(state.srv.target)
    return [...out]
  }

  devices(now: number): CastDeviceRecord[] {
    this.prune(now)
    const service = lower(CAST_SERVICE)
    const out: CastDeviceRecord[] = []
    for (const [instance, state] of this.instances) {
      if (!state.srv || !state.txt) continue
      const host = this.addresses.get(state.srv.target)?.address || state.source
      if (!host) continue
      const label = instance.slice(0, -(service.length + 1))
      const txt = state.txt
      out.push({
        id: (txt.id || label).slice(0, 64),
        name: (txt.fn || label.replace(/-[0-9a-f]{32}$/i, '')).slice(0, 80),
        model: (txt.md || '').slice(0, 80),
        host,
        port: state.srv.port > 0 ? state.srv.port : CAST_PORT
      })
    }
    return out
  }
}

/**
 * Cast devices described by one packet (see MdnsRecordCache). `sourceAddress` (the packet's sender)
 * stands in for the A record when a responder leaves it out. Goodbye packets (TTL 0) yield nothing.
 */
export function castDevicesFromRecords(records: readonly DnsRecord[], sourceAddress: string): CastDeviceRecord[] {
  const cache = new MdnsRecordCache()
  cache.ingest(records, sourceAddress, 0)
  return cache.devices(0)
}

export interface CastInterface {
  name: string
  address: string
  netmask: string
  /** Point-to-point / tunnel (VPN): still tried, but last. */
  tunnel: boolean
}

interface InterfaceInfo { address: string; netmask: string; family: string | number; internal: boolean }

const TUNNEL_NAME = /^(utun|tun|tap|ppp|ipsec|gpd|wg|zt|tailscale|llw|awdl|bridge100)/i

/**
 * The IPv4 interfaces to ask on, LAN first: every non-internal address (a query sent only to the
 * default multicast interface goes out the VPN's utun on a laptop with a VPN up).
 */
export function castInterfaces(table: Record<string, readonly InterfaceInfo[] | undefined>): CastInterface[] {
  const out: CastInterface[] = []
  for (const [name, entries] of Object.entries(table)) {
    for (const entry of entries ?? []) {
      if ((entry.family !== 'IPv4' && entry.family !== 4) || entry.internal) continue
      out.push({ name, address: entry.address, netmask: entry.netmask, tunnel: TUNNEL_NAME.test(name) || entry.netmask === '255.255.255.255' || entry.address.startsWith('169.254.') })
    }
  }
  return out.sort((a, b) => Number(a.tunnel) - Number(b.tunnel))
}

const ipv4Number = (address: string): number | null => {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0
}

/** The interface whose subnet holds `address` (debug logging: which network an answer came in on). */
export function interfaceForAddress(interfaces: readonly CastInterface[], address: string): CastInterface | null {
  const target = ipv4Number(address)
  if (target === null) return null
  for (const entry of interfaces) {
    const own = ipv4Number(entry.address)
    const mask = ipv4Number(entry.netmask)
    if (own !== null && mask !== null && ((own & mask) >>> 0) === ((target & mask) >>> 0)) return entry
  }
  return null
}

/**
 * When to ask again (ms after the browse started): quick at first (a Chromecast answers within a
 * few ms, but a packet can be lost or the Wi-Fi asleep), then every 30 s while the picker stays open.
 * A round whose sends all failed (no route yet, or macOS still asking for Local Network access) is
 * retried every 2 s instead of waiting for the slow cadence.
 */
export const CAST_QUERY_SCHEDULE_MS = [0, 250, 1_000, 2_000, 4_000, 8_000] as const
const STEADY_QUERY_MS = 30_000
const FAILED_RETRY_MS = 2_000

export function nextQueryDelay(roundsSent: number, lastRoundDelivered: boolean): number {
  const elapsed = CAST_QUERY_SCHEDULE_MS[roundsSent - 1] ?? 0
  const next = CAST_QUERY_SCHEDULE_MS[roundsSent]
  if (next !== undefined) return next - elapsed
  return lastRoundDelivered ? STEADY_QUERY_MS : FAILED_RETRY_MS
}

/** `dns-sd -Z` escapes: `\032` (decimal byte) and `\.` / `\\`. */
function unescapeDnsSd(value: string): string {
  const bytes: number[] = []
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!
    if (char === '\\' && /^\d{3}$/.test(value.slice(i + 1, i + 4))) {
      bytes.push(Number(value.slice(i + 1, i + 4)))
      i += 3
    } else if (char === '\\' && i + 1 < value.length) {
      bytes.push(...encoder.encode(value[i + 1]!))
      i += 1
    } else bytes.push(...encoder.encode(char))
  }
  return decoder.decode(Uint8Array.from(bytes))
}

/** Splits on whitespace outside quotes; quoted strings keep their content (TXT entries). */
function dnsSdFields(line: string): string[] {
  const out: string[] = []
  const pattern = /"((?:[^"\\]|\\.)*)"|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(line))) out.push(match[1] !== undefined ? `"${match[1]}` : match[2]!)
  return out
}

/** Owner names in `dns-sd -Z` output are relative to `local.` (`Name._googlecast._tcp`). */
const dnsSdName = (value: string): string => {
  const name = unescapeDnsSd(value).replace(/\.$/, '')
  return /\.local$/i.test(name) ? name : `${name}.local`
}

/**
 * One line of macOS `dns-sd -Z _googlecast._tcp` output (zone-file style PTR/SRV/TXT, already
 * resolved by mDNSResponder) as a record, or null for anything else (headers, comments, other
 * services). No TTL is printed: 120 s, like a Chromecast's.
 */
export function parseDnsSdZoneLine(line: string): DnsRecord | null {
  const code = line.indexOf(' ;')
  const fields = dnsSdFields(code >= 0 ? line.slice(0, code) : line)
  if (fields.length < 3 || fields[0]!.startsWith(';')) return null
  const [owner, type, ...data] = fields as [string, string, ...string[]]
  if (!/_googlecast\._tcp/i.test(owner)) return null
  const name = dnsSdName(owner)
  if (type === 'PTR') return { name, type: TYPE_PTR, ttl: 120, target: dnsSdName(data[0]!) }
  if (type === 'SRV' && data.length >= 4) {
    const port = Number(data[2])
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return null
    return { name, type: TYPE_SRV, ttl: 120, port, target: unescapeDnsSd(data[3]!).replace(/\.$/, '') }
  }
  if (type === 'TXT') {
    const txt: Record<string, string> = {}
    for (const field of data) {
      const entry = unescapeDnsSd(field.startsWith('"') ? field.slice(1) : field)
      const eq = entry.indexOf('=')
      if (eq > 0) txt[entry.slice(0, eq).toLowerCase()] = entry.slice(eq + 1)
      else if (entry) txt[entry.toLowerCase()] = ''
    }
    return { name, type: TYPE_TXT, ttl: 120, txt }
  }
  return null
}
