import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { inflateRawSync } from 'node:zlib'

const RELEASES_API = 'https://api.github.com/repos/flythenimbus/bramble/releases?per_page=100'
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024
const MAX_CHECKSUM_BYTES = 64 * 1024
const MAX_ARCHIVE_FILES = 5000
const MAX_FILE_BYTES = 32 * 1024 * 1024
const MAX_TOTAL_UNCOMPRESSED_BYTES = 128 * 1024 * 1024
const ALLOWED_ASSET_HOSTS = new Set([
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com'
])

export interface BrambleFirefoxRelease {
  version: string
  tag: string
  zipName: string
  zipUrl: string
  zipSize: number
  githubDigest: string | null
  checksumsUrl: string
  checksumsSize: number
  checksumsGithubDigest: string | null
}

export interface VerifiedBrambleFirefoxRelease {
  release: BrambleFirefoxRelease
  archive: Buffer
  sha256: string
}

interface ZipEntry {
  name: string
  originalName: Buffer
  directory: boolean
  method: number
  flags: number
  crc: number
  compressedSize: number
  uncompressedSize: number
  localOffset: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type ReleaseFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export function compareBrambleVersions(left: string, right: string): number {
  const a = left.split('.').map(BigInt)
  const b = right.split('.').map(BigInt)
  for (let index = 0; index < 3; index += 1) {
    const aPart = a[index] ?? 0n
    const bPart = b[index] ?? 0n
    if (aPart !== bPart) return aPart > bPart ? 1 : -1
  }
  return 0
}

function stableFirefoxVersion(tag: unknown): string | null {
  if (typeof tag !== 'string') return null
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-firefox$/.exec(tag)
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null
}

function validateAssetUrl(value: unknown, tag: string, assetName: string): string {
  if (typeof value !== 'string') throw new Error(`Bramble release is missing the ${assetName} download URL.`)
  const url = new URL(value)
  const expectedPath = `/flythenimbus/bramble/releases/download/${tag}/${assetName}`
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.pathname !== expectedPath || url.search || url.hash) {
    throw new Error(`The Bramble release contains an unexpected download URL for ${assetName}.`)
  }
  return url.toString()
}

/** Select the highest stable Firefox tag and require its ZIP plus published checksum file. */
export function selectLatestBrambleFirefoxRelease(input: unknown): BrambleFirefoxRelease {
  if (!Array.isArray(input)) throw new Error('GitHub returned an invalid Bramble releases list.')
  const candidates = input.flatMap((value) => {
    if (!isRecord(value) || value.draft === true || value.prerelease === true) return []
    const version = stableFirefoxVersion(value.tag_name)
    return version ? [{ release: value, version, tag: value.tag_name as string }] : []
  })
  candidates.sort((left, right) => compareBrambleVersions(right.version, left.version))
  const selected = candidates[0]
  if (!selected) throw new Error('No stable Bramble Firefox release is available.')

  const expectedZipName = `bramble_firefox_${selected.version}.zip`
  const assets = Array.isArray(selected.release.assets) ? selected.release.assets.filter(isRecord) : []
  const zipAssets = assets.filter((asset) => asset.name === expectedZipName)
  const checksumAssets = assets.filter((asset) => asset.name === 'SHA256SUMS')
  if (zipAssets.length !== 1 || checksumAssets.length !== 1) {
    throw new Error(`Bramble ${selected.version} does not publish exactly one Firefox ZIP and SHA256SUMS file.`)
  }
  const zip = zipAssets.at(0)
  const checksums = checksumAssets.at(0)
  if (!zip || !checksums) throw new Error(`Bramble ${selected.version} does not publish its Firefox ZIP and SHA256SUMS file.`)
  if (typeof zip.size !== 'number' || !Number.isSafeInteger(zip.size) || zip.size <= 0 || zip.size > MAX_ARCHIVE_BYTES) {
    throw new Error('The Bramble Firefox archive has an invalid or excessive size.')
  }
  if (typeof checksums.size !== 'number' || !Number.isSafeInteger(checksums.size) || checksums.size <= 0 || checksums.size > MAX_CHECKSUM_BYTES) {
    throw new Error('The Bramble release checksum file has an invalid or excessive size.')
  }
  const digest = typeof zip.digest === 'string' ? zip.digest : null
  const checksumsDigest = typeof checksums.digest === 'string' ? checksums.digest : null
  if (digest !== null && !/^sha256:[a-f\d]{64}$/i.test(digest)) {
    throw new Error('GitHub returned an unsupported digest for the Bramble Firefox archive.')
  }
  if (checksumsDigest !== null && !/^sha256:[a-f\d]{64}$/i.test(checksumsDigest)) {
    throw new Error('GitHub returned an unsupported digest for the Bramble release checksum file.')
  }

  return {
    version: selected.version,
    tag: selected.tag,
    zipName: expectedZipName,
    zipUrl: validateAssetUrl(zip.browser_download_url, selected.tag, expectedZipName),
    zipSize: zip.size,
    githubDigest: digest?.slice('sha256:'.length).toLowerCase() ?? null,
    checksumsUrl: validateAssetUrl(checksums.browser_download_url, selected.tag, 'SHA256SUMS'),
    checksumsSize: checksums.size,
    checksumsGithubDigest: checksumsDigest?.slice('sha256:'.length).toLowerCase() ?? null
  }
}

