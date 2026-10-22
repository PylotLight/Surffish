import { describe, expect, test } from "bun:test";
import {
  CastFrameReader,
  MAX_CAST_MESSAGE_BYTES,
  NS_HEARTBEAT,
  NS_MEDIA,
  buildLoadMessage,
  decodeCastMessage,
  encodeCastMessage,
  frameCastMessage,
  parseCastJson,
  parseMediaStatus,
  parseReceiverStatus,
} from "./cast-protocol";

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

describe("CastMessage protobuf", () => {
  test("encodes the exact cast_channel.proto bytes", () => {
    const bytes = encodeCastMessage({
      sourceId: "s",
      destinationId: "r",
      namespace: "n",
      data: "{}",
    });
    // 08 00 | 12 01 's' | 1a 01 'r' | 22 01 'n' | 28 00 | 32 02 '{}'
    expect(hex(bytes)).toBe(
      "0800" + "120173" + "1a0172" + "22016e" + "2800" + "32027b7d",
    );
  });
  test("round-trips strings and binary payloads", () => {
    const text = {
      sourceId: "sender-0",
      destinationId: "receiver-0",
      namespace: NS_HEARTBEAT,
      data: JSON.stringify({ type: "PING" }),
    };
    expect(decodeCastMessage(encodeCastMessage(text))).toEqual(text);
    const binary = {
      sourceId: "a",
      destinationId: "b",
      namespace: "urn:x-cast:test",
      data: Uint8Array.from([0, 1, 255]),
    };
    expect(decodeCastMessage(encodeCastMessage(binary))).toEqual(binary);
  });
  test("multi-byte varint lengths (long namespaces / payloads)", () => {
    const data = "x".repeat(300);
    const decoded = decodeCastMessage(
      encodeCastMessage({
        sourceId: "a",
        destinationId: "b",
        namespace: NS_MEDIA,
        data,
      }),
    );
    expect(decoded.data).toBe(data);
  });
  test("skips unknown fields and rejects truncation", () => {
    const base = encodeCastMessage({
      sourceId: "a",
      destinationId: "b",
      namespace: "n",
      data: "x",
    });
    // field 8 (bool continued, varint) and field 9 (uint32 remaining_length) appended
    const extended = Uint8Array.from([...base, 0x40, 0x01, 0x48, 0x96, 0x01]);
    expect(decodeCastMessage(extended).data).toBe("x");
    expect(() =>
      decodeCastMessage(base.subarray(0, base.length - 1)),
    ).toThrow();
  });
});

describe("framing", () => {
  test("4-byte big-endian length prefix", () => {
    const framed = frameCastMessage({
      sourceId: "s",
      destinationId: "r",
      namespace: "n",
      data: "{}",
    });
    expect(hex(framed.subarray(0, 4))).toBe("00000011");
    expect(framed.length).toBe(4 + 17);
  });
  test("reassembles messages split across TCP chunks", () => {
    const one = frameCastMessage({
      sourceId: "a",
      destinationId: "b",
      namespace: "n",
      data: '{"type":"PING"}',
    });
    const two = frameCastMessage({
      sourceId: "c",
      destinationId: "d",
      namespace: "n",
      data: '{"type":"PONG"}',
    });
    const stream = Uint8Array.from([...one, ...two]);
    const reader = new CastFrameReader();
    const out = [
      ...reader.push(stream.subarray(0, 3)),
      ...reader.push(stream.subarray(3, one.length + 5)),
      ...reader.push(stream.subarray(one.length + 5)),
    ];
    expect(out.map((message) => parseCastJson(message)?.type)).toEqual([
      "PING",
      "PONG",
    ]);
  });
  test("refuses oversized frames", () => {
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, MAX_CAST_MESSAGE_BYTES + 1);
    expect(() => new CastFrameReader().push(header)).toThrow(/too large/);
  });
});

describe("receiver and media messages", () => {
  test("RECEIVER_STATUS", () => {
    const status = parseReceiverStatus({
      type: "RECEIVER_STATUS",
      requestId: 2,
      status: {
        applications: [
          {
            appId: "CC1AD845",
            displayName: "Default Media Receiver",
            sessionId: "s-1",
            transportId: "t-1",
            namespaces: [{ name: NS_MEDIA }],
          },
        ],
        volume: { level: 0.4, muted: false },
      },
    });
    expect(status).toEqual({
      applications: [
        {
          appId: "CC1AD845",
          sessionId: "s-1",
          transportId: "t-1",
          displayName: "Default Media Receiver",
          namespaces: [NS_MEDIA],
        },
      ],
      volume: { level: 0.4, muted: false },
    });
    expect(parseReceiverStatus({ type: "MEDIA_STATUS" })).toBeNull();
    expect(
      parseReceiverStatus({ type: "RECEIVER_STATUS", status: {} })
        ?.applications,
    ).toEqual([]);
  });
  test("MEDIA_STATUS", () => {
    expect(
      parseMediaStatus({
        type: "MEDIA_STATUS",
        status: [
          {
            mediaSessionId: 3,
            playerState: "PLAYING",
            currentTime: 12.5,
            media: { duration: 600, streamType: "BUFFERED" },
          },
        ],
      }),
    ).toEqual({
      mediaSessionId: 3,
      playerState: "PLAYING",
      idleReason: null,
      currentTime: 12.5,
      duration: 600,
      live: false,
    });
    expect(
      parseMediaStatus({
        type: "MEDIA_STATUS",
        status: [
          { mediaSessionId: 3, playerState: "IDLE", idleReason: "FINISHED" },
        ],
      })?.idleReason,
    ).toBe("FINISHED");
    expect(parseMediaStatus({ type: "MEDIA_STATUS", status: [] })).toBeNull();
    expect(
      parseMediaStatus({
        type: "MEDIA_STATUS",
        status: [{ playerState: "PLAYING" }],
      }),
    ).toBeNull();
  });
  test("LOAD for the Default Media Receiver", () => {
    const load = buildLoadMessage(7, {
      url: "https://cdn.example/v.mp4",
      contentType: "video/mp4",
      title: "Clip",
      posterUrl: "https://cdn.example/p.jpg",
      startTime: 42,
      live: false,
    });
    expect(load).toMatchObject({
      type: "LOAD",
      requestId: 7,
      autoplay: true,
      currentTime: 42,
      media: {
        contentId: "https://cdn.example/v.mp4",
        contentType: "video/mp4",
        streamType: "BUFFERED",
        metadata: {
          title: "Clip",
          images: [{ url: "https://cdn.example/p.jpg" }],
        },
      },
    });
    expect(
      buildLoadMessage(1, {
        url: "https://x/live.m3u8",
        contentType: "application/x-mpegurl",
        title: "",
        posterUrl: null,
        startTime: 99,
        live: true,
      }),
    ).toMatchObject({
      currentTime: 0,
      media: { streamType: "LIVE", metadata: { images: [] } },
    });
  });
});
