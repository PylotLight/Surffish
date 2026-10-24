const SSH_TARGET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@%+:\-\[\]]{0,254}$/;

/** Normalize a single OpenSSH destination (config alias or user@host), without shell parsing. */
export function parseSshTarget(value: unknown): string {
  if (typeof value !== "string") return "";
  const target = value.trim();
  return target && SSH_TARGET_PATTERN.test(target) ? target : "";
}

/** Validate renderer-supplied SSH destinations before they are passed as one argv item to ssh. */
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

/** OpenSSH arguments for a loopback-only SOCKS5 dynamic forward. */
export function buildOpenSshDynamicForwardArgs(
  targetInput: unknown,
  port: number,
): string[] {
  const target = validateSshTarget(targetInput);
  if (!target)
    throw new Error("Set an SSH host alias before starting the tunnel.");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Enter a port between 1 and 65535.");
  return [
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
    target,
  ];
}
