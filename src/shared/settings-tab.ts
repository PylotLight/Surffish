/**
 * Settings as a tab (pure rules, unit tested in settings-tab.test.ts).
 *
 * Settings is one reusable internal tab per browser window, `surffish://settings`. It has no page
 * view: like the local New Tab, the window's trusted content renderer draws it, so the privileged
 * settings IPC stays on the shell's own preload and no web page ever loads it (the scheme is not
 * registered for page loads, and page navigations to non-HTTP(S) URLs are blocked).
 *
 * Deep links pick a section and, for Sites, a site: `surffish://settings#privacy`,
 * `surffish://settings?section=sites&host=https://example.com`. A section may also name a General
 * category to scroll to (`?section=general&focus=mini-window`). Proxy and SSH tunnel settings live
 * in their own Connection section (`?section=connection`); the old General → Connection link
 * (`?section=general&focus=connection`) still lands there.
 */

export const SURFFISH_SETTINGS_URL = "surffish://settings";

/** The settings pages (they match the renderer's settings modes). */
export type SettingsSection =
  | "settings"
  | "connection"
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

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  "settings",
  "connection",
  "newtab",
  "integrations",
  "feeds",
  "readaloud",
  "privacy",
  "watchers",
  "site",
  "network",
  "diagnostics",
  "languages",
];

/** Names a deep link may use for a section (the friendly ones first; the mode names work too). */
const SECTION_ALIASES: Readonly<Record<string, SettingsSection>> = {
  general: "settings",
  settings: "settings",
  connection: "connection",
  proxy: "connection",
  ssh: "connection",
  newtab: "newtab",
  "new-tab": "newtab",
  integrations: "integrations",
  extensions: "integrations",
  feeds: "feeds",
  readaloud: "readaloud",
  "read-aloud": "readaloud",
  privacy: "privacy",
  watchers: "watchers",
  sites: "site",
  site: "site",
  network: "network",
  diagnostics: "diagnostics",
  languages: "languages",
  translation: "languages",
};

/** What the URL calls a section (the inverse of SECTION_ALIASES' friendly names). */
const SECTION_SLUGS: Readonly<Record<SettingsSection, string>> = {
  settings: "general",
  connection: "connection",
  newtab: "newtab",
  integrations: "integrations",
  feeds: "feeds",
  readaloud: "read-aloud",
  privacy: "privacy",
  watchers: "watchers",
  site: "sites",
  network: "network",
  diagnostics: "diagnostics",
  languages: "languages",
};

/** Where a Settings tab should land. */
export interface SettingsTarget {
  section: SettingsSection;
  /** Sites only: the site (an http(s) origin) to show first and focus. */
  host?: string;
  /** General only: a category id to scroll to (`mini-window`, `tabs`, …). */
  focus?: string;
}

export function isSettingsSection(value: unknown): value is SettingsSection {
  return (
    typeof value === "string" &&
    (SETTINGS_SECTIONS as readonly string[]).includes(value)
  );
}

export function settingsSectionFromName(
  value: unknown,
): SettingsSection | null {
  if (typeof value !== "string") return null;
  return SECTION_ALIASES[value.trim().toLowerCase()] ?? null;
}

