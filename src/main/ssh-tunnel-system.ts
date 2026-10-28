import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { createConnection } from "node:net";
import { delimiter } from "node:path";
import {
  buildOpenSshDynamicForwardArgs,
  isTransientSshFailure,
  parseSshTarget,
  sshReconnectDelayMs,
} from "../shared/ssh-tunnel";
import type { SshTunnelStatus } from "../shared/network-helper";
import {
  allocateEphemeralLoopbackPort,
  errorMessage,
  isPortListening,
  launchdAuthSock,
  LOOPBACK,
  sshDebugEnabled,
  STARTUP_TIMEOUT_MS,
  STOP_TIMEOUT_MS,
  type SshTunnelManager,
  type TunnelSettings,
} from "./ssh-tunnel-support";

const STDERR_LIMIT = 4_000;

type SpawnProcess = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;

export interface SystemSshTunnelRuntime {
  executable?: string;
  startupTimeoutMs?: number;
  spawnProcess?: SpawnProcess;
  allocatePort?: () => Promise<number>;
  portIsListening?: (port: number) => Promise<boolean>;
  /** The environment ssh runs with (defaults to process.env plus the macOS agent and PATH fixes). */
  environment?: () => Promise<NodeJS.ProcessEnv>;
  /** Delay before automatic reconnect `attempt` (1-based); tests shorten it. */
  reconnectDelayMs?: (attempt: number) => number;
}

function defaultSshExecutable(): string {
  if (process.platform === "darwin") return "/usr/bin/ssh";
  return process.platform === "win32" ? "ssh.exe" : "ssh";
}

/**
 * The environment OpenSSH runs with. A Finder-launched app has neither the agent socket nor the
 * Homebrew PATH that ProxyCommand helpers (cloudflared, aws, gcloud) usually live on.
 */
async function systemSshEnvironment(): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (!env["SSH_AUTH_SOCK"]) {
    const sock = await launchdAuthSock();
    if (sock) env["SSH_AUTH_SOCK"] = sock;
  }
  if (process.platform === "darwin") {
    const path = (env["PATH"] ?? "").split(delimiter).filter(Boolean);
    for (const extra of [
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ])
      if (!path.includes(extra)) path.push(extra);
    env["PATH"] = path.join(delimiter);
  }
  return env;
}

