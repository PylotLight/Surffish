import type { BrowserProxySettings } from "./types";

export const SURFFISH_NETWORK_HELPER = {
  name: "Shared SOCKS listener",
  host: "127.0.0.1",
} as const;

/** Managed SSH exposes the same user-configured SOCKS endpoint to the browser and other apps. */
export function browserProxyEndpoint(
  settings: BrowserProxySettings,
): BrowserProxySettings {
  return settings.enabled && settings.sshHost?.trim()
    ? {
        ...settings,
        host: SURFFISH_NETWORK_HELPER.host,
        port: settings.port,
      }
    : { ...settings };
}

export interface SshTunnelStatus {
  configured: boolean;
  enabled: boolean;
  target: string | null;
  host: string;
  port: number | null;
  starting: boolean;
  running: boolean;
  error: string | null;
  /** A dropped session is waiting for its next automatic reconnect attempt. */
  retrying?: boolean;
  /** Which client runs the tunnel (missing: the in-app client). */
  client?: "builtin" | "system";
}

/** The helper forwards managed SSH clients through the in-app private SOCKS listener. */
export function networkHelperUpstreamSettings(
  settings: BrowserProxySettings,
  tunnel: SshTunnelStatus,
): BrowserProxySettings {
  if (!settings.sshHost?.trim() && !tunnel.configured) return { ...settings };
  if (
    !tunnel.configured ||
    !tunnel.enabled ||
    !tunnel.running ||
    tunnel.port === null
  )
    return { ...settings, enabled: false };
  return {
    ...settings,
    enabled: true,
    host: tunnel.host,
    port: tunnel.port,
  };
}

export type SshTunnelConnectionState =
  | "checking"
  | "unconfigured"
  | "disabled"
  | "connecting"
  | "connected"
  | "error"
  | "idle";

export interface SshTunnelStatusSummary {
  state: SshTunnelConnectionState;
  title: string;
  detail: string;
}

/** Describe the SSH session separately from the configurable shared endpoint. */
export function describeSshTunnelStatus(
  status: SshTunnelStatus | null,
): SshTunnelStatusSummary {
  if (!status) {
    return {
      state: "checking",
      title: "Checking connection…",
      detail: "Waiting for the SSH tunnel status.",
    };
  }
  if (!status.configured || !status.target) {
    return {
      state: "unconfigured",
      title: "No managed SSH tunnel",
      detail:
        "Enter an SSH host alias above to have Surffish start a tunnel. Without one, the SOCKS5 proxy setting expects an existing service at the configured host and port.",
    };
  }
  if (!status.enabled) {
    return {
      state: "disabled",
      title: "Not connected",
      detail: "SOCKS5 is off. Enable it and Save to start the SSH tunnel.",
    };
  }
  if (status.starting) {
    return {
      state: "connecting",
      title: "Connecting to SSH server…",
      detail: `Surffish is establishing an SSH session to ${status.target}.`,
    };
  }
  if (status.running) {
    return {
      state: "connected",
      title: "SSH session connected",
      detail: `Connected to ${status.target}${status.client === "system" ? " with system OpenSSH" : ""}; Surffish and other apps use SOCKS5 at ${SURFFISH_NETWORK_HELPER.host}:${status.port ?? "the configured port"}.`,
    };
  }
  if (status.error) {
    if (status.retrying) {
      return {
        state: "connecting",
        title: "Reconnecting to SSH server…",
        detail: `The session to ${status.target} dropped. Surffish retries automatically. Last error: ${status.error}`,
      };
    }
    return {
      state: "error",
      title: "SSH tunnel unavailable",
      detail: `Surffish could not establish an SSH session to ${status.target}: ${status.error}`,
    };
  }
  return {
    state: "idle",
    title: "Not connected",
    detail: `There is no active SSH session to ${status.target}. Save settings to retry.`,
  };
}

export interface NetworkHelperStatus {
  name: string;
  host: string;
  port: number;
  listening: boolean;
  error: string | null;
  sshTunnel: SshTunnelStatus;
}

export interface NetworkHelperUsage {
  activeConnections: number;
  uploadedBytes: number;
  downloadedBytes: number;
  uploadBytesPerSecond: number;
  downloadBytesPerSecond: number;
}
