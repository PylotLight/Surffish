/**
 * Command palette (Cmd/Ctrl+K): command descriptors shared over IPC, fuzzy matching, and
 * the ranked result list. Pure, so it is unit tested and runs in any renderer.
 */
import type {
  BrowserTabSummary,
  BrowsingHistoryEntry,
  PinnedSite,
} from "./types";
import { parseKeywordSearch, type CustomSearchEngine } from "./search-keywords";
import type { ArchivedTab } from "./tab-archive";
import { displayHost } from "./url-host";

export type PaletteMode = "all" | "tabs";

/** One registered command as the renderer sees it (main keeps the run function). */
export interface CommandDescriptor {
  id: string;
  title: string;
  /** Extra words that should find this command ("hibernate" finds "Suspend Other Tabs"). */
  keywords: string[];
  /** Electron accelerator (`CmdOrCtrl+Shift+P`), or null when it has none. */
  accelerator: string | null;
  section: string;
  enabled: boolean;
}

export interface CommandPaletteSettings {
  /** Cmd/Ctrl+K and Cmd/Ctrl+Shift+A open the palette (off leaves those keys to pages). */
  enabled: boolean;
}

export interface CommandPaletteSnapshot {
  commands: CommandDescriptor[];
  /** Most recent first. */
  recentCommandIds: string[];
}

export interface CommandPaletteOpenRequest {
  mode: PaletteMode;
}

export type PaletteItem =
  | {
      kind: "command";
      key: string;
      title: string;
      subtitle: string;
      shortcut: string | null;
      commandId: string;
      score: number;
    }
  | {
      kind: "tab";
      key: string;
      title: string;
      subtitle: string;
      tabId: string;
      faviconUrl: string | null;
      score: number;
    }
  | {
      kind: "site";
      key: string;
      title: string;
      subtitle: string;
      url: string;
      faviconUrl: string | null;
      source: "favorite" | "history";
      score: number;
    }
  | {
      kind: "search";
      key: string;
      title: string;
      subtitle: string;
      input: string;
      score: number;
    }
  | {
      kind: "archived";
      key: string;
      title: string;
      subtitle: string;
      archivedId: string;
      url: string;
      faviconUrl: string | null;
      score: number;
    };

export const MAX_RECENT_COMMANDS = 20;
const MAX_RESULTS = 40;
const MAX_HISTORY_RESULTS = 8;
const MAX_ARCHIVED_RESULTS = 6;
const MAX_ARCHIVED_TAB_SEARCH_RESULTS = 15;

// ---------------------------------------------------------------------------
// Shortcut labels

const MAC_KEY_SYMBOLS: Record<string, string> = {
  CmdOrCtrl: "⌘",
  CommandOrControl: "⌘",
  Cmd: "⌘",
  Command: "⌘",
  Super: "⌘",
  Meta: "⌘",
  Ctrl: "⌃",
  Control: "⌃",
  Alt: "⌥",
  Option: "⌥",
  Shift: "⇧",
};
const MAC_MODIFIER_ORDER = ["⌃", "⌥", "⇧", "⌘"];
const KEY_NAMES: Record<string, string> = {
  Plus: "+",
  Minus: "-",
  Equal: "=",
  Up: "↑",
  Down: "↓",
  Left: "←",
  Right: "→",
  Enter: "↩",
  Return: "↩",
  Escape: "Esc",
  Esc: "Esc",
  Backspace: "⌫",
  Delete: "⌦",
  Tab: "⇥",
  Space: "Space",
};

