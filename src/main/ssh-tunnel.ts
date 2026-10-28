import { readFile, stat } from "node:fs/promises";
import type { Server } from "node:net";
// ssh2 is CommonJS and Electron's ESM loader does not synthesize its named exports (`utils` is an
// object literal that Node's static analysis cannot see either), so take the default export.
import ssh2 from "ssh2";
import type {
  AgentAuthMethod,
  AuthMethod,
  Client,
  ConnectConfig,
  ParsedKey,
} from "ssh2";
import type { BrowserProxySettings } from "../shared/types";
import {
  isTransientSshFailure,
  parseSshClient,
  parseSshTarget,
  sshReconnectDelayMs,
} from "../shared/ssh-tunnel";
import type { SshTunnelStatus } from "../shared/network-helper";
import { loadKnownHostVerifier } from "./ssh-known-hosts";
import { resolveSshConnection } from "./ssh-config";
import { createSshSocksListener, type SshSocksListener } from "./ssh-socks";
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
import { createSystemSshTunnelManager } from "./ssh-tunnel-system";

export type { SshTunnelManager } from "./ssh-tunnel-support";

interface PreparedSshConnection {
  config: ConnectConfig;
  verificationError: () => string | null;
  /** Bounded ssh2 debug trail, used to explain authentication failures. */
  debugLines?: string[];
  /** What the client offered to the server, e.g. "user@host:22 (2 IdentityFile keys, agent /path)". */
  authSummary?: string;
}

export interface SshTunnelRuntime {
  startupTimeoutMs?: number;
  clientFactory?: () => Client;
  prepareConnection?: (
    target: string,
    timeoutMs: number,
  ) => Promise<PreparedSshConnection>;
  createSocksListener?: (client: Client) => SshSocksListener;
  allocatePort?: () => Promise<number>;
  portIsListening?: (port: number) => Promise<boolean>;
  /** Delay before automatic reconnect `attempt` (1-based); tests shorten it. */
  reconnectDelayMs?: (attempt: number) => number;
}

function listenOnLoopback(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.removeListener("listening", onListening);
      reject(
        error.code === "EADDRINUSE"
          ? new Error(
              `Automatically selected SSH tunnel port ${port} is already in use. Save again to retry.`,
            )
          : error,
      );
    };
    const onListening = (): void => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    try {
      server.listen({ host: LOOPBACK, port, exclusive: true });
    } catch (error) {
      server.removeListener("error", onError);
      server.removeListener("listening", onListening);
      reject(error);
    }
  });
}

async function isAgentSocket(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isSocket() || info.isFile() || info.isFIFO();
  } catch {
    return false;
  }
}

async function prepareSshConnection(
  target: string,
  timeoutMs: number,
): Promise<PreparedSshConnection> {
  const sshAuthSock = process.env["SSH_AUTH_SOCK"] || (await launchdAuthSock());
  const debug = sshDebugEnabled();
  const resolved = await resolveSshConnection(target, undefined, undefined, {
    authSock: sshAuthSock,
    trace: debug
      ? (message: string) => console.info(`[ssh] ${message}`)
      : undefined,
  });
  const configSource =
    resolved.configFiles.length > 0
      ? `config ${resolved.configFiles.join(", ")}`
      : "no SSH config read";
  const parsedKeys: ParsedKey[] = [];
  for (const identityFile of resolved.identityFiles) {
    let contents: Buffer;
    try {
      contents = await readFile(identityFile);
    } catch {
      throw new Error(`Could not read SSH IdentityFile ${identityFile}.`);
    }
    const parsed = ssh2.utils.parseKey(contents);
    if (parsed instanceof Error) {
      throw new Error(
        `Could not load SSH IdentityFile ${identityFile}. Password-protected keys are not supported for this background tunnel.`,
      );
    }
    if (!parsed.isPrivateKey()) continue;
    parsedKeys.push(parsed);
  }
  const agentPath = resolved.identityAgent;
  const agentAvailable = agentPath ? await isAgentSocket(agentPath) : false;
  if (parsedKeys.length === 0 && !agentAvailable) {
    if (agentPath)
      throw new Error(
        `Could not reach the SSH agent at ${agentPath}, and no usable SSH IdentityFile was found for ${target} (${configSource}).`,
      );
    throw new Error(
      `No usable private key was found in the SSH IdentityFile for ${target} (${configSource}).`,
    );
  }

  const knownHosts = await loadKnownHostVerifier(
    resolved.hostKeyNames,
    resolved.knownHostsFiles,
  );
  const authHandler: AuthMethod[] = parsedKeys.map((key) => ({
    type: "publickey",
    username: resolved.username,
    key,
  }));
  // Agent keys come last, matching OpenSSH's order after the configured key files.
  if (agentAvailable && agentPath) {
    const agentMethod: AgentAuthMethod = {
      type: "agent",
      username: resolved.username,
      agent: agentPath,
    };
    authHandler.push(agentMethod);
  }
  const debugLines: string[] = [];
  const keyCount = `${parsedKeys.length} IdentityFile key${parsedKeys.length === 1 ? "" : "s"}`;
  const agentSummary = agentPath
    ? agentAvailable
      ? `the SSH agent at ${agentPath}`
      : `no reachable SSH agent (${agentPath})`
    : "no SSH agent (no IdentityAgent or SSH_AUTH_SOCK)";
  return {
    config: {
      host: resolved.host,
      port: resolved.port,
      username: resolved.username,
      authHandler,
      hostVerifier: (key: Buffer) => knownHosts.verify(key),
      readyTimeout: timeoutMs,
      keepaliveInterval: 30_000,
      keepaliveCountMax: 3,
      tryKeyboard: false,
      debug: (message: string) => {
        debugLines.push(message);
        if (debugLines.length > 200) debugLines.shift();
      },
    },
    verificationError: knownHosts.error,
    debugLines,
    authSummary: `${resolved.username}@${resolved.host}:${resolved.port} with ${keyCount} (${configSource}) and ${agentSummary}`,
  };
}