async function fetchJson(fetcher: ReleaseFetcher): Promise<unknown> {
  const response = await fetcher(RELEASES_API, {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    redirect: 'error',
    signal: AbortSignal.timeout(20_000)
  })
  if (!response.ok) throw new Error(`Could not check Bramble releases on GitHub (HTTP ${response.status}).`)
  return response.json() as Promise<unknown>
}

export async function fetchLatestBrambleFirefoxRelease(fetcher: ReleaseFetcher = fetch): Promise<BrambleFirefoxRelease> {
  return selectLatestBrambleFirefoxRelease(await fetchJson(fetcher))
}

async function readBoundedResponse(response: Response, limit: number, expectedSize: number, label: string): Promise<Buffer> {
  if (!response.ok) throw new Error(`Could not download ${label} (HTTP ${response.status}).`)
  const contentLength = response.headers.get('content-length')
  if (contentLength && Number(contentLength) > limit) throw new Error(`${label} exceeds the allowed download size.`)
  if (!response.body) throw new Error(`${label} download returned an empty response.`)
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) {
        await reader.cancel()
        throw new Error(`${label} exceeds the allowed download size.`)
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  if (total !== expectedSize) throw new Error(`${label} size did not match GitHub release metadata.`)
  return Buffer.concat(chunks, total)
}

async function downloadReleaseAsset(url: string, limit: number, expectedSize: number, label: string, fetcher: ReleaseFetcher): Promise<Buffer> {
  let current = new URL(url)
  for (let hop = 0; hop < 4; hop += 1) {
    if (current.protocol !== 'https:' || !ALLOWED_ASSET_HOSTS.has(current.hostname) || current.port || current.username || current.password) {
      throw new Error(`The ${label} download redirected outside GitHub's release asset hosts.`)
    }
    const response = await fetcher(current, { redirect: 'manual', signal: AbortSignal.timeout(45_000) })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || hop === 3) throw new Error(`The ${label} download returned an invalid redirect.`)
      current = new URL(location, current)
      continue
    }
    return readBoundedResponse(response, limit, expectedSize, label)
  }
  throw new Error(`The ${label} download exceeded the redirect limit.`)
}

function parseChecksumFile(contents: Buffer, filename: string): string {
  const text = contents.toString('utf8')
  if (text.includes('\u0000')) throw new Error('The Bramble SHA256SUMS file is not valid text.')
  const matches: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-f\d]{64})\s+\*?(.+?)\s*$/i.exec(line)
    if (match?.[2] === filename) matches.push(match[1]!.toLowerCase())
  }
  if (matches.length !== 1) throw new Error(`SHA256SUMS must contain exactly one checksum for ${filename}.`)
  return matches[0]!
}

