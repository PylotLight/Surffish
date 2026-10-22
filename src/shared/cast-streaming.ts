/**
 * Cast Streaming ("Mirror tab"): the wire formats Chrome uses to mirror a tab to a Chromecast,
 * ported from Open Screen (cast/streaming): the OFFER/ANSWER negotiation on the webrtc namespace,
 * Cast RTP packets (a 12-byte RTP header plus Cast's frame/packet ids), the AES-128-CTR nonce for
 * each frame, RTCP Sender Reports, and the receiver's compound RTCP (Receiver Report, Cast
 * feedback with ACKs/NACKs, Picture Loss Indicator). Plus `CastRtpSender`, the per-stream frame
 * window: which packets to send, resend on NACK, forget on ACK.
 *
 * Pure (no Node or Electron imports): src/main/cast-mirror.ts drives it with a UDP socket and
 * node:crypto; the unit tests and the smoke's fake receiver use the parsers/builders.
 */

export const NS_WEBRTC = "urn:x-cast:com.google.cast.webrtc";
/** Chromecast built-in audio+video mirroring receiver (what Chrome launches for "Cast tab"). */
export const MIRRORING_APP_ID = "0F5096E8";
/** Like Chrome: the AndroidTV payload types (video 96, audio 127) every receiver accepts. */
export const VIDEO_PAYLOAD_TYPE = 96;
export const AUDIO_PAYLOAD_TYPE = 127;
export const VIDEO_TIMEBASE = 90_000;
export const AUDIO_TIMEBASE = 48_000;
export const TARGET_PLAYOUT_DELAY_MS = 400;
/** Fits a UDP datagram on Wi-Fi/Ethernet with room for VPN/PPPoE overhead. */
export const MAX_RTP_PACKET_BYTES = 1_400;
/** RTP (12) + Cast header with reference frame id (7) + room for one 4-byte extension. */
const MAX_RTP_HEADER_BYTES = 23;
const BASE_RTP_HEADER_BYTES = 19;
export const MAX_RTP_PAYLOAD_BYTES =
  MAX_RTP_PACKET_BYTES - MAX_RTP_HEADER_BYTES;
/** Open Screen's kMaxUnackedFrames: the receiver's 8-bit frame ids can't span more. */
export const MAX_UNACKED_FRAMES = 120;
export const ALL_PACKETS_LOST = 0xffff;
/** Seconds between 1900 (NTP) and 1970 (Unix). */
const NTP_UNIX_OFFSET_S = 2_208_988_800;

export type StreamKind = "audio" | "video";

