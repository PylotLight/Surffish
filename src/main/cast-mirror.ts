import { createCipheriv, randomBytes } from "node:crypto";
import { createSocket, type Socket } from "node:dgram";
import type { WebContents } from "electron";
import type { CastClient } from "./cast-client";
import { TabCapture, type CapturedFrame } from "./cast-mirror-capture";
import type { CastMessage } from "../shared/cast-protocol";
import {
  AUDIO_PAYLOAD_TYPE,
  AUDIO_TIMEBASE,
  CastRtpSender,
  NS_WEBRTC,
  TARGET_PLAYOUT_DELAY_MS,
  VIDEO_PAYLOAD_TYPE,
  VIDEO_TIMEBASE,
  buildOffer,
  buildSenderReport,
  frameNonce,
  isRtcpPacket,
  parseAnswer,
  parseReceiverRtcp,
  rtpTimestampAt,
  type MirrorStreamConfig,
} from "../shared/cast-streaming";

/**
 * Mirror tab: Cast Streaming to the Chromecast's built-in mirroring receiver (0F5096E8), the way
 * Chrome's "Cast tab" does it, so it works for any page (MSE players, logins, localhost) and needs
 * no registered receiver app. After LAUNCH, an OFFER (VP8 video ≤ 720p30, Opus audio, AES-128 keys)
 * goes out on the webrtc namespace; the ANSWER names a UDP port. Encoded frames from the capture
 * page are encrypted per frame (AES-128-CTR), split into Cast RTP packets and paced onto one UDP
 * socket, with an RTCP Sender Report per stream every 500 ms (lip sync). The receiver's RTCP comes
 * back on the same socket: ACKs and checkpoints free frames, NACKs resend packets, a Picture Loss
 * Indicator asks the encoder for a key frame. Target playout delay: 400 ms.
 */

const MIRROR_VIDEO = { width: 1280, height: 720, fps: 30, bitrate: 2_500_000 };
const AUDIO_BITRATE = 128_000;
const SENDER_REPORT_MS = 500;
const KICKSTART_MS = 20;
const ANSWER_TIMEOUT_MS = 10_000;
/** Pacing: about 25 Mbit/s while draining a burst (a key frame is ~50-100 packets). */
const PACE_TICK_MS = 2;
const PACE_BYTES_PER_TICK = 6_250;
const KEY_FRAME_MIN_INTERVAL_MS = 300;

export interface MirrorStats {
  width: number;
  height: number;
  /** Video + audio over the last couple of seconds. */
  kbps: number;
  roundTripMs: number;
  audio: boolean;
}

export interface MirrorEvents {
  onLive: () => void;
  onStats: (stats: MirrorStats) => void;
  onError: (message: string) => void;
}

interface Stream {
  config: MirrorStreamConfig;
  sender: CastRtpSender;
  receiverSsrc: number;
  /** Waiting for a key frame after the receiver fell behind (delta frames are useless until then). */
  needKey: boolean;
  lastKeyRequest: number;
}

function randomSsrc(): number {
  return randomBytes(4).readUInt32BE(0) || 1;
}

export class MirrorSession {
  private socket: Socket | null = null;
  private capture: TabCapture | null = null;
  private streams = new Map<"audio" | "video", Stream>();
  private readonly epochMs = Date.now();
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private queue: Array<{ packet: Uint8Array; audio: boolean }> = [];
  private pacing: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private live = false;
  private receiver: { host: string; port: number } | null = null;
  private videoSize = { width: 0, height: 0 };
  private audio = false;
  private bytesWindow: Array<[number, number]> = [];

  constructor(
    private readonly client: CastClient,
    private readonly host: string,
    private readonly tab: WebContents,
    private readonly events: MirrorEvents,
  ) {}