/** `CmdOrCtrl+Shift+P` -> `⇧⌘P` on macOS, `Ctrl+Shift+P` elsewhere. */
export function formatAccelerator(
  accelerator: string | null | undefined,
  platform: string,
): string | null {
  if (!accelerator) return null;
  // A literal "+" key ("CmdOrCtrl++") would split into empty parts.
  const plusKey = accelerator.endsWith("++");
  const parts = (plusKey ? accelerator.slice(0, -2) : accelerator)
    .split("+")
    .filter(Boolean);
  const rawKey = plusKey ? "+" : (parts.pop() ?? "");
  const key =
    KEY_NAMES[rawKey] ?? (rawKey.length === 1 ? rawKey.toUpperCase() : rawKey);
  if (platform === "darwin") {
    const modifiers = parts.map((part) => MAC_KEY_SYMBOLS[part] ?? part);
    modifiers.sort(
      (a, b) => MAC_MODIFIER_ORDER.indexOf(a) - MAC_MODIFIER_ORDER.indexOf(b),
    );
    return `${modifiers.join("")}${key}`;
  }
  const names = parts.map((part) =>
    /^(CmdOrCtrl|CommandOrControl|Ctrl|Control)$/.test(part)
      ? "Ctrl"
      : /^(Cmd|Command|Super|Meta)$/.test(part)
        ? "Win"
        : part === "Option"
          ? "Alt"
          : part,
  );
  return [...names, key].join("+");
}

// ---------------------------------------------------------------------------
// Fuzzy matching

function isWordStart(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = text[index - 1]!;
  return (
    /[\s\-_./:()[\]]/.test(previous) ||
    (/[a-z]/.test(previous) && /[A-Z]/.test(text[index]!))
  );
}

/**
 * Subsequence match with bonuses for word starts and runs; null when `query` isn't a
 * subsequence of `text`. Higher is better. Case-insensitive.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const needle = query.toLocaleLowerCase();
  if (!needle) return 0;
  const haystack = text.toLocaleLowerCase();
  if (!haystack) return null;
  const direct = haystack.indexOf(needle);
  if (direct >= 0) {
    // Contiguous hit: prefer the very start, then a word start, then anywhere.
    const base = direct === 0 ? 100 : isWordStart(text, direct) ? 80 : 50;
    return (
      base +
      needle.length * 4 -
      Math.min(direct, 30) * 0.5 -
      haystack.length * 0.05
    );
  }
  let score = 0;
  let position = 0;
  let run = 0;
  for (const char of needle) {
    if (char === " ") continue;
    const index = haystack.indexOf(char, position);
    if (index < 0) return null;
    const gap = index - position;
    run = gap === 0 && position > 0 ? run + 1 : 0;
    score +=
      2 +
      run * 3 +
      (isWordStart(text, index) ? 6 : 0) -
      Math.min(gap, 10) * 0.4;
    position = index + 1;
  }
  return score - haystack.length * 0.05;
}

/** Every space-separated term must match one of the fields; the score sums the best field per term. */
export function matchFields(
  query: string,
  fields: readonly string[],
  weights: readonly number[] = [],
): number | null {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 0;
  let total = 0;
  for (const term of terms) {
    let best: number | null = null;
    fields.forEach((field, index) => {
      const score = fuzzyScore(term, field);
      if (score === null) return;
      const weighted = score * (weights[index] ?? 1);
      if (best === null || weighted > best) best = weighted;
    });
    if (best === null) return null;
    total += best;
  }
  // Also reward the whole query matching the first field in one piece ("close tab").
  const whole =
    terms.length > 1 ? fuzzyScore(query.trim(), fields[0] ?? "") : null;
  return whole !== null && whole >= 50 ? total + whole : total;
}

// ---------------------------------------------------------------------------
// Recents

export function recordRecentCommand(
  recent: readonly string[],
  id: string,
  limit = MAX_RECENT_COMMANDS,
): string[] {
  return [id, ...recent.filter((candidate) => candidate !== id)].slice(
    0,
    limit,
  );
}

