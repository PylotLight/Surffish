import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";

interface KnownHostEntry {
  marker: string | null;
  hosts: string[];
  keyType: string;
  key: Buffer;
}

export interface KnownHostVerifier {
  verify(key: Buffer): boolean;
  error(): string | null;
}

function globMatches(pattern: string, value: string): boolean {
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
    } else if (/[\\^$+?.()|{}]/.test(character)) {
      expression += `\\${character}`;
    } else {
      expression += character;
    }
  }
  try {
    return new RegExp(`${expression}$`, "i").test(value);
  } catch {
    return false;
  }
}

function hashedHostMatches(pattern: string, host: string): boolean {
  const match = /^\|1\|([^|]+)\|([^|]+)$/.exec(pattern);
  if (!match) return false;
  try {
    const salt = Buffer.from(match[1]!, "base64");
    const expected = Buffer.from(match[2]!, "base64");
    const actual = createHmac("sha1", salt).update(host).digest();
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  } catch {
    return false;
  }
}

function hostPatternMatches(pattern: string, names: string[]): boolean {
  const negated = pattern.startsWith("!");
  const candidate = negated ? pattern.slice(1) : pattern;
  const matched = names.some((name) =>
    candidate.startsWith("|1|")
      ? hashedHostMatches(candidate, name) ||
        hashedHostMatches(candidate, name.toLowerCase())
      : globMatches(candidate, name),
  );
  return negated ? !matched : matched;
}

function entryMatchesHost(entry: KnownHostEntry, names: string[]): boolean {
  const positive = entry.hosts.filter((host) => !host.startsWith("!"));
  const negative = entry.hosts.filter((host) => host.startsWith("!"));
  if (negative.some((host) => !hostPatternMatches(host, names))) return false;
  return positive.some((host) => hostPatternMatches(host, names));
}

function parseKnownHosts(contents: string): KnownHostEntry[] {
  const entries: KnownHostEntry[] = [];
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const fields = trimmed.split(/\s+/);
    let marker: string | null = null;
    if (fields[0]?.startsWith("@")) marker = fields.shift()!.toLowerCase();
    if (fields.length < 3) continue;
    const encoded = fields[2]!;
    try {
      const key = Buffer.from(encoded, "base64");
      if (key.length === 0) continue;
      entries.push({
        marker,
        hosts: fields[0]!.split(","),
        keyType: fields[1]!,
        key,
      });
    } catch {
      // Invalid lines are ignored just as OpenSSH ignores records it cannot parse.
    }
  }
  return entries;
}

/** Load the user's configured trust files and create a fail-closed verifier. */
export async function loadKnownHostVerifier(
  hostNames: string[],
  files: string[],
): Promise<KnownHostVerifier> {
  const entries: KnownHostEntry[] = [];
  for (const file of files) {
    try {
      entries.push(...parseKnownHosts(await readFile(file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error(`Could not read SSH known_hosts file ${file}.`);
    }
  }

  let lastError: string | null = null;
  return {
    verify(key: Buffer): boolean {
      const matchingHostEntries = entries.filter((entry) =>
        entryMatchesHost(entry, hostNames),
      );
      const matchingKeyEntries = matchingHostEntries.filter((entry) =>
        entry.key.equals(key),
      );
      if (matchingKeyEntries.some((entry) => entry.marker === "@revoked")) {
        lastError = "The SSH server presented a revoked host key.";
        return false;
      }
      if (
        matchingKeyEntries.some((entry) => entry.marker !== "@cert-authority")
      ) {
        lastError = null;
        return true;
      }
      if (
        matchingHostEntries.some((entry) => entry.marker === "@cert-authority")
      ) {
        lastError =
          "SSH host certificates are not supported by the in-app client.";
        return false;
      }
      lastError =
        matchingHostEntries.length > 0
          ? "The SSH host key has changed from the key in known_hosts."
          : "The SSH host key is not trusted in known_hosts.";
      return false;
    },
    error: () => lastError,
  };
}
