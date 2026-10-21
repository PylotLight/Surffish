import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'

/**
 * Just enough tar for an npm package tarball (ustar, pax `path` records, GNU long names): Read Aloud
 * unpacks the `phonon-tts` runtime it downloaded, after checking the tarball's npm integrity. Files
 * whose path `keep` refuses (or that would land outside the target folder) are skipped.
 */
export interface TarFile {
  path: string
  data: Uint8Array
}

function field(block: Uint8Array, start: number, length: number): string {
  const slice = block.subarray(start, start + length)
  const end = slice.indexOf(0)
  return new TextDecoder().decode(end >= 0 ? slice.subarray(0, end) : slice)
}

function octal(block: Uint8Array, start: number, length: number): number {
  const text = field(block, start, length).trim()
  return text ? parseInt(text, 8) : 0
}

function paxPath(data: Uint8Array): string | null {
  const text = new TextDecoder().decode(data)
  for (const record of text.split('\n')) {
    const match = /^\d+ path=(.*)$/.exec(record)
    if (match) return match[1]!
  }
  return null
}

export function readTar(archive: Uint8Array, keep: (path: string) => boolean): TarFile[] {
  const files: TarFile[] = []
  let offset = 0
  let longName: string | null = null
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const size = octal(header, 124, 12)
    const type = String.fromCharCode(header[156] || 48)
    const prefix = field(header, 345, 155)
    const name = field(header, 0, 100)
    const dataStart = offset + 512
    const data = archive.subarray(dataStart, dataStart + size)
    if (dataStart + size > archive.length) throw new Error('truncated tar archive')
    offset = dataStart + Math.ceil(size / 512) * 512
    if (type === 'x') {
      longName = paxPath(data) ?? longName
      continue
    }
    if (type === 'L') {
      longName = field(data, 0, data.length)
      continue
    }
    if (type === 'g') continue
    const path = longName ?? (prefix ? `${prefix}/${name}` : name)
    longName = null
    if (type !== '0' && type !== '\0' && type !== '7') continue // files only: no links, devices or dirs
    // npm tarballs put everything under `package/`.
    const relative = path.replace(/^package\//, '')
    if (relative === path || !keep(relative)) continue
    files.push({ path: relative, data: new Uint8Array(data) })
  }
  return files
}

export function readTarGz(gzipped: Uint8Array, keep: (path: string) => boolean): TarFile[] {
  return readTar(new Uint8Array(gunzipSync(gzipped)), keep)
}

/** npm's `integrity` (`sha512-<base64>`) matches these bytes. */
export function matchesIntegrity(bytes: Uint8Array, integrity: string): boolean {
  const match = /^(sha512|sha384|sha256)-([A-Za-z0-9+/]+=*)$/.exec(integrity.trim())
  if (!match) return false
  return createHash(match[1]!).update(bytes).digest('base64') === match[2]
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