export function parseRecentCommandIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item || item.length > 80 || seen.has(item))
      continue;
    seen.add(item);
    ids.push(item);
    if (ids.length >= MAX_RECENT_COMMANDS) break;
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Results

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** Rough "this is an address, not a search" check for the fallback row's label. */
export function looksLikeAddress(input: string): boolean {
  const value = input.trim();
  if (!value || /\s/.test(value)) return false;
  if (/^https?:\/\//i.test(value)) return true;
  return /^(localhost|\d{1,3}(\.\d{1,3}){3}|[\w-]+(\.[\w-]+)+)(:\d+)?(\/.*)?$/i.test(
    value,
  );
}

export interface PaletteSources {
  query: string;
  mode: PaletteMode;
  commands: readonly CommandDescriptor[];
  recentCommandIds: readonly string[];
  tabs: readonly BrowserTabSummary[];
  pinnedSites: readonly PinnedSite[];
  history: readonly BrowsingHistoryEntry[];
  searchEngines: readonly CustomSearchEngine[];
  defaultSearchLabel: string;
  platform: string;
  /** Archived tabs (newest first); they show as an "Archived" group after open tabs. */
  archivedTabs?: readonly ArchivedTab[];
  /** For the "3h ago" label; defaults to Date.now(). */
  now?: number;
}

/** Recent commands get this added per rank (most recent = full boost). */
const RECENT_BOOST = 40;
// Kinds are interleaved by score, with a small nudge so a command beats a history row on a tie.
const KIND_WEIGHT = {
  command: 1.1,
  tab: 1.05,
  favorite: 1,
  history: 0.85,
  archived: 0.8,
};

function withoutHash(url: string): string {
  return url.replace(/#.*$/, "");
}

function archivedAge(archivedAt: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - archivedAt) / 60_000));
  if (minutes < 60) return minutes < 1 ? "just now" : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

