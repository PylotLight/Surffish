/**
 * CASTV2, the Chromecast control protocol: TLS to port 8009, each message a 4-byte big-endian
 * length followed by a protobuf `CastMessage` (cast_channel.proto). The message is small enough to
 * hand-encode, so Surffish carries no protobuf library:
 *
 *   1 protocol_version (enum, always 0 = CASTV2_1_0)   4 namespace (string)
 *   2 source_id (string)                               5 payload_type (enum, 0 = STRING, 1 = BINARY)
 *   3 destination_id (string)                          6 payload_utf8 (string)  7 payload_binary (bytes)
 *
 * Pure (no Node or Electron imports): the main-process client (src/main/cast-client.ts) and the
 * smoke's fake receiver share it.
 */

export const CAST_PORT = 8009;
export const NS_CONNECTION = "urn:x-cast:com.google.cast.tp.connection";
export const NS_HEARTBEAT = "urn:x-cast:com.google.cast.tp.heartbeat";
export const NS_RECEIVER = "urn:x-cast:com.google.cast.receiver";
export const NS_MEDIA = "urn:x-cast:com.google.cast.media";
export const PLATFORM_RECEIVER_ID = "receiver-0";
/** Default Media Receiver: plays a URL the device fetches itself (mp4/webm/HLS/DASH). */
export const DEFAULT_MEDIA_RECEIVER_APP_ID = "CC1AD845";
/** Messages larger than this are refused (the protocol caps them at 64 KiB). */
export const MAX_CAST_MESSAGE_BYTES = 64 * 1024;

