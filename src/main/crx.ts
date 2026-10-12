/**
 * Chrome extension package (CRX2 / CRX3) parsing. Pure Node: no Electron imports, so it is
 * unit-testable and reusable from probes.
 *
 * CRX3 layout: "Cr24" | uint32le 3 | uint32le headerSize | CrxFileHeader (protobuf) | ZIP
 *   CrxFileHeader { repeated AsymmetricKeyProof sha256_with_rsa = 2;
 *                   repeated AsymmetricKeyProof sha256_with_ecdsa = 3;
 *                   bytes signed_header_data = 10000; }   // SignedData { bytes crx_id = 1; }
 *   AsymmetricKeyProof { bytes public_key = 1; bytes signature = 2; }
 *   Each signature covers "CRX3 SignedData\0" | uint32le len(signed_header_data) | signed_header_data | ZIP.
 * CRX2 layout: "Cr24" | uint32le 2 | uint32le keyLen | uint32le sigLen | key | sig (SHA1 RSA over ZIP) | ZIP
 *
 * The extension ID is the first 16 bytes of SHA-256(publisher public key, DER SPKI), hex mapped onto a–p.
 */
import { createHash, createPublicKey, verify } from 'node:crypto'

export interface ParsedCrx {
  format: 2 | 3
  /** The embedded ZIP archive. */
  archive: Buffer
  /** DER SPKI public key whose hash is the extension ID. */
  publicKey: Buffer
  extensionId: string
  /** True when the signature by `publicKey` over the archive checks out. */
  signatureVerified: boolean
}

const CRX_MAGIC = 'Cr24'
const CRX3_SIGNED_DATA_PREFIX = Buffer.from('CRX3 SignedData\0', 'binary')
const MAX_CRX_HEADER_BYTES = 256 * 1024

/** Chrome's extension ID for a DER SPKI public key. */
export function extensionIdFromPublicKey(publicKey: Uint8Array): string {
  return extensionIdFromHashPrefix(createHash('sha256').update(publicKey).digest().subarray(0, 16))
}

function extensionIdFromHashPrefix(prefix: Uint8Array): string {
  let id = ''
  for (const byte of prefix) id += String.fromCharCode(97 + (byte >> 4), 97 + (byte & 0x0f))
  return id
}

interface ProtoField {
  field: number
  wireType: number
  value: Buffer | bigint
}

