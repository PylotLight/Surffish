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
