// On-disk format of the ad-filter engine cache (adblock-engine-v2.bin). The serialized engine for
// uBO's default lists is ~9 MB; zstd level 19 brings it to ~3.8 MB, and decoding it costs ~15 ms on
// a cached start. A zstd frame is recognised by its magic number; anything else is the older
// uncompressed format (or a smoke test's seed) and is handed to the engine as is, so an existing
// cache keeps working until the next refresh rewrites it.
//
// Decoding is synchronous on purpose: zlib's async zstd path in Electron's main process left ~12 MB
// of external memory accounted after the decode (measured with scripts/perf/footprint.cjs), the
// sync path leaves nothing. Compression only runs in the compiler utility process.
import * as zlib from 'node:zlib'

// Level 19: ~4 % smaller than 17 and ~8 % smaller than 12, for ~2 s of CPU once per refresh, spent
// in the compiler utility process rather than in main.
export const ENGINE_CACHE_ZSTD_LEVEL = 19

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd] as const

const zstdParams = (): zlib.ZstdOptions => ({
  params: { [zlib.constants.ZSTD_c_compressionLevel]: ENGINE_CACHE_ZSTD_LEVEL }
})

const hasZstd = (): boolean => typeof zlib.zstdCompressSync === 'function' && typeof zlib.zstdDecompressSync === 'function'

export function isCompressedEngineCache(bytes: Uint8Array): boolean {
  return bytes.length >= ZSTD_MAGIC.length && ZSTD_MAGIC.every((byte, index) => bytes[index] === byte)
}

const asBytes = (buffer: Buffer): Uint8Array => new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)

/** Compress a serialized engine for the cache file (for the compiler utility process). Without zstd, the raw bytes. */
export function compressEngineCacheSync(serialized: Uint8Array): Uint8Array {
  if (!hasZstd()) return serialized
  return asBytes(zlib.zstdCompressSync(serialized, zstdParams()))
}

// zlib's default 16 KB output chunks make decoding ~9 MB take ~33 ms (grow, copy, concat); one
// chunk of exactly the frame's content size takes ~15 ms and allocates nothing extra.
const MIN_CHUNK = 64 * 1024
const MAX_CHUNK = 256 * 1024 * 1024

/**
 * Decompressed size recorded in a zstd frame header (RFC 8878 3.1.1.1), or null when the frame
 * doesn't record it. zstd writes it whenever the input size is known, as it is for the cache.
 */
export function zstdFrameContentSize(frame: Uint8Array): number | null {
  if (!isCompressedEngineCache(frame) || frame.length < 5) return null
  const descriptor = frame[4]!
  const singleSegment = (descriptor >> 5) & 1
  const fieldSize = [singleSegment ? 1 : 0, 2, 4, 8][descriptor >> 6]!
  if (fieldSize === 0) return null
  const offset = 5 + (singleSegment ? 0 : 1) + [0, 1, 2, 4][descriptor & 3]!
  if (frame.length < offset + fieldSize) return null
  const view = new DataView(frame.buffer, frame.byteOffset + offset, fieldSize)
  if (fieldSize === 1) return view.getUint8(0)
  if (fieldSize === 2) return view.getUint16(0, true) + 256
  if (fieldSize === 4) return view.getUint32(0, true)
  const size = view.getBigUint64(0, true)
  return size <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(size) : null
}

/** The serialized engine stored in a cache file: zstd frames are decoded, older raw files pass through. Throws on a corrupt frame. */
export function decodeEngineCache(file: Uint8Array): Uint8Array {
  if (!isCompressedEngineCache(file)) return file
  if (!hasZstd()) throw new Error('zstd is unavailable to decode the ad-filter cache')
  const size = zstdFrameContentSize(file)
  const options: zlib.ZstdOptions = size ? { chunkSize: Math.min(MAX_CHUNK, Math.max(MIN_CHUNK, size)) } : {}
  return asBytes(zlib.zstdDecompressSync(file, options))
}
