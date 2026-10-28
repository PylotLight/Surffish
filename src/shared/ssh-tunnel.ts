const SSH_TARGET_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9._@%+:-]|\x5b|\x5d){0,254}$/;

/** Normalize one SSH config alias or user@host value. */
export function parseSshTarget(value: unknown): string {
  if (typeof value !== "string") return "";
  const target = value.trim();
  return target && SSH_TARGET_PATTERN.test(target) ? target : "";
}

/** Validate renderer-supplied SSH targets before resolving them in the main process. */
export function validateSshTarget(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "string")
    throw new Error("Enter an SSH host alias or user@host.");
  const target = value.trim();
  if (!target) return "";
  if (!SSH_TARGET_PATTERN.test(target))
    throw new Error(
      "Enter one SSH host alias or user@host without spaces or command options.",
    );
  return target;
}

/**
 * Which SSH client runs a managed tunnel. "builtin" is the in-app ssh2 client (default); "system"
 * runs the OS OpenSSH client so ProxyJump, ProxyCommand, Match exec and security keys work.
 */
export type SshClientEngine = "builtin" | "system";

export const DEFAULT_SSH_CLIENT: SshClientEngine = "builtin";

/** Saved or missing values: anything but "system" means the in-app client. */
export function parseSshClient(value: unknown): SshClientEngine {
  return value === "system" ? "system" : DEFAULT_SSH_CLIENT;
}

/** Renderer-supplied choice: missing means the default; an unknown string is refused. */
export function validateSshClient(value: unknown): SshClientEngine {
  if (value === undefined || value === null) return DEFAULT_SSH_CLIENT;
  if (value === "builtin" || value === "system") return value;
  throw new Error("Choose the built-in SSH client or system OpenSSH.");
}

/** Delay before automatic reconnect `attempt` (1-based): quick after a blip, then every 30 s. */
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000];

export function sshReconnectDelayMs(attempt: number): number {
  const index =
    Math.min(
      Math.max(Number.isFinite(attempt) ? Math.trunc(attempt) : 1, 1),
      RECONNECT_DELAYS_MS.length,
    ) - 1;
  return RECONNECT_DELAYS_MS[index]!;
}

/**
 * Whether a failed or dropped SSH session can recover by itself. Sleep/wake, a dropped Wi-Fi link
 * or a rebooting host fails at the network layer and clears up on its own; a refused key or a
 * changed host key needs the user, so retrying would only hide the error.
 */
export function isTransientSshFailure(
  message: string | null | undefined,
): boolean {
  if (!message) return false;
  if (
    /\b(ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENETDOWN|EHOSTDOWN|EPIPE|EAI_AGAIN|ENOTFOUND)\b/.test(
      message,
    )
  )
    return true;
  return /keepalive timeout|timed out|timeout|socket hang up|broken pipe|not responding|connection (?:to \S+ )?(?:closed|lost|reset)|closed unexpectedly|closed before authentication|could not reach the ssh agent/i.test(
    message,
  );
}

/**
 * OpenSSH arguments for a loopback-only SOCKS5 dynamic forward. The target is one argv item (no
 * shell), validated so it can never be read as an option.
 */
export function buildOpenSshDynamicForwardArgs(
  targetInput: unknown,
  port: number,
  options: { verbose?: boolean } = {},
): string[] {
  const target = validateSshTarget(targetInput);
  if (!target)
    throw new Error("Set an SSH host alias before starting the tunnel.");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Enter a port between 1 and 65535.");
  return [
    ...(options.verbose ? ["-v"] : []),
    "-N",
    "-D",
    `127.0.0.1:${port}`,
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "BatchMode=yes",
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
    // A target can never be parsed as an option, even if validation ever loosens.
    "--",
    target,
  ];
}
