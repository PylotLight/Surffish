import {
  chmodSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

/**
 * Replace `path` with `data` atomically: a unique owner-only (0600) temp file next to it, then a
 * rename, so a crash mid-write never leaves a half-written file. Creates the directory if needed.
 * Throws on failure, after removing the temp file; callers decide how to log it.
 */
export function writeFileAtomic(path: string, data: string | Uint8Array): void {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(temporaryPath, data, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    if (process.platform !== "win32") chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, path);
  } catch (error) {
    try {
      rmSync(temporaryPath, { force: true });
    } catch {
      /* best-effort cleanup */
    }
    throw error;
  }
}
