import { describe, expect, test } from 'bun:test'
import { CAST_SERVICE, castDevicesFromRecords, decodeMdnsRecords, encodeMdnsQuery } from './cast-mdns'

const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

/** A minimal mDNS responder packet (what a Chromecast sends), with name compression for the service. */
function response(options: { instance: string; host: string; port: number; txt: string[]; address: string | null; ttl?: number }): Uint8Array {
  const out: number[] = []
  const u16 = (value: number): void => { out.push((value >> 8) & 0xff, value & 0xff) }
  const u32 = (value: number): void => { u16(value >>> 16); u16(value & 0xffff) }
  const offsets = new Map<string, number>()
  const name = (value: string): void => {
    const labels = value.split('.')
    for (let i = 0; i < labels.length; i++) {
      const rest = labels.slice(i).join('.')
      const known = offsets.get(rest)
      if (known !== undefined) {
        u16(0xc000 | known)
        return
      }
      offsets.set(rest, out.length)
      const bytes = new TextEncoder().encode(labels[i])
      out.push(bytes.length, ...bytes)
    }
    out.push(0)
  }
  const ttl = options.ttl ?? 120
  const record = (owner: string, type: number, data: () => void): void => {
    name(owner)
    u16(type); u16(0x8001); u32(ttl)
    const lengthAt = out.length
    u16(0)
    const start = out.length
    data()
    const length = out.length - start
    out[lengthAt] = length >> 8
    out[lengthAt + 1] = length & 0xff
  }
  u16(0); u16(0x8400); u16(0); u16(1); u16(0); u16(options.address ? 3 : 2)
  record(CAST_SERVICE, 12, () => name(`${options.instance}.${CAST_SERVICE}`))
  record(`${options.instance}.${CAST_SERVICE}`, 33, () => { u16(0); u16(0); u16(options.port); name(options.host) })
  record(`${options.instance}.${CAST_SERVICE}`, 16, () => { for (const entry of options.txt) { const bytes = new TextEncoder().encode(entry); out.push(bytes.length, ...bytes) } })
  if (options.address) record(options.host, 1, () => out.push(...options.address!.split('.').map(Number)))
  return Uint8Array.from(out)
}

describe('mDNS query', () => {
  test('PTR question for _googlecast._tcp.local', () => {
    const query = encodeMdnsQuery()
    expect(hex(query.subarray(0, 12))).toBe('000000000001000000000000')
    expect(new TextDecoder().decode(query.subarray(13, 24))).toBe('_googlecast')
    expect(hex(query.subarray(-4))).toBe('000c0001')
    expect(hex(encodeMdnsQuery(CAST_SERVICE, true).subarray(-4))).toBe('000c8001')
  })
})

describe('mDNS answers', () => {
  const packet = response({
    instance: 'Chromecast-Ultra-0123456789abcdef0123456789abcdef',
    host: '0123-4567.local',
    port: 8009,
    txt: ['id=0123456789abcdef0123456789abcdef', 'md=Chromecast Ultra', 'fn=Living Room TV', 've=05'],
    address: '192.168.1.40'
  })
  test('decodes compressed PTR/SRV/TXT/A records', () => {
    const records = decodeMdnsRecords(packet)
    expect(records.map((record) => record.type)).toEqual([12, 33, 16, 1])
    expect(records[1]).toMatchObject({ port: 8009, target: '0123-4567.local' })
    expect(records[2]?.txt).toMatchObject({ fn: 'Living Room TV', md: 'Chromecast Ultra' })
    expect(records[3]?.address).toBe('192.168.1.40')
  })
  test('builds the device from TXT + SRV + A', () => {
    expect(castDevicesFromRecords(decodeMdnsRecords(packet), '10.0.0.9')).toEqual([
      { id: '0123456789abcdef0123456789abcdef', name: 'Living Room TV', model: 'Chromecast Ultra', host: '192.168.1.40', port: 8009 }
    ])
  })
  test('falls back to the sender address and the instance name', () => {
    const bare = response({ instance: 'Bedroom-0123456789abcdef0123456789abcdef', host: 'x.local', port: 8010, txt: [], address: null })
    expect(castDevicesFromRecords(decodeMdnsRecords(bare), '192.168.1.41')).toEqual([
      { id: 'bedroom-0123456789abcdef0123456789abcdef', name: 'bedroom', model: '', host: '192.168.1.41', port: 8010 }
    ])
  })
  test('goodbye packets and other services yield nothing; garbage throws', () => {
    const goodbye = response({ instance: 'Gone', host: 'g.local', port: 8009, txt: ['fn=Gone'], address: null, ttl: 0 })
    expect(castDevicesFromRecords(decodeMdnsRecords(goodbye), '1.2.3.4')).toEqual([])
    expect(() => decodeMdnsRecords(Uint8Array.from([0, 0, 0]))).toThrow()
    const loop = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0xc0, 12, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0])
    expect(() => decodeMdnsRecords(loop)).toThrow()
  })
})
