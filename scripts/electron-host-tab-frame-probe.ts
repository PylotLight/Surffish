import { createServer, type Server } from 'node:http'
import { cpSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { app, BrowserWindow, ipcMain, session, webContents } from 'electron'
import type { AddressInfo } from 'node:net'
import {
  activateBrowserTab,
  attachBrowserView,
  getExperimentalExtensionFrames,
  getBrowserTabs,
  setBrowserBounds
} from '../src/main/browser'
import { BROWSER_SESSION_PARTITION } from '../src/main/browser-session'
import { saveBrowserSession } from '../src/main/browser-persistence'

interface ProbeTab {
  id: number
  url?: string
  title?: string
  windowId?: number
  active?: boolean
  index?: number
}

const root = mkdtempSync(join(tmpdir(), 'sockfish-host-tab-frame-probe-'))
const sourceExtensionDirectory = process.env.SOCKFISH_PROBE_EXTENSION_DIR ? resolve(process.env.SOCKFISH_PROBE_EXTENSION_DIR) : null
const officialExtensionMode = sourceExtensionDirectory !== null
const profileDirectory = join(root, 'profile')
mkdirSync(profileDirectory, { recursive: true })
app.setPath('userData', profileDirectory)

const report: Record<string, unknown> = {
  probe: 'sockfish-webcontentsview-tab-frame-mapping',
  experimentalFlag: 'SOCKFISH_EXPERIMENTAL_EXTENSION_HOST_BRIDGE=1',
  fixtureOnly: !officialExtensionMode,
  officialExtensionMode,
  userDataProfile: 'temporary',
  networkPolicy: 'Only chrome-extension internal resources and loopback 127.0.0.1 fixture requests are allowed.',
  accountUsed: false,
  vaultDataUsed: false,
  hostSessionPartition: BROWSER_SESSION_PARTITION,
  blockedRequests: [],
  assertions: []
}
const blockedRequests: Array<{ url: string; resourceType: string }> = []
let mainServer: Server | null = null
let childServer: Server | null = null
let hostWindow: BrowserWindow | null = null
let popupWindow: BrowserWindow | null = null
let officialPopupWindow: BrowserWindow | null = null
let officialPopupDebuggerAttached = false
let bridgeWindow: BrowserWindow | null = null
let browserSession: Electron.Session | null = null
let loadedExtensionId: string | null = null
let hostTabId: string | null = null
let probePageUrl = ''
const bridgeIpcChannel = 'sockfish-experimental-extension-get-frames'
let exitCode = 0

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
      })
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return (server.address() as AddressInfo).port
}

async function waitFor<T>(read: () => T | null | undefined | Promise<T | null | undefined>, timeoutMs: number, label: string): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== null && value !== undefined) return value
    await delay(100)
  }
  throw new Error(`${label} timed out after ${timeoutMs}ms`)
}

function createLocalFixtures(): { main: Server; child: Server; setChildOrigin: (origin: string) => void } {
  let childOrigin = ''
  const child = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (path === '/frame.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end(`<!doctype html><html><head><title>Inert child frame</title></head><body><form id="child-login"><input name="username" autocomplete="username"><input name="password" type="password" autocomplete="current-password"></form><iframe name="grandchild" src="${childOrigin}/grandchild.html"></iframe></body></html>`)
    } else if (path === '/grandchild.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end('<!doctype html><html><head><title>Inert grandchild frame</title></head><body>Inert nested frame</body></html>')
    } else {
      response.writeHead(404)
      response.end('not found')
    }
  })
  const main = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (path === '/login') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end(`<!doctype html><html><head><title>Sockfish inert login</title></head><body><main><h1>Inert compatibility login</h1><form id="login"><label>Username <input name="username" autocomplete="username"></label><label>Password <input name="password" type="password" autocomplete="current-password"></label><button type="button">No-op sign-in</button></form><iframe name="child" src="${childOrigin}/frame.html"></iframe></main></body></html>`)
    } else {
      response.writeHead(404)
      response.end('not found')
    }
  })
  return { main, child, setChildOrigin: (origin) => { childOrigin = origin } }
}

