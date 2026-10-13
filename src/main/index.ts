// First: scopes every IPC handler registered after it to the sender's window (multi-window).
import { installIpcWindowScope } from './ipc-window-scope'
import { app } from 'electron'
import { dirname, join } from 'node:path'
import { APP_ID, APP_NAME } from '../shared/config'
import { registerIpc } from './ipc'
import { registerDiagnosticsIpc } from './diagnostics'
import { registerBookmarkIpc } from './bookmarks-ipc'
import { registerWindowIpc } from './window-menu'
import { initializeTabArchive, registerTabArchiveIpc } from './tab-archive'
import { disposeMemorySaver, initializeMemorySaver, registerMemorySaverIpc } from './memory-saver'
import { initializeBrowserProxy } from './proxy'
import { initializeSpacesStore } from './spaces-store'
import { restoreWindows, setMainWindowCloseHandler } from './window'
import { quietRetiredShellSenders } from './ipc-retired'
import { freezeBrowserSession, setBrowserSearchEngine } from './browser'
import { browserWindows } from './window-scope'
import { getBrowserSearchEngine } from './browser-persistence'
import { initializeSessionCookiePersistence } from './session-cookies'
import { disposeBramblePoc, initializeBramblePoc } from './bramble-poc'
import { initializeDownloads } from './downloads'
import { installAppMenu } from './app-menu'
import { flushExternalOpens, registerExternalOpenHandlers } from './external-links'
import { disposeWebStoreExtensions, initializeWebStoreExtensions } from './web-store-extensions'
import { holdPageRequestsUntil } from './request-gate'
import { afterFirstWindowPaint, traceStartup } from './startup-defer'
import { registerPdfEditorScheme } from './pdf-editor'
import { READER_SCHEME_PRIVILEGES, registerReaderIpc } from './reader-mode'
import { disposePageWatchers, initializePageWatchers, registerPageWatcherIpc } from './page-watchers'
import { initializeBrowserSafety } from './safety'
import { disposeUpdates, initializeUpdates, registerUpdateIpc } from './updates'

installIpcWindowScope()
app.setName(APP_NAME)
// Dev builds get their own profile, so they can run beside the installed release app.
// The single-instance lock is per profile (userData), so each profile still has one window owner.
// SURFFISH_PROFILE=<name> picks another isolated profile (e.g. a second dev instance).
const profileOverride = process.env['SURFFISH_PROFILE']?.trim().replace(/[^\w.-]/g, '')
// Leave an explicitly chosen profile alone (smoke tests and --user-data-dir set userData outside appData).
const usesDefaultProfileDir = dirname(app.getPath('userData')) === app.getPath('appData')
if (usesDefaultProfileDir && (profileOverride || !app.isPackaged)) {
  const profileName = profileOverride ? `${APP_NAME} ${profileOverride}` : `${APP_NAME} Dev`
  app.setName(profileName)
  app.setPath('userData', join(app.getPath('appData'), profileName))
}
// Privileged schemes must be registered before ready.
registerPdfEditorScheme([READER_SCHEME_PRIVILEGES])
// Bound Chromium's HTTP cache (default grows with free disk space) so the profile stays lean.
app.commandLine.appendSwitch('disk-cache-size', String(512 * 1024 * 1024))

// Worst case (first run downloading filter lists waits up to 8 s, plus extensions) before pages load anyway.
const STARTUP_HOLD_TIMEOUT_MS = 20_000

