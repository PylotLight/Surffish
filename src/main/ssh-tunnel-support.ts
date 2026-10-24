import { execFile } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { promisify } from "node:util";
import type { BrowserProxySettings } from "../shared/types";
import type { SshTunnelStatus } from "../shared/network-helper";

/** Shared by both tunnel engines (the in-app ssh2 client and system OpenSSH). */
export const LOOPBACK = "127.0.0.1";
export const STARTUP_TIMEOUT_MS = 8_000;
export const STOP_TIMEOUT_MS = 1_000;
const PORT_PROBE_TIMEOUT_MS = 300;

export type TunnelSettings = Pick<BrowserProxySettings, "enabled" | "sshHost"> &
  Partial<Pick<BrowserProxySettings, "sshClient">>;

export interface SshTunnelManager {
  sync(settings: TunnelSettings): Promise<void>;
  stop(): Promise<void>;
  getStatus(): SshTunnelStatus;
}

export function sshDebugEnabled(): boolean {
  return process.env["SURFFISH_SSH_DEBUG"] === "1";
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isPortListening(port: number): Promise<boolean> {
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

/** Ask the OS for a free loopback port; the tunnel's SOCKS listener stays internal to Surffish. */
export function allocateEphemeralLoopbackPort(): Promise<number> {
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

const execFileAsync = promisify(execFile);

/**
 * A packaged app launched from Finder/Dock inherits none of the shell environment, so ask launchd
 * for the agent socket macOS sets up system-wide.
 */
export async function launchdAuthSock(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  try {
    const { stdout } = await execFileAsync(
      "launchctl",
      ["getenv", "SSH_AUTH_SOCK"],
      { timeout: 1_000 },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
