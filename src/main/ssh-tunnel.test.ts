import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { createConnection, createServer, type Server } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Duplex } from "node:stream";
import {
  Server as SshServer,
  utils,
  type Client,
  type ClientChannel,
  type ConnectConfig,
} from "ssh2";
import { loadKnownHostVerifier } from "./ssh-known-hosts";
import { createSshTunnelManager, type SshTunnelManager } from "./ssh-tunnel";

const managers = new Set<SshTunnelManager>();
const servers = new Set<Server>();
const temporaryDirectories = new Set<string>();

class EchoChannel extends Duplex {
  override _read(): void {}

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.push(chunk);
    callback();
  }
}

async function listen(server: Server, port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port }, () => {
      server.removeListener("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Expected a TCP listener."));
        return;
      }
      resolve(address.port);
    });
  });
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

class FakeSshClient extends EventEmitter {
  connectCalls = 0;
  endCalls = 0;
  forwarded: Array<{ host: string; port: number }> = [];

  connect(_config: ConnectConfig): void {
    this.connectCalls += 1;
    queueMicrotask(() => this.emit("ready"));
  }

  end(): this {
    this.endCalls += 1;
    queueMicrotask(() => this.emit("close"));
    return this;
  }

  destroy(): this {
    this.emit("close");
    return this;
  }

  forwardOut(
    _sourceHost: string,
    _sourcePort: number,
    host: string,
    port: number,
    callback: (error: Error | null, channel?: ClientChannel) => void,
  ): this {
    this.forwarded.push({ host, port });
    const channel = new EchoChannel() as unknown as ClientChannel;
    callback(null, channel);
    return this;
  }
}

function makeManager(
  clients: FakeSshClient[],
  overrides: Record<string, unknown> = {},
): SshTunnelManager {
  const manager = createSshTunnelManager({
    clientFactory: () => {
      const client = new FakeSshClient();
      clients.push(client);
      return client as unknown as Client;
    },
    prepareConnection: async (target) => ({
      config: { host: `${target}.example.test`, username: "tester" },
      verificationError: () => null,
    }),
    ...overrides,
  });
  managers.add(manager);
  return manager;
}

afterEach(async () => {
  for (const manager of managers) await manager.stop();
  managers.clear();
  await Promise.all([...servers].map(close));
  servers.clear();
  for (const directory of temporaryDirectories)
    rmSync(directory, { recursive: true, force: true });
  temporaryDirectories.clear();
});

