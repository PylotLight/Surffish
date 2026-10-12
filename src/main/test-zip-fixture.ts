/** Test-only helper: a minimal stored (uncompressed) ZIP builder for extension package fixtures. */
function zipCrc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

export function storedZip(files: Record<string, string>): Buffer {
  const localRecords: Buffer[] = []
  const centralRecords: Buffer[] = []
  let localOffset = 0
  for (const [name, text] of Object.entries(files)) {
    const filename = Buffer.from(name, 'utf8')
    const data = Buffer.from(text, 'utf8')
    const crc = zipCrc32(data)
    const local = Buffer.alloc(30 + filename.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(filename.length, 26)
    filename.copy(local, 30)
    localRecords.push(local, data)

    const central = Buffer.alloc(46 + filename.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x0314, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(filename.length, 28)
    central.writeUInt32LE((0o100600 << 16) >>> 0, 38)
    central.writeUInt32LE(localOffset, 42)
    filename.copy(central, 46)
    centralRecords.push(central)
    localOffset += local.length + data.length
  }
  const centralDirectory = Buffer.concat(centralRecords)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(Object.keys(files).length, 8)
  eocd.writeUInt16LE(Object.keys(files).length, 10)
  eocd.writeUInt32LE(centralDirectory.length, 12)
  eocd.writeUInt32LE(localOffset, 16)
  return Buffer.concat([...localRecords, centralDirectory, eocd])
}