function describeConnectionError(
  error: Error,
  connection: PreparedSshConnection,
): string {
  if (error.message !== "All configured authentication methods failed")
    return error.message;
  const offered = connection.authSummary
    ? `offered ${connection.authSummary}, and every method was refused.`
    : "All configured authentication methods failed.";
  return `Authentication failed: ${offered}${debugTrail(connection)}`;
}

/** ssh2's own account of the attempt, opt-in because it is long and only useful when debugging. */
function debugTrail(connection: PreparedSshConnection): string {
  if (!sshDebugEnabled()) return "";
  const lines = connection.debugLines ?? [];
  if (lines.length === 0) return "";
  return ` Debug: ${lines.slice(-10).join(" | ")}`;
}

function waitForReady(
  client: Client,
  connection: PreparedSshConnection,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.removeListener("ready", onReady);
      client.removeListener("error", onError);
      client.removeListener("close", onClose);
      if (error) reject(error);
      else resolve();
    };
    const onReady = (): void => finish();
    const onError = (error: Error): void => {
      finish(
        new Error(
          connection.verificationError() ??
            describeConnectionError(error, connection),
        ),
      );
    };
    const onClose = (): void => {
      finish(
        new Error("SSH connection closed before authentication completed."),
      );
    };
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            `SSH connection did not become ready within ${Math.ceil(timeoutMs / 1_000)} seconds.`,
          ),
        ),
      timeoutMs,
    );
    client.once("ready", onReady);
    client.once("error", onError);
    client.once("close", onClose);
    try {
      client.connect(connection.config);
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

async function endClient(client: Client): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.removeListener("close", finish);
      resolve();
    };
    const timer = setTimeout(() => {
      try {
        client.destroy();
      } catch {
        // The socket may have already closed.
      }
      finish();
    }, STOP_TIMEOUT_MS);
    client.once("close", finish);
    try {
      client.end();
    } catch {
      finish();
    }
  });
}