export interface CastMessage {
  sourceId: string;
  destinationId: string;
  namespace: string;
  /** STRING payloads (every namespace Surffish uses); BINARY ones are kept as bytes. */
  data: string | Uint8Array;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function varint(value: number, out: number[]): void {
  let rest = value >>> 0;
  while (rest >= 0x80) {
    out.push((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  out.push(rest);
}

function field(fieldNumber: number, bytes: Uint8Array, out: number[]): void {
  varint((fieldNumber << 3) | 2, out);
  varint(bytes.length, out);
  for (const byte of bytes) out.push(byte);
}

/** One protobuf CastMessage (without the length prefix). */
export function encodeCastMessage(message: CastMessage): Uint8Array {
  const out: number[] = [];
  varint((1 << 3) | 0, out);
  varint(0, out);
  field(2, encoder.encode(message.sourceId), out);
  field(3, encoder.encode(message.destinationId), out);
  field(4, encoder.encode(message.namespace), out);
  const binary = typeof message.data !== "string";
  varint((5 << 3) | 0, out);
  varint(binary ? 1 : 0, out);
  field(
    binary ? 7 : 6,
    binary
      ? (message.data as Uint8Array)
      : encoder.encode(message.data as string),
    out,
  );
  return Uint8Array.from(out);
}

/** The wire form: 4-byte big-endian length, then the protobuf. */
export function frameCastMessage(message: CastMessage): Uint8Array {
  const body = encodeCastMessage(message);
  const framed = new Uint8Array(4 + body.length);
  new DataView(framed.buffer).setUint32(0, body.length);
  framed.set(body, 4);
  return framed;
}

function readVarint(bytes: Uint8Array, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let position = offset;
  for (;;) {
    if (position >= bytes.length) throw new Error("Truncated varint");
    const byte = bytes[position++]!;
    if (shift < 32) result += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 63) throw new Error("Varint too long");
  }
  return [result, position];
}

export function decodeCastMessage(bytes: Uint8Array): CastMessage {
  const message: CastMessage = {
    sourceId: "",
    destinationId: "",
    namespace: "",
    data: "",
  };
  let payloadType = 0;
  let utf8: string | null = null;
  let binary: Uint8Array | null = null;
  let offset = 0;
  while (offset < bytes.length) {
    const [tag, afterTag] = readVarint(bytes, offset);
    const fieldNumber = Math.floor(tag / 8);
    const wireType = tag & 7;
    offset = afterTag;
    if (wireType === 0) {
      const [value, next] = readVarint(bytes, offset);
      offset = next;
      if (fieldNumber === 5) payloadType = value;
    } else if (wireType === 2) {
      const [length, next] = readVarint(bytes, offset);
      if (next + length > bytes.length) throw new Error("Truncated field");
      const value = bytes.subarray(next, next + length);
      offset = next + length;
      if (fieldNumber === 2) message.sourceId = decoder.decode(value);
      else if (fieldNumber === 3) message.destinationId = decoder.decode(value);
      else if (fieldNumber === 4) message.namespace = decoder.decode(value);
      else if (fieldNumber === 6) utf8 = decoder.decode(value);
      else if (fieldNumber === 7) binary = value.slice();
    } else if (wireType === 5) {
      offset += 4;
    } else if (wireType === 1) {
      offset += 8;
    } else {
      throw new Error(`Unsupported wire type ${wireType}`);
    }
  }
  message.data =
    payloadType === 1 ? (binary ?? new Uint8Array(0)) : (utf8 ?? "");
  return message;
}

/**
 * Splits a TLS byte stream into CastMessages. Feed it every chunk; it returns the complete messages
 * and keeps any partial one for the next chunk. A length over the cap throws (the caller drops the
 * connection).
 */
export class CastFrameReader {
  private pending = new Uint8Array(0);

  push(chunk: Uint8Array): CastMessage[] {
    const joined = new Uint8Array(this.pending.length + chunk.length);
    joined.set(this.pending);
    joined.set(chunk, this.pending.length);
    const out: CastMessage[] = [];
    let offset = 0;
    while (joined.length - offset >= 4) {
      const length = new DataView(
        joined.buffer,
        joined.byteOffset + offset,
        4,
      ).getUint32(0);
      if (length > MAX_CAST_MESSAGE_BYTES)
        throw new Error(`Cast message too large (${length} bytes)`);
      if (joined.length - offset - 4 < length) break;
      out.push(
        decodeCastMessage(joined.subarray(offset + 4, offset + 4 + length)),
      );
      offset += 4 + length;
    }
    this.pending = joined.slice(offset);
    return out;
  }
}

/** A JSON payload, or null for binary/garbled ones. */
export function parseCastJson(
  message: CastMessage,
): Record<string, unknown> | null {
  if (typeof message.data !== "string") return null;
  try {
    const value = JSON.parse(message.data) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export interface CastApplication {
  appId: string;
  sessionId: string;
  transportId: string;
  displayName: string;
  namespaces: string[];
}

export interface CastReceiverStatus {
  applications: CastApplication[];
  volume: { level: number | null; muted: boolean | null };
}

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const obj = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

/** RECEIVER_STATUS → the running apps and the device volume. */
export function parseReceiverStatus(
  payload: Record<string, unknown>,
): CastReceiverStatus | null {
  if (payload.type !== "RECEIVER_STATUS") return null;
  const status = obj(payload.status);
  const apps = Array.isArray(status.applications) ? status.applications : [];
  const volume = obj(status.volume);
  return {
    applications: apps
      .map((raw) => {
        const app = obj(raw);
        const namespaces = Array.isArray(app.namespaces)
          ? app.namespaces.map((entry) => str(obj(entry).name)).filter(Boolean)
          : [];
        return {
          appId: str(app.appId),
          sessionId: str(app.sessionId),
          transportId: str(app.transportId),
          displayName: str(app.displayName),
          namespaces,
        };
      })
      .filter((app) => app.appId !== ""),
    volume: {
      level: num(volume.level),
      muted: typeof volume.muted === "boolean" ? volume.muted : null,
    },
  };
}

export type CastPlayerState = "IDLE" | "PLAYING" | "PAUSED" | "BUFFERING";

export interface CastMediaStatus {
  mediaSessionId: number;
  playerState: CastPlayerState;
  idleReason: string | null;
  currentTime: number;
  duration: number | null;
  /** LIVE streams have no fixed duration. */
  live: boolean;
}

/** MEDIA_STATUS → the first media session's state (the Default Media Receiver runs one at a time). */
export function parseMediaStatus(
  payload: Record<string, unknown>,
): CastMediaStatus | null {
  if (
    payload.type !== "MEDIA_STATUS" ||
    !Array.isArray(payload.status) ||
    payload.status.length === 0
  )
    return null;
  const status = obj(payload.status[0]);
  const id = num(status.mediaSessionId);
  if (id === null) return null;
  const state = str(status.playerState);
  const media = obj(status.media);
  const duration = num(media.duration);
  return {
    mediaSessionId: id,
    playerState:
      state === "PLAYING" || state === "PAUSED" || state === "BUFFERING"
        ? state
        : "IDLE",
    idleReason: str(status.idleReason) || null,
    currentTime: Math.max(0, num(status.currentTime) ?? 0),
    duration: duration !== null && duration > 0 ? duration : null,
    live: str(media.streamType) === "LIVE",
  };
}

export interface CastLoadRequest {
  url: string;
  contentType: string;
  title: string;
  posterUrl: string | null;
  startTime: number;
  live: boolean;
}

/** Media namespace LOAD for the Default Media Receiver (generic metadata: title + one image). */
export function buildLoadMessage(
  requestId: number,
  request: CastLoadRequest,
): Record<string, unknown> {
  return {
    type: "LOAD",
    requestId,
    autoplay: true,
    currentTime: request.live ? 0 : Math.max(0, request.startTime),
    media: {
      contentId: request.url,
      contentUrl: request.url,
      contentType: request.contentType,
      streamType: request.live ? "LIVE" : "BUFFERED",
      metadata: {
        type: 0,
        metadataType: 0,
        title: request.title.slice(0, 200),
        images: request.posterUrl ? [{ url: request.posterUrl }] : [],
      },
    },
  };
}
