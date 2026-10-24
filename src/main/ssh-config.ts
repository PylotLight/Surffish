import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { hostname, homedir, userInfo } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { parseSshTarget } from "../shared/ssh-tunnel";

const MAX_CONFIG_FILES = 256;
const MAX_CONFIG_FILE_BYTES = 1024 * 1024;
const MAX_INCLUDE_DEPTH = 16;
const DEFAULT_IDENTITY_FILES = ["id_ed25519", "id_ecdsa", "id_rsa", "id_dsa"];

export interface ResolvedSshConnection {
  target: string;
  host: string;
  port: number;
  username: string;
  identityFiles: string[];
  /** Path to the user's ssh-agent socket, or null when agent authentication is off. */
  identityAgent: string | null;
  hostKeyNames: string[];
  knownHostsFiles: string[];
  /** Config files that were actually read, in the order OpenSSH would read them. */
  configFiles: string[];
}

export interface ResolveSshOptions {
  /** Overrides the SSH_AUTH_SOCK lookup; null disables the environment fallback. */
  authSock?: string | null;
  /** Receives the resolution steps, for the SURFFISH_SSH_DEBUG trail. */
  trace?: (message: string) => void;
}

interface ConfigContext {
  alias: string;
  originalHost: string;
  localUser: string;
  remoteUser: string;
  homeDirectory: string;
  port: number;
  host: string;
}

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

/**
 * OpenSSH accepts `Keyword value` and `Keyword=value` (with optional spaces around the `=`), so
 * fold the assignment form back into a keyword and its arguments before anyone reads the line.
 */
function normalizeConfigTokens(tokens: string[]): string[] {
  if (tokens.length === 0) return tokens;
  const keyword = tokens[0]!;
  const separator = keyword.indexOf("=");
  if (separator === 0) return tokens;
  if (separator > 0) {
    const name = keyword.slice(0, separator);
    const value = keyword.slice(separator + 1);
    return value
      ? [name, value, ...tokens.slice(1)]
      : [name, ...tokens.slice(1)];
  }
  const next = tokens[1];
  if (next !== undefined && next.startsWith("=")) {
    const value = next.slice(1);
    return value
      ? [keyword, value, ...tokens.slice(2)]
      : [keyword, ...tokens.slice(2)];
  }
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
    return new RegExp(expression, "i").test(value);
  } catch {
    return false;
  }
}

function patternListMatches(patterns: string[], value: string): boolean {
  const positives = patterns.filter((pattern) => !pattern.startsWith("!"));
  const negatives = patterns
    .filter((pattern) => pattern.startsWith("!"))
    .map((pattern) => pattern.slice(1));
  if (negatives.some((pattern) => globSegmentMatches(pattern, value)))
    return false;
  return (
    positives.length === 0 ||
    positives.some((pattern) => globSegmentMatches(pattern, value))
  );
}

function hostBlockMatches(patterns: string[], host: string): boolean {
  return patternListMatches(
    patterns.flatMap((pattern) => pattern.split(",")),
    host,
  );
}