/** An http(s) origin, or null (anything else could be a script or a local file). */
export function settingsSiteOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  const raw = value.trim();
  if (!raw) return null;
  // A scheme without "//" (javascript:, data:, mailto:) is never a site; "host:8080" is.
  if (
    /^[a-z][a-z0-9+.-]*:(?!\/\/)/i.test(raw) &&
    !/^[^:/]+:\d+(?:[/?#]|$)/.test(raw)
  )
    return null;
  try {
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`,
    );
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function focusId(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z0-9-]{1,40}$/.test(value)
    ? value
    : undefined;
}

/** Is this the Settings tab's address (any section, query or fragment)? */
export function isSettingsUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const lower = value.trim().toLowerCase();
  if (!lower.startsWith(SURFFISH_SETTINGS_URL)) return false;
  const rest = lower.slice(SURFFISH_SETTINGS_URL.length);
  return rest === "" || rest[0] === "/" || rest[0] === "?" || rest[0] === "#";
}

/** The target a `surffish://settings…` address names, or null when it isn't one. */
export function parseSettingsUrl(value: unknown): SettingsTarget | null {
  if (!isSettingsUrl(value)) return null;
  const raw = (value as string).trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { section: "settings" };
  }
  const params = url.searchParams;
  const fromPath = url.pathname.replace(/^\/+|\/+$/g, "");
  const fromHash = url.hash.replace(/^#/, "");
  const section =
    settingsSectionFromName(params.get("section")) ??
    settingsSectionFromName(fromPath) ??
    settingsSectionFromName(fromHash) ??
    "settings";
  return normalizeSettingsTarget({
    section,
    host: params.get("host") ?? undefined,
    focus: params.get("focus") ?? undefined,
  });
}

/** Validate a target from anywhere (IPC, a deep link): unknown section → General, bad host dropped. */
export function normalizeSettingsTarget(value: unknown): SettingsTarget {
  const input =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  let section = isSettingsSection(input.section)
    ? input.section
    : (settingsSectionFromName(input.section) ?? "settings");
  // Connection used to be a General category; old links to it open the Connection section.
  if (section === "settings" && input.focus === "connection")
    section = "connection";
  const target: SettingsTarget = { section };
  if (section === "site") {
    const host = settingsSiteOrigin(input.host);
    if (host) target.host = host;
  }
  if (section === "settings") {
    const focus = focusId(input.focus);
    if (focus) target.focus = focus;
  }
  return target;
}

/** The address for a target (`surffish://settings`, `…?section=sites&host=…`). */
export function settingsUrl(
  target: SettingsTarget = { section: "settings" },
): string {
  const { section, host, focus } = normalizeSettingsTarget(target);
  if (section === "settings" && !focus) return SURFFISH_SETTINGS_URL;
  const params = new URLSearchParams({ section: SECTION_SLUGS[section] });
  if (host) params.set("host", host);
  if (focus) params.set("focus", focus);
  return `${SURFFISH_SETTINGS_URL}?${params.toString()}`;
}

/** What the tab is called in the sidebar, the window menu and the address bar's title. */
export const SETTINGS_TAB_TITLE = "Settings";

/**
 * Where to put a new Settings tab: right after the active tab (index into the window's tab list),
 * or at the end when nothing is active.
 */
export function settingsTabInsertIndex(
  tabIds: readonly string[],
  activeTabId: string | null,
): number {
  const index = activeTabId ? tabIds.indexOf(activeTabId) : -1;
  return index < 0 ? tabIds.length : index + 1;
}

/**
 * The Sites list in the Settings tab: sites that have any saved override, plus a deep-linked site
 * on top even when it has none yet (so "All site settings" from a fresh site still lands on it).
 * The store keeps the most recently changed last, so the list shows newest first.
 */
export function settingsSitesList(
  savedOrigins: readonly string[],
  focusHost?: string | null,
): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  const add = (origin: string | null): void => {
    if (!origin || seen.has(origin)) return;
    seen.add(origin);
    list.push(origin);
  };
  add(settingsSiteOrigin(focusHost ?? null));
  for (const origin of [...savedOrigins].reverse())
    add(settingsSiteOrigin(origin));
  return list;
}

/** Per-site switches with their defaults (persistence.ts parseBrowserSiteSettings uses the same). */
const SITE_SETTING_DEFAULTS = {
  blockAds: true,
  openPopupsInTabs: false,
  allowMedia: false,
  allowGeolocation: false,
  allowNotifications: false,
  allowClipboardRead: false,
} as const;

/** Does a site's saved entry change anything (a switch turned back to its default doesn't count)? */
export function siteSettingsHaveOverrides(
  settings: Partial<Record<keyof typeof SITE_SETTING_DEFAULTS, unknown>>,
): boolean {
  return (
    Object.keys(SITE_SETTING_DEFAULTS) as Array<
      keyof typeof SITE_SETTING_DEFAULTS
    >
  ).some(
    (key) =>
      typeof settings[key] === "boolean" &&
      settings[key] !== SITE_SETTING_DEFAULTS[key],
  );
}
