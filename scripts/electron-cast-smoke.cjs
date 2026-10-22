// Integration smoke for Cast (Chromecast), against the production build, with a FAKE Chromecast:
//   - a fake mDNS responder on loopback (the app's browser sends its _googlecast._tcp question there
//     through SURFFISH_CAST_MDNS_TARGET and gets a unicast PTR/SRV/TXT/A answer back), and
//   - a fake CASTV2 receiver: a local TLS server (self-signed, like a real device) speaking the
//     length-prefixed protobuf CastMessage protocol: CONNECT, PING/PONG, GET_STATUS, LAUNCH of the
//     Default Media Receiver, media LOAD/PLAY/PAUSE/SEEK/STOP, SET_VOLUME and receiver STOP.
// Discovery: a Chromecast seen before (userData cast-devices.json) shows in the picker straight away
// once a quick connect to its port answers, before any mDNS answer; one that doesn't answer stays
// hidden; questions carry the QU bit (unicast answers); a PTR-only answer gets its SRV/TXT asked for
// at once; the mDNS answer then updates the saved device.
// Checks: the toolbar button appears once a device is found; the picker lists it and says what the
// tab would cast; Cast video launches CC1AD845 and LOADs the page's video URL at the local position
// and pauses the local video; the tab shows the cast badge; play/pause/seek/volume reach the device;
// Stop stops the app and leaves the local video at the cast position; a receiver that stops the app
// (another phone) ends the session; MSE (blob:) pages are refused unless the tab fetched an HLS
// manifest; LOAD_FAILED is reported; Settings off hides everything; ⌘K "Cast…" opens the picker.
// Mirror tab: the fake receiver also plays Chrome's mirroring receiver (0F5096E8): it answers the
// OFFER on the webrtc namespace, receives the Cast RTP stream on UDP, checks a Sender Report came
// first, drops a packet and NACKs it (retransmit), sends a PLI (new key frame), ACKs frames,
// decrypts (AES-128-CTR with the OFFER's key/IV mask), reassembles and decodes a VP8 key frame with
// WebCodecs and checks it shows the tab (its colour); frames keep coming with another tab in front;
// Stop ends the stream; ⌘K "Mirror Tab" mirrors again to the last device; closing the tab ends it.
// `bun run build && bun run test:electron-cast`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-cast-smoke.cjs`).
// SURFFISH_SCREENSHOT_DIR=<dir> also saves screen grabs of the picker (Linux: ImageMagick `import`).
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { createServer: createTlsServer } = require("node:tls");
const { createSocket } = require("node:dgram");
const { createDecipheriv } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { networkInterfaces, tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  app,
  BaseWindow,
  BrowserWindow,
  webContents: allWebContents,
} = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const userData = join(tmpdir(), `surffish-cast-smoke-${process.pid}`);
const clip = readFileSync(resolve(__dirname, "fixtures/cast/clip.webm"));
const delay = (ms) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
async function waitFor(predicate, description, timeout = smoke.waitMs) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(50);
  }
  throw new Error(
    `Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError}` : ""}`,
  );
}

// ---------------------------------------------------------------------------------------------
// Fixture site: a page with a real <video>, an MSE page and an MSE page that fetched an HLS manifest.
const site = createServer((request, response) => {
  const url = new URL(request.url, "http://x");
  if (url.pathname === "/clip.webm") {
    const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range || "");
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Number(range[2]) : clip.length - 1;
      response.writeHead(206, {
        "content-type": "video/webm",
        "content-range": `bytes ${start}-${end}/${clip.length}`,
        "accept-ranges": "bytes",
        "content-length": end - start + 1,
      });
      response.end(clip.subarray(start, end + 1));
    } else {
      response.writeHead(200, {
        "content-type": "video/webm",
        "accept-ranges": "bytes",
        "content-length": clip.length,
      });
      response.end(clip);
    }
    return;
  }
  if (url.pathname === "/stream/master.m3u8") {
    response.writeHead(200, {
      "content-type": "application/vnd.apple.mpegurl",
      "access-control-allow-origin": "*",
    });
    response.end("#EXTM3U\n");
    return;
  }
  const pages = {
    "/watch":
      '<title>Smoke clip</title><video id="v" src="/clip.webm" poster="/poster.png" muted playsinline width="480" height="270"></video>',
    "/mse":
      '<title>MSE page</title><video id="v" width="480" height="270"></video><script>document.getElementById("v").src = URL.createObjectURL(new MediaSource())</script>',
    "/blank": "<title>blank</title>",
    // Green, with a small square in the corner that changes every 150 ms (so capture keeps producing frames).
    "/mirror":
      '<title>Mirror me</title><style>html,body{margin:0;height:100%;background:rgb(30,160,90)}#b{position:fixed;left:0;top:0;width:24px;height:24px;background:#fff}</style><div id="b"></div><script>let n=0;setInterval(()=>{document.getElementById("b").style.background=(++n%2)?"#000":"#fff"},150)</script>',
    "/hls":
      '<title>HLS page</title><video id="v" width="480" height="270"></video><script>document.getElementById("v").src = URL.createObjectURL(new MediaSource()); fetch("/stream/master.m3u8")</script>',
  };
  response.writeHead(pages[url.pathname] ? 200 : 404, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(
    `<!doctype html><meta charset="utf-8">${pages[url.pathname] ?? "missing"}`,
  );
});

// ---------------------------------------------------------------------------------------------
// CastMessage protobuf (cast_channel.proto), hand-rolled like src/shared/cast-protocol.ts.
function varint(value, out) {
  let rest = value >>> 0;
  while (rest >= 0x80) {
    out.push((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  out.push(rest);
}
function encode({ sourceId, destinationId, namespace, data }) {
  const out = [];
  const field = (number, text) => {
    const bytes = Buffer.from(text);
    varint((number << 3) | 2, out);
    varint(bytes.length, out);
    out.push(...bytes);
  };
  varint(8, out);
  varint(0, out);
  field(2, sourceId);
  field(3, destinationId);
  field(4, namespace);
  varint(40, out);
  varint(0, out);
  field(6, data);
  const body = Buffer.from(out);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
}
function decode(bytes) {
  const message = {};
  let offset = 0;
  const readVarint = () => {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = bytes[offset++];
      result += (byte & 0x7f) * 2 ** shift;
      if (!(byte & 0x80)) return result;
      shift += 7;
    }
  };
  while (offset < bytes.length) {
    const tag = readVarint();
    if ((tag & 7) === 0) {
      readVarint();
      continue;
    }
    const length = readVarint();
    const value = bytes.subarray(offset, offset + length).toString();
    offset += length;
    message[
      { 2: "sourceId", 3: "destinationId", 4: "namespace", 6: "data" }[
        tag >> 3
      ] ?? "other"
    ] = value;
  }
  return message;
}

const NS = {
  connection: "urn:x-cast:com.google.cast.tp.connection",
  heartbeat: "urn:x-cast:com.google.cast.tp.heartbeat",
  receiver: "urn:x-cast:com.google.cast.receiver",
  media: "urn:x-cast:com.google.cast.media",
  webrtc: "urn:x-cast:com.google.cast.webrtc",
};

// ---------------------------------------------------------------------------------------------
// Fake Chromecast (CASTV2 over TLS).
const received = [];
const receiver = {
  apps: [],
  volume: { level: 1, muted: false },
  media: null,
  sockets: new Set(),
};
function receiverStatus(requestId = 0) {
  return {
    type: "RECEIVER_STATUS",
    requestId,
    status: { applications: receiver.apps, volume: receiver.volume },
  };
}
function mediaStatus(requestId = 0) {
  const media = receiver.media;
  return {
    type: "MEDIA_STATUS",
    requestId,
    status: media
      ? [
          {
            mediaSessionId: 1,
            playerState: media.state,
            currentTime: media.time,
            idleReason: media.idleReason,
            media: {
              contentId: media.contentId,
              duration: 30,
              streamType: "BUFFERED",
            },
            volume: { level: 1, muted: false },
          },
        ]
      : [],
  };
}
function send(socket, destinationId, namespace, payload, sourceId) {
  socket.write(
    encode({
      sourceId: sourceId ?? "receiver-0",
      destinationId,
      namespace,
      data: JSON.stringify(payload),
    }),
  );
}
function broadcastStatus() {
  for (const socket of receiver.sockets)
    send(socket, "*", NS.receiver, receiverStatus());
}
const fakeCast = createTlsServer(
  {
    key: readFileSync(resolve(__dirname, "fixtures/certs/self-signed.key")),
    cert: readFileSync(resolve(__dirname, "fixtures/certs/self-signed.pem")),
  },
  (socket) => {
    receiver.sockets.add(socket);
    socket.on("close", () => receiver.sockets.delete(socket));
    socket.on("error", () => undefined);
    let pending = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      while (
        pending.length >= 4 &&
        pending.length >= 4 + pending.readUInt32BE(0)
      ) {
        const length = pending.readUInt32BE(0);
        const message = decode(pending.subarray(4, 4 + length));
        pending = pending.subarray(4 + length);
        const payload = JSON.parse(message.data);
        received.push({
          namespace: message.namespace,
          destinationId: message.destinationId,
          ...payload,
        });
        const reply = (body, from = message.destinationId) =>
          send(socket, message.sourceId, message.namespace, body, from);
        if (message.namespace === NS.heartbeat && payload.type === "PING")
          reply({ type: "PONG" });
        if (message.namespace === NS.receiver) {
          if (payload.type === "GET_STATUS")
            reply(receiverStatus(payload.requestId));
          if (payload.type === "LAUNCH") {
            receiver.apps =
              payload.appId === "0F5096E8"
                ? [
                    {
                      appId: payload.appId,
                      displayName: "Chrome Mirroring",
                      sessionId: "session-mirror",
                      transportId: "transport-mirror",
                      namespaces: [{ name: NS.webrtc }],
                    },
                  ]
                : [
                    {
                      appId: payload.appId,
                      displayName: "Default Media Receiver",
                      sessionId: "session-dmr",
                      transportId: "transport-dmr",
                      namespaces: [{ name: NS.media }],
                    },
                  ];
            reply(receiverStatus(payload.requestId));
          }
          if (payload.type === "SET_VOLUME") {
            receiver.volume = { ...receiver.volume, ...payload.volume };
            reply(receiverStatus(payload.requestId));
          }
          if (payload.type === "STOP") {
            receiver.apps = [];
            receiver.media = null;
            broadcastStatus();
          }
        }
        if (
          message.namespace === NS.webrtc &&
          message.destinationId === "transport-mirror" &&
          payload.type === "OFFER"
        ) {
          startMirrorReceiver(payload.offer).then(
            (answer) =>
              reply({
                type: "ANSWER",
                seqNum: payload.seqNum,
                result: "ok",
                answer,
              }),
            (error) =>
              reply({
                type: "ANSWER",
                seqNum: payload.seqNum,
                result: "error",
                error: { code: 1, description: String(error) },
              }),
          );
        }
        if (
          message.namespace === NS.media &&
          message.destinationId === "transport-dmr"
        ) {
          if (payload.type === "LOAD") {
            if (payload.media.contentId.includes("forbidden")) {
              reply({
                type: "LOAD_FAILED",
                requestId: payload.requestId,
                detailedErrorCode: 104,
              });
              continue;
            }
            receiver.media = {
              contentId: payload.media.contentId,
              state: "PLAYING",
              time: payload.currentTime,
              idleReason: undefined,
            };
            reply(mediaStatus(payload.requestId));
          }
          if (payload.type === "PLAY" || payload.type === "PAUSE") {
            receiver.media.state =
              payload.type === "PLAY" ? "PLAYING" : "PAUSED";
            send(socket, "*", NS.media, mediaStatus(), "transport-dmr");
          }
          if (payload.type === "SEEK") {
            receiver.media.time = payload.currentTime;
            send(socket, "*", NS.media, mediaStatus(), "transport-dmr");
          }
          if (payload.type === "STOP") receiver.media = null;
          if (payload.type === "GET_STATUS")
            reply(mediaStatus(payload.requestId));
        }
      }
    });
  },
);

// ---------------------------------------------------------------------------------------------
// Fake mirroring receiver (Cast Streaming over UDP), written from Open Screen's wire formats.
const mirror = {
  offers: [],
  socket: null,
  sender: null,
  streams: new Map(),
  rtpBeforeSr: false,
  dropped: null,
  retransmitted: false,
  pliAt: 0,
  keyAfterPli: false,
  latencies: [],
  bytes: 0,
};
function castFeedback(stream, nacks = [], pictureLoss = false) {
  const body = Buffer.alloc(20 + nacks.length * 4);
  body[0] = 0x80 | 15;
  body[1] = 206;
  body.writeUInt16BE(body.length / 4 - 1, 2);
  body.writeUInt32BE(stream.receiverSsrc, 4);
  body.writeUInt32BE(stream.senderSsrc, 8);
  body.write("CAST", 12, "latin1");
  body[16] = stream.checkpoint & 0xff;
  body[17] = nacks.length;
  body.writeUInt16BE(400, 18);
  nacks.forEach((nack, index) => {
    body[20 + index * 4] = nack.frameId & 0xff;
    body.writeUInt16BE(nack.packetId, 21 + index * 4);
    body[23 + index * 4] = 0;
  });
  if (!pictureLoss) return body;
  const pli = Buffer.alloc(12);
  pli[0] = 0x80 | 1;
  pli[1] = 206;
  pli.writeUInt16BE(2, 2);
  pli.writeUInt32BE(stream.receiverSsrc, 4);
  pli.writeUInt32BE(stream.senderSsrc, 8);
  return Buffer.concat([body, pli]);
}
function sendFeedback(stream, nacks, pictureLoss) {
  if (mirror.socket && mirror.sender)
    mirror.socket.send(
      castFeedback(stream, nacks, pictureLoss),
      mirror.sender.port,
      mirror.sender.address,
    );
}
function expandId(stream, id8) {
  let id = (Math.max(stream.latest, 0) & ~0xff) | id8;
  if (id < stream.latest - 128) id += 256;
  if (id > stream.latest + 128) id -= 256;
  return id;
}
function onMirrorPacket(packet, from) {
  mirror.sender = from;
  mirror.bytes += packet.length;
  if (packet[1] === 200) {
    const stream = mirror.streams.get(packet.readUInt32BE(4));
    if (stream)
      stream.sr = {
        unixMs:
          (packet.readUInt32BE(8) - 2208988800) * 1000 +
          (packet.readUInt32BE(12) / 2 ** 32) * 1000,
        rtp: packet.readUInt32BE(16),
      };
    return;
  }
  if (packet[0] !== 0x80 || packet.length < 19) return;
  const stream = mirror.streams.get(packet.readUInt32BE(8));
  if (!stream) return;
  if (!stream.sr) mirror.rtpBeforeSr = true;
  const flags = packet[12];
  const frameId = expandId(stream, packet[13]);
  const packetId = packet.readUInt16BE(14);
  const maxPacketId = packet.readUInt16BE(16);
  let offset = 18 + (flags & 0x40 ? 1 : 0);
  for (let extension = 0; extension < (flags & 0x3f); extension++)
    offset += 2 + (packet.readUInt16BE(offset) & 0x3ff);
  if (frameId <= stream.checkpoint || stream.done.has(frameId)) {
    if (
      mirror.dropped &&
      frameId === mirror.dropped.frameId &&
      packetId === mirror.dropped.packetId
    )
      mirror.retransmitted = true;
    return;
  }
  stream.latest = Math.max(stream.latest, frameId);
  // Lose packet 1 of the first multi-packet video key frame, then NACK it like a receiver would.
  if (
    stream.kind === "video" &&
    !mirror.dropped &&
    flags & 0x80 &&
    maxPacketId >= 1 &&
    packetId === 1
  ) {
    mirror.dropped = { frameId, packetId };
    setTimeout(() => sendFeedback(stream, [{ frameId, packetId }]), 120);
    return;
  }
  if (
    mirror.dropped &&
    frameId === mirror.dropped.frameId &&
    packetId === mirror.dropped.packetId
  )
    mirror.retransmitted = true;
  let frame = stream.pending.get(frameId);
  if (!frame) {
    frame = {
      parts: [],
      count: maxPacketId + 1,
      key: (flags & 0x80) !== 0,
      rtp: packet.readUInt32BE(4),
    };
    stream.pending.set(frameId, frame);
  }
  frame.parts[packetId] = packet.subarray(offset);
  if (frame.parts.filter(Boolean).length < frame.count) return;
  stream.pending.delete(frameId);
  stream.done.add(frameId);
  const nonce = Buffer.alloc(16);
  nonce.writeUInt32BE(frameId >>> 0, 8);
  for (let index = 0; index < 16; index++) nonce[index] ^= stream.mask[index];
  const decipher = createDecipheriv("aes-128-ctr", stream.key, nonce);
  const data = Buffer.concat([
    decipher.update(Buffer.concat(frame.parts)),
    decipher.final(),
  ]);
  stream.frames.push({ frameId, key: frame.key, data });
  if (stream.kind === "video" && stream.sr) {
    // Capture time on the sender's clock (from the Sender Report) to arrival here.
    const captureMs = stream.sr.unixMs + ((frame.rtp - stream.sr.rtp) | 0) / 90;
    mirror.latencies.push(Date.now() - captureMs);
  }
  if (
    stream.kind === "video" &&
    frame.key &&
    mirror.pliAt &&
    Date.now() > mirror.pliAt
  )
    mirror.keyAfterPli = true;
  while (stream.done.has(stream.checkpoint + 1)) stream.checkpoint += 1;
  sendFeedback(stream, []);
}
async function startMirrorReceiver(offer) {
  mirror.offers.push(offer);
  if (!mirror.socket) {
    mirror.socket = createSocket("udp4");
    mirror.socket.on("message", onMirrorPacket);
    await new Promise((resolvePromise) =>
      mirror.socket.bind(0, "127.0.0.1", resolvePromise),
    );
  }
  mirror.streams.clear();
  const indexes = [];
  const ssrcs = [];
  for (const stream of offer.supportedStreams) {
    const receiverSsrc = 0x5000 + stream.index;
    mirror.streams.set(stream.ssrc, {
      kind: stream.type === "video_source" ? "video" : "audio",
      senderSsrc: stream.ssrc,
      receiverSsrc,
      key: Buffer.from(stream.aesKey, "hex"),
      mask: Buffer.from(stream.aesIvMask, "hex"),
      latest: -1,
      checkpoint: -1,
      pending: new Map(),
      done: new Set(),
      frames: [],
      sr: null,
    });
    indexes.push(stream.index);
    ssrcs.push(receiverSsrc);
  }
  return {
    castMode: "mirroring",
    udpPort: mirror.socket.address().port,
    sendIndexes: indexes,
    ssrcs,
  };
}
const mirrorStream = (kind) =>
  [...mirror.streams.values()].find((stream) => stream.kind === kind);

// ---------------------------------------------------------------------------------------------
// Fake mDNS responder (unicast to the asker): a PTR question gets the PTR alone (like a responder
// that leaves the rest out), an SRV/TXT question for the instance gets PTR/SRV/TXT/A. Holds every
// answer while `mdnsHold` is set (the cached-device step).
const mdnsQueries = [];
const mdnsQuestions = [];
let mdnsHold = true;
const mdns = createSocket("udp4");
const MDNS_INSTANCE =
  "Smoke-TV-00112233445566778899aabbccddeeff._googlecast._tcp.local";
function mdnsParseQuestions(packet) {
  const out = [];
  let offset = 12;
  for (let index = 0; index < packet.readUInt16BE(4); index++) {
    const labels = [];
    while (packet[offset] !== 0) {
      labels.push(
        packet.subarray(offset + 1, offset + 1 + packet[offset]).toString(),
      );
      offset += 1 + packet[offset];
    }
    offset += 1;
    out.push({
      name: labels.join("."),
      type: packet.readUInt16BE(offset),
      qu: (packet.readUInt16BE(offset + 2) & 0x8000) !== 0,
    });
    offset += 4;
  }
  return out;
}
function mdnsAnswer(castPort, full) {
  const out = [];
  const u16 = (value) => out.push((value >> 8) & 0xff, value & 0xff);
  const u32 = (value) => {
    u16(value >>> 16);
    u16(value & 0xffff);
  };
  const name = (value) => {
    for (const label of value.split(".")) {
      const bytes = Buffer.from(label);
      out.push(bytes.length, ...bytes);
    }
    out.push(0);
  };
  const record = (owner, type, data) => {
    name(owner);
    u16(type);
    u16(0x8001);
    u32(120);
    const at = out.length;
    u16(0);
    const start = out.length;
    data();
    out[at] = (out.length - start) >> 8;
    out[at + 1] = (out.length - start) & 0xff;
  };
  const instance = MDNS_INSTANCE;
  u16(0);
  u16(0x8400);
  u16(0);
  u16(full ? 4 : 1);
  u16(0);
  u16(0);
  record("_googlecast._tcp.local", 12, () => name(instance));
  if (!full) return Buffer.from(out);
  record(instance, 33, () => {
    u16(0);
    u16(0);
    u16(castPort);
    name("smoke-tv.local");
  });
  record(instance, 16, () => {
    for (const entry of [
      "id=00112233445566778899aabbccddeeff",
      "md=Chromecast",
      "fn=Smoke TV",
    ]) {
      out.push(Buffer.byteLength(entry), ...Buffer.from(entry));
    }
  });
  record("smoke-tv.local", 1, () => out.push(127, 0, 0, 1));
  return Buffer.from(out);
}

const views = (window) =>
  window.contentView.children.filter(
    (view) => view.webContents && !view.webContents.isDestroyed(),
  );
function surfaceFor(view) {
  try {
    return new URL(view.webContents.getURL()).searchParams.get("surface");
  } catch {
    return null;
  }
}
const pageContents = (predicate) =>
  allWebContents
    .getAllWebContents()
    .find(
      (contents) =>
        !contents.isDestroyed() && predicate(contents.getURL(), contents),
    );

function screenGrab(name) {
  const dir = process.env.SURFFISH_SCREENSHOT_DIR;
  if (!dir || process.platform !== "linux" || !process.env.DISPLAY) return;
  mkdirSync(dir, { recursive: true });
  try {
    execFileSync(
      "import",
      ["-window", "root", "-crop", "1200x800+0+0", join(dir, `${name}.png`)],
      { stdio: "ignore" },
    );
  } catch (error) {
    console.warn(`screen grab ${name} failed: ${error.message}`);
  }
}

async function run() {
  app.setPath("userData", userData);
  mkdirSync(userData, { recursive: true, mode: 0o700 });
  const blocker = ElectronBlocker.parse(
    "||surffish-smoke-never-match.invalid^",
    smoke.ADBLOCK_CONFIG,
  );
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), blocker.serialize(), {
    mode: 0o600,
  });
  const now = Date.now();
  writeFileSync(
    join(userData, "new-tab-photo-cache.json"),
    `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`,
  );
  // All interfaces: the tab starts on loopback (which the app must refuse: a Chromecast can't reach
  // this machine's loopback), then uses this machine's LAN address like a real site on the network.
  await new Promise((resolvePromise) =>
    site.listen(0, "0.0.0.0", resolvePromise),
  );
  await new Promise((resolvePromise) =>
    fakeCast.listen(0, "127.0.0.1", resolvePromise),
  );
  await new Promise((resolvePromise) =>
    mdns.bind(0, "127.0.0.1", resolvePromise),
  );
  const castPort = fakeCast.address().port;
  mdns.on("message", (packet, info) => {
    mdnsQueries.push(packet);
    const questions = mdnsParseQuestions(packet);
    mdnsQuestions.push(...questions);
    if (mdnsHold) return;
    const followUp = questions.some(
      (question) =>
        question.name.toLowerCase() === MDNS_INSTANCE.toLowerCase() &&
        (question.type === 33 || question.type === 16),
    );
    const browse = questions.some(
      (question) =>
        question.name === "_googlecast._tcp.local" && question.type === 12,
    );
    if (followUp || browse)
      mdns.send(mdnsAnswer(castPort, followUp), info.port, info.address);
  });
  // A Chromecast seen on an earlier run (saved under an older name), and one that has gone (its port refuses).
  const closed = createTlsServer();
  await new Promise((resolvePromise) =>
    closed.listen(0, "127.0.0.1", resolvePromise),
  );
  const deadPort = closed.address().port;
  await new Promise((resolvePromise) => closed.close(resolvePromise));
  writeFileSync(
    join(userData, "cast-devices.json"),
    JSON.stringify({
      version: 1,
      devices: [
        {
          id: "00112233445566778899aabbccddeeff",
          name: "Smoke TV (old name)",
          model: "Chromecast",
          host: "127.0.0.1",
          port: castPort,
          seenAt: Date.now() - 60_000,
        },
        {
          id: "gone-tv",
          name: "Gone TV",
          model: "Chromecast",
          host: "127.0.0.1",
          port: deadPort,
          seenAt: Date.now() - 120_000,
        },
      ],
    }),
  );
  process.env.SURFFISH_CAST_MDNS_TARGET = `127.0.0.1:${mdns.address().port}`;
  const origin = `http://127.0.0.1:${site.address().port}`;
  const lanAddress = Object.values(networkInterfaces())
    .flat()
    .find(
      (entry) => entry && entry.family === "IPv4" && !entry.internal,
    )?.address;
  // Without a LAN interface, a name that doesn't resolve still gives the element a castable currentSrc.
  const lanOrigin = `http://${lanAddress ?? "smoke-host.test"}:${site.address().port}`;
  const watchUrl = `${origin}/watch`;
  writeFileSync(
    join(userData, "browser-session.json"),
    JSON.stringify({ version: 1, tabs: [watchUrl], activeIndex: 0 }),
  );

  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();
  const mainWindow = await waitFor(
    () => BaseWindow.getAllWindows()[0],
    "the main window",
  );
  mainWindow.setBounds({ x: 0, y: 0, width: 1200, height: 800 });
  const surface = (name) =>
    views(mainWindow).find((view) => surfaceFor(view) === name)?.webContents;
  await waitFor(
    () => surface("toolbar") && surface("sidebar"),
    "the renderer surfaces",
  );
  const toolbar = surface("toolbar");
  await waitFor(
    () =>
      smoke.evaluate(
        toolbar,
        'document.readyState === "complete" && Boolean(window.api)',
      ),
    "the toolbar renderer",
  );
  const inToolbar = (code) => smoke.evaluate(toolbar, code);
  const click = (selector) =>
    inToolbar(
      `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element || element.disabled) return false; element.click(); return true })()`,
    );
  const snapshot = () => inToolbar("window.api.browser.cast.snapshot()");
  const page = await waitFor(
    () =>
      pageContents(
        (url, contents) => url === watchUrl && !contents.isLoading(),
      ),
    "the video tab",
  );
  const playLocal = () =>
    smoke.evaluate(
      page,
      'new Promise((done) => { const v = document.getElementById("v"); const go = () => v.play().then(() => done(true), () => done(false)); if (v.readyState >= 1) go(); else v.addEventListener("loadedmetadata", go, { once: true }); v.addEventListener("error", () => done(false), { once: true }) })',
    );

  smoke.step(
    'no button before discovery; ⌘K "Cast…" opens the picker, which shows the known device at once',
  );
  // The cast button is contextual (shared/toolbar-layout.ts): folded (hidden) until a device is known and the page played media.
  assert.equal(
    await inToolbar(
      'Boolean(document.querySelector(".cast-button:not([hidden])"))',
    ),
    false,
    "no cast button with no devices known",
  );
  const pickerAt = Date.now();
  assert.equal(
    await inToolbar('window.api.browser.commands.run("cast.open")'),
    true,
  );
  await waitFor(
    () => inToolbar('Boolean(document.querySelector("#cast-popover"))'),
    "the cast picker",
  );
  await waitFor(
    () =>
      inToolbar(
        'document.querySelector("#cast-popover .cast-device-name")?.textContent === "Smoke TV (old name)"',
      ),
    "the known device row (before any mDNS answer)",
    5_000,
  );
  const cachedMs = Date.now() - pickerAt;
  console.log(`known device shown ${cachedMs}ms after opening the picker`);
  assert.ok(cachedMs < 2_000, `known device shown quickly (${cachedMs}ms)`);
  assert.ok(
    !(await snapshot()).devices.some((device) => device.id === "gone-tv"),
    "a known device that refuses connections stays hidden",
  );
  assert.ok(mdnsQueries.length >= 1, "the app sent an mDNS question");
  assert.ok(
    mdnsQuestions.every((question) => question.qu),
    "questions ask for unicast answers (QU)",
  );

  smoke.step(
    "mDNS: a PTR-only answer gets SRV/TXT asked for at once; the answer updates the device",
  );
  const releasedAt = Date.now();
  mdnsHold = false;
  await waitFor(
    async () =>
      (await snapshot()).devices.some((device) => device.name === "Smoke TV"),
    "Smoke TV to be discovered",
    6_000,
  );
  console.log(
    `mDNS answer applied ${Date.now() - releasedAt}ms after the responder started answering`,
  );
  assert.ok(
    mdnsQuestions.some(
      (question) =>
        question.name.toLowerCase() === MDNS_INSTANCE.toLowerCase() &&
        question.type === 33,
    ),
    "an SRV follow-up for the instance",
  );
  assert.equal(
    (await snapshot()).devices.length,
    1,
    "one device (cache and mDNS agree on its id)",
  );
  const device = (await snapshot()).devices.find(
    (entry) => entry.name === "Smoke TV",
  );
  assert.deepEqual(
    { ...device },
    {
      id: "00112233445566778899aabbccddeeff",
      name: "Smoke TV",
      model: "Chromecast",
      host: "127.0.0.1",
      port: castPort,
    },
  );
  assert.equal(
    (await snapshot()).scanning,
    true,
    "browsing while the picker is open",
  );
  await waitFor(
    () =>
      inToolbar(
        'document.querySelector("#cast-popover .cast-device-name")?.textContent === "Smoke TV"',
      ),
    "the device row",
  );

  smoke.step("loopback media is refused with a reason");
  await waitFor(
    () =>
      inToolbar(
        'document.querySelector("#cast-popover .cast-media")?.dataset.castable === "false" && /localhost/.test(document.querySelector("#cast-popover .cast-media").textContent)',
      ),
    "the loopback refusal",
  );
  assert.equal(
    await inToolbar(
      'document.querySelector("#cast-popover .cast-action").disabled',
    ),
    true,
  );
  assert.equal(await click(".cast-close"), true);
  await waitFor(
    async () =>
      !(await inToolbar('Boolean(document.querySelector("#cast-popover"))')),
    "the picker to close",
  );
  await waitFor(
    async () => (await snapshot()).scanning === false,
    "browsing to stop with the picker closed",
  );
  await waitFor(
    () => {
      const saved = JSON.parse(
        readFileSync(join(userData, "cast-devices.json"), "utf8"),
      ).devices;
      return (
        saved.find((entry) => entry.id === "00112233445566778899aabbccddeeff")
          ?.name === "Smoke TV"
      );
    },
    "the saved device to take the name mDNS gave it",
    5_000,
  );

  smoke.step(
    "a LAN page's playing video is castable; the toolbar button shows once a device is known",
  );
  page.loadURL(`${lanOrigin}/watch`);
  await waitFor(
    () => !page.isLoading() && page.getURL() === `${lanOrigin}/watch`,
    "the LAN video page",
  );
  const playing = lanAddress ? await playLocal() : false;
  if (lanAddress) assert.equal(playing, true, "the local video plays");
  if (playing)
    await waitFor(
      () =>
        inToolbar(
          'Boolean(document.querySelector(".cast-button:not([hidden])"))',
        ),
      "the toolbar cast button (a device is known and the page played video)",
    );
  else
    await waitFor(
      () => inToolbar('Boolean(document.querySelector(".cast-button"))'),
      "the (folded) cast button",
    );
  assert.equal(await click(".cast-button"), true);
  await waitFor(
    () =>
      inToolbar(
        'document.querySelector("#cast-popover .cast-media")?.dataset.castable === "true"',
      ),
    "the page video to be castable",
  );
  assert.match(
    await inToolbar(
      'document.querySelector("#cast-popover .cast-media").textContent',
    ),
    /WebM video ready to cast/,
  );
  await delay(300);
  screenGrab("cast-picker");

  smoke.step(
    "Cast video: LAUNCH CC1AD845, LOAD the page URL at the local position, local video paused, tab badge",
  );
  const localTime = await smoke.evaluate(
    page,
    'document.getElementById("v").currentTime',
  );
  assert.equal(await click("#cast-popover .cast-action"), true);
  await waitFor(
    async () => (await snapshot()).session?.status === "playing",
    "the cast to be playing",
  );
  const launch = received.find((message) => message.type === "LAUNCH");
  assert.equal(launch.appId, "CC1AD845");
  assert.ok(
    received.some(
      (message) =>
        message.type === "CONNECT" && message.destinationId === "receiver-0",
    ),
    "connected to receiver-0",
  );
  assert.ok(
    received.some(
      (message) =>
        message.type === "CONNECT" && message.destinationId === "transport-dmr",
    ),
    "connected to the app transport",
  );
  const load = received.find((message) => message.type === "LOAD");
  assert.equal(load.media.contentId, `${lanOrigin}/clip.webm`);
  assert.equal(load.media.contentType, "video/webm");
  assert.equal(load.media.metadata.title, "Smoke clip");
  assert.deepEqual(load.media.metadata.images, [
    { url: `${lanOrigin}/poster.png` },
  ]);
  assert.equal(load.autoplay, true);
  assert.ok(
    load.currentTime >= localTime - 0.01,
    `LOAD starts at the local position (${load.currentTime} vs ${localTime})`,
  );
  const session = (await snapshot()).session;
  assert.equal(session.deviceName, "Smoke TV");
  assert.equal(session.kind, "media");
  assert.equal(
    await smoke.evaluate(page, 'document.getElementById("v").paused'),
    true,
    "the local video is paused",
  );
  const sidebar = surface("sidebar");
  await waitFor(
    () =>
      smoke.evaluate(
        sidebar,
        'Boolean(document.querySelector(".tab-cast-badge"))',
      ),
    "the cast badge on the tab row",
  );
  await waitFor(
    () =>
      inToolbar(
        'document.querySelector(".cast-button:not([hidden])")?.classList.contains("is-casting")',
      ),
    "the toolbar button to show casting (a live cast always shows it)",
  );
  await waitFor(
    () =>
      inToolbar(
        'document.querySelector("#cast-popover .cast-session-status")?.textContent === "Playing"',
      ),
    "the session controls",
  );
  await delay(300);
  screenGrab("cast-playing");

  smoke.step("controls reach the device: pause, play, seek, volume, mute");
  assert.equal(await click("#cast-popover .cast-play"), true);
  await waitFor(
    () =>
      received.some(
        (message) => message.type === "PAUSE" && message.mediaSessionId === 1,
      ),
    "PAUSE",
  );
  await waitFor(
    async () => (await snapshot()).session?.status === "paused",
    "paused status from the device",
  );
  assert.equal(
    await inToolbar('window.api.browser.cast.control("play")'),
    true,
  );
  await waitFor(
    () => received.some((message) => message.type === "PLAY"),
    "PLAY",
  );
  assert.equal(
    await inToolbar('window.api.browser.cast.control("seek", 20)'),
    true,
  );
  await waitFor(
    () =>
      received.some(
        (message) => message.type === "SEEK" && message.currentTime === 20,
      ),
    "SEEK to 20 s",
  );
  await waitFor(
    async () => Math.floor((await snapshot()).session?.currentTime ?? 0) === 20,
    "the device position",
  );
  assert.equal(
    await inToolbar('window.api.browser.cast.control("volume", 0.3)'),
    true,
  );
  await waitFor(
    () =>
      received.some(
        (message) =>
          message.type === "SET_VOLUME" && message.volume.level === 0.3,
      ),
    "SET_VOLUME 0.3",
  );
  await waitFor(
    async () => (await snapshot()).session?.volume === 0.3,
    "the volume from RECEIVER_STATUS",
  );
  assert.equal(
    await inToolbar('window.api.browser.cast.control("mute")'),
    true,
  );
  await waitFor(
    () =>
      received.some(
        (message) =>
          message.type === "SET_VOLUME" && message.volume.muted === true,
      ),
    "SET_VOLUME muted",
  );
  assert.equal(
    await inToolbar(
      'window.api.browser.commands.list().then((s) => s.commands.find((c) => c.id === "cast.stop").enabled)',
    ),
    true,
    "⌘K Stop Casting is enabled",
  );

  smoke.step(
    "Stop: media STOP + receiver STOP, session gone, local video left at the cast position",
  );
  // Pause on the TV first so the position is exactly the seek target.
  assert.equal(
    await inToolbar('window.api.browser.cast.control("pause")'),
    true,
  );
  await waitFor(
    async () => (await snapshot()).session?.status === "paused",
    "paused",
  );
  assert.equal(await click("#cast-popover .cast-stop"), true);
  await waitFor(
    () =>
      received.some(
        (message) =>
          message.namespace === NS.receiver &&
          message.type === "STOP" &&
          message.sessionId === "session-dmr",
      ),
    "receiver STOP",
  );
  assert.ok(
    received.some(
      (message) => message.namespace === NS.media && message.type === "STOP",
    ),
    "media STOP",
  );
  await waitFor(
    async () => (await snapshot()).session === null,
    "the session to end",
  );
  await waitFor(
    () => smoke.evaluate(sidebar, '!document.querySelector(".tab-cast-badge")'),
    "the tab badge to go",
  );
  if (lanAddress)
    await waitFor(
      async () =>
        Math.round(
          await smoke.evaluate(
            page,
            'document.getElementById("v").currentTime',
          ),
        ) === 20,
      "the local video at the cast position",
    );

  smoke.step("another sender stopping the app ends the session");
  assert.equal(
    await inToolbar(
      `window.api.browser.cast.castMedia(${JSON.stringify(device.id)}).then((r) => r.ok)`,
    ),
    true,
  );
  await waitFor(
    async () => (await snapshot()).session?.status === "playing",
    "playing again",
  );
  receiver.apps = [];
  broadcastStatus();
  await waitFor(
    async () => (await snapshot()).session === null,
    "the session to end when the app is gone",
  );

  smoke.step("a LOAD the device refuses is reported");
  await smoke.evaluate(
    page,
    `(() => { document.getElementById("v").src = ${JSON.stringify(`${lanOrigin}/forbidden.mp4`)} })()`,
  );
  await delay(100);
  const refused = await inToolbar(
    `window.api.browser.cast.castMedia(${JSON.stringify(device.id)})`,
  );
  assert.equal(refused.ok, false);
  assert.match(refused.error, /couldn’t play this video \(code 104\)/);
  await waitFor(
    async () => (await snapshot()).session?.status === "error",
    "the error shown in the picker",
  );
  await inToolbar('window.api.browser.cast.control("stop")');

  smoke.step(
    "MSE (blob:) page: Mirror tab hint; with an HLS manifest fetched: the manifest is castable",
  );
  page.loadURL(`${lanOrigin}/mse`);
  await waitFor(
    () => !page.isLoading() && page.getURL().endsWith("/mse"),
    "the MSE page",
  );
  const mse = await inToolbar("window.api.browser.cast.probe()");
  assert.equal(mse.choice.castable, false);
  assert.equal(mse.choice.reason, "mse");
  page.loadURL(`${lanOrigin}/hls`);
  await waitFor(
    () => !page.isLoading() && page.getURL().endsWith("/hls"),
    "the HLS page",
  );
  const hls = await waitFor(async () => {
    const result = await inToolbar("window.api.browser.cast.probe()");
    return result?.choice.castable ? result : null;
  }, "the HLS manifest to be found");
  assert.equal(hls.choice.url, `${lanOrigin}/stream/master.m3u8`);
  assert.equal(hls.choice.contentType, "application/x-mpegurl");
  assert.equal(hls.proxied, false);

  smoke.step(
    "Mirror tab: LAUNCH 0F5096E8, OFFER (VP8 + Opus, AES keys) / ANSWER, Sender Report before RTP",
  );
  page.loadURL(`${origin}/mirror`);
  await waitFor(
    () => !page.isLoading() && page.getURL().endsWith("/mirror"),
    "the mirror page",
  );
  const tabs = await inToolbar("window.api.browser.tabs.get()");
  const mirroredTabId = tabs.find((tab) => tab.url.endsWith("/mirror")).id;
  if (!(await inToolbar('Boolean(document.querySelector("#cast-popover"))')))
    assert.equal(await click(".cast-button"), true);
  await waitFor(
    () =>
      inToolbar(
        'Boolean(document.querySelector("#cast-popover .cast-mirror"))',
      ),
    "the Mirror tab button",
  );
  await delay(300);
  screenGrab("cast-mirror-picker");
  assert.equal(await click("#cast-popover .cast-mirror"), true);
  await waitFor(
    async () => (await snapshot()).session?.status === "playing",
    "mirroring to go live",
  );
  assert.equal(
    received.filter((message) => message.type === "LAUNCH").at(-1).appId,
    "0F5096E8",
  );
  const offer = mirror.offers.at(-1);
  assert.equal(offer.castMode, "mirroring");
  const [audioOffer, videoOffer] = offer.supportedStreams;
  assert.deepEqual(
    [
      audioOffer.type,
      audioOffer.codecName,
      audioOffer.timeBase,
      audioOffer.rtpPayloadType,
    ],
    ["audio_source", "opus", "1/48000", 127],
  );
  assert.deepEqual(
    [
      videoOffer.type,
      videoOffer.codecName,
      videoOffer.timeBase,
      videoOffer.rtpPayloadType,
      videoOffer.targetDelay,
    ],
    ["video_source", "vp8", "1/90000", 96, 400],
  );
  assert.match(videoOffer.aesKey, /^[0-9a-f]{32}$/);
  assert.notEqual(videoOffer.aesKey, audioOffer.aesKey);
  const live = (await snapshot()).session;
  assert.equal(live.kind, "mirror");
  assert.equal(live.title, "Mirror me");
  await waitFor(
    () =>
      inToolbar(
        'document.querySelector("#cast-popover .cast-session-status")?.textContent === "Live"',
      ),
    "the Live label",
  );
  await waitFor(
    () =>
      smoke.evaluate(
        sidebar,
        'Boolean(document.querySelector(".tab-cast-badge"))',
      ),
    "the cast badge on the mirrored tab",
  );
  await waitFor(
    () =>
      inToolbar(
        'Boolean(document.querySelector("#cast-popover .cast-mirror-stats"))',
      ),
    "the stream line (resolution, bitrate)",
  );
  await delay(300);
  screenGrab("cast-mirror-live");
  const video = mirrorStream("video");
  await waitFor(() => video.frames.length >= 3, "video frames at the receiver");
  assert.equal(
    mirror.rtpBeforeSr,
    false,
    "a Sender Report arrived before the first RTP packet",
  );

  smoke.step(
    "Mirror tab: a dropped packet is NACKed and resent; the key frame decrypts and decodes to the tab",
  );
  await waitFor(() => mirror.retransmitted, "the NACKed packet to be resent");
  const keyFrame = video.frames.find((frame) => frame.key);
  assert.ok(keyFrame, "a key frame arrived complete");
  // VP8 key frame: frame tag bit 0 clear, then the 9d 01 2a start code.
  assert.equal(keyFrame.data[0] & 1, 0);
  assert.deepEqual([...keyFrame.data.subarray(3, 6)], [0x9d, 0x01, 0x2a]);
  const decoderWindow = new BrowserWindow({
    show: false,
    webPreferences: { backgroundThrottling: false },
  });
  await decoderWindow.loadURL(`${origin}/blank`);
  const decoded = await smoke.evaluate(
    decoderWindow.webContents,
    `new Promise((done, fail) => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(keyFrame.data.toString("base64"))}), (c) => c.charCodeAt(0))
    const decoder = new VideoDecoder({
      output: (frame) => {
        const width = frame.displayWidth, height = frame.displayHeight
        const canvas = new OffscreenCanvas(width, height)
        const context = canvas.getContext('2d')
        context.drawImage(frame, 0, 0)
        frame.close()
        const pixels = context.getImageData(width >> 2, height >> 2, width >> 1, height >> 1).data
        let r = 0, g = 0, b = 0
        for (let i = 0; i < pixels.length; i += 4) { r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2] }
        const n = pixels.length / 4
        done({ width, height, r: r / n, g: g / n, b: b / n })
      },
      error: (error) => fail(String(error))
    })
    decoder.configure({ codec: 'vp8' })
    decoder.decode(new EncodedVideoChunk({ type: 'key', timestamp: 0, data: bytes }))
    decoder.flush().catch(fail)
  })`,
  );
  decoderWindow.destroy();
  console.log(
    `decoded key frame ${decoded.width}x${decoded.height}, centre rgb(${Math.round(decoded.r)}, ${Math.round(decoded.g)}, ${Math.round(decoded.b)})`,
  );
  assert.ok(
    decoded.width <= 1280 && decoded.height <= 720 && decoded.width >= 320,
    "at most 720p",
  );
  assert.ok(
    Math.abs(decoded.r - 30) < 30 &&
      Math.abs(decoded.g - 160) < 30 &&
      Math.abs(decoded.b - 90) < 30,
    "the decoded picture is the tab (green)",
  );

  smoke.step(
    "Mirror tab: a Picture Loss Indicator gets a new key frame; frames keep coming with another tab in front",
  );
  mirror.pliAt = Date.now();
  sendFeedback(video, [], true);
  await waitFor(() => mirror.keyAfterPli, "a key frame after the PLI");
  const otherTabId = await inToolbar(
    `window.api.browser.tabs.create(${JSON.stringify(`${origin}/blank`)})`,
  );
  await waitFor(
    async () =>
      (await inToolbar("window.api.browser.tabs.get()")).find(
        (tab) => tab.id === otherTabId,
      )?.active,
    "the other tab in front",
  );
  const before = video.frames.length;
  await waitFor(
    () => video.frames.length >= before + 5,
    "frames from the background (mirrored) tab",
  );
  const audio = mirrorStream("audio");
  await delay(500);
  const seconds = (Date.now() - mirror.pliAt) / 1000;
  const latencies = mirror.latencies.slice().sort((a, b) => a - b);
  console.log(
    `mirror: ${video.frames.length} video frames, ${audio ? audio.frames.length : 0} audio frames, ~${Math.round((mirror.bytes * 8) / 1000 / Math.max(1, seconds + 3))} kbit/s, capture→receiver median ${Math.round(latencies[latencies.length >> 1])} ms (p90 ${Math.round(latencies[Math.floor(latencies.length * 0.9)])} ms)`,
  );
  if (audio && audio.frames.length > 0)
    assert.ok(
      audio.frames.every((frame) => frame.key),
      "audio frames are independent",
    );
  await waitFor(
    async () => ((await snapshot()).session?.mirror?.height ?? 0) > 0,
    "mirror stats in the session",
  );
  await inToolbar(
    `window.api.browser.tabs.activate(${JSON.stringify(mirroredTabId)})`,
  );

  smoke.step(
    'Mirror tab: Stop ends the stream; ⌘K "Mirror Tab" mirrors again to the last device; closing the tab ends it',
  );
  await inToolbar('window.api.browser.cast.control("stop")');
  await waitFor(
    () =>
      received.some(
        (message) =>
          message.namespace === NS.receiver &&
          message.type === "STOP" &&
          message.sessionId === "session-mirror",
      ),
    "receiver STOP of the mirroring app",
  );
  await waitFor(
    async () => (await snapshot()).session === null,
    "the mirror session to end",
  );
  await delay(400);
  const after = video.frames.length;
  await delay(600);
  assert.equal(video.frames.length, after, "no frames after Stop");
  const offers = mirror.offers.length;
  assert.equal(
    await inToolbar('window.api.browser.commands.run("cast.mirror")'),
    true,
  );
  await waitFor(
    () => mirror.offers.length === offers + 1,
    "a new OFFER from ⌘K Mirror Tab",
  );
  await waitFor(
    async () => (await snapshot()).session?.status === "playing",
    "mirroring live again",
  );
  assert.equal((await snapshot()).session.tabId, mirroredTabId);
  // Closing the mirrored tab ends the cast (and stops the receiver app).
  const stops = received.filter(
    (message) => message.namespace === NS.receiver && message.type === "STOP",
  ).length;
  await inToolbar(
    `window.api.browser.tabs.close(${JSON.stringify(mirroredTabId)})`,
  );
  await waitFor(
    async () => (await snapshot()).session === null,
    "the session to end with its tab",
  );
  assert.ok(
    received.filter(
      (message) => message.namespace === NS.receiver && message.type === "STOP",
    ).length > stops,
    "receiver STOP after the tab closed",
  );

  smoke.step("Settings off: no button, no commands; back on");
  const off = await inToolbar(
    "window.api.browser.cast.setSettings({ enabled: false })",
  );
  assert.equal(off.enabled, false);
  await waitFor(
    () =>
      inToolbar(
        '!document.querySelector(".cast-button") && !document.querySelector("#cast-popover")',
      ),
    "the button and picker to go",
  );
  assert.equal(
    await inToolbar(
      'window.api.browser.commands.list().then((s) => s.commands.find((c) => c.id === "cast.open").enabled)',
    ),
    false,
  );
  assert.equal((await snapshot()).scanning, false);
  const on = await inToolbar(
    "window.api.browser.cast.setSettings({ enabled: true })",
  );
  assert.equal(on.enabled, true);
  console.log("Electron cast smoke passed.");
}

function cleanup() {
  try {
    site.close();
  } catch {}
  try {
    fakeCast.close();
  } catch {}
  for (const socket of receiver.sockets) socket.destroy();
  try {
    mdns.close();
  } catch {}
  try {
    mirror.socket?.close();
  } catch {}
}

run()
  .then(() => {
    cleanup();
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    cleanup();
    app.exit(1);
  });
