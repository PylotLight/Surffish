/**
 * Settings search: query parsing, matching and highlight ranges (pure, unit tested), plus a small
 * index of every settings section's row labels so a search on one page can say which other pages
 * have matches ("Also in New Tab · 2"). The page on screen is filtered from its live DOM by the
 * renderer (views/settings/useSettingsSearch.ts); this index only drives the cross-page hints, and
 * the settings-search smoke checks every label below still exists on its page.
 */

export type SettingsSearchMode =
  | "settings"
  | "newtab"
  | "integrations"
  | "feeds"
  | "readaloud"
  | "privacy"
  | "watchers"
  | "site"
  | "network"
  | "diagnostics"
  | "languages";

/** Words people type for a setting that its label doesn't use. Keys and values are normalized. */
const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  adblock: ["block ads", "ad blocking", "trackers"],
  ads: ["block ads", "trackers"],
  blur: ["transparency", "vibrancy"],
  dark: ["appearance"],
  theme: ["appearance"],
  hotkey: ["shortcut"],
  keybinding: ["shortcut"],
  keyboard: ["shortcut"],
  sleep: ["hibernate", "memory saver"],
  suspend: ["hibernate", "memory saver"],
  discard: ["hibernate", "memory saver"],
  memory: ["hibernate", "memory saver"],
  pip: ["mini window"],
  floating: ["mini window"],
  "picture in picture": ["mini window"],
  tray: ["menu bar"],
  menubar: ["menu bar"],
  dock: ["tuck", "screen edge"],
  edge: ["tuck", "screen edge"],
  socks: ["socks5", "proxy"],
  vpn: ["proxy", "kill switch"],
  tunnel: ["proxy"],
  ssh: ["proxy"],
  password: ["bramble", "quick unlock"],
  passwords: ["bramble", "quick unlock"],
  pin: ["quick unlock"],
  "touch id": ["quick unlock"],
  rss: ["feeds", "feed"],
  atom: ["feeds", "feed"],
  llm: ["built-in ai", "model"],
  ai: ["built-in ai"],
  ollama: ["built-in ai", "server"],
  spelling: ["spellcheck"],
  dictionary: ["spellcheck"],
  update: ["updates"],
  version: ["about & updates"],
  history: ["clear browsing data"],
  cookies: ["cookies", "site data"],
  clock: ["clock", "time zone", "world clocks"],
  wallpaper: ["background"],
  keywords: ["search keywords", "keyword search"],
  bang: ["keyword search"],
  engine: ["search engine"],
  google: ["search engine"],
  duckduckgo: ["search engine"],
  palette: ["command palette"],
  extensions: ["chrome web store", "extension"],
  bookmarks: ["bookmarks bar", "import"],
  watch: ["page watchers", "watching"],
  momentum: ["throw"],
  fling: ["throw"],
  transparent: ["opacity"],
};

/** Lower-case, accents stripped, whitespace collapsed. Keeps length 1:1 for plain ASCII. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export interface SettingsSearchTerm {
  /** The word as typed (normalized). */
  term: string;
  /** The word plus its synonyms; any one of them satisfies the term. */
  alternatives: string[];
}

/** Splits a query into terms (max 6); a multi-word synonym key also matches as one phrase. */
export function parseSettingsQuery(query: string): SettingsSearchTerm[] {
  const normalized = normalizeSearchText(query).trim();
  if (!normalized) return [];
  const terms: SettingsSearchTerm[] = [];
  let rest = normalized;
  for (const phrase of Object.keys(SYNONYMS).filter((key) =>
    key.includes(" "),
  )) {
    if (rest.includes(phrase)) {
      terms.push({
        term: phrase,
        alternatives: [phrase, ...(SYNONYMS[phrase] ?? [])],
      });
      rest = rest.replace(phrase, " ");
    }
  }
  for (const word of rest.split(" ").filter(Boolean)) {
    if (terms.length >= 6) break;
    if (terms.some((existing) => existing.term === word)) continue;
    terms.push({ term: word, alternatives: [word, ...(SYNONYMS[word] ?? [])] });
  }
  return terms;
}

