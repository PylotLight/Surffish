import { describe, expect, test } from "bun:test";
import {
  ALL_PACKETS_LOST,
  AUDIO_PAYLOAD_TYPE,
  CastRtpSender,
  MAX_RTP_PAYLOAD_BYTES,
  MAX_UNACKED_FRAMES,
  VIDEO_PAYLOAD_TYPE,
  buildOffer,
  buildReceiverFeedback,
  buildRtpPacket,
  buildSenderReport,
  expandFrameIdAfter,
  expandFrameIdAtOrBefore,
  frameNonce,
  isRtcpPacket,
  ntpMiddle32,
  packetCountFor,
  parseAnswer,
  parseReceiverRtcp,
  parseRtpPacket,
  parseSenderReport,
  rtpTimestampAt,
  toHex,
  type MirrorStreamConfig,
} from "./cast-streaming";

const key = Uint8Array.from({ length: 16 }, (_value, index) => index);
const mask = Uint8Array.from({ length: 16 }, (_value, index) => 0xf0 + index);

describe("OFFER / ANSWER", () => {
  test("the OFFER lists audio then video with hex keys and Cast RTP fields", () => {
    const streams: MirrorStreamConfig[] = [
      {
        index: 0,
        kind: "audio",
        ssrc: 11,
        payloadType: AUDIO_PAYLOAD_TYPE,
        timebase: 48_000,
        aesKey: key,
        aesIvMask: mask,
        bitRate: 128_000,
        channels: 2,
      },
      {
        index: 1,
        kind: "video",
        ssrc: 22,
        payloadType: VIDEO_PAYLOAD_TYPE,
        timebase: 90_000,
        aesKey: key,
        aesIvMask: mask,
        bitRate: 3_000_000,
        channels: 1,
        maxFrameRate: 30,
        width: 1280,
        height: 720,
      },
    ];
    const offer = buildOffer(7, streams) as {
      type: string;
      seqNum: number;
      offer: {
        castMode: string;
        supportedStreams: Array<Record<string, unknown>>;
      };
    };
    expect(offer.type).toBe("OFFER");
    expect(offer.seqNum).toBe(7);
    expect(offer.offer.castMode).toBe("mirroring");
    const [audio, video] = offer.offer.supportedStreams;
    expect(audio).toMatchObject({
      index: 0,
      type: "audio_source",
      codecName: "opus",
      rtpPayloadType: 127,
      ssrc: 11,
      timeBase: "1/48000",
      channels: 2,
      targetDelay: 400,
      rtpProfile: "cast",
      aesKey: "000102030405060708090a0b0c0d0e0f",
    });
    expect(video).toMatchObject({
      index: 1,
      type: "video_source",
      codecName: "vp8",
      rtpPayloadType: 96,
      timeBase: "1/90000",
      maxFrameRate: "30000/1000",
      maxBitRate: 3_000_000,
      resolutions: [{ width: 1280, height: 720 }],
    });
    expect(video!.aesIvMask).toBe(toHex(mask));
  });

  test("ANSWER: port and the receiver SSRC per offered index; errors explained", () => {
    expect(
      parseAnswer({
        type: "ANSWER",
        result: "ok",
        answer: { udpPort: 50_000, sendIndexes: [0, 1], ssrcs: [101, 102] },
      }),
    ).toEqual({
      ok: true,
      udpPort: 50_000,
      streams: [
        { index: 0, receiverSsrc: 101 },
        { index: 1, receiverSsrc: 102 },
      ],
    });
    expect(
      parseAnswer({
        type: "ANSWER",
        result: "error",
        error: { code: 1, description: "no codec" },
      }),
    ).toEqual({ ok: false, error: "no codec" });
    expect(
      parseAnswer({
        type: "ANSWER",
        result: "ok",
        answer: { sendIndexes: [0], ssrcs: [1] },
      }).ok,
    ).toBe(false);
    expect(
      parseAnswer({
        type: "ANSWER",
        result: "ok",
        answer: { udpPort: 1, sendIndexes: [], ssrcs: [] },
      }).ok,
    ).toBe(false);
    expect(parseAnswer({ type: "CAPABILITIES_RESPONSE" }).ok).toBe(false);
  });
});

