import { lazy, Suspense, type ComponentType, type JSX } from 'react'

/**
 * Views most sessions never open (Settings, Downloads, Bookmarks manager, Network, Diagnostics,
 * archived tabs) load on first use instead of being parsed by all three shell surfaces
 * (toolbar, sidebar, content) at launch. Each wrapper renders nothing for the moment its chunk
 * takes to load (a local file), then the view.
 */
function deferred<P extends object>(load: () => Promise<ComponentType<P>>): (props: P) => JSX.Element {
  const Lazy = lazy(() => load().then((component) => ({ default: component })))
  function Deferred(props: P): JSX.Element {
    return <Suspense fallback={null}><Lazy {...props} /></Suspense>
  }
  return Deferred
}

const settings = (): Promise<typeof import('./settings/lazy-settings')> => import('./settings/lazy-settings')

export const SearchKeywordsSettings = deferred(() => settings().then((m) => m.SearchKeywordsSettings))
export const CommandPaletteSettings = deferred(() => settings().then((m) => m.CommandPaletteSettings))
export const DefaultBrowserSettings = deferred(() => settings().then((m) => m.DefaultBrowserSettings))
export const SpellcheckSettings = deferred(() => settings().then((m) => m.SpellcheckSettings))
export const AppearanceSettings = deferred(() => settings().then((m) => m.AppearanceSettings))
export const ProxyKillSwitchSetting = deferred(() => settings().then((m) => m.ProxyKillSwitchSetting))
export const PrivacySettings = deferred(() => settings().then((m) => m.PrivacySettings))
export const PageWatchersSettings = deferred(() => settings().then((m) => m.PageWatchersSettings))
export const PageWatchersToggle = deferred(() => settings().then((m) => m.PageWatchersToggle))
export const GlanceSettings = deferred(() => settings().then((m) => m.GlanceSettings))
export const MiniWindowSettings = deferred(() => settings().then((m) => m.MiniWindowSettings))
export const LocalAISettings = deferred(() => settings().then((m) => m.LocalAISettings))
export const FeedsSettings = deferred(() => settings().then((m) => m.FeedsSettings))
export const BrambleQuickUnlockSettings = deferred(() => settings().then((m) => m.BrambleQuickUnlockSettings))
export const NetworkRulesSettings = deferred(() => settings().then((m) => m.NetworkRulesSettings))
export const UpdateSettings = deferred(() => settings().then((m) => m.UpdateSettings))
export const TabArchiveSettings = deferred(() => settings().then((m) => m.TabArchiveSettings))
export const MemorySaverSettings = deferred(() => settings().then((m) => m.MemorySaverSettings))
export const PreloadPagesSettings = deferred(() => settings().then((m) => m.PreloadPagesSettings))
export const SpacesSettings = deferred(() => settings().then((m) => m.SpacesSettings))
export const ExtensionsSettings = deferred(() => settings().then((m) => m.ExtensionsSettings))
export const BookmarkImportPanel = deferred(() => settings().then((m) => m.BookmarkImportPanel))
export const SitesSettings = deferred(() => settings().then((m) => m.SitesSettings))

export const DownloadsPanel = deferred(() => import('./DownloadsPanel').then((m) => m.default))
export const NetworkView = deferred(() => import('./NetworkView').then((m) => m.default))
export const DiagnosticsView = deferred(() => import('./DiagnosticsView').then((m) => m.default))
export const BookmarksManager = deferred(() => import('./bookmarks/BookmarksManager').then((m) => m.BookmarksManager))
export const ArchivedTabsSidebar = deferred(() => import('./tab-archive/ArchivedTabsSidebar').then((m) => m.ArchivedTabsSidebar))
export const CertificateViewer = deferred(() => import('./certificates/CertificateViewer').then((m) => m.CertificateViewer))

// New Tab settings: Settings → New Tab and the Customize panel on the New Tab share one component
// (one chunk). The panel's chunk is warmed on the gear's hover/focus so the first open is instant.
const newTabPanel = (): Promise<typeof import('./new-tab/NewTabCustomizePanel')> => import('./new-tab/NewTabCustomizePanel')
export const preloadNewTabCustomizePanel = newTabPanel
export const NewTabCustomizePanel = deferred(() => newTabPanel().then((m) => m.default))
export const NewTabSettingsFields = deferred(() => import('./new-tab/NewTabSettingsFields').then((m) => m.default))