  /** Negotiates with the (already launched) mirroring app and starts streaming. */
  async start(transportId: string): Promise<void> {
    const streams: MirrorStreamConfig[] = [
      {
        index: 0,
        kind: "audio",
        ssrc: randomSsrc(),
        payloadType: AUDIO_PAYLOAD_TYPE,
        timebase: AUDIO_TIMEBASE,
        aesKey: randomBytes(16),
        aesIvMask: randomBytes(16),
        bitRate: AUDIO_BITRATE,
        channels: 2,
      },
      {
        index: 1,
        kind: "video",
        ssrc: randomSsrc(),
        payloadType: VIDEO_PAYLOAD_TYPE,
        timebase: VIDEO_TIMEBASE,
        aesKey: randomBytes(16),
        aesIvMask: randomBytes(16),
        bitRate: MIRROR_VIDEO.bitrate,
        channels: 1,
        maxFrameRate: MIRROR_VIDEO.fps,
        width: MIRROR_VIDEO.width,
        height: MIRROR_VIDEO.height,
      },
    ];
    const answer = parseAnswer(await this.negotiate(transportId, streams));
    if (!answer.ok)
      throw new Error(
        `The Chromecast couldn’t start mirroring: ${answer.error}`,
      );
    if (this.stopped) return;
    this.receiver = { host: this.host, port: answer.udpPort };
    for (const accepted of answer.streams) {
      const config = streams.find((stream) => stream.index === accepted.index);
      if (!config) continue;
      this.streams.set(config.kind, {
        config,
        receiverSsrc: accepted.receiverSsrc,
        needKey: true,
        lastKeyRequest: 0,
        sender: new CastRtpSender({
          ssrc: config.ssrc,
          payloadType: config.payloadType,
          targetDelayMs: TARGET_PLAYOUT_DELAY_MS,
          now: Date.now,
          send: (packet, kind) =>
            this.enqueuePacket(
              packet,
              config.kind === "audio",
              kind === "retransmit",
            ),
        }),
      });
    }
    if (!this.streams.has("video"))
      throw new Error("The Chromecast didn’t accept the video stream");
    await this.openSocket();
    if (this.stopped) return;
    // The receiver drops frames until it has a Sender Report (its clock offset and lip sync).
    this.sendSenderReports();
    this.timers.push(
      setInterval(() => this.sendSenderReports(), SENDER_REPORT_MS),
    );
    this.timers.push(
      setInterval(() => {
        for (const stream of this.streams.values()) stream.sender.kickstart();
      }, KICKSTART_MS),
    );
    this.timers.push(setInterval(() => this.publishStats(), 1_000));
    for (const timer of this.timers) timer.unref?.();
    this.capture = new TabCapture(this.tab, {
      width: MIRROR_VIDEO.width,
      height: MIRROR_VIDEO.height,
      fps: MIRROR_VIDEO.fps,
      videoBitrate: MIRROR_VIDEO.bitrate,
      audioBitrate: AUDIO_BITRATE,
      onFrame: (frame) => this.onFrame(frame),
      onStatus: (kind, detail) => this.onCaptureStatus(kind, detail),
    });
    await this.capture.start();
  }