function writeProbeExtension(directory: string): void {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'manifest.json'), `${JSON.stringify({
    manifest_version: 3,
    name: 'Sockfish Local Tab and Frame Probe',
    version: '1.0.0',
    permissions: ['tabs', 'scripting', 'webNavigation'],
    host_permissions: ['http://127.0.0.1/*'],
    background: { service_worker: 'background.js' }
  }, null, 2)}\n`)
  writeFileSync(join(directory, 'get-current-shim.js'), `function installSockfishGetCurrent() {
  if (typeof chrome.tabs.getCurrent === 'function') return;
  Object.defineProperty(chrome.tabs, 'getCurrent', {
    configurable: true,
    value(callback) {
      const currentUrl = typeof globalThis.location?.href === 'string' ? globalThis.location.href : null;
      const currentPath = globalThis.location?.pathname ?? '';
      const isActionPopup = currentPath === '/popup' || currentPath.startsWith('/popup/');
      const result = isActionPopup ? Promise.resolve(undefined) : currentUrl
        ? chrome.tabs.query({}).then((tabs) => tabs.find((tab) => tab.url === currentUrl))
        : Promise.resolve(undefined);
      if (typeof callback === 'function') { result.then(callback, () => callback(undefined)); return undefined; }
      return result;
    }
  });
}
installSockfishGetCurrent();\n`)
  writeFileSync(join(directory, 'background.js'), `importScripts('get-current-shim.js');
function installSockfishGetAllFrames() {
  if (chrome.webNavigation?.getAllFrames) return;
  const getAllFrames = (details, callback) => {
    const result = chrome.runtime.sendMessage({ command: 'sockfish-experimental-get-all-frames', tabId: details?.tabId })
      .then((reply) => reply?.ok && Array.isArray(reply.frames) ? reply.frames : undefined);
    if (typeof callback === 'function') { result.then(callback, () => callback(undefined)); return undefined; }
    return result;
  };
  Object.defineProperty(chrome, 'webNavigation', { configurable: true, value: { getAllFrames } });
}
installSockfishGetAllFrames();
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.command === 'sockfish-experimental-get-all-frames') return;
  if (message?.command !== 'sockfish-probe-tabs-and-frames') return;
  (async () => {
    const tabs = await chrome.tabs.query({});
    const target = tabs.find((tab) => typeof tab.url === 'string' && tab.url.startsWith(message.pageUrl));
    if (!target || typeof target.id !== 'number') {
      return { tabs: tabs.map(({ id, url, title, windowId, active, index }) => ({ id, url, title, windowId, active, index })), targetTab: null, injectedFrames: [] };
    }
    const injectedFrames = await chrome.scripting.executeScript({
      target: { tabId: target.id, allFrames: true },
      func: () => ({ url: location.href, top: window.top === window, name: window.name })
    });
    const bridgedFrames = await new Promise((resolve) => {
      chrome.webNavigation.getAllFrames({ tabId: target.id }, (frames) => resolve(frames));
    });
    const workerCurrentTab = await chrome.tabs.getCurrent();
    return {
      tabs: tabs.map(({ id, url, title, windowId, active, index }) => ({ id, url, title, windowId, active, index })),
      targetTab: { id: target.id, url: target.url, title: target.title, windowId: target.windowId, active: target.active, index: target.index },
      workerGetCurrentMethodPresent: typeof chrome.tabs.getCurrent === 'function',
      workerGetCurrent: workerCurrentTab ?? null,
      injectedFrames,
      bridgedFrames
    };
  })().then(sendResponse, (error) => sendResponse({ error: String(error) }));
  return true;
});\n`)
  writeFileSync(join(directory, 'host-bridge.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Experimental host bridge</title></head><body><script src="get-current-shim.js"></script><script src="host-bridge.js"></script></body></html>\n')
  writeFileSync(join(directory, 'host-bridge.js'), `chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.command !== 'sockfish-experimental-get-all-frames' || sender.id !== chrome.runtime.id) return;
  globalThis.sockfishExperimentalHost.getAllFrames(message.tabId)
    .then((frames) => sendResponse({ ok: Array.isArray(frames), frames }))
    .catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});
globalThis.__sockfishHostBridgeReady = true;\n`)
  writeFileSync(join(directory, 'probe.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Local extension probe</title></head><body>Local extension API probe<script src="get-current-shim.js"></script><script src="probe.js"></script></body></html>\n')
  writeFileSync(join(directory, 'probe.js'), `const pageUrl = new URL(location.href).searchParams.get('target');
Promise.all([
  chrome.tabs.getCurrent(),
  new Promise((resolve) => chrome.tabs.getCurrent((tab) => resolve(tab)))
]).then(([promiseCurrentTab, callbackCurrentTab]) => chrome.runtime.sendMessage({ command: 'sockfish-probe-tabs-and-frames', pageUrl })
  .then((result) => {
    globalThis.__sockfishProbeResult = {
      ...result,
      pageGetCurrentMethodPresent: typeof chrome.tabs.getCurrent === 'function',
      pageGetCurrent: promiseCurrentTab ?? null,
      pageGetCurrentCallback: callbackCurrentTab ?? null
    };
    document.body.dataset.probeReady = 'true';
  }))
  .catch((error) => { globalThis.__sockfishProbeResult = { error: String(error) }; document.body.dataset.probeReady = 'true'; });\n`)
  writeFileSync(join(directory, 'host-preload.cjs'), `const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('sockfishExperimentalHost', {
  getAllFrames: (tabId) => ipcRenderer.invoke('${bridgeIpcChannel}', tabId)
});\n`)
}

function prepareOfficialExtensionCopy(sourceDirectory: string, directory: string): Record<string, unknown> {
  const sourceManifestPath = join(sourceDirectory, 'manifest.json')
  if (!existsSync(sourceManifestPath)) throw new Error(`No manifest.json found in ${sourceDirectory}`)
  cpSync(sourceDirectory, directory, { recursive: true, errorOnExist: true })
  const manifestPath = join(directory, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, any>
  if (manifest.manifest_version !== 3 || typeof manifest.background?.service_worker !== 'string') {
    throw new Error('The official-build host probe requires an MV3 package with a background service worker.')
  }
  if (manifest.background.type === 'module') throw new Error('This test-only wrapper does not alter module service workers.')

  const originalWorker = manifest.background.service_worker as string
  const originalWorkerPath = join(directory, originalWorker)
  if (!existsSync(originalWorkerPath)) throw new Error(`Background worker file not found: ${originalWorker}`)
  copyFileSync(originalWorkerPath, join(directory, 'sockfish-original-background.js'))

  const assetsDirectory = join(root, 'probe-assets')
  writeProbeExtension(assetsDirectory)
  for (const file of ['get-current-shim.js', 'host-bridge.html', 'host-bridge.js', 'probe.html', 'probe.js', 'host-preload.cjs']) {
    copyFileSync(join(assetsDirectory, file), join(directory, file))
  }

  const webNavigationEventNames = [
    'onBeforeNavigate', 'onCommitted', 'onDOMContentLoaded', 'onCompleted',
    'onErrorOccurred', 'onCreatedNavigationTarget', 'onReferenceFragmentUpdated',
    'onTabReplaced', 'onHistoryStateUpdated'
  ]
  const workerWrapper = `importScripts('get-current-shim.js');
const eventNames = ${JSON.stringify(webNavigationEventNames)};
const webNavigation = Object.create(null);
for (const name of eventNames) {
  const listeners = new Set();
  webNavigation[name] = {
    addListener(listener) { if (typeof listener === 'function') listeners.add(listener); },
    removeListener(listener) { listeners.delete(listener); },
    hasListener(listener) { return listeners.has(listener); },
    hasListeners() { return listeners.size > 0; }
  };
}
webNavigation.getAllFrames = (details, callback) => {
  const result = chrome.runtime.sendMessage({ command: 'sockfish-experimental-get-all-frames', tabId: details?.tabId })
    .then((reply) => reply?.ok && Array.isArray(reply.frames) ? reply.frames : undefined);
  if (typeof callback === 'function') { result.then(callback, () => callback(undefined)); return undefined; }
  return result;
};
Object.defineProperty(chrome, 'webNavigation', { configurable: true, enumerable: true, value: webNavigation });
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.command === 'sockfish-experimental-get-all-frames') return;
  if (message?.command !== 'sockfish-probe-tabs-and-frames') return;
  (async () => {
    const tabs = await chrome.tabs.query({});
    const target = tabs.find((tab) => typeof tab.url === 'string' && tab.url.startsWith(message.pageUrl));
    if (!target || typeof target.id !== 'number') return { tabs, targetTab: null, injectedFrames: [], bridgedFrames: [] };
    const injectedFrames = await chrome.scripting.executeScript({
      target: { tabId: target.id, allFrames: true },
      func: () => ({ url: location.href, top: window.top === window, name: window.name })
    });
    const bridgedFrames = await new Promise((resolve) => {
      chrome.webNavigation.getAllFrames({ tabId: target.id }, (frames) => resolve(frames));
    });
    const workerCurrentTab = await chrome.tabs.getCurrent();
    return {
      tabs: tabs.map(({ id, url, title, windowId, active, index }) => ({ id, url, title, windowId, active, index })),
      targetTab: { id: target.id, url: target.url, title: target.title, windowId: target.windowId, active: target.active, index: target.index },
      workerGetCurrentMethodPresent: typeof chrome.tabs.getCurrent === 'function',
      workerGetCurrent: workerCurrentTab ?? null,
      injectedFrames,
      bridgedFrames
    };
  })().then(sendResponse, (error) => sendResponse({ error: String(error) }));
  return true;
});
importScripts('sockfish-original-background.js');\n`
  writeFileSync(join(directory, 'sockfish-test-worker.js'), workerWrapper)
  manifest.background.service_worker = 'sockfish-test-worker.js'

  const actionPopup = manifest.action?.default_popup ?? manifest.browser_action?.default_popup ?? null
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return {
    version: manifest.version ?? null,
    manifestVersion: manifest.manifest_version,
    originalServiceWorker: originalWorker,
    actionPopup,
    optionsPage: manifest.options_ui?.page ?? manifest.options_page ?? null,
    staticContentScriptFiles: Array.isArray(manifest.content_scripts)
      ? manifest.content_scripts.flatMap((entry: { js?: string[]; css?: string[] }) => [...(entry.js ?? []), ...(entry.css ?? [])])
      : [],
    permissions: manifest.permissions ?? [],
    popupHtmlModified: false,
    popupShimMethod: actionPopup ? 'CDP Page.addScriptToEvaluateOnNewDocument' : null,
    sourceBuildModified: false,
    loadedTemporaryCopy: true,
    temporaryManifestWrapped: true,
    listenerOnlyWebNavigationStubs: true,
    navigationEventsEmitted: false
  }
}

function summarizeFrames(frames: Electron.WebFrameMain[], mainFrame: Electron.WebFrameMain) {
  return frames.filter((frame) => !frame.detached).map((frame) => ({
    url: frame.url,
    frameTreeNodeId: frame.frameTreeNodeId,
    routingId: frame.routingId,
    processId: frame.processId,
    osProcessId: frame.osProcessId,
    parentFrameTreeNodeId: frame.parent?.frameTreeNodeId ?? null,
    isMainFrame: frame.frameTreeNodeId === mainFrame.frameTreeNodeId
  }))
}

async function inspectExtensionWorlds(contents: Electron.WebContents, extensionId: string): Promise<Record<string, unknown>> {
  const debuggerSession = contents.debugger
  const attachedHere = !debuggerSession.isAttached()
  const contexts: Array<{ id: number; origin: string; name: string; isDefault: boolean; frameId: string | null }> = []
  const listener = (_event: Electron.Event, method: string, params: any): void => {
    if (method !== 'Runtime.executionContextCreated' || !params?.context) return
    const context = params.context
    contexts.push({
      id: context.id,
      origin: context.origin ?? '',
      name: context.name ?? '',
      isDefault: context.auxData?.isDefault === true,
      frameId: context.auxData?.frameId ?? null
    })
  }
  try {
    if (attachedHere) debuggerSession.attach('1.3')
    debuggerSession.on('message', listener)
    await withTimeout(debuggerSession.sendCommand('Runtime.enable'), 5000, 'enable CDP runtime for content-script inspection')
    await delay(500)
    const worlds = []
    for (const context of contexts.filter((candidate) => candidate.origin.includes(extensionId) || candidate.name.includes(extensionId))) {
      let apis: unknown = null
      try {
        const result = await debuggerSession.sendCommand('Runtime.evaluate', {
          expression: `(() => ({ runtimeId: globalThis.chrome?.runtime?.id ?? null, hasRuntimeMessaging: typeof globalThis.chrome?.runtime?.sendMessage === 'function', hasTabsGetCurrent: typeof globalThis.chrome?.tabs?.getCurrent === 'function' }))()`,
          contextId: context.id,
          returnByValue: true
        })
        apis = result.result?.value ?? null
      } catch (error) {
        apis = { error: error instanceof Error ? error.message : String(error) }
      }
      worlds.push({ ...context, apis })
    }
    return { inspected: true, worlds }
  } catch (error) {
    return { inspected: false, error: error instanceof Error ? error.message : String(error), worlds: [] }
  } finally {
    debuggerSession.removeListener('message', listener)
    if (attachedHere && debuggerSession.isAttached()) debuggerSession.detach()
  }
}

async function run(): Promise<void> {
  if (process.env.SOCKFISH_EXPERIMENTAL_EXTENSION_HOST_BRIDGE !== '1') {
    throw new Error('This partial bridge is disabled by default. Set SOCKFISH_EXPERIMENTAL_EXTENSION_HOST_BRIDGE=1 to run the disposable probe.')
  }
  const fixtures = createLocalFixtures()
  childServer = fixtures.child
  mainServer = fixtures.main
  const childPort = await listen(fixtures.child)
  const childOrigin = `http://127.0.0.1:${childPort}`
  fixtures.setChildOrigin(childOrigin)
  // Distinct ports make the nested child frame cross-origin to the login form; every request remains loopback-only.
  const port = await listen(fixtures.main)
  const mainOrigin = `http://127.0.0.1:${port}`
  probePageUrl = `${mainOrigin}/login`

  await app.whenReady()
  browserSession = session.fromPartition(BROWSER_SESSION_PARTITION)
  browserSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    let allowed = false
    try {
      const url = new URL(details.url)
      allowed = url.protocol === 'chrome-extension:' || (url.protocol === 'http:' && url.hostname === '127.0.0.1')
    } catch {}
    if (!allowed && blockedRequests.length < 100) blockedRequests.push({ url: details.url, resourceType: String(details.resourceType) })
    callback({ cancel: !allowed })
  })

  const extensionDirectory = join(root, 'unpacked-probe-extension')
  let officialSetup: Record<string, unknown> | null = null
  if (sourceExtensionDirectory) {
    officialSetup = prepareOfficialExtensionCopy(sourceExtensionDirectory, extensionDirectory)
    report.officialExtension = { ...officialSetup, sourcePath: sourceExtensionDirectory }
  } else {
    writeProbeExtension(extensionDirectory)
  }
  const readyExtensionIds = new Set<string>()
  const recordReadyExtension = (_event: Electron.Event, readyExtension: Electron.Extension): void => {
    readyExtensionIds.add(readyExtension.id)
  }
  browserSession.extensions.on('extension-ready', recordReadyExtension)
  const extension = await browserSession.extensions.loadExtension(extensionDirectory)
  loadedExtensionId = extension.id
  if (!readyExtensionIds.has(extension.id)) {
    await withTimeout(new Promise<void>((resolve) => {
      const listener = (_event: Electron.Event, readyExtension: Electron.Extension): void => {
        if (readyExtension.id !== extension.id) return
        browserSession?.extensions.removeListener('extension-ready', listener)
        resolve()
      }
      browserSession?.extensions.on('extension-ready', listener)
    }), 10000, 'extension-ready')
  }
  browserSession.extensions.removeListener('extension-ready', recordReadyExtension)

  ipcMain.handle(bridgeIpcChannel, (event, tabId: unknown) => {
    if (!bridgeWindow || bridgeWindow.isDestroyed() || event.sender !== bridgeWindow.webContents) {
      throw new Error('Only the isolated extension bridge page may request frame details.')
    }
    if (typeof tabId !== 'number') return null
    return getExperimentalExtensionFrames(tabId)
  })

  hostWindow = new BrowserWindow({
    show: false,
    width: 1100,
    height: 800,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
  })
  saveBrowserSession([probePageUrl], 0)
  attachBrowserView(hostWindow)
  setBrowserBounds({ x: 0, y: 0, width: 1000, height: 700 })
  const registryTab = getBrowserTabs()[0]
  hostTabId = registryTab?.id ?? null
  if (!hostTabId || !activateBrowserTab(hostTabId)) throw new Error('Sockfish could not activate its local WebContentsView tab.')

  const pageContents = await waitFor(
    () => webContents.getAllWebContents().find((contents) => !contents.isDestroyed() && contents.getURL().startsWith(probePageUrl)) ?? null,
    10000,
    'Sockfish WebContentsView'
  )
  await waitFor(
    () => !pageContents.isLoading() && pageContents.mainFrame.framesInSubtree.filter((frame) => !frame.detached).length >= 3 ? true : null,
    15000,
    'nested loopback frame tree'
  )
  const currentRegistryTab = getBrowserTabs().find((tab) => tab.id === hostTabId)
  const hostFrameDetails = summarizeFrames(pageContents.mainFrame.framesInSubtree, pageContents.mainFrame)

  bridgeWindow = new BrowserWindow({
    show: false,
    width: 300,
    height: 200,
    webPreferences: {
      partition: BROWSER_SESSION_PARTITION,
      preload: join(extensionDirectory, 'host-preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  await withTimeout(bridgeWindow.loadURL(`chrome-extension://${extension.id}/host-bridge.html`), 10000, 'load isolated extension host bridge')
  await waitFor(
    () => bridgeWindow?.webContents.executeJavaScript('globalThis.__sockfishHostBridgeReady === true', true),
    10000,
    'extension host bridge listener'
  )

  popupWindow = new BrowserWindow({
    show: false,
    width: 420,
    height: 360,
    webPreferences: {
      partition: BROWSER_SESSION_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })
  const probeUrl = `chrome-extension://${extension.id}/probe.html?target=${encodeURIComponent(probePageUrl)}`
  await withTimeout(popupWindow.loadURL(probeUrl), 10000, 'load extension API probe page')
  const extensionProbe = await waitFor(
    () => popupWindow?.webContents.executeJavaScript('globalThis.__sockfishProbeResult ?? null', true) as Promise<Record<string, unknown> | null>,
    15000,
    'extension tab/frame query'
  )
  await delay(100)

  let officialPopupSnapshot: unknown = null
  let officialPopupContext: unknown = null
  let officialPopupError: string | null = null
  const actionPopup = officialSetup?.actionPopup
  if (officialExtensionMode && typeof actionPopup === 'string') {
    try {
      officialPopupWindow = new BrowserWindow({
        show: false,
        width: 520,
        height: 720,
        webPreferences: {
          partition: BROWSER_SESSION_PARTITION,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true
        }
      })
      await withTimeout(officialPopupWindow.loadURL(probePageUrl), 10000, 'initialize popup CDP target on loopback')
      const popupDebugger = officialPopupWindow.webContents.debugger
      popupDebugger.attach('1.3')
      officialPopupDebuggerAttached = true
      await withTimeout(popupDebugger.sendCommand('Page.enable'), 5000, 'enable popup CDP instrumentation')
      const popupShimSource = `(() => {
        const tabs = globalThis.chrome?.tabs;
        if (!tabs) return;
        if (typeof tabs.getCurrent !== 'function') {
          Object.defineProperty(tabs, 'getCurrent', {
            configurable: true,
            value(callback) {
              if (typeof callback === 'function') { queueMicrotask(() => callback(undefined)); return undefined; }
              return Promise.resolve(undefined);
            }
          });
        }
        globalThis.__sockfishExperimentalPopupGetCurrentInstalled = typeof tabs.getCurrent === 'function';
      })();`
      await withTimeout(popupDebugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: popupShimSource }), 5000, 'install pre-document popup API instrumentation')
      await withTimeout(officialPopupWindow.loadURL(`chrome-extension://${extension.id}/${actionPopup}`), 10000, 'load official action popup')
      await delay(2500)
      officialPopupSnapshot = await withTimeout(officialPopupWindow.webContents.executeJavaScript(`(() => ({
        title: document.title,
        readyState: document.readyState,
        bodyText: (document.body?.innerText ?? '').trim().slice(0, 1600),
        roots: ['app-root', '#app', '#root', 'main', 'form'].map((selector) => ({ selector, count: document.querySelectorAll(selector).length })),
        scriptCount: document.querySelectorAll('script[src]').length,
        visibleInputs: [...document.querySelectorAll('input')].map((field) => ({ type: field.type, name: field.name || null, autocomplete: field.autocomplete || null, valuePresent: field.value.length > 0 }))
      }))()`, true), 8000, 'read official action popup snapshot')
      officialPopupContext = await withTimeout(officialPopupWindow.webContents.executeJavaScript(`(async () => {
        const present = typeof chrome?.tabs?.getCurrent === 'function';
        const current = present ? await chrome.tabs.getCurrent() : undefined;
        return {
          getCurrentPresent: present,
          actionPopupReturnsUndefined: current === undefined,
          experimentalShimApplied: globalThis.__sockfishExperimentalPopupGetCurrentInstalled === true
        };
      })()`, true), 8000, 'check action-popup tabs.getCurrent semantics')
    } catch (error) {
      officialPopupError = error instanceof Error ? error.message : String(error)
    }
  }
  const contentScriptWorldReport = officialExtensionMode ? await inspectExtensionWorlds(pageContents, extension.id) : null

  const targetTab = extensionProbe.targetTab as ProbeTab | null | undefined
  const injectedFrames = Array.isArray(extensionProbe.injectedFrames) ? extensionProbe.injectedFrames as Array<{ frameId: number; result?: { url?: string; top?: boolean; name?: string } }> : []
  const bridgedFrames = Array.isArray(extensionProbe.bridgedFrames) ? extensionProbe.bridgedFrames as Array<{ frameId: number; parentFrameId: number; processId: number; url: string }> : []
  const hostApiFrames = typeof targetTab?.id === 'number' ? getExperimentalExtensionFrames(targetTab.id) : null
  const pageGetCurrent = extensionProbe.pageGetCurrent as ProbeTab | null | undefined
  const pageGetCurrentCallback = extensionProbe.pageGetCurrentCallback as ProbeTab | null | undefined
  const workerGetCurrent = extensionProbe.workerGetCurrent as ProbeTab | null | undefined
  const bridgeFramesMatchHostApi = Boolean(hostApiFrames && JSON.stringify(bridgedFrames) === JSON.stringify(hostApiFrames))
  const frameIdComparisons = injectedFrames.map((injected) => {
    const hostFrame = hostFrameDetails.find((frame) => frame.url === injected.result?.url)
    return {
      url: injected.result?.url ?? null,
      extensionFrameId: injected.frameId,
      hostFrameTreeNodeId: hostFrame?.frameTreeNodeId ?? null,
      hostRoutingId: hostFrame?.routingId ?? null,
      hostParentFrameTreeNodeId: hostFrame?.parentFrameTreeNodeId ?? null,
      extensionIdMatchesMappedFrameTreeNode: hostFrame
        ? injected.frameId === (hostFrame.isMainFrame ? 0 : hostFrame.frameTreeNodeId)
        : false,
      extensionIdMatchesRoutingId: hostFrame
        ? injected.frameId === (hostFrame.isMainFrame ? 0 : hostFrame.routingId)
        : false
    }
  })
  const popupSnapshotData = officialPopupSnapshot as { title?: string; readyState?: string; roots?: Array<{ selector?: string; count?: number }> } | null
  const officialPopupRendered = officialExtensionMode
    ? Boolean(popupSnapshotData?.title === 'Bitwarden' && popupSnapshotData.readyState === 'complete' && popupSnapshotData.roots?.some((root) => root.selector === 'app-root' && (root.count ?? 0) > 0))
    : null
  const contentScriptWorlds = (contentScriptWorldReport as { worlds?: unknown[] } | null)?.worlds ?? []
  const officialContentWorldCount = officialExtensionMode ? contentScriptWorlds.length : null
  const workerRespondedToDiagnostic = Boolean(targetTab && Array.isArray(extensionProbe.injectedFrames) && Array.isArray(extensionProbe.bridgedFrames))
  const reportResult = {
    runtime: { electronVersion: process.versions.electron, chromiumVersion: process.versions.chrome },
    stockElectronMeasurements: {
      tabsQueryExposedHostTab: Boolean(targetTab),
      scriptingAllFramesResultCount: injectedFrames.length,
      tabIdMatchesWebContentsId: typeof targetTab?.id === 'number' && targetTab.id === pageContents.id,
      childFrameIdsMatchFrameTreeNodes: frameIdComparisons.filter((item) => item.url !== pageContents.getURL()).every((item) => item.extensionIdMatchesMappedFrameTreeNode)
    },
    experimentalOverrides: {
      sourceExtensionFilesModified: false,
      popupHtmlModified: false,
      temporaryManifestWorkerWrapper: officialExtensionMode,
      listenerOnlyWebNavigationEvents: officialExtensionMode,
      webNavigationGetAllFramesRelayedToHost: true,
      popupTabsGetCurrentPreDocumentShim: officialExtensionMode,
      navigationEventsEmitted: false
    },
    wrappedWorkerRespondedToDiagnostic: officialExtensionMode ? workerRespondedToDiagnostic : null,
    officialPopupRendered,
    officialContentWorldCount,
    extension: { name: extension.name, version: extension.version, id: extension.id },
    hostTab: currentRegistryTab ? { id: currentRegistryTab.id, url: currentRegistryTab.url, active: currentRegistryTab.active, sleeping: currentRegistryTab.sleeping } : null,
    hostWebContents: { id: pageContents.id, url: pageContents.getURL(), sessionPartition: BROWSER_SESSION_PARTITION },
    hostBridge: { ipcChannel: bridgeIpcChannel, hiddenExtensionOriginPage: true, rendererNodeIntegration: false, contextIsolation: true },
    extensionProbe,
    officialPopup: officialExtensionMode ? { snapshot: officialPopupSnapshot, context: officialPopupContext, error: officialPopupError } : null,
    contentScriptWorlds: contentScriptWorldReport,
    extensionOptionsPage: officialSetup?.optionsPage ?? null,
    tabIdMatchesWebContentsId: typeof targetTab?.id === 'number' && targetTab.id === pageContents.id,
    pageGetCurrentMatchesExtensionTab: typeof pageGetCurrent?.id === 'number' && pageGetCurrent.id === popupWindow.webContents.id,
    callbackGetCurrentMatchesExtensionTab: typeof pageGetCurrentCallback?.id === 'number' && pageGetCurrentCallback.id === popupWindow.webContents.id,
    workerGetCurrentReturnsUndefined: workerGetCurrent === null || workerGetCurrent === undefined,
    bridgeFramesMatchHostApi,
    tabAppearsInSockfishRegistry: Boolean(currentRegistryTab && currentRegistryTab.url.startsWith(probePageUrl)),
    hostFrames: hostFrameDetails,
    frameIdComparisons,
    allInjectedFramesMatchedHostTree: frameIdComparisons.length === hostFrameDetails.length && frameIdComparisons.every((item) => item.extensionIdMatchesMappedFrameTreeNode),
    blockedRequests
  }
  Object.assign(report, reportResult)
  const assertions = report.assertions as string[]
  if (!currentRegistryTab || !currentRegistryTab.url.startsWith(probePageUrl)) assertions.push('FAILED: the local page was not present in Sockfish’s own BrowserTab registry')
  if (!targetTab) assertions.push('FAILED: Electron chrome.tabs.query did not expose the real Sockfish WebContentsView tab')
  if (!injectedFrames.length) assertions.push('FAILED: chrome.scripting.executeScript(allFrames) returned no frame results')
  if (targetTab && targetTab.id !== pageContents.id) assertions.push('OBSERVED: extension tab.id differs from Electron webContents.id; host needs an explicit mapping')
  if (frameIdComparisons.some((item) => !item.extensionIdMatchesMappedFrameTreeNode)) assertions.push('OBSERVED: extension frameId does not directly match the proposed WebFrameMain frameTreeNodeId mapping')
  if (!bridgeFramesMatchHostApi) assertions.push('FAILED: the extension-worker getAllFrames bridge did not return the exact host frame-tree result')
  if (typeof pageGetCurrent?.id !== 'number' || pageGetCurrent.id !== popupWindow.webContents.id) assertions.push('FAILED: getCurrent did not resolve to the extension page tab in Promise form')
  if (typeof pageGetCurrentCallback?.id !== 'number' || pageGetCurrentCallback.id !== popupWindow.webContents.id) assertions.push('FAILED: getCurrent did not resolve to the extension page tab in callback form')
  if (workerGetCurrent !== null && workerGetCurrent !== undefined) assertions.push('FAILED: getCurrent returned a tab in the background service-worker context')
  if (officialExtensionMode && !workerRespondedToDiagnostic) assertions.push('FAILED: the wrapped official worker did not answer the diagnostic; no compatibility conclusion is available from this run')
  if (officialExtensionMode && !officialContentWorldCount) assertions.push('FAILED: no official extension isolated content-script worlds were observed on the local host page')
  if (officialExtensionMode && actionPopup && !officialPopupRendered) assertions.push('FAILED: the official action popup did not render under the documented pre-document test instrumentation')
  const hostBridgePassed = Boolean(currentRegistryTab && targetTab && injectedFrames.length === hostFrameDetails.length && bridgeFramesMatchHostApi)
  const officialSurfacesPassed = !officialExtensionMode || Boolean(workerRespondedToDiagnostic && officialContentWorldCount && (!actionPopup || officialPopupRendered))
  report.ok = hostBridgePassed && officialSurfacesPassed
  exitCode = report.ok ? 0 : 1
}

async function stopServer(server: Server | null): Promise<void> {
  if (!server?.listening) return
  server.closeAllConnections?.()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

async function main(): Promise<void> {
  try {
    await run()
  } catch (error) {
    report.error = error instanceof Error ? error.stack ?? error.message : String(error)
    report.ok = false
    exitCode = 1
  } finally {
    try {
      if (officialPopupWindow && !officialPopupWindow.isDestroyed()) {
        if (officialPopupDebuggerAttached && officialPopupWindow.webContents.debugger.isAttached()) officialPopupWindow.webContents.debugger.detach()
        officialPopupWindow.destroy()
      }
      if (popupWindow && !popupWindow.isDestroyed()) popupWindow.destroy()
      if (bridgeWindow && !bridgeWindow.isDestroyed()) bridgeWindow.destroy()
      if (hostWindow && !hostWindow.isDestroyed()) hostWindow.destroy()
      ipcMain.removeHandler(bridgeIpcChannel)
      if (browserSession && loadedExtensionId) browserSession.extensions.removeExtension(loadedExtensionId)
      await Promise.all([stopServer(mainServer), stopServer(childServer)])
    } catch (error) {
      report.cleanupError = error instanceof Error ? error.message : String(error)
      exitCode = 1
    }
    try {
      rmSync(root, { recursive: true, force: true })
      report.temporaryProfileRemoved = true
    } catch (error) {
      report.temporaryProfileRemoved = false
      report.cleanupError = error instanceof Error ? error.message : String(error)
      exitCode = 1
    }
    report.exitCode = exitCode
    console.log(`SOCKFISH_HOST_TAB_FRAME_PROBE_REPORT=${JSON.stringify(report)}`)
    process.exitCode = exitCode
    if (app.isReady()) app.exit(exitCode)
  }
}

void main()
