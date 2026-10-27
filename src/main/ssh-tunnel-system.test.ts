import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:net";
import { PassThrough } from "node:stream";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import type { SshTunnelStatus } from "../shared/network-helper";
import { createSystemSshTunnelManager } from "./ssh-tunnel-system";
import { createRoutedSshTunnelManager } from "./ssh-tunnel";
import type { SshTunnelManager, TunnelSettings } from "./ssh-tunnel-support";

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

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error("Timed out waiting for the tunnel state.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function fakeChild(): ChildProcess & { stderr: PassThrough } {
  const child = new EventEmitter() as ChildProcess & { stderr: PassThrough };
  Object.defineProperties(child, {
    stderr: { value: new PassThrough() },
    exitCode: { value: null, writable: true },
    signalCode: { value: null, writable: true },
    killed: { value: false, writable: true },
  });
  return child;
}

function exitChild(
  child: ChildProcess,
  code: number | null,
  signal: NodeJS.Signals | null,
): void {
  const mutable = child as unknown as {
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
  };
  mutable.exitCode = code;
  mutable.signalCode = signal;
  child.emit("exit", code, signal);
}

/** A stand-in for `ssh -D`: listens on the forwarded port until killed. */
function fakeSshProcess(port: number): ChildProcess & { stderr: PassThrough } {
  const server = createServer((socket) => socket.end());
  servers.add(server);
  void listen(server, port);
  const child = fakeChild();
  child.kill = ((signal: NodeJS.Signals = "SIGTERM"): boolean => {
    if (child.exitCode !== null || child.signalCode !== null) return false;
    void close(server).then(() => exitChild(child, null, signal));
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

const env = async (): Promise<NodeJS.ProcessEnv> => ({ PATH: "/usr/bin" });

afterEach(async () => {
  for (const manager of managers) await manager.stop();
  managers.clear();
  await Promise.all([...servers].map(close));
  servers.clear();
});

describe("system OpenSSH tunnel engine", () => {
  test("runs ssh without a shell, on a private port, and stops the process", async () => {
    const calls: Array<{
      command: string;
      args: string[];
      options: SpawnOptions;
    }> = [];
    const manager = createSystemSshTunnelManager({
      executable: "fake-ssh",
      environment: env,
      spawnProcess: (command, args, options) => {
        calls.push({ command, args, options });
        return fakeSshProcess(dynamicForwardPort(args));
      },
    });
    managers.add(manager);

    await manager.sync({
      enabled: true,
      sshHost: "work-vpn",
      sshClient: "system",
    });
    const port = dynamicForwardPort(calls[0]?.args ?? []);
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
      client: "system",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("fake-ssh");
    expect(calls[0]?.options.shell).toBeUndefined();
    expect(calls[0]?.options.env).toEqual({ PATH: "/usr/bin" });
    expect(calls[0]?.args.slice(-2)).toEqual(["--", "work-vpn"]);
    expect(calls[0]?.args.slice(0, 3)).toEqual([
      "-N",
      "-D",
      `127.0.0.1:${port}`,
    ]);
    expect(calls[0]?.args).toContain("BatchMode=yes");

    // Same target: the running process is kept.
    await manager.sync({
      enabled: true,
      sshHost: "work-vpn",
      sshClient: "system",
    });
    expect(manager.getStatus().port).toBe(port);
    expect(calls).toHaveLength(1);

    await manager.stop();
    expect(manager.getStatus().running).toBe(false);
  });

  test("reports the ssh error line when it exits before the port opens", async () => {
    const manager = createSystemSshTunnelManager({
      environment: env,
      spawnProcess: () => {
        const child = fakeChild();
        child.kill = (() => false) as ChildProcess["kill"];
        setTimeout(() => {
          child.stderr.write(
            "debug1: Reading configuration data\nwork-vpn: Permission denied (publickey).\n",
          );
          setTimeout(() => exitChild(child, 255, null), 5);
        }, 5);
        return child;
      },
    });
    managers.add(manager);

    await manager.sync({ enabled: true, sshHost: "work-vpn" });
    const status = manager.getStatus();
    expect(status.running).toBe(false);
    expect(status.error).toContain("code 255");
    expect(status.error).toContain("Permission denied (publickey).");
    expect(status.error).not.toContain("debug1");
  });

  test("reports an unexpected exit after the tunnel was up and starts it again", async () => {
    const spawned: Array<ChildProcess & { stderr: PassThrough }> = [];
    const manager = createSystemSshTunnelManager({
      environment: env,
      reconnectDelayMs: () => 5,
      spawnProcess: (_command, args) => {
        const child = fakeSshProcess(dynamicForwardPort(args));
        spawned.push(child);
        return child;
      },
    });
    managers.add(manager);
    await manager.sync({ enabled: true, sshHost: "work-vpn" });
    expect(manager.getStatus().running).toBe(true);
    expect(spawned).toHaveLength(1);

    spawned[0]?.stderr.write("Connection to work-vpn closed by remote host.\n");
    exitChild(spawned[0] as ChildProcess, 255, null);
    expect(manager.getStatus()).toMatchObject({
      running: false,
      starting: false,
      retrying: true,
    });
    expect(manager.getStatus().error).toContain("exited unexpectedly");

    // ssh exits when sleep kills the connection; the engine starts it again without a Save.
    await waitFor(() => manager.getStatus().running);
    expect(spawned).toHaveLength(2);
    expect(manager.getStatus()).toMatchObject({
      running: true,
      retrying: false,
      error: null,
    });
  });

  test("reports a missing ssh binary", async () => {
    const manager = createSystemSshTunnelManager({
      environment: env,
      spawnProcess: () => {
        throw new Error("spawn ENOENT");
      },
    });
    managers.add(manager);
    await manager.sync({ enabled: true, sshHost: "work-vpn" });
    expect(manager.getStatus().error).toContain(
      "Could not launch system OpenSSH",
    );
  });

  test("does not start over an already-listening selected port", async () => {
    const occupied = createServer();
    servers.add(occupied);
    const port = await listen(occupied);
    let spawnCount = 0;
    const manager = createSystemSshTunnelManager({
      environment: env,
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
  });

  test("stays stopped without an alias or with SOCKS5 off", async () => {
    let spawnCount = 0;
    const manager = createSystemSshTunnelManager({
      environment: env,
      spawnProcess: () => {
        spawnCount += 1;
        throw new Error("should not spawn");
      },
    });
    managers.add(manager);
    await manager.sync({ enabled: true, sshHost: "" });
    await manager.sync({ enabled: false, sshHost: "work-vpn" });
    expect(spawnCount).toBe(0);
    expect(manager.getStatus()).toMatchObject({ running: false, error: null });
  });
});

function recordingEngine(name: "builtin" | "system"): SshTunnelManager & {
  log: string[];
} {
  const log: string[] = [];
  let running = false;
  return {
    log,
    async sync(settings: TunnelSettings) {
      log.push(`sync ${settings.sshHost}`);
      running = settings.enabled;
    },
    async stop() {
      log.push("stop");
      running = false;
    },
    getStatus(): SshTunnelStatus {
      return {
        configured: true,
        enabled: true,
        target: "work-vpn",
        host: "127.0.0.1",
        port: running ? 4000 : null,
        starting: false,
        running,
        error: null,
        client: name,
      };
    },
  };
}

describe("SSH client routing", () => {
  test("defaults to the built-in engine and switches cleanly", async () => {
    const builtin = recordingEngine("builtin");
    const system = recordingEngine("system");
    const routed = createRoutedSshTunnelManager({ builtin, system });

    await routed.sync({ enabled: true, sshHost: "work-vpn" });
    expect(builtin.log).toEqual(["sync work-vpn"]);
    expect(routed.getStatus().client).toBe("builtin");

    await routed.sync({
      enabled: true,
      sshHost: "work-vpn",
      sshClient: "system",
    });
    expect(builtin.log).toEqual(["sync work-vpn", "stop"]);
    expect(system.log).toEqual(["sync work-vpn"]);
    expect(routed.getStatus()).toMatchObject({
      client: "system",
      running: true,
    });

    await routed.sync({
      enabled: true,
      sshHost: "work-vpn",
      sshClient: "builtin",
    });
    expect(system.log).toEqual(["sync work-vpn", "stop"]);
    expect(routed.getStatus().client).toBe("builtin");

    await routed.stop();
    expect(builtin.log.at(-1)).toBe("stop");
    expect(system.log.at(-1)).toBe("stop");
  });
});