describe("frame ids and nonces", () => {
  test("8-bit frame ids expand around a reference", () => {
    expect(expandFrameIdAfter(10, 12)).toBe(12);
    expect(expandFrameIdAfter(250, 3)).toBe(259);
    expect(expandFrameIdAfter(12, 12)).toBe(268);
    expect(expandFrameIdAtOrBefore(260, 255)).toBe(255);
    expect(expandFrameIdAtOrBefore(260, 4)).toBe(260);
    expect(expandFrameIdAtOrBefore(260, 5)).toBe(5);
  });

  test("the AES nonce is the mask XOR the frame id in bytes 8..11", () => {
    const nonce = frameNonce(mask, 0x01020304);
    expect(Array.from(nonce.subarray(0, 8))).toEqual(
      Array.from(mask.subarray(0, 8)),
    );
    expect(Array.from(nonce.subarray(8, 12))).toEqual([
      0xf8 ^ 1,
      0xf9 ^ 2,
      0xfa ^ 3,
      0xfb ^ 4,
    ]);
    expect(Array.from(nonce.subarray(12))).toEqual(
      Array.from(mask.subarray(12)),
    );
  });
});

describe("RTP packets", () => {
  test("a frame splits into max-size packets that parse back with the Cast header", () => {
    const data = Uint8Array.from(
      { length: MAX_RTP_PAYLOAD_BYTES * 2 + 10 },
      (_value, index) => index & 0xff,
    );
    expect(packetCountFor(data.length)).toBe(3);
    expect(packetCountFor(0)).toBe(1);
    const frame = {
      frameId: 300,
      referenceFrameId: 299,
      key: false,
      rtpTimestamp: 0x1_0000_0005,
      data,
    };
    const packets = [0, 1, 2].map((id) =>
      buildRtpPacket(frame, id, 65_535 + id, 0xdeadbeef, VIDEO_PAYLOAD_TYPE),
    );
    const parsed = packets.map((packet) => parseRtpPacket(packet)!);
    expect(parsed.map((packet) => packet.sequence)).toEqual([65_535, 0, 1]);
    expect(parsed.map((packet) => packet.marker)).toEqual([false, false, true]);
    expect(parsed[0]).toMatchObject({
      payloadType: 96,
      rtpTimestamp: 5,
      ssrc: 0xdeadbeef,
      key: false,
      frameId8: 300 & 0xff,
      packetId: 0,
      maxPacketId: 2,
      referenceFrameId8: 299 & 0xff,
      playoutDelayMs: null,
    });
    const joined = new Uint8Array(
      parsed.reduce((sum, packet) => sum + packet.payload.length, 0),
    );
    let at = 0;
    for (const packet of parsed) {
      joined.set(packet.payload, at);
      at += packet.payload.length;
    }
    expect(joined).toEqual(data);
    expect(() => buildRtpPacket(frame, 3, 0, 1, 96)).toThrow();
  });

  test("key frames carry the K bit and reference themselves; junk is refused", () => {
    const packet = buildRtpPacket(
      {
        frameId: 0,
        referenceFrameId: 0,
        key: true,
        rtpTimestamp: 1,
        data: new Uint8Array(5),
      },
      0,
      1,
      2,
      96,
    );
    expect(parseRtpPacket(packet)).toMatchObject({
      key: true,
      frameId8: 0,
      referenceFrameId8: 0,
      marker: true,
    });
    expect(parseRtpPacket(new Uint8Array(10))).toBeNull();
    expect(isRtcpPacket(packet)).toBe(false);
  });
});

