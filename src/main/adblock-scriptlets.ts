/**
 * Scriptlet bundling for the ad-filter frame preload. No Electron imports.
 *
 * Ghostery assembles every `##+js(...)` scriptlet as a standalone script that carries its own copy
 * of every helper it depends on:
 *
 *   PRELUDE;dep1;dep2;...;SHARE_SAFE_SELF;(scriptlet)(...args)
 *
 * uBO's YouTube rules inject ~30 scriptlets that all share `safeSelf` and a handful of other
 * helpers, so the same helpers went over IPC and through V8 dozens of times per frame (~290 KB of
 * script for one YouTube frame). `bundleScriptlets` turns them into one script with each helper
 * declared once and each scriptlet invocation in its own try/catch, which is what uBO itself does.
 *
 * The split is done by exact string matching against the engine's own dependency bodies, never by
 * guessing at JavaScript syntax: anything that doesn't match the expected shape (surrogate scripts,
 * a future Ghostery format) is passed through unchanged as its own script.
 */
import { Script } from "node:vm";

/** Ghostery's assembleScript() pieces (@ghostery/adblocker resources.js); a unit test pins them against the real engine. */
export const SCRIPTLET_PRELUDE =
  "if (typeof scriptletGlobals === 'undefined') { var scriptletGlobals = {}; }";
export const SCRIPTLET_SHARE_SAFE_SELF =
  "if (typeof safeSelf === 'function') { if (scriptletGlobals.safeSelf) { safeSelf.safe = scriptletGlobals.safeSelf; } else { scriptletGlobals.safeSelf = safeSelf(); } }";

/** The bits of Ghostery's Resources this module reads. */
export interface ScriptletResources {
  scriptlets: ReadonlyArray<{
    name: string;
    aliases?: readonly string[];
    body: string;
    dependencies: readonly string[];
  }>;
}

export interface ParsedScriptlet {
  dependencies: string[];
  invocation: string;
}

export interface ScriptletBundle {
  /** Scripts to run, in order: the bundle (if any) first, then anything that could not be bundled. */
  scripts: string[];
  /** How many scriptlets these scripts run (diagnostics count scriptlets, not scripts). */
  scriptletCount: number;
}

const PREFIX_KEY_LENGTH = 48;
const dependencyIndexCache = new WeakMap<object, Map<string, string[]>>();

/** Every dependency body the resources can inline, indexed by its first characters (longest first). */
function dependencyIndex(resources: ScriptletResources): Map<string, string[]> {
  const cached = dependencyIndexCache.get(resources);
  if (cached) return cached;
  const byName = new Map<string, string>();
  for (const scriptlet of resources.scriptlets) {
    for (const name of [scriptlet.name, ...(scriptlet.aliases ?? [])])
      byName.set(name, scriptlet.body);
  }
  const bodies = new Set<string>();
  for (const scriptlet of resources.scriptlets) {
    for (const name of scriptlet.dependencies) {
      const body = byName.get(name);
      if (body) bodies.add(body);
    }
  }
  const index = new Map<string, string[]>();
  for (const body of bodies) {
    const key = body.slice(0, PREFIX_KEY_LENGTH);
    const list = index.get(key) ?? [];
    list.push(body);
    index.set(key, list);
  }
  for (const list of index.values()) list.sort((a, b) => b.length - a.length);
  dependencyIndexCache.set(resources, index);
  return index;
}

/** Split one assembled scriptlet into its inlined dependency bodies and its invocation, or null if it isn't one. */
export function parseAssembledScriptlet(
  script: string,
  resources: ScriptletResources,
): ParsedScriptlet | null {
  const head = `${SCRIPTLET_PRELUDE};`;
  if (!script.startsWith(head)) return null;
  const index = dependencyIndex(resources);
  const share = `${SCRIPTLET_SHARE_SAFE_SELF};`;
  const dependencies: string[] = [];
  let position = head.length;
  while (position < script.length) {
    if (script.startsWith(share, position)) {
      const invocation = script.slice(position + share.length);
      return invocation.startsWith("(") ? { dependencies, invocation } : null;
    }
    const candidates = index.get(
      script.slice(position, position + PREFIX_KEY_LENGTH),
    );
    const match = candidates?.find(
      (body) =>
        script.startsWith(body, position) &&
        script.charCodeAt(position + body.length) === 59 /* ; */,
    );
    if (!match) return null;
    dependencies.push(match);
    position += match.length + 1;
  }
  return null;
}

const DECLARATION =
  /^(?:(?:async\s+)?function\s*\*?\s*|class\s+)([\w$]+)\s*[({]/;

function onlyDistinctDeclarations(dependencies: Iterable<string>): boolean {
  const names = new Set<string>();
  for (const dependency of dependencies) {
    const name = DECLARATION.exec(dependency)?.[1];
    if (!name || names.has(name)) return false;
    names.add(name);
  }
  return true;
}

/** True when `source` compiles as the block the frame preload evaluates (`{\n…\n}`). */
function compiles(source: string): boolean {
  try {
    // Parse only (never run). V8 pre-parses function bodies, which still reports syntax errors.
    new Script(`{\n${source}\n}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * One script for every bundleable scriptlet (shared helpers declared once, each invocation isolated
 * in try/catch, as when they ran separately), followed by any script that couldn't be bundled.
 * Returns the input unchanged when bundling would not help or the bundle would not compile.
 */
export function bundleScriptlets(
  scripts: readonly string[],
  resources: ScriptletResources | null | undefined,
): ScriptletBundle {
  const unchanged: ScriptletBundle = {
    scripts: [...scripts],
    scriptletCount: scripts.length,
  };
  if (scripts.length < 2 || !resources || !Array.isArray(resources.scriptlets))
    return unchanged;
  const parsed: ParsedScriptlet[] = [];
  const rest: string[] = [];
  for (const script of scripts) {
    const one = parseAssembledScriptlet(script, resources);
    if (one) parsed.push(one);
    else rest.push(script);
  }
  if (parsed.length < 2) return unchanged;
  const dependencies = new Set<string>();
  for (const one of parsed)
    for (const dependency of one.dependencies) dependencies.add(dependency);
  const bundle = [
    SCRIPTLET_PRELUDE,
    ...dependencies,
    SCRIPTLET_SHARE_SAFE_SELF,
    ...parsed.map((one) => `try { ${one.invocation} } catch (e) {}`),
  ].join(";\n");
  // Each piece was a valid script on its own; joining them can only break if two helpers declare the
  // same name. Helpers that are uniquely named function/class declarations (all of uBO's) can't, so
  // only anything else pays for a full parse check (~10-30 ms for a YouTube-sized bundle).
  if (!onlyDistinctDeclarations(dependencies) && !compiles(bundle))
    return unchanged;
  return { scripts: [bundle, ...rest], scriptletCount: scripts.length };
}
