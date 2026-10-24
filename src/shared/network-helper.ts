import type { BrowserProxySettings } from "./types";

export const SURFFISH_NETWORK_HELPER = {
  name: "Surffish Network Helper",
  host: "127.0.0.1",
  port: 1088,
} as const;

/** Managed SSH always uses the same public SOCKS endpoint as the Network Helper. */
export function browserProxyEndpoint(
  settings: BrowserProxySettings,
): BrowserProxySettings {
  return settings.enabled && settings.sshHost?.trim()
    ? {
        ...settings,
        host: SURFFISH_NETWORK_HELPER.host,
        port: SURFFISH_NETWORK_HELPER.port,
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
}

/** Keep the OpenSSH-selected local port internal; the helper is the client-facing endpoint. */
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

/** Describe the SSH session separately from the local Network Helper listener. */
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
      detail: `OpenSSH is establishing a session to ${status.target}.`,
    };
  }
  if (status.running) {
    return {
      state: "connected",
      title: "SSH session connected",
      detail: `Connected to ${status.target}; Surffish and other apps can use SOCKS5 at ${SURFFISH_NETWORK_HELPER.host}:${SURFFISH_NETWORK_HELPER.port}.`,
    };
  }
  if (status.error) {
    return {
      state: "error",
      title: "SSH tunnel unavailable",
      detail: `OpenSSH could not establish a session to ${status.target}: ${status.error}`,
    };
  }
  return {
    state: "idle",
    title: "Not connected",
    detail: `There is no active OpenSSH session to ${status.target}. Save settings to retry.`,
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