export async function downloadVerifiedBrambleFirefoxRelease(
  fetcher: ReleaseFetcher = fetch,
  selectedRelease?: BrambleFirefoxRelease
): Promise<VerifiedBrambleFirefoxRelease> {
  const release = selectedRelease ?? await fetchLatestBrambleFirefoxRelease(fetcher)
  const [archive, checksums] = await Promise.all([
    downloadReleaseAsset(release.zipUrl, MAX_ARCHIVE_BYTES, release.zipSize, 'Bramble Firefox archive', fetcher),
    downloadReleaseAsset(release.checksumsUrl, MAX_CHECKSUM_BYTES, release.checksumsSize, 'Bramble release checksums', fetcher)
  ])
  const sha256 = createHash('sha256').update(archive).digest('hex')
  if (release.checksumsGithubDigest && createHash('sha256').update(checksums).digest('hex') !== release.checksumsGithubDigest) {
    throw new Error('The Bramble SHA256SUMS file did not match GitHub’s release asset digest.')
  }
  const publishedChecksum = parseChecksumFile(checksums, release.zipName)
  if (sha256 !== publishedChecksum) throw new Error('The Bramble Firefox archive did not match its published SHA256SUMS checksum.')
  if (release.githubDigest && sha256 !== release.githubDigest) throw new Error('The Bramble Firefox archive did not match GitHub’s release asset digest.')
  return { release, archive, sha256 }
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function normalizedArchivePath(name: string, label: string): string {
  const portable = name.replaceAll('\\', '/')
  if (!portable || portable.startsWith('/') || portable.startsWith('//') || /^[a-z\d]:/i.test(portable) || portable.includes('\u0000')) {
    throw new Error(`The ${label} ZIP contains an unsafe file path.`)
  }
  const parts = portable.split('/').filter((part) => part !== '' && part !== '.')
  if (parts.some((part) => part === '..' || part.includes(':'))) throw new Error(`The ${label} ZIP contains a path traversal entry.`)
  const normalized = parts.join('/')
  if (!normalized) throw new Error(`The ${label} ZIP contains an empty file path.`)
  return normalized
}

function readZipEntries(archive: Buffer, label: string, maxArchiveBytes: number): { entries: ZipEntry[]; directoryOffset: number } {
  if (archive.length < 22 || archive.length > maxArchiveBytes) throw new Error(`The ${label} ZIP has an invalid size.`)
  const minimumEocd = Math.max(0, archive.length - 22 - 65_535)
  let eocd = -1
  for (let offset = archive.length - 22; offset >= minimumEocd; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50 && offset + 22 + archive.readUInt16LE(offset + 20) === archive.length) {
      eocd = offset
      break
    }
  }
  if (eocd < 0) throw new Error(`The ${label} ZIP is missing its end-of-directory record.`)
  const diskNumber = archive.readUInt16LE(eocd + 4)
  const directoryDisk = archive.readUInt16LE(eocd + 6)
  const diskEntries = archive.readUInt16LE(eocd + 8)
  const entryCount = archive.readUInt16LE(eocd + 10)
  const directorySize = archive.readUInt32LE(eocd + 12)
  const directoryOffset = archive.readUInt32LE(eocd + 16)
  if (diskNumber !== 0 || directoryDisk !== 0 || diskEntries !== entryCount || entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new Error(`The ${label} ZIP uses an unsupported multi-disk or ZIP64 format.`)
  }
  if (entryCount > MAX_ARCHIVE_FILES || directoryOffset + directorySize !== eocd) throw new Error(`The ${label} ZIP directory is invalid or too large.`)

  const entries: ZipEntry[] = []
  const paths = new Set<string>()
  let totalUncompressed = 0
  let offset = directoryOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocd || archive.readUInt32LE(offset) !== 0x02014b50) throw new Error(`The ${label} ZIP contains an invalid directory entry.`)
    const madeBy = archive.readUInt16LE(offset + 4)
    const flags = archive.readUInt16LE(offset + 8)
    const method = archive.readUInt16LE(offset + 10)
    const crc = archive.readUInt32LE(offset + 16)
    const compressedSize = archive.readUInt32LE(offset + 20)
    const uncompressedSize = archive.readUInt32LE(offset + 24)
    const filenameLength = archive.readUInt16LE(offset + 28)
    const extraLength = archive.readUInt16LE(offset + 30)
    const commentLength = archive.readUInt16LE(offset + 32)
    const externalAttributes = archive.readUInt32LE(offset + 38)
    const localOffset = archive.readUInt32LE(offset + 42)
    const end = offset + 46 + filenameLength + extraLength + commentLength
    if (end > eocd || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff || localOffset >= directoryOffset) {
      throw new Error(`The ${label} ZIP contains an unsupported ZIP64 or truncated entry.`)
    }
    if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0 || ![0, 8].includes(method)) throw new Error(`The ${label} ZIP uses encryption or an unsupported compression method.`)
    const originalName = Buffer.from(archive.subarray(offset + 46, offset + 46 + filenameLength))
    let decodedName: string
    try {
      decodedName = new TextDecoder('utf-8', { fatal: true }).decode(originalName)
    } catch {
      throw new Error(`The ${label} ZIP contains a non-UTF-8 file name.`)
    }
    const directory = decodedName.endsWith('/') || ((externalAttributes >>> 16) & 0o170000) === 0o040000
    const unixFileType = (madeBy >>> 8) === 3 ? (externalAttributes >>> 16) & 0o170000 : 0
    if (unixFileType !== 0 && unixFileType !== 0o100000 && unixFileType !== 0o040000) throw new Error(`The ${label} ZIP contains a link or special file.`)
    const name = normalizedArchivePath(decodedName, label)
    const collisionKey = name.toLowerCase()
    if (paths.has(collisionKey)) throw new Error(`The ${label} ZIP contains duplicate or case-colliding paths.`)
    paths.add(collisionKey)
    if (uncompressedSize > MAX_FILE_BYTES || compressedSize > MAX_ARCHIVE_BYTES || (directory && uncompressedSize !== 0)) {
      throw new Error(`The ${label} ZIP contains an oversized or invalid file entry.`)
    }
    totalUncompressed += uncompressedSize
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) throw new Error(`The ${label} ZIP expands beyond the allowed size.`)
    entries.push({ name, originalName, directory, method, flags, crc, compressedSize, uncompressedSize, localOffset })
    offset = end
  }
  if (offset !== directoryOffset + directorySize) throw new Error(`The ${label} ZIP directory size is inconsistent.`)
  if (!entries.some((entry) => !entry.directory && entry.name === 'manifest.json')) throw new Error(`The ${label} ZIP does not contain a root manifest.json.`)
  return { entries, directoryOffset }
}

