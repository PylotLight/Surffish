export const SURFFISH_NETWORK_HELPER = {
  name: "Surffish Network Helper",
  host: "127.0.0.1",
  port: 1088,
} as const;

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
      detail: `Connected to ${status.target}; local SOCKS5 forwarding is available at ${status.host}:${status.port}.`,
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