  private negotiate(
    transportId: string,
    streams: MirrorStreamConfig[],
  ): Promise<Record<string, unknown>> {
    const seqNum = Math.floor(Math.random() * 1_000_000) + 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.client.off("message", listener);
        reject(new Error("The Chromecast didn’t answer the mirroring offer"));
      }, ANSWER_TIMEOUT_MS);
      timer.unref?.();
      const listener = (
        message: CastMessage,
        json: Record<string, unknown> | null,
      ): void => {
        if (message.namespace !== NS_WEBRTC || !json || json.type !== "ANSWER")
          return;
        if (typeof json.seqNum === "number" && json.seqNum !== seqNum) return;
        clearTimeout(timer);
        this.client.off("message", listener);
        resolve(json);
      };
      this.client.on("message", listener);
      this.client.send(transportId, NS_WEBRTC, buildOffer(seqNum, streams));
    });
  }

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createSocket("udp4");
      this.socket = socket;
      socket.once("error", reject);
      socket.on("message", (packet, from) => {
        if (from.address !== this.receiver?.host) return;
        this.onRtcp(packet);
      });
      socket.bind(0, () => {
        socket.off("error", reject);
        socket.on("error", (error) => {
          if (!this.stopped)
            console.warn("[cast-mirror] socket:", error.message);
        });
        try {
          socket.setSendBufferSize(1 << 20);
        } catch {
          /* OS limit */
        }
        resolve();
      });
    });
  }

  private sendSenderReports(): void {
    const now = Date.now();
    for (const stream of this.streams.values()) {
      const stats = stream.sender.stats;
      this.sendNow(
        buildSenderReport({
          ssrc: stream.config.ssrc,
          unixMs: now,
          rtpTimestamp: rtpTimestampAt(
            now,
            this.epochMs,
            stream.config.timebase,
          ),
          packetCount: stats.packetsSent,
          octetCount: stats.bytesSent,
        }),
      );
    }
  }

  private onFrame(frame: CapturedFrame): void {
    const stream = this.streams.get(frame.kind);
    if (!stream || this.stopped) return;
    if (frame.kind === "video") {
      if (stream.needKey && !frame.key) {
        this.requestKeyFrame(stream);
        return;
      }
    }
    const frameId = stream.sender.upcomingFrameId;
    const cipher = createCipheriv(
      "aes-128-ctr",
      stream.config.aesKey,
      frameNonce(stream.config.aesIvMask, frameId),
    );
    const data = Buffer.concat([cipher.update(frame.data), cipher.final()]);
    const rtpTimestamp = rtpTimestampAt(
      frame.captureMs,
      this.epochMs,
      stream.config.timebase,
    );
    const sent = stream.sender.enqueue({ key: frame.key, rtpTimestamp, data });
    if (sent === null) {
      // The receiver is too far behind: drop until it catches up, then restart from a key frame.
      if (frame.kind === "video") {
        stream.needKey = true;
        this.requestKeyFrame(stream);
      }
      return;
    }
    if (frame.key) stream.needKey = false;
    if (!this.live && frame.kind === "video") {
      this.live = true;
      this.events.onLive();
    }
  }

  private requestKeyFrame(stream: Stream): void {
    const now = Date.now();
    if (now - stream.lastKeyRequest < KEY_FRAME_MIN_INTERVAL_MS) return;
    stream.lastKeyRequest = now;
    this.capture?.requestKeyFrame();
  }

  private onRtcp(packet: Buffer): void {
    if (!isRtcpPacket(packet)) return;
    for (const stream of this.streams.values()) {
      const feedback = parseReceiverRtcp(
        packet,
        stream.receiverSsrc,
        stream.config.ssrc,
        stream.sender.lastFrameId,
      );
      if (!feedback) continue;
      if (stream.sender.onFeedback(feedback) && stream.config.kind === "video")
        this.requestKeyFrame(stream);
    }
  }

  private onCaptureStatus(kind: string, detail: string): void {
    if (kind === "ready") this.audio = detail.includes("audio");
    if (kind === "video-size") {
      const match = /^(\d+)x(\d+)$/.exec(detail);
      if (match)
        this.videoSize = { width: Number(match[1]), height: Number(match[2]) };
    }
    if (kind === "error") this.events.onError(`Mirroring stopped: ${detail}`);
  }

  private enqueuePacket(
    packet: Uint8Array,
    audio: boolean,
    retransmit: boolean,
  ): void {
    // Audio is small and late audio is a glitch: it jumps the queue (so do retransmits, which are late already).
    if (audio || retransmit) {
      const at = this.queue.findIndex((entry) => !entry.audio);
      if (at < 0) this.queue.push({ packet, audio: true });
      else this.queue.splice(at, 0, { packet, audio: true });
    } else {
      this.queue.push({ packet, audio });
    }
    if (!this.pacing) this.drain();
  }

  /** Paces queued packets (a key frame is a burst of ~100) so the Chromecast's Wi-Fi buffer doesn't overflow. */
  private drain(): void {
    this.pacing = null;
    let budget = PACE_BYTES_PER_TICK;
    while (this.queue.length > 0 && budget > 0) {
      const { packet } = this.queue.shift()!;
      budget -= packet.length;
      this.sendNow(packet);
    }
    if (this.queue.length > 0 && !this.stopped) {
      this.pacing = setTimeout(() => this.drain(), PACE_TICK_MS);
    }
  }

  private sendNow(packet: Uint8Array): void {
    const socket = this.socket;
    const receiver = this.receiver;
    if (!socket || !receiver || this.stopped) return;
    this.bytesWindow.push([Date.now(), packet.length]);
    socket.send(packet, receiver.port, receiver.host);
  }

  private publishStats(): void {
    // The tab closed (a once('destroyed') listener per cast would pile onto a busy emitter).
    if (this.tab.isDestroyed()) {
      this.events.onError("the mirrored tab closed");
      return;
    }
    const now = Date.now();
    this.bytesWindow = this.bytesWindow.filter(([at]) => now - at <= 2_000);
    const bytes = this.bytesWindow.reduce((sum, [, length]) => sum + length, 0);
    const video = this.streams.get("video");
    this.events.onStats({
      width: this.videoSize.width,
      height: this.videoSize.height,
      kbps: Math.round((bytes * 8) / 2 / 1000),
      roundTripMs: video ? video.sender.roundTripMs : 0,
      audio: this.audio,
    });
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.capture?.stop();
    this.capture = null;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    if (this.pacing) clearTimeout(this.pacing);
    this.pacing = null;
    this.queue = [];
    try {
      this.socket?.close();
    } catch {
      /* already closed */
    }
    this.socket = null;
  }
}
