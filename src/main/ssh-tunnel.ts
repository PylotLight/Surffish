import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { createConnection } from "node:net";
import type { BrowserProxySettings } from "../shared/types";
import {
  buildOpenSshDynamicForwardArgs,
  parseSshTarget,
} from "../shared/ssh-tunnel";
import type { SshTunnelStatus } from "../shared/network-helper";

const STARTUP_TIMEOUT_MS = 8_000;
const STOP_TIMEOUT_MS = 1_000;
const PORT_PROBE_TIMEOUT_MS = 300;
const STDERR_LIMIT = 2_000;
const LOOPBACK = "127.0.0.1";

type TunnelSettings = Pick<
  BrowserProxySettings,
  "enabled" | "port" | "sshHost"
>;
type SpawnProcess = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;

export interface SshTunnelRuntime {
  executable?: string;
  startupTimeoutMs?: number;
  spawnProcess?: SpawnProcess;
  portIsListening?: (port: number) => Promise<boolean>;
}

export interface SshTunnelManager {
  sync(settings: TunnelSettings): Promise<void>;
  stop(): Promise<void>;
  getStatus(): SshTunnelStatus;
}

function defaultSshExecutable(): string {
  if (process.platform === "darwin") return "/usr/bin/ssh";
  return process.platform === "win32" ? "ssh.exe" : "ssh";
}

function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: LOOPBACK, port });
    let settled = false;
    const finish = (listening: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(listening);
    };
    const timer = setTimeout(() => finish(false), PORT_PROBE_TIMEOUT_MS);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function waitForListener(
  child: ChildProcess,
  port: number,
  timeoutMs: number,
  stderr: () => string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let probeTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (probeTimer) clearTimeout(probeTimer);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      if (error) reject(error);
      else resolve();
    };
    const message = (reason: string): Error => {
      const detail = stderr().trim().split(/\r?\n/).slice(-2).join(" ");
      return new Error(detail ? `${reason} ${detail}` : reason);
    };
    const onError = (error: Error): void =>
      finish(message(`Could not launch OpenSSH: ${error.message}`));
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void =>
      finish(
        message(
          `OpenSSH exited before the tunnel became ready (${signal ?? `code ${code ?? "unknown"}`}).`,
        ),
      );
    const timeoutTimer = setTimeout(
      () =>
        finish(
          message(
            `OpenSSH did not open the SOCKS port within ${Math.ceil(timeoutMs / 1_000)} seconds.`,
          ),
        ),
      timeoutMs,
    );
    child.once("error", onError);
    child.once("exit", onExit);

    const probe = (): void => {
      if (settled) return;
      if (child.exitCode !== null || child.signalCode !== null) {
        onExit(child.exitCode, child.signalCode);
        return;
      }
      const socket = createConnection({ host: LOOPBACK, port });
      socket.once("connect", () => {
        socket.destroy();
        if (child.exitCode !== null || child.signalCode !== null) {
          onExit(child.exitCode, child.signalCode);
          return;
        }
        finish();
      });
      socket.once("error", () => {
        socket.destroy();
        if (!settled) probeTimer = setTimeout(probe, 100);
      });
    };
    probe();
  });
}

function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("exit", finish);
      resolve();
    };
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          child.kill("SIGKILL");
        } catch {
          // The process may have exited between the state check and kill.
        }
      }
      finish();
    }, STOP_TIMEOUT_MS);
    child.once("exit", finish);
    try {
      child.kill("SIGTERM");
    } catch {
      finish();
    }
  });
}

/**
 * Creates an isolated manager so its child-process lifecycle can be tested with a local fake SSH process.
 * The default instance below always runs the OS OpenSSH client and never invokes a shell.
 */