function readVarint(bytes: Buffer, offset: number): { value: bigint; next: number } {
  let value = 0n
  let shift = 0n
  let position = offset
  for (let count = 0; count < 10; count += 1) {
    if (position >= bytes.length) throw new Error('The extension package header is truncated.')
    const byte = bytes[position] as number
    position += 1
    value |= BigInt(byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return { value, next: position }
    shift += 7n
  }
  throw new Error('The extension package header has an invalid varint.')
}

/** Minimal protobuf reader: only the wire types CRX headers use (varint, length-delimited, fixed). */
function readProtoFields(bytes: Buffer): ProtoField[] {
  const fields: ProtoField[] = []
  let offset = 0
  while (offset < bytes.length) {
    const key = readVarint(bytes, offset)
    offset = key.next
    const field = Number(key.value >> 3n)
    const wireType = Number(key.value & 7n)
    if (wireType === 0) {
      const varint = readVarint(bytes, offset)
      offset = varint.next
      fields.push({ field, wireType, value: varint.value })
    } else if (wireType === 2) {
      const length = readVarint(bytes, offset)
      offset = length.next
      const end = offset + Number(length.value)
      if (length.value > BigInt(bytes.length) || end > bytes.length) throw new Error('The extension package header has a truncated field.')
      fields.push({ field, wireType, value: bytes.subarray(offset, end) })
      offset = end
    } else if (wireType === 1 || wireType === 5) {
      const size = wireType === 1 ? 8 : 4
      if (offset + size > bytes.length) throw new Error('The extension package header has a truncated field.')
      fields.push({ field, wireType, value: bytes.subarray(offset, offset + size) })
      offset += size
    } else {
      throw new Error('The extension package header uses an unsupported protobuf wire type.')
    }
  }
  return fields
}

function bytesFields(fields: ProtoField[], field: number): Buffer[] {
  return fields.filter((entry) => entry.field === field && entry.wireType === 2).map((entry) => entry.value as Buffer)
}

function verifySignature(algorithm: 'sha256' | 'sha1', data: Buffer, publicKey: Buffer, signature: Buffer): boolean {
  try {
    const key = createPublicKey({ key: publicKey, format: 'der', type: 'spki' })
    return verify(algorithm, data, key, signature)
  } catch {
    return false
  }
}

function assertZip(archive: Buffer): void {
  if (archive.length < 22 || archive.readUInt32LE(0) !== 0x04034b50) {
    throw new Error('The extension package does not contain a ZIP archive.')
  }
}

function parseCrx3(bytes: Buffer): ParsedCrx {
  if (bytes.length < 12) throw new Error('The extension package is truncated.')
  const headerSize = bytes.readUInt32LE(8)
  if (headerSize > MAX_CRX_HEADER_BYTES || 12 + headerSize > bytes.length) throw new Error('The extension package header size is invalid.')
  const header = bytes.subarray(12, 12 + headerSize)
  const archive = bytes.subarray(12 + headerSize)
  assertZip(archive)
  const fields = readProtoFields(header)
  const signedHeaderData = bytesFields(fields, 10000)[0]
  if (!signedHeaderData) throw new Error('The CRX3 package has no signed header data.')
  const crxId = bytesFields(readProtoFields(signedHeaderData), 1)[0]
  if (!crxId || crxId.length !== 16) throw new Error('The CRX3 package has no valid extension ID.')
  const extensionId = extensionIdFromHashPrefix(crxId)

  const lengthBytes = Buffer.alloc(4)
  lengthBytes.writeUInt32LE(signedHeaderData.length)
  const signedPayload = Buffer.concat([CRX3_SIGNED_DATA_PREFIX, lengthBytes, signedHeaderData, archive])

  // The publisher key is the proof whose key hashes to crx_id (the Web Store adds its own proof too).
  for (const proofBytes of bytesFields(fields, 2)) {
    const proof = readProtoFields(proofBytes)
    const publicKey = bytesFields(proof, 1)[0]
    const signature = bytesFields(proof, 2)[0]
    if (!publicKey || !signature || extensionIdFromPublicKey(publicKey) !== extensionId) continue
    return {
      format: 3,
      archive: Buffer.from(archive),
      publicKey: Buffer.from(publicKey),
      extensionId,
      signatureVerified: verifySignature('sha256', signedPayload, publicKey, signature)
    }
  }
  throw new Error('The CRX3 package has no publisher key matching its extension ID.')
}

function parseCrx2(bytes: Buffer): ParsedCrx {
  if (bytes.length < 16) throw new Error('The extension package is truncated.')
  const keyLength = bytes.readUInt32LE(8)
  const signatureLength = bytes.readUInt32LE(12)
  const keyEnd = 16 + keyLength
  const signatureEnd = keyEnd + signatureLength
  if (keyLength === 0 || keyLength > MAX_CRX_HEADER_BYTES || signatureLength > MAX_CRX_HEADER_BYTES || signatureEnd > bytes.length) {
    throw new Error('The CRX2 package header is invalid.')
  }
  const publicKey = bytes.subarray(16, keyEnd)
  const signature = bytes.subarray(keyEnd, signatureEnd)
  const archive = bytes.subarray(signatureEnd)
  assertZip(archive)
  return {
    format: 2,
    archive: Buffer.from(archive),
    publicKey: Buffer.from(publicKey),
    extensionId: extensionIdFromPublicKey(publicKey),
    signatureVerified: verifySignature('sha1', archive, publicKey, signature)
  }
}

/** Parse a CRX2 or CRX3 package and return its ZIP, publisher key, and verified identity. */
export function parseCrx(input: Uint8Array): ParsedCrx {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  if (bytes.length < 12 || bytes.subarray(0, 4).toString('binary') !== CRX_MAGIC) {
    throw new Error('The download is not a Chrome extension package (missing the Cr24 header).')
  }
  const version = bytes.readUInt32LE(4)
  if (version === 3) return parseCrx3(bytes)
  if (version === 2) return parseCrx2(bytes)
  throw new Error(`Unsupported Chrome extension package version ${version}.`)
}
