import { afterEach, describe, expect, test } from "bun:test";
import {
  createConnection,
  createServer,
  type Server,
  type Socket,
} from "node:net";
import type { BrowserProxySettings } from "../shared/types";
import {
  createSocks5RelayServer,
  getNetworkHelperStatus,
  getNetworkHelperUsage,
  startNetworkHelper,
  stopNetworkHelper,
} from "./network-helper";

const sockets = new Set<Socket>();

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      server.removeListener("error", reject);
      const address = server.address();
      if (!address || typeof address === "string")
        reject(new Error("Expected a TCP listener."));
      else resolve(address.port);
    });
  });
}

function connect(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    sockets.add(socket);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function nextData(socket: Socket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const onData = (data: Buffer): void => {
      cleanup();
      resolve(data);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error("Socket closed before a response arrived."));
    };
    const cleanup = (): void => {
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
    };
    socket.once("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

function domainConnectRequest(
  host: string,
  port: number,
  command = 0x01,
): Buffer {
  const name = Buffer.from(host);
  return Buffer.concat([
    Buffer.from([0x05, command, 0x00, 0x03, name.length]),
    name,
    Buffer.from([port >> 8, port & 0xff]),
  ]);
}

function socksSettings(port: number, enabled = true): BrowserProxySettings {
  return { enabled, host: "127.0.0.1", port, bypassLocalNetwork: true };
}

afterEach(() => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
});

describe("Surffish Network Helper SOCKS5 relay", () => {
  test("forwards a domain CONNECT through the upstream SOCKS5 server and relays TCP data", async () => {
    const beforeUsage = getNetworkHelperUsage();
    const capture: { forwardedRequest: Buffer | null } = {
      forwardedRequest: null,
    };
    const upstream = createServer((socket) => {
      sockets.add(socket);
      let phase: "greeting" | "request" | "tunnel" = "greeting";
      let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        const data = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        buffer = buffer.length ? Buffer.concat([buffer, data]) : data;
        if (phase === "greeting" && buffer.length >= 3) {
          expect([...buffer.subarray(0, 3)]).toEqual([0x05, 0x01, 0x00]);
          buffer = buffer.subarray(3);
          phase = "request";
          socket.write(Buffer.from([0x05, 0x00]));
        }
        if (phase === "request" && buffer.length >= 5) {
          const length = 7 + buffer[4]!;
          if (buffer.length < length) return;
          capture.forwardedRequest = Buffer.from(buffer.subarray(0, length));
          buffer = buffer.subarray(length);
          phase = "tunnel";
          socket.write(
            Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0x12, 0x34]),
          );
        }
        if (phase === "tunnel" && buffer.length) {
          const payload = buffer;
          buffer = Buffer.alloc(0);
          socket.write(
            payload.equals(Buffer.from("ping")) ? Buffer.from("pong") : payload,
          );
        }
      });
    });
    const upstreamPort = await listen(upstream);
    const relay = createSocks5RelayServer(() => socksSettings(upstreamPort));
    const relayPort = await listen(relay);
    const client = await connect(relayPort);
    try {
      const greeting = nextData(client);
      client.write(Buffer.from([0x05, 0x01, 0x00]));
      expect([...(await greeting)]).toEqual([0x05, 0x00]);

      const connectReply = nextData(client);
      client.write(domainConnectRequest("example.com", 443));
      expect([...(await connectReply)]).toEqual([
        0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0x12, 0x34,
      ]);
      expect(capture.forwardedRequest).not.toBeNull();
      expect(
        (capture.forwardedRequest as Buffer).equals(
          domainConnectRequest("example.com", 443),
        ),
      ).toBe(true);

      const tunnelReply = nextData(client);
      client.write(Buffer.from("ping"));
      expect((await tunnelReply).toString()).toBe("pong");
      const usage = getNetworkHelperUsage();
      expect(usage.activeConnections).toBeGreaterThanOrEqual(
        beforeUsage.activeConnections + 1,
      );
      expect(
        usage.uploadedBytes - beforeUsage.uploadedBytes,
      ).toBeGreaterThanOrEqual(4);
      expect(
        usage.downloadedBytes - beforeUsage.downloadedBytes,
      ).toBeGreaterThanOrEqual(4);
    } finally {
      client.destroy();
      await closeServer(relay);
      await closeServer(upstream);
    }
  });

  test("fails closed when the configured upstream is disabled", async () => {
    const relay = createSocks5RelayServer(() => socksSettings(1080, false));
    const relayPort = await listen(relay);
    const client = await connect(relayPort);
    try {
      const greeting = nextData(client);
      client.write(Buffer.from([0x05, 0x01, 0x00]));
      expect([...(await greeting)]).toEqual([0x05, 0x00]);

      const failure = nextData(client);
      client.write(domainConnectRequest("example.com", 443));
      expect([...(await failure)]).toEqual([
        0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0,
      ]);
    } finally {
      client.destroy();
      await closeServer(relay);
    }
  });

  test("fails closed when the upstream port is unreachable", async () => {
    const upstream = createServer();
    const unusedPort = await listen(upstream);
    await closeServer(upstream);
    const relay = createSocks5RelayServer(() => socksSettings(unusedPort));
    const relayPort = await listen(relay);
    const client = await connect(relayPort);
    try {
      const greeting = nextData(client);
      client.write(Buffer.from([0x05, 0x01, 0x00]));
      expect([...(await greeting)]).toEqual([0x05, 0x00]);

      const failure = nextData(client);
      client.write(domainConnectRequest("example.com", 443));
      expect([...(await failure)]).toEqual([
        0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0,
      ]);
    } finally {
      client.destroy();
      await closeServer(relay);
    }
  });

  test("rejects SOCKS5 commands other than TCP CONNECT", async () => {
    const relay = createSocks5RelayServer(() => socksSettings(1080, false));
    const relayPort = await listen(relay);
    const client = await connect(relayPort);
    try {
      const greeting = nextData(client);
      client.write(Buffer.from([0x05, 0x01, 0x00]));
      expect([...(await greeting)]).toEqual([0x05, 0x00]);

      const failure = nextData(client);
      client.write(domainConnectRequest("example.com", 53, 0x03));
      expect([...(await failure)]).toEqual([
        0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0,
      ]);
    } finally {
      client.destroy();
      await closeServer(relay);
    }
  });

  test("waits for the old listener to close before a quick restart", async () => {
    const getUpstream = () => socksSettings(1080, false);
    const probe = createServer();
    const port = await listen(probe);
    await closeServer(probe);
    const endpoint = socksSettings(port);
    try {
      await startNetworkHelper(port, getUpstream);
      expect(getNetworkHelperStatus(endpoint)).toMatchObject({
        host: "127.0.0.1",
        port,
        listening: true,
      });

      const stopping = stopNetworkHelper();
      const restarting = startNetworkHelper(port, getUpstream);
      await Promise.all([stopping, restarting]);

      expect(getNetworkHelperStatus(endpoint).listening).toBe(true);
      expect(getNetworkHelperStatus(endpoint).error).toBeNull();
    } finally {
      await stopNetworkHelper();
    }
  });
});