function expandTokens(value: string, context: ConfigContext): string {
  const tokens: Record<string, string> = {
    d: context.homeDirectory,
    h: context.host,
    l: hostname(),
    n: context.originalHost,
    p: String(context.port),
    r: context.remoteUser,
    u: context.localUser,
  };
  return value.replace(/%%|%[dhlnpru]/g, (match) => {
    if (match === "%%") return "%";
    const token = match[1];
    return tokens[token!] ?? match;
  });
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

async function visitConfigInOrder(
  homeDirectory: string,
  context: ConfigContext,
  onLine: (tokens: string[]) => Promise<boolean | void>,
  onFileBoundary?: (entering: boolean) => void,
  onFileVisited?: (canonicalPath: string) => void,
): Promise<void> {
  const activeFiles = new Set<string>();
  let filesVisited = 0;
  const visit = async (filePath: string, depth: number): Promise<void> => {
    if (depth > MAX_INCLUDE_DEPTH || filesVisited >= MAX_CONFIG_FILES) return;
    let canonicalPath: string;
    try {
      canonicalPath = await realpath(filePath);
    } catch {
      return;
    }
    if (activeFiles.has(canonicalPath)) return;
    activeFiles.add(canonicalPath);
    filesVisited += 1;
    onFileVisited?.(canonicalPath);

    try {
      let contents: string;
      try {
        if ((await stat(canonicalPath)).size > MAX_CONFIG_FILE_BYTES) return;
        contents = await readFile(canonicalPath, "utf8");
      } catch {
        return;
      }
      onFileBoundary?.(true);
      try {
        for (const line of contents.split(/\r?\n/)) {
          const tokens = normalizeConfigTokens(tokenizeConfigLine(line));
          if (tokens.length === 0) continue;
          if (tokens[0]!.toLowerCase() !== "include") {
            await onLine(tokens);
            continue;
          }
          if ((await onLine(tokens)) === false) continue;
          for (const value of tokens.slice(1)) {
            const expanded = expandTokens(
              value.replace(/^~(?=\/|$)/, homeDirectory),
              context,
            );
            const resolved = isAbsolute(expanded)
              ? expanded
              : join(dirname(canonicalPath), expanded);
            for (const includedFile of await expandIncludePattern(resolved)) {
              await visit(includedFile, depth + 1);
            }
          }
        }
      } finally {
        onFileBoundary?.(false);
      }
    } finally {
      activeFiles.delete(canonicalPath);
    }
  };
  await visit(join(homeDirectory, ".ssh", "config"), 0);
}

function defaultLocalUsername(): string {
  try {
    return (
      userInfo().username || process.env.USER || process.env.USERNAME || ""
    );
  } catch {
    return process.env.USER || process.env.USERNAME || "";
  }
}

function expandEnvironment(value: string): string {
  return value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
    (match, name: string) => process.env[name] ?? match,
  );
}

function resolveConfigPath(value: string, context: ConfigContext): string {
  const expanded = expandTokens(
    expandEnvironment(value).replace(/^~(?=\/|$)/, context.homeDirectory),
    context,
  );
  return isAbsolute(expanded)
    ? resolve(expanded)
    : resolve(context.homeDirectory, expanded);
}