describe("RTCP", () => {
  test("Sender Report round-trips (NTP time, RTP timestamp, counts)", () => {
    const ms = Date.UTC(2026, 9, 18, 10, 0, 0, 250);
    const packet = buildSenderReport({
      ssrc: 5,
      unixMs: ms,
      rtpTimestamp: 90_000,
      packetCount: 3,
      octetCount: 4000,
    });
    expect(isRtcpPacket(packet)).toBe(true);
    const parsed = parseSenderReport(packet)!;
    expect(parsed.ssrc).toBe(5);
    expect(Math.abs(parsed.unixMs - ms)).toBeLessThan(1);
    expect(parsed).toMatchObject({
      rtpTimestamp: 90_000,
      packetCount: 3,
      octetCount: 4000,
    });
  });

  test("Cast feedback: checkpoint, NACKs (bit vector + whole frame), ACKs and PLI", () => {
    const packet = buildReceiverFeedback({
      receiverSsrc: 9,
      senderSsrc: 8,
      checkpoint: 257,
      playoutDelayMs: 400,
      nacks: [
        { frameId: 258, packetId: 3 },
        { frameId: 260, packetId: ALL_PACKETS_LOST },
      ],
      acks: [259, 270],
      pictureLoss: true,
    });
    expect(packet.length % 4).toBe(0);
    const parsed = parseReceiverRtcp(packet, 9, 8, 300)!;
    expect(parsed.checkpoint).toBe(257);
    expect(parsed.playoutDelayMs).toBe(400);
    expect(parsed.nacks).toEqual([
      { frameId: 258, packetId: 3 },
      { frameId: 260, packetId: ALL_PACKETS_LOST },
    ]);
    expect(parsed.acks).toEqual([259, 270]);
    expect(parsed.pictureLoss).toBe(true);
    // Another stream's SSRCs: nothing for this one.
    expect(parseReceiverRtcp(packet, 1, 2, 300)).toEqual({
      checkpoint: null,
      playoutDelayMs: null,
      nacks: [],
      acks: [],
      pictureLoss: false,
      report: null,
    });
    expect(parseReceiverRtcp(packet.subarray(0, 10), 9, 8, 300)).toBeNull();
  });

  test("a NACK bit vector names the following packets", () => {
    const packet = buildReceiverFeedback({
      receiverSsrc: 1,
      senderSsrc: 2,
      checkpoint: 4,
      playoutDelayMs: 400,
    });
    // Patch in one loss field by hand: frame 5, packet 2, bits 0b101 -> packets 2, 3, 5.
    const withLoss = new Uint8Array(packet.length + 4);
    withLoss.set(packet);
    const lossView = new DataView(withLoss.buffer);
    lossView.setUint16(2, withLoss.length / 4 - 1);
    withLoss[17] = 1;
    lossView.setUint32(20, (5 << 24) | (2 << 8) | 0b101);
    expect(parseReceiverRtcp(withLoss, 1, 2, 10)!.nacks).toEqual([
      { frameId: 5, packetId: 2 },
      { frameId: 5, packetId: 3 },
      { frameId: 5, packetId: 5 },
    ]);
  });

  test("Receiver Report blocks give loss and the last-SR echo", () => {
    const rr = new Uint8Array(32);
    const view = new DataView(rr.buffer);
    rr[0] = 0x81;
    rr[1] = 201;
    view.setUint16(2, 7);
    view.setUint32(4, 9);
    view.setUint32(8, 8);
    view.setUint32(12, (3 << 24) | 17);
    view.setUint32(24, 0x1234_5678);
    view.setUint32(28, 65_536);
    expect(parseReceiverRtcp(rr, 9, 8, 0)!.report).toEqual({
      fractionLost: 3,
      cumulativeLost: 17,
      lastSenderReport: 0x1234_5678,
      delaySinceLastReport: 65_536,
    });
  });

  test("RTP timestamps are on the shared session clock", () => {
    expect(rtpTimestampAt(2_000, 1_000, 90_000)).toBe(90_000);
    expect(rtpTimestampAt(1_010, 1_000, 48_000)).toBe(480);
  });
});