describe("managed in-process SSH tunnel lifecycle", () => {
  test("opens one private SOCKS listener, reuses it, and stops the SSH client", async () => {
    const clients: FakeSshClient[] = [];
    const manager = makeManager(clients);

    await manager.sync({ enabled: true, sshHost: "work-vpn" });
    const port = manager.getStatus().port;
    expect(port).toBeGreaterThan(1024);
    expect(manager.getStatus()).toMatchObject({
      configured: true,
      enabled: true,
      target: "work-vpn",
      host: "127.0.0.1",
      port,
      starting: false,
      running: true,
      error: null,
    });
    expect(clients).toHaveLength(1);
    expect(clients[0]?.connectCalls).toBe(1);

    await manager.sync({ enabled: true, sshHost: "work-vpn" });
    expect(manager.getStatus().port).toBe(port);
    expect(clients).toHaveLength(1);

    await manager.stop();
    expect(manager.getStatus().running).toBe(false);
    expect(manager.getStatus().port).toBeNull();
    expect(clients[0]?.endCalls).toBe(1);
  });

  test("does not open a private SOCKS listener on an occupied selected port", async () => {
    const occupied = createServer();
    servers.add(occupied);
    const port = await listen(occupied);
    const clients: FakeSshClient[] = [];
    const manager = makeManager(clients, { allocatePort: async () => port });

    await manager.sync({ enabled: true, sshHost: "work-vpn" });
    expect(clients).toHaveLength(0);
    expect(manager.getStatus().error).toContain("already in use");
    expect(manager.getStatus().running).toBe(false);
  });

  test("keeps the tunnel stopped when no SSH alias is configured", async () => {
    const clients: FakeSshClient[] = [];
    const manager = makeManager(clients);

    await manager.sync({ enabled: true, sshHost: "" });
    expect(clients).toHaveLength(0);
    expect(manager.getStatus()).toMatchObject({
      configured: false,
      running: false,
      target: null,
      error: null,
    });
  });

  test("names the identities it offered when the server refuses all of them", async () => {
    const clients: FakeSshClient[] = [];
    const manager = makeManager(clients, {
      prepareConnection: async () => ({
        config: { host: "nas.local", username: "nas" },
        verificationError: () => null,
        authSummary:
          "nas@nas.local:22 with 1 IdentityFile key and the SSH agent at /tmp/agent.sock",
      }),
      clientFactory: () => {
        const client = new FakeSshClient();
        const failure = new Error(
          "All configured authentication methods failed",
        );
        client.connect = () => {
          client.connectCalls += 1;
          queueMicrotask(() => client.emit("error", failure));
        };
        clients.push(client);
        return client as unknown as Client;
      },
    });

    await manager.sync({ enabled: true, sshHost: "nas" });
    expect(manager.getStatus().error).toBe(
      "Authentication failed: offered nas@nas.local:22 with 1 IdentityFile key and the SSH agent at /tmp/agent.sock, and every method was refused.",
    );
  });

  test("the private listener accepts SOCKS5 CONNECT and forwards the requested host and port", async () => {
    const clients: FakeSshClient[] = [];
    const manager = makeManager(clients);
    await manager.sync({ enabled: true, sshHost: "nas" });
    const port = manager.getStatus().port!;
    const socket = createConnection({ host: "127.0.0.1", port });
    let received = Buffer.alloc(0);
    const response = new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("SOCKS response timed out")),
        1_000,
      );
      socket.on("data", (chunk: Buffer | string) => {
        received = Buffer.concat([
          received,
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
        ]);
        if (received.includes(Buffer.from("ping"))) {
          clearTimeout(timer);
          resolve(received);
        }
      });
      socket.once("error", reject);
    });
    socket.write(
      Buffer.from([
        0x05,
        0x01,
        0x00,
        0x05,
        0x01,
        0x00,
        0x03,
        0x09,
        ...Buffer.from("nas.local"),
        0x00,
        0x50,
        ...Buffer.from("ping"),
      ]),
    );
    const data = await response;
    expect(data.subarray(0, 2)).toEqual(Buffer.from([0x05, 0x00]));
    expect(data.subarray(2, 4)).toEqual(Buffer.from([0x05, 0x00]));
    expect(data.includes(Buffer.from("ping"))).toBe(true);
    expect(clients[0]?.forwarded).toEqual([{ host: "nas.local", port: 80 }]);
    socket.destroy();
  });

  test("authenticates to an SSH2 server with a key, checks known_hosts, and relays SOCKS traffic", async () => {
    const sshKeys = utils.generateKeyPairSync("ed25519");
    const userKeys = utils.generateKeyPairSync("ed25519");
    const parsedHostKey = utils.parseKey(sshKeys.private);
    const parsedUserKey = utils.parseKey(userKeys.private);
    if (parsedHostKey instanceof Error || parsedUserKey instanceof Error)
      throw new Error("Could not create the SSH test keys.");

    const echoServer = createServer((socket) => socket.pipe(socket));
    servers.add(echoServer);
    const echoPort = await listen(echoServer);

    const sshServer = new SshServer({ hostKeys: [sshKeys.private] });
    servers.add(sshServer);
    sshServer.on("connection", (connection) => {
      connection.on("error", () => {});
      connection.on("authentication", (context) => {
        if (context.method === "publickey") context.accept();
        else context.reject();
      });
      connection.on("tcpip", (accept, reject, details) => {
        const upstream = createConnection({
          host: details.destIP,
          port: details.destPort,
        });
        upstream.once("error", () => {
          upstream.destroy();
          reject();
        });
        upstream.once("connect", () => {
          const channel = accept();
          upstream.pipe(channel);
          channel.pipe(upstream);
          channel.once("close", () => upstream.destroy());
        });
      });
    });
    const sshPort = await listen(sshServer);

    const directory = mkdtempSync(join(tmpdir(), "surffish-ssh-e2e-"));
    temporaryDirectories.add(directory);
    const knownHostsPath = join(directory, "known_hosts");
    writeFileSync(
      knownHostsPath,
      `127.0.0.1 ssh-ed25519 ${parsedHostKey.getPublicSSH().toString("base64")}\n`,
    );
    const verifier = await loadKnownHostVerifier(
      ["127.0.0.1"],
      [knownHostsPath],
    );
    const realManager = createSshTunnelManager({
      prepareConnection: async () => ({
        config: {
          host: "127.0.0.1",
          port: sshPort,
          username: "tester",
          authHandler: [
            { type: "publickey", username: "tester", key: parsedUserKey },
          ],
          hostVerifier: (key: Buffer) => verifier.verify(key),
          readyTimeout: 3_000,
          keepaliveInterval: 1_000,
        },
        verificationError: verifier.error,
      }),
    });
    managers.add(realManager);
    await realManager.sync({ enabled: true, sshHost: "nas" });
    expect(realManager.getStatus()).toMatchObject({
      running: true,
      error: null,
    });

    const socket = createConnection({
      host: "127.0.0.1",
      port: realManager.getStatus().port!,
    });
    let received = Buffer.alloc(0);
    const response = new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("End-to-end SOCKS response timed out")),
        2_000,
      );
      socket.on("data", (chunk: Buffer | string) => {
        received = Buffer.concat([
          received,
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
        ]);
        if (received.includes(Buffer.from("ssh2-ok"))) {
          clearTimeout(timer);
          resolve(received);
        }
      });
      socket.once("error", reject);
    });
    socket.write(Buffer.from([0x05, 0x01, 0x00]));
    socket.write(
      Buffer.from([
        0x05,
        0x01,
        0x00,
        0x01,
        127,
        0,
        0,
        1,
        echoPort >> 8,
        echoPort & 0xff,
      ]),
    );
    socket.write(Buffer.from("ssh2-ok"));
    const data = await response;
    expect(data.subarray(0, 2)).toEqual(Buffer.from([0x05, 0x00]));
    expect(data.subarray(2, 4)).toEqual(Buffer.from([0x05, 0x00]));
    expect(data.includes(Buffer.from("ssh2-ok"))).toBe(true);
    socket.destroy();

    const untrustedPath = join(directory, "untrusted_known_hosts");
    writeFileSync(
      untrustedPath,
      `127.0.0.1 ssh-ed25519 ${parsedUserKey.getPublicSSH().toString("base64")}\n`,
    );
    const untrusted = await loadKnownHostVerifier(
      ["127.0.0.1"],
      [untrustedPath],
    );
    const rejectedManager = createSshTunnelManager({
      prepareConnection: async () => ({
        config: {
          host: "127.0.0.1",
          port: sshPort,
          username: "tester",
          authHandler: [
            { type: "publickey", username: "tester", key: parsedUserKey },
          ],
          hostVerifier: (key: Buffer) => untrusted.verify(key),
          readyTimeout: 3_000,
        },
        verificationError: untrusted.error,
      }),
    });
    managers.add(rejectedManager);
    await rejectedManager.sync({ enabled: true, sshHost: "nas" });
    expect(rejectedManager.getStatus().running).toBe(false);
    expect(rejectedManager.getStatus().error).toContain(
      "changed from the key in known_hosts",
    );
  });
});