/** The last meaningful stderr lines (verbose `debug1:` lines are left out of the error). */
function stderrDetail(stderr: string): string {
  return stderr
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^debug\d:/.test(line))
    .slice(-2)
    .join(" ");
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
      const detail = stderrDetail(stderr());
      return new Error(detail ? `${reason} ${detail}` : reason);
    };
    const onError = (error: Error): void =>
      finish(message(`Could not launch system OpenSSH: ${error.message}`));
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void =>
      finish(
        message(
          `System OpenSSH exited before the tunnel became ready (${signal ?? `code ${code ?? "unknown"}`}).`,
        ),
      );
    const timeoutTimer = setTimeout(
      () =>
        finish(
          message(
            `System OpenSSH did not open the SOCKS port within ${Math.ceil(timeoutMs / 1_000)} seconds.`,
          ),
        ),
      timeoutMs,
    );
    child.once("error", onError);
    child.once("exit", onExit);

    const exited = (): boolean =>
      child.exitCode !== null || child.signalCode !== null;
    const probe = (): void => {
      if (settled) return;
      if (exited()) {
        onExit(child.exitCode, child.signalCode);
        return;
      }
      const socket = createConnection({ host: LOOPBACK, port });
      socket.once("connect", () => {
        socket.destroy();
        if (exited()) {
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
 * The system OpenSSH engine: runs `ssh -N -D 127.0.0.1:<private port> -- <target>` (never through a
 * shell) so the OS ssh config, agent, ProxyJump/ProxyCommand, Match exec and security keys apply.
 * Same status and lifecycle contract as the in-app engine in ssh-tunnel.ts.
 */
export function createSystemSshTunnelManager(
  runtime: SystemSshTunnelRuntime = {},
): SshTunnelManager {
  const executable = runtime.executable ?? defaultSshExecutable();
  const spawnProcess: SpawnProcess = runtime.spawnProcess ?? spawn;
  const allocatePort = runtime.allocatePort ?? allocateEphemeralLoopbackPort;
  const portIsListening = runtime.portIsListening ?? isPortListening;
  const startupTimeoutMs = runtime.startupTimeoutMs ?? STARTUP_TIMEOUT_MS;
  const environment = runtime.environment ?? systemSshEnvironment;
  const reconnectDelay = runtime.reconnectDelayMs ?? sshReconnectDelayMs;
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
  let lastSettings: TunnelSettings | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let retrying = false;

  const cancelReconnect = (resetAttempts: boolean): void => {
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    retrying = false;
    if (resetAttempts) reconnectAttempt = 0;
  };

  /** After sleep or a network drop ssh exits; start it again instead of waiting for a Save. */
  const scheduleReconnect = (): void => {
    if (reconnectTimer !== null || !lastSettings) return;
    retrying = true;
    reconnectTimer = setTimeout(
      () => {
        reconnectTimer = null;
        retrying = false;
        const settings = lastSettings;
        if (!settings) return;
        reconnectAttempt += 1;
        void run(settings, true).catch((reconnectError: unknown) => {
          error = errorMessage(reconnectError);
          if (isTransientSshFailure(error)) scheduleReconnect();
        });
      },
      reconnectDelay(reconnectAttempt + 1),
    );
  };

  /** Stop the child without touching the configured target or reconnect state. */
  const teardown = async (): Promise<void> => {
    generation += 1;
    const previous = child;
    child = null;
    runningTarget = null;
    runningPort = null;
    port = null;
    starting = false;
    running = false;
    startup = null;
    error = null;
    const pendingStop = previous ? stopChild(previous) : stopping;
    if (previous && pendingStop) stopping = pendingStop;
    if (pendingStop) await pendingStop;
    if (stopping === pendingStop) stopping = null;
  };

  const stop = async (): Promise<void> => {
    lastSettings = null;
    cancelReconnect(true);
    await teardown();
  };

  const fail = (runId: number, message: string): void => {
    if (runId !== generation) return;
    starting = false;
    running = false;
    error = message;
  };

  const run = async (
    settings: TunnelSettings,
    retry: boolean,
  ): Promise<void> => {
    const nextTarget = parseSshTarget(settings.sshHost);
    if (!retry) cancelReconnect(true);
    configured = nextTarget.length > 0;
    enabled = settings.enabled;
    target = nextTarget || null;
    port = nextTarget ? (runningPort ?? port) : null;

    if (!nextTarget || !settings.enabled) {
      lastSettings = null;
      cancelReconnect(true);
      await teardown();
      return;
    }
    lastSettings = {
      enabled: settings.enabled,
      sshHost: settings.sshHost,
      sshClient: settings.sshClient,
    };
    if (
      child &&
      runningTarget === nextTarget &&
      child.exitCode === null &&
      child.signalCode === null
    ) {
      if (startup) await startup;
      return;
    }

    await teardown();
    if (retry) starting = true;
    const runId = ++generation;
    let selectedPort: number;
    try {
      selectedPort = await allocatePort();
    } catch (portError) {
      fail(runId, errorMessage(portError));
      return;
    }
    if (runId !== generation) return;
    let alreadyListening: boolean;
    try {
      alreadyListening = await portIsListening(selectedPort);
    } catch (probeError) {
      fail(runId, errorMessage(probeError));
      return;
    }
    if (runId !== generation) return;
    if (alreadyListening) {
      fail(
        runId,
        `Automatically selected SSH tunnel port ${selectedPort} is already in use. Save again to retry.`,
      );
      return;
    }
    port = selectedPort;

    const debug = sshDebugEnabled();
    let nextChild: ChildProcess;
    try {
      const args = buildOpenSshDynamicForwardArgs(nextTarget, selectedPort, {
        verbose: debug,
      });
      const env = await environment();
      if (runId !== generation) return;
      if (debug) console.info(`[ssh] system: ${executable} ${args.join(" ")}`);
      nextChild = spawnProcess(executable, args, {
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
        env,
      });
    } catch (spawnError) {
      fail(
        runId,
        `Could not launch system OpenSSH: ${errorMessage(spawnError)}`,
      );
      return;
    }
    child = nextChild;
    runningTarget = nextTarget;
    runningPort = selectedPort;
    starting = true;
    running = false;
    error = null;
    let capturedStderr = "";
    nextChild.stderr?.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      if (debug)
        for (const line of text.split(/\r?\n/))
          if (line.trim()) console.info(`[ssh] system: ${line.trim()}`);
      capturedStderr = `${capturedStderr}${text}`.slice(-STDERR_LIMIT);
    });
    nextChild.once("exit", (code, signal) => {
      if (child !== nextChild || generation !== runId) return;
      const wasStarting = starting;
      child = null;
      runningTarget = null;
      runningPort = null;
      starting = false;
      running = false;
      startup = null;
      const exit = signal ?? `code ${code ?? "unknown"}`;
      const detail = stderrDetail(capturedStderr);
      error = `System OpenSSH ${wasStarting ? "exited before the tunnel became ready" : "exited unexpectedly"} (${exit})${detail ? `: ${detail}` : "."}`;
      if (isTransientSshFailure(error)) scheduleReconnect();
    });

    const pending = waitForListener(
      nextChild,
      selectedPort,
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
        retrying = false;
        reconnectAttempt = 0;
      }
    } catch (startError) {
      if (child === nextChild && generation === runId) {
        starting = false;
        running = false;
        child = null;
        runningTarget = null;
        runningPort = null;
        error = errorMessage(startError);
        await stopChild(nextChild);
        if (isTransientSshFailure(error)) scheduleReconnect();
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
    retrying,
    client: "system",
  });

  return { sync: (settings) => run(settings, false), stop, getStatus };
}
