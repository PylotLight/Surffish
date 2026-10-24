import {
  createConnection,
  createServer,
  type Server,
  type Socket,
} from "node:net";
import type { BrowserProxySettings } from "../shared/types";
import {
  SURFFISH_NETWORK_HELPER,
  type NetworkHelperStatus,
  type NetworkHelperUsage,
} from "../shared/network-helper";
import { getManagedSshTunnelStatus } from "./ssh-tunnel";

const MAX_CONNECTIONS = 128;
const MAX_HANDSHAKE_BUFFER = 64 * 1024;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const FAILURE_REPLY = Buffer.from([0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
const activeClients = new Set<Socket>();
let helperServer: Server | null = null;
let helperStarting: Promise<void> | null = null;
let helperStopping: Promise<void> | null = null;
let helperError: string | null = null;
let uploadedBytes = 0;
let downloadedBytes = 0;
const trafficHistory = new Map<
  number,
  { uploadedBytes: number; downloadedBytes: number }
>();

function recordTraffic(direction: "upload" | "download", bytes: number): void {
  if (bytes <= 0) return;
  if (direction === "upload") uploadedBytes += bytes;
  else downloadedBytes += bytes;
  const second = Math.floor(Date.now() / 1_000) * 1_000;
  if (!trafficHistory.has(second)) {
    for (const recordedSecond of trafficHistory.keys()) {
      if (second - recordedSecond > 10_000)
        trafficHistory.delete(recordedSecond);
    }
  }
  const sample = trafficHistory.get(second) ?? {
    uploadedBytes: 0,
    downloadedBytes: 0,
  };
  if (direction === "upload") sample.uploadedBytes += bytes;
  else sample.downloadedBytes += bytes;
  trafficHistory.set(second, sample);
}

function appendBuffer(current: Buffer, next: Buffer): Buffer {
  return current.length === 0 ? next : Buffer.concat([current, next]);
}

function requestLength(buffer: Buffer): number | null {
  if (buffer.length < 4) return null;
  if (buffer[0] !== 0x05 || buffer[2] !== 0x00) return -1;
  const addressType = buffer[3];
  if (addressType === 0x01) return buffer.length < 10 ? null : 10;
  if (addressType === 0x04) return buffer.length < 22 ? null : 22;
  if (addressType === 0x03) {
    if (buffer.length < 5) return null;
    const length = 7 + buffer[4]!;
    return buffer.length < length ? null : length;
  }
  return -1;
}

function replyLength(buffer: Buffer): number | null {
  if (buffer.length < 4) return null;
  if (buffer[0] !== 0x05) return -1;
  const addressType = buffer[3];
  if (addressType === 0x01) return buffer.length < 10 ? null : 10;
  if (addressType === 0x04) return buffer.length < 22 ? null : 22;
  if (addressType === 0x03) {
    if (buffer.length < 5) return null;
    const length = 7 + buffer[4]!;
    return buffer.length < length ? null : length;
  }
  return -1;
}

/** Create a SOCKS5 server for local clients; exposed separately so the protocol can be tested on an ephemeral port. */
export function createSocks5RelayServer(
  getUpstream: () => BrowserProxySettings,
): Server {
  const server = createServer((client) => {
    if (activeClients.size >= MAX_CONNECTIONS) {
      client.destroy();
      return;
    }
    activeClients.add(client);
    client.setNoDelay(true);
    client.setTimeout(HANDSHAKE_TIMEOUT_MS, () => client.destroy());

    let phase:
      | "greeting"
      | "request"
      | "connecting"
      | "upstream-greeting"
      | "upstream-reply"
      | "tunnel"
      | "closing" = "greeting";
    let clientBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let earlyClientData: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let upstreamBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let upstream: Socket | null = null;
    let targetRequest: Buffer | null = null;

    const closeUpstream = (): void => {
      upstream?.destroy();
      upstream = null;
    };
    const fail = (reply: Buffer<ArrayBufferLike> = FAILURE_REPLY): void => {
      if (phase === "closing" || phase === "tunnel") return;
      phase = "closing";
      if (!client.destroyed && client.writable) client.end(reply);
      closeUpstream();
    };
    const onClientData = (chunk: Buffer): void => {
      if (phase === "tunnel" || phase === "closing") return;
      if (
        phase === "connecting" ||
        phase === "upstream-greeting" ||
        phase === "upstream-reply"
      ) {
        earlyClientData = appendBuffer(earlyClientData, chunk);
        if (earlyClientData.length > MAX_HANDSHAKE_BUFFER) fail();
        return;
      }
      clientBuffer = appendBuffer(clientBuffer, chunk);
      if (clientBuffer.length > MAX_HANDSHAKE_BUFFER) {
        fail();
        return;
      }
      processClientBuffer();
    };
    const enterTunnel = (response: Buffer, trailing: Buffer): void => {
      client.write(response);
      if (trailing.length) {
        client.write(trailing);
        recordTraffic("download", trailing.length);
      }
      phase = "tunnel";
      client.setTimeout(0);
      upstream?.setTimeout(0);
      client.removeListener("data", onClientData);
      if (upstream) upstream.removeListener("data", onUpstreamData);
      client.on("data", (chunk) => recordTraffic("upload", chunk.length));
      upstream?.on("data", (chunk) => recordTraffic("download", chunk.length));
      const pending = earlyClientData;
      earlyClientData = Buffer.alloc(0);
      if (pending.length) {
        recordTraffic("upload", pending.length);
        upstream?.write(pending);
      }
      if (upstream) {
        client.pipe(upstream);
        upstream.pipe(client);
      }
    };
    const onUpstreamData = (chunk: Buffer): void => {
      upstreamBuffer = appendBuffer(upstreamBuffer, chunk);
      if (upstreamBuffer.length > MAX_HANDSHAKE_BUFFER && phase !== "tunnel") {
        fail();
        return;
      }
      if (phase === "upstream-greeting") {
        if (upstreamBuffer.length < 2) return;
        const greeting = upstreamBuffer.subarray(0, 2);
        upstreamBuffer = upstreamBuffer.subarray(2);
        if (greeting[0] !== 0x05 || greeting[1] !== 0x00) {
          fail();
          return;
        }
        phase = "upstream-reply";
        if (!targetRequest) {
          fail();
          return;
        }
        upstream?.write(targetRequest);
      }
      if (phase !== "upstream-reply") return;
      const length = replyLength(upstreamBuffer);
      if (length === null) return;
      if (length < 0) {
        fail();
        return;
      }
      const response = upstreamBuffer.subarray(0, length);
      const trailing = upstreamBuffer.subarray(length);
      upstreamBuffer = Buffer.alloc(0);
      if (response[1] !== 0x00) {
        fail(response);
        return;
      }
      enterTunnel(response, trailing);
    };
    const processClientBuffer = (): void => {
      while (phase === "greeting" || phase === "request") {
        if (phase === "greeting") {
          if (clientBuffer.length < 2) return;
          if (clientBuffer[0] !== 0x05) {
            fail(Buffer.from([0x05, 0xff]));
            return;
          }
          const methodCount = clientBuffer[1]!;
          if (clientBuffer.length < 2 + methodCount) return;
          const methods = clientBuffer.subarray(2, 2 + methodCount);
          clientBuffer = clientBuffer.subarray(2 + methodCount);
          if (!methods.includes(0x00)) {
            fail(Buffer.from([0x05, 0xff]));
            return;
          }
          client.write(Buffer.from([0x05, 0x00]));
          phase = "request";
          continue;
        }
        const length = requestLength(clientBuffer);
        if (length === null) return;
        if (length < 0) {
          const replyCode =
            clientBuffer.length >= 2 && clientBuffer[1] !== 0x01 ? 0x07 : 0x08;
          fail(Buffer.from([0x05, replyCode, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          return;
        }
        if (clientBuffer[1] !== 0x01) {
          fail(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          return;
        }
        const target = clientBuffer.subarray(0, length);
        earlyClientData = clientBuffer.subarray(length);
        clientBuffer = Buffer.alloc(0);
        let settings: BrowserProxySettings;
        try {
          settings = getUpstream();
        } catch {
          fail();
          return;
        }
        const address = server.address();
        const helperPort =
          address && typeof address !== "string" ? address.port : null;
        const upstreamIsHelper =
          settings.port === helperPort &&
          ["127.0.0.1", "localhost", "::1"].includes(
            settings.host.toLowerCase(),
          );
        if (!settings.enabled || upstreamIsHelper) {
          fail();
          return;
        }
        phase = "connecting";
        targetRequest = target;
        upstream = createConnection({
          host: settings.host,
          port: settings.port,
        });
        upstream.setNoDelay(true);
        upstream.setTimeout(HANDSHAKE_TIMEOUT_MS, () => fail());
        upstream.on("data", onUpstreamData);
        upstream.once("error", () => fail());
        upstream.once("close", () => {
          if (phase === "tunnel" && !client.destroyed) client.destroy();
        });
        upstream.once("connect", () => {
          if (phase === "closing") return;
          phase = "upstream-greeting";
          upstream?.write(Buffer.from([0x05, 0x01, 0x00]));
        });
        return;
      }
    };

    client.on("data", onClientData);
    client.once("error", closeUpstream);
    client.once("close", () => {
      activeClients.delete(client);
      closeUpstream();
    });
  });
  return server;
}

/** Start on loopback before browser windows are created. An occupied port is reported, not fatal to browser startup. */
export async function startNetworkHelper(
  port: number,
  getUpstream: () => BrowserProxySettings,
): Promise<void> {
  if (helperStopping) await helperStopping;
  if (helperStarting) return helperStarting;
  if (helperServer) return;
  helperError = null;
  uploadedBytes = 0;
  downloadedBytes = 0;
  trafficHistory.clear();
  const server = createSocks5RelayServer(getUpstream);
  helperServer = server;
  const starting = new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    server.on("error", (error: NodeJS.ErrnoException) => {
      helperError =
        error.code === "EADDRINUSE"
          ? `Port ${port} is already in use.`
          : error.message;
      if (!server.listening && helperServer === server) helperServer = null;
      finish();
    });
    server.once("listening", () => {
      helperError = null;
      finish();
    });
    try {
      server.listen({
        host: SURFFISH_NETWORK_HELPER.host,
        port,
        exclusive: true,
      });
    } catch (error) {
      helperError = error instanceof Error ? error.message : String(error);
      if (helperServer === server) helperServer = null;
      finish();
    }
  });
  helperStarting = starting;
  try {
    await starting;
  } finally {
    if (helperStarting === starting) helperStarting = null;
  }
}

export function getNetworkHelperStatus(
  settings: BrowserProxySettings,
): NetworkHelperStatus {
  const sshTunnel = getManagedSshTunnelStatus();
  return {
    name: SURFFISH_NETWORK_HELPER.name,
    host: settings.sshHost?.trim()
      ? SURFFISH_NETWORK_HELPER.host
      : settings.host,
    port: settings.port,
    listening: helperServer?.listening === true,
    error: helperError,
    sshTunnel: {
      ...sshTunnel,
      host: SURFFISH_NETWORK_HELPER.host,
      port: sshTunnel.running && helperServer?.listening ? settings.port : null,
    },
  };
}

/** Byte totals exclude SOCKS negotiation and count only bytes relayed after CONNECT succeeds. */
export function getNetworkHelperUsage(): NetworkHelperUsage {
  const now = Date.now();
  let recentUploadedBytes = 0;
  let recentDownloadedBytes = 0;
  for (const [second, sample] of trafficHistory) {
    if (now - second > 10_000) {
      trafficHistory.delete(second);
      continue;
    }
    if (now - second <= 3_000) {
      recentUploadedBytes += sample.uploadedBytes;
      recentDownloadedBytes += sample.downloadedBytes;
    }
  }
  return {
    activeConnections: activeClients.size,
    uploadedBytes,
    downloadedBytes,
    uploadBytesPerSecond: Math.round(recentUploadedBytes / 3),
    downloadBytesPerSecond: Math.round(recentDownloadedBytes / 3),
  };
}

/** Stop accepting clients and wait until the listener releases its port. */
export function stopNetworkHelper(): Promise<void> {
  if (helperStopping) return helperStopping;
  const server = helperServer;
  helperServer = null;
  helperError = null;
  for (const client of activeClients) client.destroy();
  const starting = helperStarting;
  const stopping = (async (): Promise<void> => {
    if (starting) await starting;
    if (!server?.listening) return;
    await new Promise<void>((resolve) => {
      try {
        server.close(() => resolve());
      } catch {
        resolve();
      }
    });
  })();
  helperStopping = stopping;
  void stopping.finally(() => {
    if (helperStopping === stopping) helperStopping = null;
  });
  return stopping;
}