export interface MirrorStreamConfig {
  /** Position in the OFFER (audio first, then video, like Open Screen). */
  index: number;
  kind: StreamKind;
  ssrc: number;
  payloadType: number;
  timebase: number;
  aesKey: Uint8Array;
  aesIvMask: Uint8Array;
  bitRate: number;
  channels: number;
  /** Video only. */
  maxFrameRate?: number;
  width?: number;
  height?: number;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/** The OFFER Chrome sends on the webrtc namespace (cast/streaming/public/offer_messages.cc). */
export function buildOffer(
  seqNum: number,
  streams: readonly MirrorStreamConfig[],
  targetDelayMs = TARGET_PLAYOUT_DELAY_MS,
): Record<string, unknown> {
  return {
    type: "OFFER",
    seqNum,
    offer: {
      castMode: "mirroring",
      receiverGetStatus: true,
      supportedStreams: streams.map((stream) => {
        const common = {
          index: stream.index,
          type: stream.kind === "audio" ? "audio_source" : "video_source",
          codecName: stream.kind === "audio" ? "opus" : "vp8",
          rtpProfile: "cast",
          rtpPayloadType: stream.payloadType,
          ssrc: stream.ssrc,
          targetDelay: targetDelayMs,
          aesKey: toHex(stream.aesKey),
          aesIvMask: toHex(stream.aesIvMask),
          timeBase: `1/${stream.timebase}`,
          channels: stream.channels,
          receiverRtcpEventLog: false,
        };
        if (stream.kind === "audio")
          return { ...common, bitRate: stream.bitRate };
        return {
          ...common,
          maxFrameRate: `${Math.round((stream.maxFrameRate ?? 30) * 1000)}/1000`,
          maxBitRate: stream.bitRate,
          resolutions: [
            { width: stream.width ?? 1280, height: stream.height ?? 720 },
          ],
        };
      }),
    },
  };
}

export type ParsedAnswer =
  | {
      ok: true;
      udpPort: number;
      streams: Array<{ index: number; receiverSsrc: number }>;
    }
  | { ok: false; error: string };

/** The receiver's ANSWER: where to send RTP and which offered streams it took (with its SSRCs). */
export function parseAnswer(json: Record<string, unknown>): ParsedAnswer {
  if (json.type !== "ANSWER")
    return { ok: false, error: `Unexpected ${String(json.type ?? "reply")}` };
  if (json.result !== "ok") {
    const error =
      typeof json.error === "object" && json.error !== null
        ? (json.error as Record<string, unknown>).description
        : null;
    return {
      ok: false,
      error:
        typeof error === "string" && error
          ? error
          : "The Chromecast declined the stream",
    };
  }
  const answer =
    typeof json.answer === "object" && json.answer !== null
      ? (json.answer as Record<string, unknown>)
      : {};
  const udpPort = answer.udpPort;
  const indexes = Array.isArray(answer.sendIndexes) ? answer.sendIndexes : [];
  const ssrcs = Array.isArray(answer.ssrcs) ? answer.ssrcs : [];
  if (
    typeof udpPort !== "number" ||
    !Number.isInteger(udpPort) ||
    udpPort <= 0 ||
    udpPort > 65_535
  )
    return { ok: false, error: "The Chromecast’s answer had no UDP port" };
  const streams: Array<{ index: number; receiverSsrc: number }> = [];
  indexes.forEach((index, position) => {
    const ssrc = ssrcs[position];
    if (typeof index === "number" && typeof ssrc === "number")
      streams.push({ index, receiverSsrc: ssrc >>> 0 });
  });
  if (streams.length === 0)
    return { ok: false, error: "The Chromecast accepted no streams" };
  return { ok: true, udpPort, streams };
}

/** AES-128-CTR initial counter for a frame: the IV mask XOR the 32-bit frame id at bytes 8..11 (frame_crypto.cc). */
export function frameNonce(ivMask: Uint8Array, frameId: number): Uint8Array {
  const nonce = new Uint8Array(16);
  new DataView(nonce.buffer).setUint32(8, frameId >>> 0);
  for (let index = 0; index < 16; index++)
    nonce[index] = nonce[index]! ^ (ivMask[index] ?? 0);
  return nonce;
}

/** Smallest id greater than `base` whose low 8 bits are `low8`. */
export function expandFrameIdAfter(base: number, low8: number): number {
  let id = (base & ~0xff) | (low8 & 0xff);
  while (id <= base) id += 0x100;
  return id;
}

/** Largest id at or below `max` whose low 8 bits are `low8`. */
export function expandFrameIdAtOrBefore(max: number, low8: number): number {
  let id = (max & ~0xff) | (low8 & 0xff);
  while (id > max) id -= 0x100;
  return id;
}

export function packetCountFor(
  byteLength: number,
  maxPayload = MAX_RTP_PAYLOAD_BYTES,
): number {
  return Math.max(1, Math.ceil(byteLength / maxPayload));
}

export interface CastFrame {
  frameId: number;
  referenceFrameId: number;
  key: boolean;
  rtpTimestamp: number;
  /** Encrypted payload. */
  data: Uint8Array;
}

/** One Cast RTP packet of `frame` (rtp_packetizer.cc). */
export function buildRtpPacket(
  frame: CastFrame,
  packetId: number,
  sequence: number,
  ssrc: number,
  payloadType: number,
  maxPayload = MAX_RTP_PAYLOAD_BYTES,
): Uint8Array {
  const count = packetCountFor(frame.data.length, maxPayload);
  if (packetId < 0 || packetId >= count)
    throw new RangeError(`packet ${packetId} of ${count}`);
  const start = packetId * maxPayload;
  const chunk = frame.data.subarray(
    start,
    Math.min(frame.data.length, start + maxPayload),
  );
  const packet = new Uint8Array(BASE_RTP_HEADER_BYTES + chunk.length);
  const view = new DataView(packet.buffer);
  const last = packetId === count - 1;
  packet[0] = 0x80;
  packet[1] = (last ? 0x80 : 0) | (payloadType & 0x7f);
  view.setUint16(2, sequence & 0xffff);
  view.setUint32(4, frame.rtpTimestamp >>> 0);
  view.setUint32(8, ssrc >>> 0);
  packet[12] = (frame.key ? 0x80 : 0) | 0x40;
  packet[13] = frame.frameId & 0xff;
  view.setUint16(14, packetId);
  view.setUint16(16, count - 1);
  packet[18] = frame.referenceFrameId & 0xff;
  packet.set(chunk, BASE_RTP_HEADER_BYTES);
  return packet;
}

export interface ParsedRtpPacket {
  payloadType: number;
  marker: boolean;
  sequence: number;
  rtpTimestamp: number;
  ssrc: number;
  key: boolean;
  frameId8: number;
  packetId: number;
  maxPacketId: number;
  referenceFrameId8: number | null;
  playoutDelayMs: number | null;
  payload: Uint8Array;
}

/** The receiver side of buildRtpPacket (rtp_packet_parser.cc); null for anything malformed. */
export function parseRtpPacket(packet: Uint8Array): ParsedRtpPacket | null {
  if (packet.length < 18 || packet[0] !== 0x80) return null;
  const view = new DataView(
    packet.buffer,
    packet.byteOffset,
    packet.byteLength,
  );
  const flags = packet[12]!;
  let offset = 18;
  let referenceFrameId8: number | null = null;
  if (flags & 0x40) {
    if (packet.length < offset + 1) return null;
    referenceFrameId8 = packet[offset]!;
    offset += 1;
  }
  let playoutDelayMs: number | null = null;
  for (let extension = 0; extension < (flags & 0x3f); extension++) {
    if (packet.length < offset + 2) return null;
    const word = view.getUint16(offset);
    const size = word & 0x3ff;
    offset += 2;
    if (packet.length < offset + size) return null;
    if (word >> 10 === 1 && size === 2) playoutDelayMs = view.getUint16(offset);
    offset += size;
  }
  const packetId = view.getUint16(14);
  const maxPacketId = view.getUint16(16);
  if (packetId > maxPacketId) return null;
  return {
    payloadType: packet[1]! & 0x7f,
    marker: (packet[1]! & 0x80) !== 0,
    sequence: view.getUint16(2),
    rtpTimestamp: view.getUint32(4),
    ssrc: view.getUint32(8),
    key: (flags & 0x80) !== 0,
    frameId8: packet[13]!,
    packetId,
    maxPacketId,
    referenceFrameId8,
    playoutDelayMs,
    payload: packet.subarray(offset),
  };
}

/** Unix milliseconds as a 64-bit NTP timestamp, [seconds, fraction]. */
export function ntpFromUnixMs(ms: number): [number, number] {
  const seconds = Math.floor(ms / 1000);
  const fraction = Math.floor(((ms - seconds * 1000) / 1000) * 0x1_0000_0000);
  return [
    (seconds + NTP_UNIX_OFFSET_S) >>> 0,
    Math.min(fraction, 0xffff_ffff) >>> 0,
  ];
}

/** The middle 32 bits of an NTP timestamp: how a Receiver Report names the Sender Report it answers. */
export function ntpMiddle32(ms: number): number {
  const [seconds, fraction] = ntpFromUnixMs(ms);
  return (((seconds & 0xffff) << 16) | (fraction >>> 16)) >>> 0;
}

export interface SenderReport {
  ssrc: number;
  /** Sender clock (Unix ms) the RTP timestamp corresponds to. */
  unixMs: number;
  rtpTimestamp: number;
  packetCount: number;
  octetCount: number;
}

/** RTCP Sender Report without report blocks (sender_report_builder.cc). */
export function buildSenderReport(report: SenderReport): Uint8Array {
  const packet = new Uint8Array(28);
  const view = new DataView(packet.buffer);
  packet[0] = 0x80;
  packet[1] = 200;
  view.setUint16(2, 6);
  view.setUint32(4, report.ssrc >>> 0);
  const [seconds, fraction] = ntpFromUnixMs(report.unixMs);
  view.setUint32(8, seconds);
  view.setUint32(12, fraction);
  view.setUint32(16, report.rtpTimestamp >>> 0);
  view.setUint32(20, report.packetCount >>> 0);
  view.setUint32(24, report.octetCount >>> 0);
  return packet;
}

export function parseSenderReport(packet: Uint8Array): SenderReport | null {
  if (packet.length < 28 || (packet[0]! & 0xc0) !== 0x80 || packet[1] !== 200)
    return null;
  const view = new DataView(
    packet.buffer,
    packet.byteOffset,
    packet.byteLength,
  );
  const seconds = view.getUint32(8);
  const fraction = view.getUint32(12);
  return {
    ssrc: view.getUint32(4),
    unixMs:
      (seconds - NTP_UNIX_OFFSET_S) * 1000 + (fraction / 0x1_0000_0000) * 1000,
    rtpTimestamp: view.getUint32(16),
    packetCount: view.getUint32(20),
    octetCount: view.getUint32(24),
  };
}

export function isRtcpPacket(packet: Uint8Array): boolean {
  return (
    packet.length >= 8 &&
    (packet[0]! & 0xc0) === 0x80 &&
    packet[1]! >= 200 &&
    packet[1]! <= 207
  );
}

export interface PacketNack {
  frameId: number;
  packetId: number;
}

export interface ReceiverFeedback {
  /** Full frame id: every frame up to and including it is complete at the receiver. */
  checkpoint: number | null;
  playoutDelayMs: number | null;
  /** Sorted; ALL_PACKETS_LOST as packetId for a frame with nothing received. */
  nacks: PacketNack[];
  /** Frames after the checkpoint that are complete. */
  acks: number[];
  pictureLoss: boolean;
  /** From the Receiver Report block: last Sender Report (middle 32 NTP bits) and delay since (1/65536 s). */
  report: {
    lastSenderReport: number;
    delaySinceLastReport: number;
    cumulativeLost: number;
    fractionLost: number;
  } | null;
}

/**
 * The receiver's compound RTCP for one stream (compound_rtcp_parser.cc). `maxFrameId` is the
 * newest frame this sender has sent, used to expand the 8-bit checkpoint. Null when malformed.
 * Packets meant for another stream (other SSRCs) leave every field empty.
 */
export function parseReceiverRtcp(
  packet: Uint8Array,
  receiverSsrc: number,
  senderSsrc: number,
  maxFrameId: number,
): ReceiverFeedback | null {
  const out: ReceiverFeedback = {
    checkpoint: null,
    playoutDelayMs: null,
    nacks: [],
    acks: [],
    pictureLoss: false,
    report: null,
  };
  const view = new DataView(
    packet.buffer,
    packet.byteOffset,
    packet.byteLength,
  );
  let offset = 0;
  while (offset < packet.length) {
    if (packet.length - offset < 4 || (packet[offset]! & 0xc0) !== 0x80)
      return null;
    const count = packet[offset]! & 0x1f;
    const type = packet[offset + 1]!;
    const length = (view.getUint16(offset + 2) + 1) * 4;
    if (offset + length > packet.length) return null;
    const body = offset + 4;
    const end = offset + length;
    if (
      type === 201 &&
      end - body >= 4 &&
      view.getUint32(body) === receiverSsrc >>> 0
    ) {
      for (
        let block = body + 4;
        block + 24 <= end && block < body + 4 + count * 24;
        block += 24
      ) {
        if (view.getUint32(block) !== senderSsrc >>> 0) continue;
        const word = view.getUint32(block + 4);
        out.report = {
          fractionLost: word >>> 24,
          cumulativeLost: word & 0xff_ffff,
          lastSenderReport: view.getUint32(block + 16),
          delaySinceLastReport: view.getUint32(block + 20),
        };
      }
    } else if (
      type === 206 &&
      end - body >= 8 &&
      view.getUint32(body) === receiverSsrc >>> 0 &&
      view.getUint32(body + 4) === senderSsrc >>> 0
    ) {
      if (count === 1) out.pictureLoss = true;
      if (count === 15) {
        if (end - body < 16 || view.getUint32(body + 8) !== 0x43415354)
          return null;
        const checkpoint = expandFrameIdAtOrBefore(
          maxFrameId,
          packet[body + 12]!,
        );
        const losses = packet[body + 13]!;
        out.checkpoint = checkpoint;
        out.playoutDelayMs = view.getUint16(body + 14);
        let at = body + 16;
        if (at + losses * 4 > end) return null;
        for (let loss = 0; loss < losses; loss++, at += 4) {
          const frameId = expandFrameIdAfter(checkpoint, packet[at]!);
          let packetId = view.getUint16(at + 1);
          let bits = packet[at + 3]!;
          out.nacks.push({ frameId, packetId });
          if (packetId !== ALL_PACKETS_LOST) {
            while (bits) {
              packetId += 1;
              if (bits & 1) out.nacks.push({ frameId, packetId });
              bits >>= 1;
            }
          }
        }
        if (at + 6 <= end && view.getUint32(at) === 0x43535432) {
          const octets = packet[at + 5]!;
          at += 6;
          let frame = checkpoint + 2;
          for (
            let octet = 0;
            octet < octets && at + octet < end;
            octet++, frame += 8
          ) {
            const bits = packet[at + octet]!;
            for (let bit = 0; bit < 8; bit++)
              if (bits & (1 << bit)) out.acks.push(frame + bit);
          }
        }
      }
    }
    offset = end;
  }
  out.nacks.sort((a, b) => a.frameId - b.frameId || a.packetId - b.packetId);
  return out;
}

/** A receiver's Cast feedback (+ optional PLI): what the fake receiver and the tests send back. */
export function buildReceiverFeedback(input: {
  receiverSsrc: number;
  senderSsrc: number;
  checkpoint: number;
  playoutDelayMs: number;
  nacks?: PacketNack[];
  acks?: number[];
  pictureLoss?: boolean;
}): Uint8Array {
  const nacks = input.nacks ?? [];
  const loss: number[] = [];
  for (const nack of nacks)
    loss.push(((nack.frameId & 0xff) << 24) | ((nack.packetId & 0xffff) << 8));
  const acks = (input.acks ?? []).filter(
    (frame) => frame >= input.checkpoint + 2,
  );
  // ACK bit vector: 2 octets, then 4 at a time (word alignment); bit 0 is checkpoint + 2.
  const needed = acks.length
    ? Math.ceil((Math.max(...acks) - (input.checkpoint + 2) + 1) / 8)
    : 0;
  const octets =
    needed === 0
      ? 0
      : needed <= 2
        ? 2
        : Math.min(254, 2 + Math.ceil((needed - 2) / 4) * 4);
  const ackBytes = new Uint8Array(octets);
  for (const frame of acks) {
    const bit = frame - (input.checkpoint + 2);
    if (bit < octets * 8)
      ackBytes[bit >> 3] = (ackBytes[bit >> 3] ?? 0) | (1 << (bit & 7));
  }
  const out: Uint8Array[] = [];
  const feedbackLength = 16 + loss.length * 4 + (octets ? 6 + octets : 0);
  const feedback = new Uint8Array(4 + feedbackLength);
  const view = new DataView(feedback.buffer);
  feedback[0] = 0x80 | 15;
  feedback[1] = 206;
  view.setUint16(2, feedback.length / 4 - 1);
  view.setUint32(4, input.receiverSsrc >>> 0);
  view.setUint32(8, input.senderSsrc >>> 0);
  view.setUint32(12, 0x43415354);
  feedback[16] = input.checkpoint & 0xff;
  feedback[17] = loss.length;
  view.setUint16(18, input.playoutDelayMs);
  loss.forEach((word, index) => view.setUint32(20 + index * 4, word >>> 0));
  if (octets) {
    const at = 20 + loss.length * 4;
    view.setUint32(at, 0x43535432);
    feedback[at + 4] = 0;
    feedback[at + 5] = octets;
    feedback.set(ackBytes, at + 6);
  }
  out.push(feedback);
  if (input.pictureLoss) {
    const pli = new Uint8Array(12);
    const pliView = new DataView(pli.buffer);
    pli[0] = 0x80 | 1;
    pli[1] = 206;
    pliView.setUint16(2, 2);
    pliView.setUint32(4, input.receiverSsrc >>> 0);
    pliView.setUint32(8, input.senderSsrc >>> 0);
    out.push(pli);
  }
  const total = new Uint8Array(out.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of out) {
    total.set(part, at);
    at += part.length;
  }
  return total;
}

/** The RTP timestamp of a moment on the session clock (both streams share `epochMs`, which keeps lip sync). */
export function rtpTimestampAt(
  unixMs: number,
  epochMs: number,
  timebase: number,
): number {
  return Math.round(((unixMs - epochMs) * timebase) / 1000) >>> 0;
}

interface PendingFrame {
  frame: CastFrame;
  packetCount: number;
  sentAt: number[];
}

export interface SenderStats {
  framesSent: number;
  packetsSent: number;
  bytesSent: number;
  retransmits: number;
  dropped: number;
}

/**
 * One Cast RTP stream's sender window (a slimmed-down sender_impl.cc): frames are kept until the
 * receiver's checkpoint passes them or it ACKs them; NACKed packets are resent unless they were
 * sent less than one round trip ago; when the receiver may not know about the newest frame, its
 * last packet is resent as a "kickstart". Packets come out through `send` in order; the caller
 * paces them onto the network.
 */
export class CastRtpSender {
  private readonly pending = new Map<number, PendingFrame>();
  private nextFrameId = 0;
  private checkpoint = -1;
  private latestExpected = -1;
  private sequence = Math.floor(Math.random() * 0x1_0000);
  roundTripMs = 30;
  readonly stats: SenderStats = {
    framesSent: 0,
    packetsSent: 0,
    bytesSent: 0,
    retransmits: 0,
    dropped: 0,
  };

