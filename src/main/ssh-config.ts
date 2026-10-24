import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { parseSshTarget } from "../shared/ssh-tunnel";

const MAX_CONFIG_FILES = 256;
const MAX_CONFIG_FILE_BYTES = 1024 * 1024;
const MAX_INCLUDE_DEPTH = 16;

function tokenizeConfigLine(line: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let started = false;

  for (const character of line) {
    if (escaped) {
      token += character;
      escaped = false;
      started = true;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      started = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else token += character;
      started = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      started = true;
      continue;
    }
    if (character === "#") break;
    if (/\s/.test(character)) {
      if (started) tokens.push(token);
      token = "";
      started = false;
      continue;
    }
    token += character;
    started = true;
  }
  if (escaped) token += "\\";
  if (started) tokens.push(token);
  return tokens;
}

function escapeRegexCharacter(character: string): string {
  return /[\\^$+?.()|{}]/.test(character) ? `\\${character}` : character;
}

function globSegmentMatches(pattern: string, value: string): boolean {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === "*") {
      expression += ".*";
    } else if (character === "?") {
      expression += ".";
    } else if (character === "[") {
      const end = pattern.indexOf("]", index + 1);
      if (end === -1) expression += "\\[";
      else {
        let content = pattern.slice(index + 1, end);
        if (content.startsWith("!")) content = `^${content.slice(1)}`;
        expression += `[${content.replaceAll("\\", "\\\\")}]`;
        index = end;
      }
    } else {
      expression += escapeRegexCharacter(character);
    }
  }
  expression += "$";
  try {
    return new RegExp(expression).test(value);
  } catch {
    return false;
  }
}

async function expandIncludePattern(pattern: string): Promise<string[]> {
  const absolutePattern = isAbsolute(pattern) ? pattern : resolve(pattern);
  const segments = absolutePattern.split(sep).filter(Boolean);
  let candidates = [isAbsolute(absolutePattern) ? sep : ""];

  for (const segment of segments) {
    const hasWildcard = /[*?[]/.test(segment);
    if (!hasWildcard) {
      candidates = candidates.map((candidate) => join(candidate, segment));
      continue;
    }
    const next: string[] = [];
    for (const candidate of candidates) {
      let entries;
      try {
        entries = await readdir(candidate || ".", { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.name.startsWith(".") && !segment.startsWith(".")) continue;
        if (globSegmentMatches(segment, entry.name))
          next.push(join(candidate, entry.name));
      }
    }
    candidates = next;
    if (candidates.length === 0) break;
  }

  const files: string[] = [];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) files.push(resolve(candidate));
    } catch {
      // OpenSSH ignores missing/unreadable Include paths.
    }
  }
  return files;
}

function concreteHostAlias(value: string): string | null {
  const alias = parseSshTarget(value);
  if (!alias || /[*?\[\]!]/.test(alias)) return null;
  return alias;
}

/** Read only concrete Host names from the user's OpenSSH config and Include files. */
export async function listSshHostAliases(
  homeDirectory = homedir(),
): Promise<string[]> {
  const rootConfig = join(homeDirectory, ".ssh", "config");
  const visited = new Set<string>();
  const aliases = new Map<string, string>();

  const visit = async (filePath: string, depth: number): Promise<void> => {
    if (depth > MAX_INCLUDE_DEPTH || visited.size >= MAX_CONFIG_FILES) return;
    let canonicalPath: string;
    try {
      canonicalPath = await realpath(filePath);
    } catch {
      return;
    }
    if (visited.has(canonicalPath)) return;
    visited.add(canonicalPath);

    let contents: string;
    try {
      if ((await stat(canonicalPath)).size > MAX_CONFIG_FILE_BYTES) return;
      contents = await readFile(canonicalPath, "utf8");
    } catch {
      return;
    }

    const includes: string[] = [];
    for (const line of contents.split(/\r?\n/)) {
      const [directive, ...values] = tokenizeConfigLine(line);
      if (!directive || values.length === 0) continue;
      if (directive.toLowerCase() === "host") {
        for (const value of values) {
          const alias = concreteHostAlias(value);
          if (alias) aliases.set(alias.toLowerCase(), alias);
        }
      } else if (directive.toLowerCase() === "include") {
        for (const value of values) {
          const expanded = value
            .replace(/^~(?=\/|$)/, homeDirectory)
            .replaceAll("%d", homeDirectory);
          const resolved = isAbsolute(expanded)
            ? expanded
            : join(dirname(canonicalPath), expanded);
          includes.push(resolved);
        }
      }
    }

    for (const includePattern of includes) {
      if (visited.size >= MAX_CONFIG_FILES) break;
      for (const includedFile of await expandIncludePattern(includePattern)) {
        await visit(includedFile, depth + 1);
      }
    }
  };

  await visit(rootConfig, 0);
  return [...aliases.values()].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" }),
  );
}