const hasInstanceLock = app.requestSingleInstanceLock()
if (!hasInstanceLock) app.quit()
// Default-browser links and opened files can arrive before ready; they queue until tabs exist.
else registerExternalOpenHandlers()
app.whenReady().then(async () => {
  if (!app.isPackaged) console.info('Surffish browser profile:', app.getPath('userData'))
  try {
    // Space definitions first: the proxy reads each Space partition's forced route.
    initializeSpacesStore()
    // Set the browser session's proxy before any remote page is created.
    await initializeBrowserProxy()
    // Kill switch, HTTPS-only and spellcheck hook into the sessions before ad blocking attaches.
    initializeBrowserSafety()
    await initializeSessionCookiePersistence()
    initializeDownloads()
  } catch (error) {
    console.error('Could not initialize the browser profile:', error)
    app.quit()
    return
  }
  traceStartup('profile ready')
  // The ad filter and Web Store extensions load after the first window is drawn; until then page
  // requests wait in the fallback gate (no unfiltered first page, extension content scripts still
  // apply) and are handed to the ad blocker once it attaches.
  let finishDeferredStartup: () => void = () => {}
  holdPageRequestsUntil(new Promise<void>((resolve) => { finishDeferredStartup = resolve }), STARTUP_HOLD_TIMEOUT_MS)
  // Windows taskbar grouping/notifications; dev builds group under the Electron binary.
  if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? APP_ID : process.execPath)
  quietRetiredShellSenders()
  registerIpc()
  registerUpdateIpc()
  registerDiagnosticsIpc()
  registerBookmarkIpc()
  registerWindowIpc()
  registerTabArchiveIpc()
  registerMemorySaverIpc()
  registerReaderIpc()
  registerPageWatcherIpc()
  installAppMenu()
  setBrowserSearchEngine(getBrowserSearchEngine())
  setMainWindowCloseHandler(() => {
    disposeBramblePoc()
    disposeWebStoreExtensions()
  })
  // Every saved window comes back (an older single-window session becomes one window).
  const windows = restoreWindows()
  traceStartup('windows created')
  flushExternalOpens()
  initializeTabArchive()
  // Discard least recently used background tabs when memory is tight (on by default).
  initializeMemorySaver()
  // Release-feed update notifications: first check ~30s after launch, then every 6h.
  initializeUpdates()
  // Page watchers: checks run in main on their own schedule (never for private tabs).
  initializePageWatchers()
  // macOS keeps running with no windows open; the Dock icon brings the saved windows back.
  app.on('activate', () => {
    if (browserWindows().length === 0) restoreWindows()
  })
  await afterFirstWindowPaint(windows.at(-1))
  traceStartup('first window painted')
  const originalSecurityWarnings = process.env.ELECTRON_DISABLE_SECURITY_WARNINGS
  let initializeNetworkAdblock: (() => Promise<void>) | undefined
  try {
    // The adapter sets this environment variable as an import side effect; restore the app's
    // previous setting right away.
    const adblock = await import('./adblock')
    initializeNetworkAdblock = adblock.initializeNetworkAdblock
    adblock.attachNetworkAdblock()
  } catch (error) {
    console.warn('Could not load the network ad-filter adapter; continuing without it:', error)
  } finally {
    if (originalSecurityWarnings === undefined) delete process.env.ELECTRON_DISABLE_SECURITY_WARNINGS
    else process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = originalSecurityWarnings
  }
  try {
    await initializeNetworkAdblock?.()
  } catch (error) {
    console.warn('Could not initialize network ad filtering; continuing without it:', error)
  }
  traceStartup('adblock engine ready')
  try {
    // Before page requests are released, so content scripts apply to restored tabs.
    await initializeWebStoreExtensions()
  } catch (error) {
    console.warn('Could not load Chrome Web Store extensions; continuing without them:', error)
  }
  finishDeferredStartup()
  traceStartup('extensions ready, page requests released')
  try {
    await initializeBramblePoc()
  } catch (error) {
    console.warn('Could not initialize the Bramble extension; continuing without it:', error)
  }
}).catch((error: unknown) => {
  console.error('App startup failed:', error)
  app.quit()
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('before-quit', () => {
  // Windows close one by one while quitting; keep all of them in the saved session.
  freezeBrowserSession()
  disposeUpdates()
  disposePageWatchers()
  disposeMemorySaver()
  disposeBramblePoc()
  disposeWebStoreExtensions()
})
