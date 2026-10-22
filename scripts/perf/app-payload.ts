// Packaged app payload for the perf check (bundle.appPayload / bundle.appFiles). Unit-tested in app-payload.test.ts.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * What electron-builder packs into app.asar, approximated: build.files under the app (out/**, package.json)
 * plus the production dependency closure from node_modules, minus the build.files `!` patterns. Bytes and
 * file count. Deterministic: a dependency moved to `dependencies`, a stray sourcemap or a big asset shows here.
 */
export function appPayload(dir: string): {
  appPayload: number;
  appFiles: number;
} {
  const kept = appPayloadFiles(dir);
  return {
    appPayload: kept.reduce((n, f) => n + statSync(join(dir, f)).size, 0),
    appFiles: kept.length,
  };
}

/** The production dependency closure (package names), as electron-builder walks it. */
export function productionDependencies(dir: string): string[] {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const seen = new Set<string>();
  const walk = (name: string) => {
    if (seen.has(name)) return;
    const root = join(dir, "node_modules", name);
    if (!existsSync(join(root, "package.json"))) return;
    seen.add(name);
    const dep = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    for (const d of [
      ...Object.keys(dep.dependencies ?? {}),
      ...Object.keys(dep.optionalDependencies ?? {}),
    ])
      walk(d);
  };
  for (const d of Object.keys(pkg.dependencies ?? {})) walk(d);
  return [...seen];
}

/**
 * The file Node loads for `import 'name'` (or `require`): exports["."] by condition, else main, else index.js,
 * relative to the project. Node ignores the `module` field, so neither does this.
 */
export function runtimeEntry(
  dir: string,
  name: string,
  condition: "import" | "require" = "import",
): string {
  const pkg = JSON.parse(
    readFileSync(join(dir, "node_modules", name, "package.json"), "utf8"),
  );
  const pick = (target: unknown): string | null => {
    if (typeof target === "string") return target;
    if (!target || typeof target !== "object") return null;
    const conditions = target as Record<string, unknown>;
    for (const key of ["node", condition, "default"]) {
      const found = pick(conditions[key]);
      if (found) return found;
    }
    return null;
  };
  const exportsField = pkg.exports;
  const dot =
    exportsField &&
    typeof exportsField === "object" &&
    !Array.isArray(exportsField) &&
    Object.keys(exportsField).some((k) => k.startsWith("."))
      ? exportsField["."]
      : exportsField;
  const entry = pick(dot) ?? pkg.main ?? "index.js";
  return join("node_modules", name, entry).replaceAll("\\", "/");
}

/** Project-relative paths electron-builder packs into app.asar (approximated, see appPayload). */
export function appPayloadFiles(dir: string): string[] {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const patterns: string[] = pkg.build?.files ?? ["out/**/*", "package.json"];
  const include = patterns
    .filter((p) => !p.startsWith("!"))
    .map((p) => new Bun.Glob(p));
  const exclude = patterns
    .filter((p) => p.startsWith("!"))
    .map((p) => new Bun.Glob(p.slice(1)));
  const files: string[] = [];
  for (const g of include)
    for (const f of g.scanSync({ cwd: dir, onlyFiles: true, dot: true }))
      files.push(f);
  for (const name of productionDependencies(dir)) {
    for (const f of new Bun.Glob("**/*").scanSync({
      cwd: join(dir, "node_modules", name),
      onlyFiles: true,
      dot: true,
    }))
      files.push(`node_modules/${name}/${f}`);
  }
  return [...new Set(files)].filter((f) => !exclude.some((g) => g.match(f)));
}