/** Archived tabs matching `query` (all of them, newest first, when empty), skipping URLs already open. */
function archivedItems(
  sources: PaletteSources,
  query: string,
  limit: number,
  weight: number,
): PaletteItem[] {
  const openUrls = new Set(sources.tabs.map((tab) => withoutHash(tab.url)));
  const now = sources.now ?? Date.now();
  const items: PaletteItem[] = [];
  (sources.archivedTabs ?? []).forEach((tab, index) => {
    if (openUrls.has(withoutHash(tab.url))) return;
    const score = query
      ? matchFields(
          query,
          [tab.title, displayHost(tab.url), tab.url],
          [1, 0.9, 0.5],
        )
      : 500 - index;
    if (score === null) return;
    items.push({
      kind: "archived",
      key: `archived:${tab.id}`,
      title: tab.title || tab.url,
      subtitle: `Archived ${archivedAge(tab.archivedAt, now)} · ${displayHost(tab.url)}`,
      archivedId: tab.id,
      url: tab.url,
      faviconUrl: tab.faviconUrl,
      score: score * weight,
    });
  });
  return items.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function buildPaletteItems(sources: PaletteSources): PaletteItem[] {
  const query = sources.query.trim();
  const recentRank = new Map(
    sources.recentCommandIds.map((id, index) => [id, index]),
  );
  const recentBoost = (id: string): number => {
    const rank = recentRank.get(id);
    return rank === undefined
      ? 0
      : RECENT_BOOST * (1 - rank / (sources.recentCommandIds.length + 1));
  };
  const items: PaletteItem[] = [];

  if (sources.mode === "tabs") {
    sources.tabs.forEach((tab, index) => {
      const score = query
        ? matchFields(
            query,
            [tab.title, tab.url, displayHost(tab.url)],
            [1, 0.6, 0.9],
          )
        : 1000 - index;
      if (score === null) return;
      items.push({
        kind: "tab",
        key: `tab:${tab.id}`,
        title: tab.title || tab.url,
        subtitle: tab.active
          ? `Current tab · ${displayHost(tab.url)}`
          : displayHost(tab.url),
        tabId: tab.id,
        faviconUrl: tab.faviconUrl,
        score,
      });
    });
    const open = query
      ? items.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS)
      : items.slice(0, MAX_RESULTS);
    // Archived tabs form their own group after the open ones.
    return [
      ...open,
      ...archivedItems(
        sources,
        query,
        query ? MAX_ARCHIVED_TAB_SEARCH_RESULTS : 10,
        1,
      ),
    ];
  }

  const commands = sources.commands.filter((command) => command.enabled);
  if (!query) {
    // Recently used first, then the registry order.
    const ordered = [...commands].sort(
      (a, b) =>
        (recentRank.get(a.id) ?? Infinity) - (recentRank.get(b.id) ?? Infinity),
    );
    return ordered.slice(0, MAX_RESULTS).map((command, index) => ({
      kind: "command",
      key: `command:${command.id}`,
      title: command.title,
      subtitle: recentRank.has(command.id) ? "Recent" : command.section,
      shortcut: formatAccelerator(command.accelerator, sources.platform),
      commandId: command.id,
      score: 1000 - index,
    }));
  }

  for (const command of commands) {
    const score = matchFields(
      query,
      [command.title, command.keywords.join(" "), command.section],
      [1, 0.7, 0.4],
    );
    if (score === null) continue;
    items.push({
      kind: "command",
      key: `command:${command.id}`,
      title: command.title,
      subtitle: recentRank.has(command.id)
        ? `${command.section} · Recent`
        : command.section,
      shortcut: formatAccelerator(command.accelerator, sources.platform),
      commandId: command.id,
      score: score * KIND_WEIGHT.command + recentBoost(command.id),
    });
  }

  for (const tab of sources.tabs) {
    const score = matchFields(
      query,
      [tab.title, displayHost(tab.url), tab.url],
      [1, 0.9, 0.5],
    );
    if (score === null) continue;
    items.push({
      kind: "tab",
      key: `tab:${tab.id}`,
      title: tab.title || tab.url,
      subtitle: `Switch to tab · ${displayHost(tab.url)}`,
      tabId: tab.id,
      faviconUrl: tab.faviconUrl,
      score: score * KIND_WEIGHT.tab,
    });
  }

  const seenUrls = new Set(sources.tabs.map((tab) => tab.url));
  for (const site of sources.pinnedSites) {
    if (!isHttpUrl(site.url) || seenUrls.has(site.url)) continue;
    const score = matchFields(
      query,
      [site.title, displayHost(site.url), site.url],
      [1, 0.9, 0.5],
    );
    if (score === null) continue;
    seenUrls.add(site.url);
    items.push({
      kind: "site",
      key: `site:${site.url}`,
      title: site.title || displayHost(site.url),
      subtitle: `Favorite · ${displayHost(site.url)}`,
      url: site.url,
      faviconUrl: site.faviconUrl ?? null,
      source: "favorite",
      score: score * KIND_WEIGHT.favorite,
    });
  }

  // Before history, so a page that was archived shows as Archived (restores its back list) rather than History.
  for (const item of archivedItems(
    sources,
    query,
    MAX_ARCHIVED_RESULTS,
    KIND_WEIGHT.archived,
  )) {
    if (item.kind !== "archived" || seenUrls.has(item.url)) continue;
    seenUrls.add(item.url);
    items.push(item);
  }

  let historyCount = 0;
  for (const entry of sources.history) {
    if (historyCount >= MAX_HISTORY_RESULTS) break;
    if (!isHttpUrl(entry.url) || seenUrls.has(entry.url)) continue;
    const score = matchFields(
      query,
      [entry.title, displayHost(entry.url), entry.url],
      [1, 0.9, 0.5],
    );
    if (score === null) continue;
    seenUrls.add(entry.url);
    historyCount += 1;
    items.push({
      kind: "site",
      key: `history:${entry.url}`,
      title: entry.title || displayHost(entry.url),
      subtitle: `History · ${displayHost(entry.url)}`,
      url: entry.url,
      faviconUrl: entry.faviconUrl ?? null,
      source: "history",
      score: score * KIND_WEIGHT.history,
    });
  }

  items.sort((a, b) => b.score - a.score);
  const ranked = items.slice(0, MAX_RESULTS - 1);

  // The "go there" row: a keyword search leads (the user asked for that engine), otherwise it trails.
  const keyword = parseKeywordSearch(query, sources.searchEngines);
  if (keyword) {
    ranked.unshift({
      kind: "search",
      key: "search",
      title: keyword.query
        ? `Search ${keyword.engine.name} for “${keyword.query}”`
        : `Open ${keyword.engine.name}`,
      subtitle:
        keyword.via === "bang"
          ? `!${keyword.engine.keyword}`
          : `Keyword: ${keyword.engine.keyword}`,
      input: query,
      score: Infinity,
    });
  } else {
    const address = looksLikeAddress(query);
    ranked.push({
      kind: "search",
      key: "search",
      title: address
        ? `Open ${query}`
        : `Search ${sources.defaultSearchLabel} for “${query}”`,
      subtitle: address ? "Go to address" : "Search the web",
      input: query,
      score: -Infinity,
    });
  }
  return ranked;
}