/** Resolve the connection details for an SSH target using the user's OpenSSH config. */
export async function resolveSshConnection(
  value: string,
  homeDirectory = homedir(),
  localUsername = defaultLocalUsername(),
  options: ResolveSshOptions = {},
): Promise<ResolvedSshConnection> {
  const trace = options.trace;
  const authSock =
    options.authSock === undefined
      ? (process.env["SSH_AUTH_SOCK"] ?? null)
      : options.authSock;
  const target = parseSshTarget(value);
  if (!target) throw new Error("Enter one SSH host alias or user@host.");
  const at = target.lastIndexOf("@");
  const explicitUser = at >= 0 ? target.slice(0, at) : "";
  const alias = at >= 0 ? target.slice(at + 1) : target;
  const context: ConfigContext = {
    alias,
    originalHost: alias,
    localUser: localUsername,
    remoteUser: explicitUser || localUsername,
    homeDirectory,
    port: 22,
    host: alias,
  };
  const values = new Map<string, string>();
  const identityValues: string[] = [];
  const knownHostsValues: string[] = [];
  const globalKnownHostsValues: string[] = [];
  let identityFilesDisabled = false;
  let identityAgentValue = "";
  let identityAgentDisabled = false;
  let hostKeyAlias = "";
  let configuredHost = alias;
  let activeHostBlock = true;
  const parentHostBlocks: boolean[] = [];
  const configFiles: string[] = [];
  trace?.(`config: home ${homeDirectory}, alias ${alias}`);

  await visitConfigInOrder(
    homeDirectory,
    context,
    async (tokens) => {
      const keyword = tokens[0]!.toLowerCase();
      const args = tokens.slice(1);
      if (keyword === "include") return activeHostBlock;
      if (keyword === "host") {
        activeHostBlock =
          (parentHostBlocks.at(-1) ?? true) && hostBlockMatches(args, alias);
        return;
      }
      if (keyword === "match") {
        // Match conditions are intentionally not executed: e.g. Match exec runs a shell command.
        // Support Match all and straightforward host/originalhost/user/localuser patterns only.
        let matches = true;
        let index = 0;
        while (index < args.length) {
          const criterion = args[index]!.toLowerCase();
          index += 1;
          if (criterion === "all") continue;
          const patterns: string[] = [];
          while (
            index < args.length &&
            ![
              "host",
              "originalhost",
              "user",
              "localuser",
              "all",
              "canonical",
              "final",
              "exec",
              "localnetwork",
            ].includes(args[index]!.toLowerCase())
          ) {
            patterns.push(...args[index]!.split(","));
            index += 1;
          }
          if (criterion === "host" || criterion === "originalhost")
            matches &&= patternListMatches(patterns, alias);
          else if (criterion === "user")
            matches &&= patternListMatches(patterns, context.remoteUser);
          else if (criterion === "localuser")
            matches &&= patternListMatches(patterns, localUsername);
          else {
            // Unsupported Match criteria cannot safely be assumed to apply.
            matches = false;
            if (criterion === "exec") {
              // Skip the command expression as one or more tokens until the next criterion.
              while (
                index < args.length &&
                ![
                  "host",
                  "originalhost",
                  "user",
                  "localuser",
                  "all",
                  "canonical",
                  "final",
                  "exec",
                  "localnetwork",
                ].includes(args[index]!.toLowerCase())
              )
                index += 1;
            }
          }
        }
        activeHostBlock = (parentHostBlocks.at(-1) ?? true) && matches;
        return;
      }
      if (!activeHostBlock || args.length === 0) return;
      const key = keyword.toLowerCase();
      if (key === "identityfile") {
        for (const identity of args) {
          if (identity.toLowerCase() === "none") {
            identityFilesDisabled = true;
            identityValues.length = 0;
          } else if (!identityFilesDisabled) identityValues.push(identity);
        }
        return;
      }
      if (key === "identityagent") {
        const agent = args[0]!;
        if (agent.toLowerCase() === "none") {
          identityAgentDisabled = true;
          identityAgentValue = "";
        } else if (!identityAgentDisabled && !identityAgentValue) {
          identityAgentValue = agent;
        }
        return;
      }
      if (key === "userknownhostsfile") {
        if (args.some((item) => item.toLowerCase() === "none"))
          knownHostsValues.push("none");
        else knownHostsValues.push(...args);
        return;
      }
      if (key === "globalknownhostsfile") {
        if (args.some((item) => item.toLowerCase() === "none"))
          globalKnownHostsValues.push("none");
        else globalKnownHostsValues.push(...args);
        return;
      }
      if (key === "hostkeyalias") {
        if (!hostKeyAlias) hostKeyAlias = args[0]!;
        return;
      }
      if (["proxycommand", "proxyjump"].includes(key)) {
        const first = args[0]!.toLowerCase();
        if (first !== "none")
          throw new Error(
            `SSH config option ${tokens[0]} is not supported by the in-app SSH client.`,
          );
        return;
      }
      if (key === "hostname") {
        if (!values.has(key)) {
          values.set(key, args[0]!);
          configuredHost = args[0]!;
          context.host = configuredHost;
        }
        return;
      }
      if (key === "user") {
        if (!explicitUser && !values.has(key)) {
          values.set(key, args[0]!);
          context.remoteUser = args[0]!;
        }
        return;
      }
      if (key === "port") {
        if (!values.has(key)) {
          values.set(key, args[0]!);
          const port = Number(args[0]);
          if (Number.isInteger(port) && port >= 1 && port <= 65535)
            context.port = port;
        }
        return;
      }
      if (!values.has(key)) values.set(key, args[0]!);
    },
    (entering) => {
      if (entering) parentHostBlocks.push(activeHostBlock);
      else activeHostBlock = parentHostBlocks.pop() ?? true;
    },
    (canonicalPath) => {
      configFiles.push(canonicalPath);
      trace?.(`config: reading ${canonicalPath}`);
    },
  );
  if (configFiles.length === 0)
    trace?.(
      `config: no readable OpenSSH config under ${join(homeDirectory, ".ssh")}`,
    );

  const host = values.get("hostname") || alias;
  const portValue = values.get("port") || "22";
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`Invalid SSH port in ~/.ssh/config for ${target}.`);
  const username = explicitUser || values.get("user") || localUsername;
  if (!username) throw new Error("Could not determine the SSH username.");
  trace?.(`target: ${username}@${host}:${port}`);

  const finalContext: ConfigContext = {
    ...context,
    host,
    port,
    remoteUser: username,
  };
  const agentSource = identityAgentValue || authSock;
  const identityAgent =
    identityAgentDisabled || !agentSource
      ? null
      : resolveConfigPath(agentSource, finalContext);
  trace?.(
    `agent: ${identityAgent ?? "none"}${
      identityAgentValue
        ? " (IdentityAgent)"
        : authSock
          ? " (SSH_AUTH_SOCK)"
          : ""
    }${identityAgentDisabled ? " (IdentityAgent none)" : ""}`,
  );
  let identityFiles: string[];
  if (identityFilesDisabled) {
    identityFiles = [];
    trace?.("identity: disabled by IdentityFile none");
  } else if (identityValues.length > 0) {
    identityFiles = identityValues.map((path) =>
      resolveConfigPath(path, finalContext),
    );
    trace?.(`identity: config lists ${identityFiles.join(", ")}`);
  } else {
    identityFiles = await Promise.all(
      DEFAULT_IDENTITY_FILES.map((name) =>
        resolveConfigPath(join(".ssh", name), finalContext),
      ),
    );
    const existing: string[] = [];
    for (const path of identityFiles) {
      try {
        if ((await stat(path)).isFile()) existing.push(path);
      } catch {
        // Match OpenSSH's default behavior by considering only keys that exist.
      }
    }
    trace?.(
      `identity: no IdentityFile in config; default candidates ${identityFiles.join(", ")} -> ${
        existing.length > 0 ? existing.join(", ") : "none exist"
      }`,
    );
    identityFiles = existing;
  }
  if (identityFiles.length === 0 && !identityAgent)
    throw new Error(
      `No SSH IdentityFile or SSH agent is configured or available for ${target}.`,
    );

  const hostNames = hostKeyAlias
    ? [expandTokens(hostKeyAlias, finalContext)]
    : [alias, host];
  const userKnownHosts =
    knownHostsValues.length === 0
      ? [
          join(homeDirectory, ".ssh", "known_hosts"),
          join(homeDirectory, ".ssh", "known_hosts2"),
        ]
      : knownHostsValues.flatMap((item) =>
          item.toLowerCase() === "none" ? [] : [item],
        );
  const globalKnownHosts =
    globalKnownHostsValues.length === 0
      ? ["/etc/ssh/ssh_known_hosts", "/etc/ssh/ssh_known_hosts2"]
      : globalKnownHostsValues.flatMap((item) =>
          item.toLowerCase() === "none" ? [] : [item],
        );
  const knownHostsFiles = [...userKnownHosts, ...globalKnownHosts].map((path) =>
    resolveConfigPath(path, finalContext),
  );
  const hostKeyNames = [
    ...new Set(
      hostNames.flatMap((name) =>
        port === 22 ? [name] : [`[${name}]:${port}`],
      ),
    ),
  ];
  return {
    target,
    host,
    port,
    username,
    identityFiles: [...new Set(identityFiles)],
    identityAgent,
    hostKeyNames,
    knownHostsFiles: [...new Set(knownHostsFiles)],
    configFiles,
  };
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
  const aliases = new Map<string, string>();
  await visitConfigInOrder(
    homeDirectory,
    {
      alias: "",
      originalHost: "",
      localUser: defaultLocalUsername(),
      remoteUser: defaultLocalUsername(),
      homeDirectory,
      port: 22,
      host: "",
    },
    async (tokens) => {
      if (tokens[0]!.toLowerCase() === "include") return true;
      if (tokens[0]!.toLowerCase() !== "host") return;
      for (const value of tokens.slice(1)) {
        const alias = concreteHostAlias(value);
        if (alias) aliases.set(alias.toLowerCase(), alias);
      }
    },
  );
  return [...aliases.values()].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" }),
  );
}
