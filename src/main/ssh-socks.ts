import { createServer, type Server, type Socket } from "node:net";
import type { Client, ClientChannel } from "ssh2";

const MAX_HANDSHAKE_BUFFER = 64 * 1024;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const LOOPBACK = "127.0.0.1";

export interface SshSocksListener {
  server: Server;
  close(): Promise<void>;
}

function requestLength(buffer: Buffer): number | null {
  if (buffer.length < 4) return null;
  if (buffer[0] !== 0x05 || buffer[2] !== 0x00) return -1;
  if (buffer[3] === 0x01) return buffer.length < 10 ? null : 10;
  if (buffer[3] === 0x04) return buffer.length < 22 ? null : 22;
  if (buffer[3] === 0x03) {
    if (buffer.length < 5) return null;
    const length = 7 + buffer[4]!;
    return buffer.length < length ? null : length;
  }
  return -1;
}

function addressFromRequest(buffer: Buffer): string | null {
  const type = buffer[3];
  if (type === 0x01)
    return `${buffer[4]}.${buffer[5]}.${buffer[6]}.${buffer[7]}`;
  if (type === 0x03) return buffer.subarray(5, 5 + buffer[4]!).toString("utf8");
  if (type !== 0x04) return null;
  const groups: string[] = [];
  for (let index = 4; index < 20; index += 2)
    groups.push(buffer.readUInt16BE(index).toString(16));
  return groups.join(":");
}

function failureReply(code = 0x01): Buffer {
  return Buffer.from([0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
}

/** Create the internal SOCKS listener used by the unchanged shared endpoint. */
export function createSshSocksListener(
  client: Pick<Client, "forwardOut">,
): SshSocksListener {
  const sockets = new Set<Socket>();
  const channels = new Set<ClientChannel>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.setNoDelay(true);
    socket.setTimeout(HANDSHAKE_TIMEOUT_MS, () => socket.destroy());

    let phase: "greeting" | "request" | "connecting" | "tunnel" | "closing" =
      "greeting";
    let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let channel: ClientChannel | null = null;

    const release = (): void => {
      if (channel) {
        channels.delete(channel);
        channel.destroy();
        channel = null;
      }
      sockets.delete(socket);
    };
    const fail = (code = 0x01): void => {
      if (phase === "closing" || phase === "tunnel") return;
      phase = "closing";
      if (!socket.destroyed && socket.writable) socket.end(failureReply(code));
      if (channel) {
        channels.delete(channel);
        channel.destroy();
        channel = null;
      }
    };
    const enterTunnel = (stream: ClientChannel, earlyData: Buffer): void => {
      if (socket.destroyed || phase !== "connecting") {
        stream.destroy();
        return;
      }
      channel = stream;
      channels.add(stream);
      stream.once("error", () => socket.destroy());
      stream.once("close", () => {
        channels.delete(stream);
        if (!socket.destroyed) socket.destroy();
      });
      socket.once("close", release);
      socket.setTimeout(0);
      socket.removeListener("data", onData);
      socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
      if (earlyData.length > 0) stream.write(earlyData);
      phase = "tunnel";
      socket.pipe(stream);
      stream.pipe(socket);
      socket.resume();
    };
    const onData = (chunk: Buffer): void => {
      if (phase === "tunnel" || phase === "closing") return;
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_HANDSHAKE_BUFFER) {
        fail();
        return;
      }
      while (phase === "greeting" || phase === "request") {
        if (phase === "greeting") {
          if (buffer.length < 2) return;
          if (buffer[0] !== 0x05) {
            fail(0x01);
            return;
          }
          const methodCount = buffer[1]!;
          if (buffer.length < methodCount + 2) return;
          const methods = buffer.subarray(2, methodCount + 2);
          buffer = buffer.subarray(methodCount + 2);
          if (!methods.includes(0x00)) {
            phase = "closing";
            socket.end(Buffer.from([0x05, 0xff]));
            return;
          }
          socket.write(Buffer.from([0x05, 0x00]));
          phase = "request";
          continue;
        }
        const length = requestLength(buffer);
        if (length === null) return;
        if (length < 0) {
          const command = buffer.length >= 2 ? buffer[1] : 0x01;
          fail(command !== 0x01 ? 0x07 : 0x08);
          return;
        }
        if (buffer[1] !== 0x01) {
          fail(0x07);
          return;
        }
        const host = addressFromRequest(buffer);
        const port = buffer.readUInt16BE(length - 2);
        const earlyData = buffer.subarray(length);
        buffer = Buffer.alloc(0);
        if (!host || !Number.isInteger(port) || port < 1) {
          fail(0x08);
          return;
        }
        phase = "connecting";
        socket.pause();
        socket.removeListener("data", onData);
        const sourceAddress = socket.remoteAddress || LOOPBACK;
        const sourcePort = socket.remotePort || 0;
        try {
          client.forwardOut(
            sourceAddress,
            sourcePort,
            host,
            port,
            (error, stream) => {
              if (error || !stream) {
                fail(0x05);
                return;
              }
              enterTunnel(stream, earlyData);
            },
          );
        } catch {
          fail(0x05);
        }
        return;
      }
    };

    socket.on("data", onData);
    socket.once("error", release);
    socket.once("close", release);
  });

  return {
    server,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      for (const channel of channels) channel.destroy();
      if (!server.listening) return;
      await new Promise<void>((resolve) => {
        try {
          server.close(() => resolve());
        } catch {
          resolve();
        }
      });
    },
  };
}
