import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:net";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { createSshTunnelManager, type SshTunnelManager } from "./ssh-tunnel";

const managers = new Set<SshTunnelManager>();
const servers = new Set<Server>();

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

function fakeSshProcess(port: number): ChildProcess {
  const server = createServer((socket) => socket.end());
  servers.add(server);
  void listen(server, port);
  const child = new EventEmitter() as ChildProcess;
  const stderr = new PassThrough();
  Object.defineProperties(child, {
    stderr: { value: stderr },
    exitCode: { value: null, writable: true },
    signalCode: { value: null, writable: true },
    killed: { value: false, writable: true },
  });
  child.kill = ((signal: NodeJS.Signals = "SIGTERM"): boolean => {
    if (child.exitCode !== null || child.signalCode !== null) return false;
    const mutableChild = child as unknown as {
      killed: boolean;
      signalCode: NodeJS.Signals | null;
    };
    mutableChild.killed = true;
    mutableChild.signalCode = signal;
    void close(server).then(() => {
      child.emit("exit", null, signal);
    });
    return true;
  }) as ChildProcess["kill"];
  return child;
}

function dynamicForwardPort(args: string[]): number {
  const destination = args.find((argument) =>
    argument.startsWith("127.0.0.1:"),
  );
  if (!destination)
    throw new Error("Expected a loopback dynamic-forward argument.");
  return Number(destination.slice("127.0.0.1:".length));
}

afterEach(async () => {
  for (const manager of managers) await manager.stop();
  managers.clear();
  await Promise.all([...servers].map(close));
  servers.clear();
});

describe("managed OpenSSH tunnel lifecycle", () => {
  test("auto-allocates a private SOCKS port and stops its process", async () => {
    const argsSeen: string[][] = [];
    const manager = createSshTunnelManager({
      executable: "fake-ssh",
      spawnProcess: (_command, args) => {
        argsSeen.push(args);
        return fakeSshProcess(dynamicForwardPort(args));
      },
    });
    managers.add(manager);

    await manager.sync({ enabled: true, sshHost: "work-vpn" });
    const port = dynamicForwardPort(argsSeen[0] ?? []);
    expect(port).toBeGreaterThan(1024);
    expect(port).not.toBe(1088);
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
    expect(argsSeen).toHaveLength(1);
    expect(argsSeen[0]?.at(-1)).toBe("work-vpn");
    expect(argsSeen[0]?.slice(0, 3)).toEqual(["-N", "-D", `127.0.0.1:${port}`]);

    await manager.sync({ enabled: true, sshHost: "work-vpn" });
    expect(manager.getStatus().port).toBe(port);
    expect(argsSeen).toHaveLength(1);

    await manager.stop();
    expect(manager.getStatus().running).toBe(false);
  });

  test("does not start OpenSSH over an already-listening selected port", async () => {
    const occupied = createServer();
    servers.add(occupied);
    const port = await listen(occupied);
    let spawnCount = 0;
    const manager = createSshTunnelManager({
      allocatePort: async () => port,
      spawnProcess: () => {
        spawnCount += 1;
        throw new Error("should not spawn");
      },
    });
    managers.add(manager);

    await manager.sync({ enabled: true, sshHost: "work-vpn" });
    expect(spawnCount).toBe(0);
    expect(manager.getStatus().error).toContain("already in use");
    expect(manager.getStatus().running).toBe(false);
  });

  test("keeps the tunnel stopped when no SSH alias is configured", async () => {
    let spawnCount = 0;
    const manager = createSshTunnelManager({
      spawnProcess: () => {
        spawnCount += 1;
        throw new Error("should not spawn");
      },
    });
    managers.add(manager);

    await manager.sync({ enabled: true, sshHost: "" });
    expect(spawnCount).toBe(0);
    expect(manager.getStatus()).toMatchObject({
      configured: false,
      running: false,
      target: null,
      error: null,
    });
  });
});
