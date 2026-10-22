"use strict";

// Sandboxed preload for the hidden "Mirror tab" capture page (src/main/cast-mirror-capture.ts).
// Captures one tab (getUserMedia with the tab's media source id: video + its audio, which Chromium
// then stops playing on this Mac's speakers), encodes VP8 + Opus with WebCodecs and hands each
// encoded frame to main, which encrypts, packetizes and sends it to the Chromecast. Nothing is
// exposed to the page (it is a local file with no script of its own).
const { ipcRenderer } = require("electron");

let running = null;

function wallNow() {
  return performance.timeOrigin + performance.now();
}

// Maps a track's media timestamps (µs) onto this machine's wall clock (ms), re-anchoring when the
// two drift apart (a stalled capture), so main can put both streams on one RTP clock (lip sync).
function clockFor() {
  let baseWall = null;
  let baseTs = 0;
  return {
    at(timestamp) {
      const now = wallNow();
      if (
        baseWall === null ||
        Math.abs(baseWall + (timestamp - baseTs) / 1000 - now) > 150
      ) {
        baseWall = now;
        baseTs = timestamp;
      }
      return baseWall + (timestamp - baseTs) / 1000;
    },
    timestampNow() {
      return baseWall === null
        ? 0
        : Math.round(baseTs + (wallNow() - baseWall) * 1000);
    },
  };
}

function report(kind, detail) {
  ipcRenderer.send("cast-capture:status", {
    kind,
    detail: String(detail && detail.message ? detail.message : detail).slice(
      0,
      500,
    ),
  });
}

function chunkBytes(chunk) {
  const data = new Uint8Array(chunk.byteLength);
  chunk.copyTo(data);
  return data;
}

async function startVideo(state, track, config) {
  const clock = clockFor();
  const minGapUs = (1e6 / config.fps) * 0.8;
  let size = "";
  let lastTs = -Infinity;
  let forceKey = true;
  let last = null;
  let lastWall = 0;
  const encoder = new VideoEncoder({
    output: (chunk) => {
      if (state.stopped) return;
      ipcRenderer.send("cast-capture:frame", {
        kind: "video",
        key: chunk.type === "key",
        captureMs: clock.at(chunk.timestamp),
        data: chunkBytes(chunk),
      });
    },
    error: (error) => report("error", `Video encoder: ${error}`),
  });
  state.encoders.push(encoder);
  const encode = (frame) => {
    const width = frame.displayWidth & ~1;
    const height = frame.displayHeight & ~1;
    const nextSize = `${width}x${height}`;
    if (nextSize !== size) {
      encoder.configure({
        codec: "vp8",
        width,
        height,
        bitrate: config.videoBitrate,
        framerate: config.fps,
        latencyMode: "realtime",
      });
      size = nextSize;
      forceKey = true;
      ipcRenderer.send("cast-capture:status", {
        kind: "video-size",
        detail: nextSize,
      });
    }
    encoder.encode(frame, { keyFrame: forceKey });
    forceKey = false;
  };
  // A static page sends no new frames: the receiver's key frame request re-encodes the last one.
  state.requestKeyFrame = () => {
    forceKey = true;
    setTimeout(() => {
      if (state.stopped || !forceKey || !last || wallNow() - lastWall < 40)
        return;
      const copy = new VideoFrame(last, {
        timestamp: Math.max(lastTs + 1, clock.timestampNow()),
      });
      lastTs = copy.timestamp;
      lastWall = wallNow();
      encode(copy);
      copy.close();
    }, 60);
  };
  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  state.readers.push(reader);
  for (;;) {
    const { value: frame, done } = await reader.read();
    if (done || state.stopped) {
      if (frame) frame.close();
      break;
    }
    clock.at(frame.timestamp);
    // Cap the frame rate, and drop frames while the encoder is behind (realtime: never queue up),
    // except when a key frame is owed.
    if (
      !forceKey &&
      (frame.timestamp - lastTs < minGapUs || encoder.encodeQueueSize > 1)
    ) {
      frame.close();
      continue;
    }
    lastTs = frame.timestamp;
    lastWall = wallNow();
    if (last) last.close();
    last = frame.clone();
    encode(frame);
    frame.close();
  }
  if (last) last.close();
}

async function startAudio(state, track, config) {
  const clock = clockFor();
  let configured = "";
  const encoder = new AudioEncoder({
    output: (chunk) => {
      if (state.stopped) return;
      ipcRenderer.send("cast-capture:frame", {
        kind: "audio",
        key: true,
        captureMs: clock.at(chunk.timestamp),
        data: chunkBytes(chunk),
      });
    },
    error: (error) => report("error", `Audio encoder: ${error}`),
  });
  state.encoders.push(encoder);
  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  state.readers.push(reader);
  for (;;) {
    const { value: data, done } = await reader.read();
    if (done || state.stopped) {
      if (data) data.close();
      break;
    }
    clock.at(data.timestamp);
    const shape = `${data.sampleRate}/${data.numberOfChannels}`;
    if (shape !== configured) {
      encoder.configure({
        codec: "opus",
        sampleRate: data.sampleRate,
        numberOfChannels: Math.min(2, data.numberOfChannels),
        bitrate: config.audioBitrate,
        opus: { frameDuration: 10_000 },
      });
      configured = shape;
    }
    if (encoder.encodeQueueSize < 8) encoder.encode(data);
    data.close();
  }
}

async function start(config) {
  if (running) return;
  const state = {
    stopped: false,
    stream: null,
    encoders: [],
    readers: [],
    requestKeyFrame: () => undefined,
  };
  running = state;
  const source = {
    chromeMediaSource: "tab",
    chromeMediaSourceId: config.sourceId,
  };
  const video = {
    mandatory: {
      ...source,
      maxWidth: config.width,
      maxHeight: config.height,
      maxFrameRate: config.fps,
    },
  };
  try {
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: source },
        video,
      });
    } catch {
      // No audio device / audio capture refused: mirror the picture alone.
      state.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video,
      });
    }
    if (state.stopped) {
      for (const track of state.stream.getTracks()) track.stop();
      return;
    }
    const [videoTrack] = state.stream.getVideoTracks();
    const [audioTrack] = state.stream.getAudioTracks();
    ipcRenderer.send("cast-capture:status", {
      kind: "ready",
      detail: audioTrack ? "audio+video" : "video",
    });
    const jobs = [startVideo(state, videoTrack, config)];
    if (audioTrack) jobs.push(startAudio(state, audioTrack, config));
    await Promise.all(jobs);
  } catch (error) {
    if (!state.stopped) report("error", error);
  }
}

function stop() {
  const state = running;
  running = null;
  if (!state) return;
  state.stopped = true;
  for (const reader of state.readers) reader.cancel().catch(() => undefined);
  for (const encoder of state.encoders) {
    try {
      if (encoder.state !== "closed") encoder.close();
    } catch {
      /* already closed */
    }
  }
  if (state.stream) for (const track of state.stream.getTracks()) track.stop();
}

ipcRenderer.on("cast-capture:start", (_event, config) => {
  if (!config || typeof config.sourceId !== "string") return;
  void start({
    sourceId: config.sourceId,
    width: Number(config.width) || 1280,
    height: Number(config.height) || 720,
    fps: Number(config.fps) || 30,
    videoBitrate: Number(config.videoBitrate) || 2_500_000,
    audioBitrate: Number(config.audioBitrate) || 128_000,
  });
});
ipcRenderer.on("cast-capture:key-frame", () => {
  if (running) running.requestKeyFrame();
});
ipcRenderer.on("cast-capture:stop", () => stop());
window.addEventListener("pagehide", () => stop());