  constructor(
    private readonly options: {
      ssrc: number;
      payloadType: number;
      targetDelayMs: number;
      send: (packet: Uint8Array, kind: "new" | "retransmit") => void;
      /** Unix ms (Date.now): also the clock the Sender Reports carry. */
      now: () => number;
      maxPayload?: number;
    },
  ) {}

  get lastFrameId(): number {
    return this.nextFrameId - 1;
  }

  get checkpointFrameId(): number {
    return this.checkpoint;
  }

  /** Frames sent but not yet complete at the receiver. */
  get inFlight(): number {
    return this.pending.size;
  }

  /**
   * Queues an encrypted frame (encrypt with frameNonce(ivMask, nextFrameId) first). Returns its
   * frame id, or null when the receiver is too far behind (the caller then waits for a key frame).
   */
  enqueue(input: {
    key: boolean;
    rtpTimestamp: number;
    data: Uint8Array;
  }): number | null {
    const frameId = this.nextFrameId;
    if (frameId - this.checkpoint > MAX_UNACKED_FRAMES - 4) {
      this.stats.dropped += 1;
      return null;
    }
    this.nextFrameId += 1;
    const frame: CastFrame = {
      frameId,
      referenceFrameId: input.key ? frameId : frameId - 1,
      key: input.key,
      rtpTimestamp: input.rtpTimestamp,
      data: input.data,
    };
    const count = packetCountFor(input.data.length, this.options.maxPayload);
    const pending: PendingFrame = {
      frame,
      packetCount: count,
      sentAt: new Array<number>(count).fill(0),
    };
    this.pending.set(frameId, pending);
    for (let packetId = 0; packetId < count; packetId++)
      this.sendPacket(pending, packetId, "new");
    this.stats.framesSent += 1;
    return frameId;
  }

