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

/**
 * One PTR question. `unicastResponse` sets the QU bit (RFC 6762 §5.4), asking responders to reply
 * straight to the querying socket, which helps when port 5353 couldn't be bound.
 */
export function encodeMdnsQuery(name = CAST_SERVICE, unicastResponse = false): Uint8Array {
  const out: number[] = []
  u16(0, out) // id: 0 for multicast queries
  u16(0, out) // flags: standard query
  u16(1, out) // one question
  u16(0, out); u16(0, out); u16(0, out)
  encodeName(name, out)
  u16(TYPE_PTR, out)
  u16(unicastResponse ? 0x8001 : 0x0001, out) // class IN (+ QU)
  return Uint8Array.from(out)
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

/**
 * Cast devices described by one packet. `sourceAddress` (the packet's sender) stands in for the A
 * record when a responder leaves it out. Goodbye packets (TTL 0) yield nothing.
 */
export function castDevicesFromRecords(records: readonly DnsRecord[], sourceAddress: string): CastDeviceRecord[] {
  const service = lower(CAST_SERVICE)
  const instances = new Set<string>()
  for (const record of records) {
    if (record.type === TYPE_PTR && lower(record.name) === service && record.target && record.ttl > 0) instances.add(lower(record.target))
    if ((record.type === TYPE_SRV || record.type === TYPE_TXT) && lower(record.name).endsWith(`.${service}`) && record.ttl > 0) instances.add(lower(record.name))
  }
  const addresses = new Map<string, string>()
  for (const record of records) {
    if (record.type === TYPE_A && record.address) addresses.set(lower(record.name), record.address)
  }
  const out: CastDeviceRecord[] = []
  for (const instance of instances) {
    const srv = records.find((record) => record.type === TYPE_SRV && lower(record.name) === instance)
    const txt = records.find((record) => record.type === TYPE_TXT && lower(record.name) === instance)?.txt ?? {}
    const label = instance.slice(0, -(service.length + 1))
    const host = (srv?.target && addresses.get(lower(srv.target))) || sourceAddress
    if (!host) continue
    out.push({
      id: (txt.id || label).slice(0, 64),
      name: (txt.fn || label.replace(/-[0-9a-f]{32}$/i, '')).slice(0, 80),
      model: (txt.md || '').slice(0, 80),
      host,
      port: srv?.port && srv.port > 0 ? srv.port : CAST_PORT
    })
  }
  return out
}