/** Creates an isolated in-process manager so client, config, and listener lifecycles can be tested. */
export function createSshTunnelManager(
  runtime: SshTunnelRuntime = {},
): SshTunnelManager {
  const clientFactory = runtime.clientFactory ?? (() => new ssh2.Client());
  const prepareConnection = runtime.prepareConnection ?? prepareSshConnection;
  const makeSocksListener =
    runtime.createSocksListener ?? createSshSocksListener;
  const allocatePort = runtime.allocatePort ?? allocateEphemeralLoopbackPort;
  const portIsListening = runtime.portIsListening ?? isPortListening;
  const startupTimeoutMs = runtime.startupTimeoutMs ?? STARTUP_TIMEOUT_MS;
  const reconnectDelay = runtime.reconnectDelayMs ?? sshReconnectDelayMs;
  let client: Client | null = null;
  let listener: SshSocksListener | null = null;
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

  /**
   * A sleep/wake or network drop leaves the tunnel down without the user touching settings, so
   * rebuild it here on a backoff instead of waiting for a Save.
   */
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

  /** Release the client and listener without touching the configured target or reconnect state. */
  const teardown = async (): Promise<void> => {
    generation += 1;
    const previousClient = client;
    const previousListener = listener;
    client = null;
    listener = null;
    runningTarget = null;
    runningPort = null;
    port = null;
    starting = false;
    running = false;
    startup = null;
    error = null;
    const pendingStop = (async (): Promise<void> => {
      if (previousListener) await previousListener.close();
      if (previousClient) await endClient(previousClient);
    })();
    stopping = pendingStop;
    await pendingStop;
    if (stopping === pendingStop) stopping = null;
  };

  const stop = async (): Promise<void> => {
    lastSettings = null;
    cancelReconnect(true);
    await teardown();
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
    if (startup) {
      const currentStartup = startup;
      await currentStartup;
      if (client && runningTarget === nextTarget && runningPort !== null)
        return;
    }
    if (client && runningTarget === nextTarget && runningPort !== null) {
      if (startup) await startup;
      return;
    }

    await teardown();
    if (retry) starting = true;
    const runId = ++generation;
    let resolveStartup: () => void = () => {};
    const startupCompletion = new Promise<void>((resolve) => {
      resolveStartup = resolve;
    });
    startup = startupCompletion;
    let nextClient: Client | null = null;
    let nextListener: SshSocksListener | null = null;
    try {
      let selectedPort: number;
      try {
        selectedPort = await allocatePort();
      } catch (portError) {
        throw new Error(errorMessage(portError), { cause: portError });
      }
      if (runId !== generation) return;
      let alreadyListening: boolean;
      try {
        alreadyListening = await portIsListening(selectedPort);
      } catch (probeError) {
        throw new Error(errorMessage(probeError), { cause: probeError });
      }
      if (runId !== generation) return;
      if (alreadyListening)
        throw new Error(
          `Automatically selected SSH tunnel port ${selectedPort} is already in use. Save again to retry.`,
        );
      port = selectedPort;

      const prepared = await prepareConnection(nextTarget, startupTimeoutMs);
      if (runId !== generation) return;
      nextClient = clientFactory();
      client = nextClient;
      runningTarget = nextTarget;
      runningPort = selectedPort;
      starting = true;
      running = false;
      error = null;
      let authenticated = false;
      nextClient.once("ready", () => {
        authenticated = true;
      });

      const handleUnexpectedClose = (message: string): void => {
        if (client !== nextClient || generation !== runId) return;
        generation += 1;
        client = null;
        runningTarget = null;
        runningPort = null;
        starting = false;
        running = false;
        startup = null;
        error = message;
        const abandonedListener = listener;
        listener = null;
        if (abandonedListener) void abandonedListener.close();
        if (isTransientSshFailure(message)) scheduleReconnect();
      };
      nextClient.on("error", (connectionError) => {
        if (client !== nextClient || generation !== runId) return;
        if (!authenticated) return;
        handleUnexpectedClose(
          `SSH tunnel connection failed: ${connectionError.message}`,
        );
      });
      nextClient.once("close", () => {
        if (client !== nextClient || generation !== runId) return;
        handleUnexpectedClose("SSH tunnel connection closed unexpectedly.");
      });

      await waitForReady(nextClient, prepared, startupTimeoutMs);
      if (runId !== generation || client !== nextClient) return;

      nextListener = makeSocksListener(nextClient);
      await listenOnLoopback(nextListener.server, selectedPort);
      if (runId !== generation || client !== nextClient) {
        await nextListener.close();
        return;
      }
      listener = nextListener;
      starting = false;
      running = true;
      error = null;
      retrying = false;
      reconnectAttempt = 0;
    } catch (startError) {
      if (runId === generation) {
        starting = false;
        running = false;
        runningTarget = null;
        runningPort = null;
        if (client === nextClient) client = null;
        error = errorMessage(startError);
        // The host is unreachable (still waking, Wi-Fi reconnecting): keep trying quietly.
        if (isTransientSshFailure(error)) scheduleReconnect();
      }
      if (nextListener && listener !== nextListener) await nextListener.close();
      if (nextClient) await endClient(nextClient);
    } finally {
      if (startup === startupCompletion) startup = null;
      resolveStartup();
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
    client: "builtin",
  });

  return { sync: (settings) => run(settings, false), stop, getStatus };
}

/**
 * Runs the tunnel with whichever client the settings choose. Switching clients stops the other
 * engine first, so only one tunnel (and one private SOCKS listener) exists at a time.
 */
export function createRoutedSshTunnelManager(engines: {
  builtin: SshTunnelManager;
  system: SshTunnelManager;
}): SshTunnelManager {
  let active: SshTunnelManager = engines.builtin;
  return {
    async sync(settings: TunnelSettings): Promise<void> {
      const next =
        parseSshClient(settings.sshClient) === "system"
          ? engines.system
          : engines.builtin;
      if (next !== active) {
        const previous = active;
        active = next;
        await previous.stop();
      }
      await next.sync(settings);
    },
    async stop(): Promise<void> {
      await Promise.all([engines.builtin.stop(), engines.system.stop()]);
    },
    getStatus(): SshTunnelStatus {
      return active.getStatus();
    },
  };
}

export const managedSshTunnel = createRoutedSshTunnelManager({
  builtin: createSshTunnelManager(),
  system: createSystemSshTunnelManager(),
});

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