export function createSshTunnelManager(
  runtime: SshTunnelRuntime = {},
): SshTunnelManager {
  const executable = runtime.executable ?? defaultSshExecutable();
  const spawnProcess: SpawnProcess = runtime.spawnProcess ?? spawn;
  const portIsListening = runtime.portIsListening ?? isPortListening;
  const startupTimeoutMs = runtime.startupTimeoutMs ?? STARTUP_TIMEOUT_MS;
  let child: ChildProcess | null = null;
  let runningTarget: string | null = null;
  let runningPort: number | null = null;
  let configured = false;
  let enabled = false;
  let target: string | null = null;
  let port: number | null = null;
  let starting = false;
  let running = false;
  let error: string | null = null;
  let generation = 0;
  let startup: Promise<void> | null = null;
  let stopping: Promise<void> | null = null;

  const stop = async (): Promise<void> => {
    generation += 1;
    const previous = child;
    child = null;
    runningTarget = null;
    runningPort = null;
    starting = false;
    running = false;
    startup = null;
    error = null;
    const pendingStop = previous ? stopChild(previous) : stopping;
    if (previous && pendingStop) stopping = pendingStop;
    if (pendingStop) await pendingStop;
    if (stopping === pendingStop) stopping = null;
  };

  const sync = async (settings: TunnelSettings): Promise<void> => {
    const nextTarget = parseSshTarget(settings.sshHost);
    configured = nextTarget.length > 0;
    enabled = settings.enabled;
    target = nextTarget || null;
    port = nextTarget ? settings.port : null;

    if (!nextTarget || !settings.enabled) {
      await stop();
      return;
    }
    if (
      child &&
      runningTarget === nextTarget &&
      runningPort === settings.port &&
      child.exitCode === null &&
      child.signalCode === null
    ) {
      if (startup) await startup;
      return;
    }

    await stop();
    const runId = ++generation;
    let alreadyListening: boolean;
    try {
      alreadyListening = await portIsListening(settings.port);
    } catch (probeError) {
      if (runId === generation)
        error =
          probeError instanceof Error ? probeError.message : String(probeError);
      return;
    }
    if (runId !== generation) return;
    if (alreadyListening) {
      error = `Port ${settings.port} is already in use by another local service. Stop it or choose a different port.`;
      return;
    }

    let nextChild: ChildProcess;
    try {
      nextChild = spawnProcess(
        executable,
        buildOpenSshDynamicForwardArgs(nextTarget, settings.port),
        {
          stdio: ["ignore", "ignore", "pipe"],
          windowsHide: true,
          env: process.env,
        },
      );
    } catch (spawnError) {
      error =
        spawnError instanceof Error ? spawnError.message : String(spawnError);
      return;
    }
    child = nextChild;
    runningTarget = nextTarget;
    runningPort = settings.port;
    starting = true;
    running = false;
    error = null;
    let capturedStderr = "";
    nextChild.stderr?.on("data", (chunk: Buffer | string) => {
      capturedStderr = `${capturedStderr}${chunk.toString()}`.slice(
        -STDERR_LIMIT,
      );
    });
    nextChild.once("exit", (code, signal) => {
      if (child !== nextChild || generation !== runId) return;
      child = null;
      runningTarget = null;
      runningPort = null;
      starting = false;
      running = false;
      startup = null;
      const exit = signal ?? `code ${code ?? "unknown"}`;
      const detail = capturedStderr.trim().split(/\r?\n/).slice(-2).join(" ");
      error = `SSH tunnel exited unexpectedly (${exit})${detail ? `: ${detail}` : "."}`;
    });

    const pending = waitForListener(
      nextChild,
      settings.port,
      startupTimeoutMs,
      () => capturedStderr,
    );
    startup = pending;
    try {
      await pending;
      if (child === nextChild && generation === runId) {
        starting = false;
        running = true;
        error = null;
      }
    } catch (startError) {
      if (child === nextChild && generation === runId) {
        starting = false;
        running = false;
        child = null;
        runningTarget = null;
        runningPort = null;
        error =
          startError instanceof Error ? startError.message : String(startError);
        await stopChild(nextChild);
      }
    } finally {
      if (startup === pending) startup = null;
    }
  };

  const getStatus = (): SshTunnelStatus => ({
    configured,
    enabled,
    target,
    host: LOOPBACK,
    port,
    starting,
    running,
    error,
  });

  return { sync, stop, getStatus };
}

export const managedSshTunnel = createSshTunnelManager();

export function syncManagedSshTunnel(
  settings: BrowserProxySettings,
): Promise<void> {
  return managedSshTunnel.sync(settings);
}

export function stopManagedSshTunnel(): Promise<void> {
  return managedSshTunnel.stop();
}

export function getManagedSshTunnelStatus(): SshTunnelStatus {
  return managedSshTunnel.getStatus();
}