describe("CastRtpSender", () => {
  function harness() {
    let now = 1_000_000;
    const sent: Array<{
      packet: ReturnType<typeof parseRtpPacket>;
      kind: string;
    }> = [];
    const sender = new CastRtpSender({
      ssrc: 8,
      payloadType: 96,
      targetDelayMs: 400,
      now: () => now,
      send: (packet, kind) =>
        sent.push({ packet: parseRtpPacket(packet), kind }),
    });
    return {
      sender,
      sent,
      advance: (ms: number) => {
        now += ms;
      },
      now: () => now,
    };
  }
  const feedback = (
    input: Parameters<typeof buildReceiverFeedback>[0],
    sender: CastRtpSender,
  ) =>
    parseReceiverRtcp(buildReceiverFeedback(input), 9, 8, sender.lastFrameId)!;

  test("frames go out in order, delta frames reference the previous one", () => {
    const { sender, sent } = harness();
    expect(
      sender.enqueue({
        key: true,
        rtpTimestamp: 0,
        data: new Uint8Array(MAX_RTP_PAYLOAD_BYTES + 1),
      }),
    ).toBe(0);
    expect(
      sender.enqueue({
        key: false,
        rtpTimestamp: 3000,
        data: new Uint8Array(10),
      }),
    ).toBe(1);
    expect(
      sent.map(({ packet }) => [
        packet!.frameId8,
        packet!.packetId,
        packet!.key,
        packet!.referenceFrameId8,
      ]),
    ).toEqual([
      [0, 0, true, 0],
      [0, 1, true, 0],
      [1, 0, false, 0],
    ]);
    expect(sender.inFlight).toBe(2);
    expect(sender.stats.framesSent).toBe(2);
  });

  test("NACKs resend once a round trip has passed; ACK/checkpoint forget frames", () => {
    const { sender, sent, advance } = harness();
    sender.enqueue({
      key: true,
      rtpTimestamp: 0,
      data: new Uint8Array(MAX_RTP_PAYLOAD_BYTES * 3),
    });
    sender.enqueue({
      key: false,
      rtpTimestamp: 3000,
      data: new Uint8Array(10),
    });
    sender.enqueue({
      key: false,
      rtpTimestamp: 6000,
      data: new Uint8Array(10),
    });
    sent.length = 0;
    // Too soon: the packet may still be in flight.
    sender.onFeedback(
      feedback(
        {
          receiverSsrc: 9,
          senderSsrc: 8,
          checkpoint: -1 & 0xff,
          playoutDelayMs: 400,
          nacks: [{ frameId: 0, packetId: 1 }],
        },
        sender,
      ),
    );
    expect(sent.length).toBe(0);
    advance(100);
    sender.onFeedback(
      feedback(
        {
          receiverSsrc: 9,
          senderSsrc: 8,
          checkpoint: -1 & 0xff,
          playoutDelayMs: 400,
          nacks: [
            { frameId: 0, packetId: 1 },
            { frameId: 1, packetId: ALL_PACKETS_LOST },
          ],
        },
        sender,
      ),
    );
    expect(
      sent.map(({ packet, kind }) => [
        packet!.frameId8,
        packet!.packetId,
        kind,
      ]),
    ).toEqual([
      [0, 1, "retransmit"],
      [1, 0, "retransmit"],
    ]);
    sender.onFeedback(
      feedback(
        {
          receiverSsrc: 9,
          senderSsrc: 8,
          checkpoint: 0,
          playoutDelayMs: 400,
          acks: [2],
        },
        sender,
      ),
    );
    expect(sender.checkpointFrameId).toBe(0);
    expect(sender.inFlight).toBe(1);
    expect(sender.stats.retransmits).toBe(2);
  });

  test("PLI is reported; kickstart resends the newest frame’s last packet when unacknowledged", () => {
    const { sender, sent, advance } = harness();
    sender.enqueue({
      key: true,
      rtpTimestamp: 0,
      data: new Uint8Array(MAX_RTP_PAYLOAD_BYTES * 2),
    });
    expect(sender.kickstart()).toBe(false);
    advance(100);
    sent.length = 0;
    expect(sender.kickstart()).toBe(true);
    expect(sent[0]!.packet!.packetId).toBe(1);
    expect(
      sender.onFeedback(
        feedback(
          {
            receiverSsrc: 9,
            senderSsrc: 8,
            checkpoint: 0,
            playoutDelayMs: 400,
            pictureLoss: true,
          },
          sender,
        ),
      ),
    ).toBe(true);
    advance(100);
    expect(sender.kickstart()).toBe(false);
  });

  test("refuses frames when the receiver falls too far behind", () => {
    const { sender } = harness();
    let accepted = 0;
    for (let index = 0; index < MAX_UNACKED_FRAMES + 10; index++)
      if (
        sender.enqueue({
          key: index === 0,
          rtpTimestamp: index,
          data: new Uint8Array(1),
        }) !== null
      )
        accepted += 1;
    expect(accepted).toBeLessThan(MAX_UNACKED_FRAMES);
    expect(sender.stats.dropped).toBeGreaterThan(0);
  });

  test("round trip from the Receiver Report echo", () => {
    const { sender, now } = harness();
    const rr = new Uint8Array(32);
    const view = new DataView(rr.buffer);
    rr[0] = 0x81;
    rr[1] = 201;
    view.setUint16(2, 7);
    view.setUint32(4, 9);
    view.setUint32(8, 8);
    // SR sent 100 ms ago, held 20 ms at the receiver: 80 ms round trip.
    view.setUint32(24, ntpMiddle32(now() - 100));
    view.setUint32(28, Math.round(0.02 * 65_536));
    sender.onFeedback(parseReceiverRtcp(rr, 9, 8, 0)!);
    expect(sender.roundTripMs).toBeGreaterThan(30);
    expect(sender.roundTripMs).toBeLessThan(80);
  });
});
