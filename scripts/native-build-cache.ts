import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

function hashDirectory(
  hash: ReturnType<typeof createHash>,
  directory: string,
  root = directory,
): void {
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    const relativePath = relative(root, path).split(sep).join("/");
    const stats = statSync(path);
    if (stats.isDirectory()) {
      hash.update(`directory\0${relativePath}\0`);
      hashDirectory(hash, path, root);
    } else if (stats.isFile()) {
      hash.update(`file\0${relativePath}\0`);
      hash.update(readFileSync(path));
      hash.update("\0");
    }
  }
}

/** Hash the native source, all files in its include directory, and build configuration. */
export function nativeBuildFingerprint(
  sourcePath: string,
  includeDirectory: string,
  configuration: Readonly<Record<string, unknown>>,
): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(configuration));
  hash.update("\0source\0");
  hash.update(readFileSync(sourcePath));
  hash.update("\0headers\0");
  hashDirectory(hash, includeDirectory);
  return hash.digest("hex");
}

/** Skip compilation only when both the artifact and its matching fingerprint exist. */
export function isNativeBuildUpToDate(
  outputPath: string,
  fingerprintPath: string,
  fingerprint: string,
): boolean {
  try {
    if (!existsSync(outputPath) || !statSync(outputPath).isFile()) return false;
    return readFileSync(fingerprintPath, "utf8").trim() === fingerprint;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
