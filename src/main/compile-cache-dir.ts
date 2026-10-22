// Where boot.ts keeps Node's on-disk V8 compile cache, and pruning of older app versions' caches.
// Imported only by boot.ts (keep it dependency-free: it runs before the app bundle is parsed).
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * One folder per app version. Node keys entries on each file's path and contents, and every release
 * renames the hashed chunks (browser-<hash>.js, ...), so without this an update's cache sits next to
 * every older one forever (~1 MB per release, never read again).
 */
export function compileCacheDirectoryFor(
  root: string,
  version: string,
): string {
  return join(root, versionFolder(version));
}

/** Remove every cache folder in `root` except the current version's. Returns the names removed. */
export function pruneOtherCompileCaches(
  root: string,
  version: string,
  remove: (path: string) => void = (path) =>
    rmSync(path, { recursive: true, force: true }),
): string[] {
  const keep = versionFolder(version);
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const name of names) {
    if (name === keep) continue;
    try {
      remove(join(root, name));
      removed.push(name);
    } catch {
      // Best effort: a folder another running build still uses can go next time.
    }
  }
  return removed;
}

function versionFolder(version: string): string {
  const safe = version.replace(/[^0-9A-Za-z.+-]/g, "_");
  return `app-${safe || "unknown"}`;
}
