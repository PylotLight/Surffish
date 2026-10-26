import type { BrowserSidebarMode } from "../../../../shared/types";

export type SidebarMode = BrowserSidebarMode;
export type BrowserSurface = "content" | "toolbar" | "sidebar";

export function isSettingsSection(mode: SidebarMode): boolean {
  return (
    mode === "settings" ||
    mode === "connection" ||
    mode === "newtab" ||
    mode === "integrations" ||
    mode === "site" ||
    mode === "network" ||
    mode === "privacy" ||
    mode === "diagnostics" ||
    mode === "watchers" ||
    mode === "feeds" ||
    mode === "readaloud" ||
    mode === "languages"
  );
}

export type SettingsSectionMode = Extract<
  SidebarMode,
  | "settings"
  | "connection"
  | "newtab"
  | "integrations"
  | "site"
  | "network"
  | "privacy"
  | "diagnostics"
  | "watchers"
  | "feeds"
  | "readaloud"
  | "languages"
>;

/** Settings → Integrations has sub-areas; each is its own sidebar mode so links can land on one directly. */
export const INTEGRATIONS_TABS: ReadonlyArray<{
  mode: Extract<SettingsSectionMode, "integrations" | "feeds" | "readaloud">;
  label: string;
}> = [
  { mode: "integrations", label: "Extensions" },
  { mode: "feeds", label: "Feeds" },
  { mode: "readaloud", label: "Read Aloud" },
];

export function isIntegrationsMode(mode: SidebarMode): boolean {
  return mode === "integrations" || mode === "feeds" || mode === "readaloud";
}

/** The top-level settings nav entry a mode belongs to (Feeds and Read Aloud live under Integrations). */
export function settingsNavMode(mode: SidebarMode): SidebarMode {
  return isIntegrationsMode(mode) ? "integrations" : mode;
}

export const SETTINGS_SECTIONS: ReadonlyArray<{
  mode: SettingsSectionMode;
  label: string;
}> = [
  { mode: "settings", label: "General" },
  { mode: "connection", label: "Connection" },
  { mode: "newtab", label: "New Tab" },
  { mode: "integrations", label: "Integrations" },
  { mode: "languages", label: "Languages" },
  { mode: "privacy", label: "Privacy" },
  { mode: "watchers", label: "Watchers" },
  { mode: "site", label: "Sites" },
  { mode: "network", label: "Network" },
  { mode: "diagnostics", label: "Diagnostics" },
];

/** General is long: its groups sit in these categories (sticky headings + the jump list beside them). */
export const GENERAL_CATEGORIES: ReadonlyArray<{ id: string; label: string }> =
  [
    { id: "browsing", label: "Browsing" },
    { id: "appearance", label: "Appearance" },
    { id: "tabs", label: "Tabs & windows" },
    { id: "mini-window", label: "Mini window" },
    { id: "features", label: "Features" },
    { id: "advanced", label: "Advanced" },
  ];

export function httpOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

export function historyHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