/** True when every term (or one of its synonyms) appears in the text. No terms: everything matches. */
export function matchesSettingsQuery(
  text: string,
  terms: readonly SettingsSearchTerm[],
): boolean {
  if (terms.length === 0) return true;
  const haystack = normalizeSearchText(text);
  return terms.every((term) =>
    term.alternatives.some((alternative) => haystack.includes(alternative)),
  );
}

/**
 * [start, end) ranges in `text` to highlight for the terms, merged and sorted. Offsets map straight
 * back onto the DOM text node, so text whose normalized form changes length gets no highlight.
 */
export function settingsHighlightRanges(
  text: string,
  terms: readonly SettingsSearchTerm[],
): Array<[number, number]> {
  if (terms.length === 0 || !text) return [];
  const haystack = normalizeSearchText(text);
  if (haystack.length !== text.length) return [];
  const ranges: Array<[number, number]> = [];
  for (const term of terms) {
    for (const alternative of term.alternatives) {
      let from = 0;
      for (;;) {
        const index = haystack.indexOf(alternative, from);
        if (index < 0) break;
        ranges.push([index, index + alternative.length]);
        from = index + alternative.length;
      }
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

export interface SettingsIndexEntry {
  mode: SettingsSearchMode;
  /** Row or group label exactly as the page shows it (the smoke checks it is there). */
  label: string;
  /** Extra words for matching that the page only shows in hints. */
  keywords?: string;
}

const entries = (
  mode: SettingsSearchMode,
  rows: ReadonlyArray<readonly [string, string?]>,
): SettingsIndexEntry[] =>
  rows.map(([label, keywords]) => ({ mode, label, keywords }));

/** Labels per page (group titles and row labels), in page order. */
export const SETTINGS_SEARCH_INDEX: readonly SettingsIndexEntry[] = [
  ...entries("settings", [
    ["Search engine", "address bar"],
    ["Sidebar blur", "transparency"],
    ["Bookmarks bar", "favourites"],
    [
      "Toolbar",
      "pin unpin buttons overflow surffish menu customize reorder cast downloads history reading list",
    ],
    ["Search keywords", "keyword search bang"],
    ["Command palette", "shortcut"],
    ["Default browser", "open links"],
    ["Import", "bookmarks chrome firefox safari"],
    ["Hibernate inactive tabs", "sleep"],
    ["Memory saver", "sleep"],
    ["Preload pages for faster browsing", "preconnect"],
    ["Saved session", "restore"],
    ["Glance", "shift-click link peek"],
    ["Tab archive", "archive unused tabs"],
    ["Spaces"],
    ["Mini window", "pop out always on top"],
    ["Default page"],
    ["Toggle shortcut", "global shortcut"],
    ["Grouping", "tabs stack separate"],
    ["Header", "float push overlay"],
    ["Throw with momentum", "fling"],
    ["Tuck to screen edge", "dock hide"],
    ["Peek on hover", "hover"],
    ["Hover delay"],
    ["Built-in AI (experimental)", "model provider server"],
    ["Cast to Chromecast", "cast tv google cast mirror screen"],
    ["Page Watchers", "watch changes"],
    ["Spellcheck", "languages spelling"],
    ["SOCKS5 proxy", "host port tunnel"],
    ["Local network goes direct", "bypass"],
    ["Kill switch", "block"],
    ["Network rules", "route override"],
    ["Developer"],
    ["Network inspector", "requests"],
    ["About & updates", "version check"],
  ]),
  ...entries("newtab", [
    ["New tab opens", "page"],
    ["Show site names"],
    ["Icon size"],
    ["Links per row"],
    ["Vertical position"],
    ["Dim", "background"],
    ["Blur", "background"],
    ["Show clock"],
    ["Time format", "12-hour 24-hour am pm"],
    ["Show AM/PM"],
    ["Show seconds"],
    ["Show date"],
    ["Date format", "iso numeric"],
    ["Clock size", "large big small scale"],
    ["Clock position", "vertical placement move clock down"],
    ["Clock weight", "bold light font"],
    ["Monospaced digits", "tabular font"],
    ["Greeting", "good morning"],
    ["Time zone"],
    ["World clocks", "city"],
    ["Time difference", "offset"],
    ["Day when different", "tomorrow yesterday"],
    ["Weather", "open-meteo forecast temperature"],
    ["City", "town location search approximate"],
    [
      "Provider",
      "open-meteo met norway yr wttr openweather bom forecast model ecmwf gfs icon",
    ],
    ["API key", "openweather"],
    ["Position", "weather corner top right below clock"],
    [
      "Forecast",
      "weather daily days week 3-day 5-day 7-day multi-day high low rain",
    ],
    ["Weather size", "large big small scale forecast"],
    ["Units", "celsius fahrenheit"],
  ]),
  ...entries("integrations", [
    ["Bramble password manager", "passwords"],
    ["Chrome Web Store extensions", "extension install"],
  ]),
  ...entries("feeds", [["Add a feed", "rss atom json"], ["Following"]]),
  ...entries("readaloud", [
    [
      "Read Aloud (experimental)",
      "text to speech tts listen voice voices accent british american phonon narrate model download voice tester speed 2x 3x sample realtime expressiveness temperature numbers dates times webgpu threads read from here shortcut recommended",
    ],
  ]),
  ...entries("privacy", [
    ["Clear browsing data", "history cache"],
    ["HTTPS-only mode", "secure"],
    ["Tab volume", "audio"],
    ["Sites with cookies", "site data"],
  ]),
  ...entries("watchers", [["Add a page", "watch changes"], ["Watching"]]),
  ...entries("site", [
    ["Block ads and trackers", "adblock"],
    ["Open pop-ups in tabs", "popup"],
    ["Camera and microphone", "permissions"],
    ["Location", "permissions"],
    ["Notifications", "permissions"],
  ]),
  ...entries("diagnostics", [["Diagnostics", "cpu memory processes"]]),
];

export interface SettingsElsewhereHit {
  mode: SettingsSearchMode;
  count: number;
  labels: string[];
}

/** Pages other than `current` with index entries matching the query, most matches first. */
export function settingsMatchesElsewhere(
  query: string,
  current: SettingsSearchMode,
  index: readonly SettingsIndexEntry[] = SETTINGS_SEARCH_INDEX,
): SettingsElsewhereHit[] {
  const terms = parseSettingsQuery(query);
  if (terms.length === 0) return [];
  const integrations = (mode: SettingsSearchMode): boolean =>
    mode === "integrations" || mode === "feeds" || mode === "readaloud";
  const sameNavEntry = (mode: SettingsSearchMode): boolean =>
    mode === current || (integrations(current) && integrations(mode));
  const byMode = new Map<SettingsSearchMode, SettingsElsewhereHit>();
  for (const entry of index) {
    if (
      sameNavEntry(entry.mode) ||
      !matchesSettingsQuery(`${entry.label} ${entry.keywords ?? ""}`, terms)
    )
      continue;
    const hit = byMode.get(entry.mode) ?? {
      mode: entry.mode,
      count: 0,
      labels: [],
    };
    hit.count += 1;
    if (hit.labels.length < 3) hit.labels.push(entry.label);
    byMode.set(entry.mode, hit);
  }
  return [...byMode.values()].sort((a, b) => b.count - a.count);
}

/**
 * Splits a long hint into what a row shows (its first sentence) and what the row's info button
 * reveals (the rest). Short hints, and hints whose first sentence is itself very long, stay whole.
 */
export function splitSettingsHint(
  hint: string,
  max = 96,
): { short: string; more: string | null } {
  const text = hint.trim();
  if (text.length <= max) return { short: text, more: null };
  const match = /^(.+?[.!?])\s+(?=[A-Z(“"‘'0-9⌘])/.exec(text);
  const first = match?.[1];
  if (!match || !first || first.length > max + 40)
    return { short: text, more: null };
  return { short: first, more: text.slice(match[0].length).trim() || null };
}