  /** The id the next enqueue() will use (for the AES nonce). */
  get upcomingFrameId(): number {
    return this.nextFrameId;
  }

  private sendPacket(
    pending: PendingFrame,
    packetId: number,
    kind: "new" | "retransmit",
  ): void {
    const packet = buildRtpPacket(
      pending.frame,
      packetId,
      this.sequence,
      this.options.ssrc,
      this.options.payloadType,
      this.options.maxPayload,
    );
    this.sequence = (this.sequence + 1) & 0xffff;
    pending.sentAt[packetId] = this.options.now();
    this.stats.packetsSent += 1;
    this.stats.bytesSent += packet.length;
    if (kind === "retransmit") this.stats.retransmits += 1;
    this.options.send(packet, kind);
  }

  /** Applies the receiver's feedback; returns true when it asked for a key frame (PLI). */
  onFeedback(feedback: ReceiverFeedback): boolean {
    if (feedback.report) {
      const rtt = this.roundTripFrom(feedback.report);
      if (rtt !== null)
        this.roundTripMs = Math.round(this.roundTripMs * 0.75 + rtt * 0.25);
    }
    if (
      feedback.checkpoint !== null &&
      feedback.checkpoint > this.checkpoint &&
      feedback.checkpoint < this.nextFrameId
    ) {
      for (
        let frameId = this.checkpoint + 1;
        frameId <= feedback.checkpoint;
        frameId++
      )
        this.pending.delete(frameId);
      this.checkpoint = feedback.checkpoint;
      this.latestExpected = Math.max(this.latestExpected, this.checkpoint);
    }
    for (const frameId of feedback.acks) {
      if (frameId < this.nextFrameId) {
        this.pending.delete(frameId);
        this.latestExpected = Math.max(this.latestExpected, frameId);
      }
    }
    const tooRecent = this.options.now() - this.roundTripMs;
    for (const nack of feedback.nacks) {
      const pending = this.pending.get(nack.frameId);
      if (!pending) continue;
      this.latestExpected = Math.max(this.latestExpected, nack.frameId);
      const ids =
        nack.packetId === ALL_PACKETS_LOST
          ? pending.sentAt.map((_sent, index) => index)
          : [nack.packetId];
      for (const packetId of ids) {
        if (
          packetId < pending.packetCount &&
          pending.sentAt[packetId]! <= tooRecent
        )
          this.sendPacket(pending, packetId, "retransmit");
      }
    }
    return feedback.pictureLoss;
  }

  private roundTripFrom(
    report: NonNullable<ReceiverFeedback["report"]>,
  ): number | null {
    if (report.lastSenderReport === 0) return null;
    const now = ntpMiddle32(this.options.now());
    const units =
      (now - report.lastSenderReport - report.delaySinceLastReport) >>> 0;
    const ms = (units / 65_536) * 1000;
    return ms >= 0 && ms < 2_000 ? Math.max(1, ms) : null;
  }

  /**
   * Resends the newest frame's last packet when the receiver hasn't shown it knows about that
   * frame for a while (a whole frame lost leaves it nothing to NACK). Call every ~20 ms.
   */
  kickstart(): boolean {
    const last = this.nextFrameId - 1;
    if (last < 0 || this.latestExpected >= last) return false;
    const pending = this.pending.get(last);
    if (!pending) return false;
    const packetId = pending.packetCount - 1;
    const interval = Math.max(
      this.options.targetDelayMs / 20,
      this.roundTripMs * 2,
    );
    if (this.options.now() - pending.sentAt[packetId]! < interval) return false;
    this.sendPacket(pending, packetId, "retransmit");
    return true;
  }
}
