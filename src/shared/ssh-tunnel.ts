const SSH_TARGET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@%+:\-\[\]]{0,254}$/;

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
