import { describe, expect, test } from 'bun:test'
import {
  CAST_QUERY_SCHEDULE_MS,
  CAST_SERVICE,
  MDNS_TYPE,
  MdnsRecordCache,
  castDevicesFromRecords,
  castInterfaces,
  decodeMdnsRecords,
  encodeMdnsQuery,
  encodeMdnsQuestions,
  interfaceForAddress,
  nextQueryDelay,
  parseDnsSdZoneLine,
  type DnsRecord
} from './cast-mdns'

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

describe('follow-up questions', () => {
  test('several questions in one packet, with QU', () => {
    const packet = encodeMdnsQuestions([{ name: CAST_SERVICE, type: MDNS_TYPE.PTR }, { name: `tv.${CAST_SERVICE}`, type: MDNS_TYPE.SRV }], true)
    expect(hex(packet.subarray(4, 6))).toBe('0002')
    expect(hex(packet.subarray(-4))).toBe('00218001')
  })
})

describe('MdnsRecordCache', () => {
  const instance = `Living-Room-0123456789abcdef0123456789abcdef.${CAST_SERVICE}`
  const ptr: DnsRecord = { name: CAST_SERVICE, type: MDNS_TYPE.PTR, ttl: 120, target: instance }
  const srv: DnsRecord = { name: instance, type: MDNS_TYPE.SRV, ttl: 120, port: 8009, target: 'abcd.local' }
  const txt: DnsRecord = { name: instance, type: MDNS_TYPE.TXT, ttl: 120, txt: { id: 'abc', fn: 'Living Room', md: 'Chromecast' } }
  const a: DnsRecord = { name: 'abcd.local', type: MDNS_TYPE.A, ttl: 120, address: '192.168.1.50' }

  test('a bare PTR asks for SRV and TXT and shows nothing yet', () => {
    const cache = new MdnsRecordCache()
    expect(cache.ingest([ptr], '192.168.1.50', 0)).toBe(true)
    expect(cache.devices(0)).toEqual([])
    expect(cache.followUps(0)).toEqual([{ name: instance.toLowerCase(), type: MDNS_TYPE.SRV }, { name: instance.toLowerCase(), type: MDNS_TYPE.TXT }])
  })
  test('records arriving in separate packets complete the device', () => {
    const cache = new MdnsRecordCache()
    cache.ingest([ptr], '192.168.1.50', 0)
    cache.ingest([srv, txt], '192.168.1.50', 10)
    expect(cache.followUps(10)).toEqual([])
    expect(cache.devices(10)).toEqual([{ id: 'abc', name: 'Living Room', model: 'Chromecast', host: '192.168.1.50', port: 8009 }])
    expect(cache.ingest([srv, txt], '192.168.1.50', 20)).toBe(false)
  })
  test('the A record wins over the sender; an address change is a change', () => {
    const cache = new MdnsRecordCache()
    cache.ingest([ptr, srv, txt, a], '10.0.0.1', 0)
    expect(cache.devices(0)[0]?.host).toBe('192.168.1.50')
    expect(cache.ingest([{ ...a, address: '192.168.1.51' }], '10.0.0.1', 5)).toBe(true)
    expect(cache.devices(5)[0]?.host).toBe('192.168.1.51')
  })
  test('without a sender (dns-sd) the SRV host needs resolving', () => {
    const cache = new MdnsRecordCache()
    cache.ingest([ptr, srv, txt], '', 0)
    expect(cache.devices(0)).toEqual([])
    expect(cache.unresolvedHosts(0)).toEqual(['abcd.local'])
    expect(cache.followUps(0)).toEqual([{ name: 'abcd.local', type: MDNS_TYPE.A }])
    cache.ingest([a], '', 1)
    expect(cache.devices(1)[0]?.host).toBe('192.168.1.50')
  })
  test('goodbyes and expiry forget the instance', () => {
    const cache = new MdnsRecordCache()
    cache.ingest([ptr, srv, txt, a], '192.168.1.50', 0)
    expect(cache.ingest([{ ...srv, ttl: 0 }], '192.168.1.50', 1)).toBe(true)
    expect(cache.devices(1)).toEqual([])
    cache.ingest([ptr, srv, txt, a], '192.168.1.50', 0)
    expect(cache.devices(121_000)).toEqual([])
  })
})

