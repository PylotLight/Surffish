import { readFile } from "node:fs/promises";
import { createConnection, createServer, type Server } from "node:net";
import { Client, utils, type ConnectConfig, type ParsedKey } from "ssh2";
import type { BrowserProxySettings } from "../shared/types";
import { parseSshTarget } from "../shared/ssh-tunnel";
import type { SshTunnelStatus } from "../shared/network-helper";
import { loadKnownHostVerifier } from "./ssh-known-hosts";
import { resolveSshConnection } from "./ssh-config";
import { createSshSocksListener, type SshSocksListener } from "./ssh-socks";

const STARTUP_TIMEOUT_MS = 8_000;
const STOP_TIMEOUT_MS = 1_000;
const PORT_PROBE_TIMEOUT_MS = 300;
const LOOPBACK = "127.0.0.1";

type TunnelSettings = Pick<BrowserProxySettings, "enabled" | "sshHost">;

interface PreparedSshConnection {
  config: ConnectConfig;
  verificationError: () => string | null;
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
}

export interface SshTunnelManager {
  sync(settings: TunnelSettings): Promise<void>;
  stop(): Promise<void>;
  getStatus(): SshTunnelStatus;
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

/** Ask the OS for a free loopback port; the in-app SOCKS listener stays internal to Surffish. */
function allocateEphemeralLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen({ host: LOOPBACK, port: 0, exclusive: true }, () => {
      server.removeListener("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate an internal SSH tunnel port."));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
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

async function prepareSshConnection(
  target: string,
  timeoutMs: number,
): Promise<PreparedSshConnection> {
  const resolved = await resolveSshConnection(target);
  const parsedKeys: ParsedKey[] = [];
  for (const identityFile of resolved.identityFiles) {
    let contents: Buffer;
    try {
      contents = await readFile(identityFile);
    } catch {
      throw new Error(`Could not read SSH IdentityFile ${identityFile}.`);
    }
    const parsed = utils.parseKey(contents);
    if (parsed instanceof Error) {
      throw new Error(
        `Could not load SSH IdentityFile ${identityFile}. Password-protected keys are not supported for this background tunnel.`,
      );
    }
    if (!parsed.isPrivateKey()) continue;
    parsedKeys.push(parsed);
  }
  if (parsedKeys.length === 0)
    throw new Error(
      `No usable private key was found in the SSH IdentityFile for ${target}.`,
    );

  const knownHosts = await loadKnownHostVerifier(
    resolved.hostKeyNames,
    resolved.knownHostsFiles,
  );
  const authHandler = parsedKeys.map((key) => ({
    type: "publickey" as const,
    username: resolved.username,
    key,
  }));
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
    },
    verificationError: knownHosts.error,
  };
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
      finish(new Error(connection.verificationError() ?? error.message));
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Creates an isolated in-process manager so client, config, and listener lifecycles can be tested. */
export function createSshTunnelManager(
  runtime: SshTunnelRuntime = {},
): SshTunnelManager {
  const clientFactory = runtime.clientFactory ?? (() => new Client());
  const prepareConnection = runtime.prepareConnection ?? prepareSshConnection;
  const makeSocksListener =
    runtime.createSocksListener ?? createSshSocksListener;
  const allocatePort = runtime.allocatePort ?? allocateEphemeralLoopbackPort;
  const portIsListening = runtime.portIsListening ?? isPortListening;
  const startupTimeoutMs = runtime.startupTimeoutMs ?? STARTUP_TIMEOUT_MS;
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

  const stop = async (): Promise<void> => {
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

  const sync = async (settings: TunnelSettings): Promise<void> => {
    const nextTarget = parseSshTarget(settings.sshHost);
    configured = nextTarget.length > 0;
    enabled = settings.enabled;
    target = nextTarget || null;
    port = nextTarget ? (runningPort ?? port) : null;

    if (!nextTarget || !settings.enabled) {
      await stop();
      return;
    }
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

    await stop();
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
        throw new Error(errorMessage(portError));
      }
      if (runId !== generation) return;
      let alreadyListening: boolean;
      try {
        alreadyListening = await portIsListening(selectedPort);
      } catch (probeError) {
        throw new Error(errorMessage(probeError));
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
    } catch (startError) {
      if (runId === generation) {
        starting = false;
        running = false;
        runningTarget = null;
        runningPort = null;
        if (client === nextClient) client = null;
        error = errorMessage(startError);
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