export interface ExtractExtensionZipOptions {
  /** Name used in error messages, e.g. "Bramble Firefox" or "extension package". */
  label: string
  /** Skip entries for which this returns true (e.g. the Web Store's `_metadata/`). */
  skip?: (path: string) => boolean
  maxArchiveBytes?: number
}

/** Extract only regular files from a checksum-verified, bounded ZIP; reject links and traversal. */
export function extractBrambleFirefoxArchive(archiveBytes: Uint8Array, destinationDirectory: string): void {
  extractExtensionZip(archiveBytes, destinationDirectory, { label: 'Bramble Firefox' })
}

/** Extract only regular files from a bounded extension ZIP; reject links, traversal, and ZIP64. */
export function extractExtensionZip(archiveBytes: Uint8Array, destinationDirectory: string, options: ExtractExtensionZipOptions): void {
  const label = options.label
  const archive = Buffer.from(archiveBytes.buffer, archiveBytes.byteOffset, archiveBytes.byteLength)
  const { entries, directoryOffset } = readZipEntries(archive, label, options.maxArchiveBytes ?? MAX_ARCHIVE_BYTES)
  const destination = resolve(destinationDirectory)
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })
  for (const entry of entries) {
    const local = entry.localOffset
    if (local + 30 > archive.length || archive.readUInt32LE(local) !== 0x04034b50) throw new Error(`The ${label} ZIP contains an invalid local file header.`)
    const localFlags = archive.readUInt16LE(local + 6)
    const localMethod = archive.readUInt16LE(local + 8)
    const localCrc = archive.readUInt32LE(local + 14)
    const localCompressedSize = archive.readUInt32LE(local + 18)
    const localUncompressedSize = archive.readUInt32LE(local + 22)
    const localNameLength = archive.readUInt16LE(local + 26)
    const localExtraLength = archive.readUInt16LE(local + 28)
    const localNameStart = local + 30
    const dataStart = localNameStart + localNameLength + localExtraLength
    const dataEnd = dataStart + entry.compressedSize
    if (dataEnd > directoryOffset || localFlags !== entry.flags || localMethod !== entry.method || (localFlags & 0x0001) !== 0 || !archive.subarray(localNameStart, localNameStart + localNameLength).equals(entry.originalName)) {
      throw new Error(`The ${label} ZIP local header does not match its directory.`)
    }
    if ((entry.flags & 0x0008) === 0 && (localCrc !== entry.crc || localCompressedSize !== entry.compressedSize || localUncompressedSize !== entry.uncompressedSize)) {
      throw new Error(`The ${label} ZIP local file sizes are inconsistent.`)
    }
    if (entry.directory || options.skip?.(entry.name)) continue
    const compressed = archive.subarray(dataStart, dataEnd)
    let contents: Buffer
    try {
      contents = entry.method === 0
        ? Buffer.from(compressed)
        : inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.uncompressedSize) })
    } catch (error) {
      throw new Error(`Could not unpack ${label} file ${entry.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (contents.length !== entry.uncompressedSize || crc32(contents) !== entry.crc) throw new Error(`${label} ZIP integrity check failed for ${entry.name}.`)
    const outputPath = resolve(destination, ...entry.name.split('/'))
    if (!outputPath.startsWith(`${destination}${sep}`)) throw new Error(`The ${label} ZIP contains a path outside its installation directory.`)
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, contents, { mode: 0o600, flag: 'wx' })
  }
  try {
    JSON.parse(readFileSync(join(destination, 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    throw new Error(`The ${label} ZIP contains an invalid root manifest.json.`)
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