describe('interfaces', () => {
  const table = {
    lo0: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', internal: true }],
    utun4: [{ address: '10.8.0.2', netmask: '255.255.255.255', family: 'IPv4', internal: false }],
    en0: [{ address: '192.168.1.20', netmask: '255.255.255.0', family: 'IPv4', internal: false }, { address: 'fe80::1', netmask: 'ffff::', family: 'IPv6', internal: false }]
  }
  test('every non-internal IPv4 address, LAN before tunnels', () => {
    expect(castInterfaces(table)).toEqual([
      { name: 'en0', address: '192.168.1.20', netmask: '255.255.255.0', tunnel: false },
      { name: 'utun4', address: '10.8.0.2', netmask: '255.255.255.255', tunnel: true }
    ])
  })
  test('finds the interface an answer came in on', () => {
    expect(interfaceForAddress(castInterfaces(table), '192.168.1.50')?.name).toBe('en0')
    expect(interfaceForAddress(castInterfaces(table), '172.16.0.1')).toBeNull()
  })
})

describe('query schedule', () => {
  test('quick early rounds, then 30 s; failed rounds retry every 2 s', () => {
    const delays = CAST_QUERY_SCHEDULE_MS.map((_, index) => nextQueryDelay(index + 1, true))
    expect(delays).toEqual([250, 750, 1_000, 2_000, 4_000, 30_000])
    expect(nextQueryDelay(6, false)).toBe(2_000)
    expect(nextQueryDelay(9, true)).toBe(30_000)
  })
})

describe('dns-sd -Z output', () => {
  const lines = [
    'Browsing for _googlecast._tcp',
    '; To direct clients to browse a different domain, substitute that domain in place of \'@\'',
    'lb._dns-sd._udp                                 PTR     @',
    '_googlecast._tcp                                PTR     Living\\032Room-0123._googlecast._tcp',
    'Living\\032Room-0123._googlecast._tcp           SRV     0 0 8009 0123-ab.local. ; Replace with unicast FQDN of target host',
    'Living\\032Room-0123._googlecast._tcp           TXT     "id=0123" "cd=x" "md=Chromecast Ultra" "fn=Living Room \\"TV\\"" "rs="'
  ]
  test('parses PTR/SRV/TXT, ignoring headers and other services', () => {
    const records = lines.map(parseDnsSdZoneLine)
    expect(records.slice(0, 3)).toEqual([null, null, null])
    expect(records[3]).toEqual({ name: '_googlecast._tcp.local', type: MDNS_TYPE.PTR, ttl: 120, target: 'Living Room-0123._googlecast._tcp.local' })
    expect(records[4]).toMatchObject({ name: 'Living Room-0123._googlecast._tcp.local', type: MDNS_TYPE.SRV, port: 8009, target: '0123-ab.local' })
    expect(records[5]?.txt).toEqual({ id: '0123', cd: 'x', md: 'Chromecast Ultra', fn: 'Living Room "TV"', rs: '' })
  })
  test('feeds the cache like an mDNS answer', () => {
    const cache = new MdnsRecordCache()
    cache.ingest(lines.map(parseDnsSdZoneLine).filter((record) => record !== null), '', 0)
    cache.ingest([{ name: '0123-ab.local', type: MDNS_TYPE.A, ttl: 120, address: '192.168.1.9' }], '', 0)
    expect(cache.devices(0)).toEqual([{ id: '0123', name: 'Living Room "TV"', model: 'Chromecast Ultra', host: '192.168.1.9', port: 8009 }])
  })
})
