const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { app, BrowserWindow, session, webContents } = require('electron')

const probeArgs = process.argv.slice(2)
const testOnlyWebNavigationShim = probeArgs.includes('--test-only-web-navigation-listener-shim')
const extensionArgument = probeArgs.find((argument) => !argument.startsWith('--'))
const extensionDirectory = extensionArgument ? resolve(extensionArgument) : ''
if (!extensionDirectory || !existsSync(extensionDirectory) || !statSync(extensionDirectory).isDirectory()) {
  console.error('Usage: npm run probe:electron-extension-real -- <unpacked-extension-directory> [--test-only-web-navigation-listener-shim]')
  process.exit(2)
}

const manifestPath = join(extensionDirectory, 'manifest.json')
if (!existsSync(manifestPath)) {
  console.error(`No manifest.json found in ${extensionDirectory}`)
  process.exit(2)
}

let manifest
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
} catch (error) {
  console.error(`Could not parse ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
}

const userDataDirectory = mkdtempSync(join(tmpdir(), 'surffish-real-extension-probe-'))
app.setPath('userData', userDataDirectory)
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('disable-component-update')

const report = {
  probe: 'unpacked-extension-runtime',
  fixtureOnly: false,
  networkPolicy: 'Only the exact loopback origin serving a synthetic blank login form is allowed; all other HTTP(S)/WebSocket requests are cancelled.',
  accountUsed: false,
  vaultDataUsed: false,
  electronVersion: process.versions.electron,
  chromiumVersion: process.versions.chrome,
  extensionDirectory: extensionDirectory,
  manifest: {
    name: typeof manifest.name === 'string' ? manifest.name : null,
    shortName: typeof manifest.short_name === 'string' ? manifest.short_name : null,
    version: typeof manifest.version === 'string' ? manifest.version : null,
    manifestVersion: typeof manifest.manifest_version === 'number' ? manifest.manifest_version : null,
    background: manifest.background ?? null,
    permissions: Array.isArray(manifest.permissions) ? manifest.permissions : [],
    optionalPermissions: Array.isArray(manifest.optional_permissions) ? manifest.optional_permissions : [],
    hostPermissions: Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [],
    actionPopup: manifest.action?.default_popup ?? manifest.browser_action?.default_popup ?? null,
    optionsPage: manifest.options_ui?.page ?? manifest.options_page ?? null,
    commands: Object.keys(manifest.commands ?? {})
  },
  extensionLoaded: false,
  extensionReady: false,
  page: null,
  popup: null,
  options: null,
  backgroundTargets: [],
  serviceWorkerProbe: null,
  serviceWorkerLifecycle: { registrations: [], statusChanges: [], consoleErrors: [], runningWorkers: [] },
  webContents: [],
  consoleErrors: [],
  failedLoads: [],
  rendererCrashes: [],
  blockedRequests: [],
  blockedRequestCount: 0,
  testShim: { enabled: false },
  cleanup: null
}

let server
let pageURL
let allowedOrigin
let browserSession
let extension
let loadedExtensionDirectory = extensionDirectory
let pageWindow
let popupWindow
let optionsWindow
let pageDebuggerAttached = false
let userDataRemoved = false
const extensionContexts = []
const blockedRequestLimit = 100
const consoleLimit = 100
const webNavigationEventNames = [
  'onBeforeNavigate', 'onCommitted', 'onDOMContentLoaded', 'onCompleted',
  'onErrorOccurred', 'onCreatedNavigationTarget', 'onReferenceFragmentUpdated',
  'onTabReplaced', 'onHistoryStateUpdated'
]

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

function progress(phase) {
  report.phase = phase
  if (process.env.SURFFISH_PROBE_VERBOSE === '1') console.error(`[extension-probe] ${phase}`)
}

async function withTimeout(promise, timeoutMs, label) {
  let timeout
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
      })
    ])
  } finally {
    clearTimeout(timeout)
  }
}

function prepareTestOnlyWebNavigationShim() {
  if (!testOnlyWebNavigationShim) return
  const background = manifest.background && typeof manifest.background === 'object' ? manifest.background : {}
  if (manifest.manifest_version !== 3 || typeof background.service_worker !== 'string') {
    throw new Error('The test-only webNavigation shim supports only a Manifest V3 service_worker build.')
  }
  if (background.type === 'module') {
    throw new Error('The test-only wrapper uses importScripts and cannot wrap a module service worker.')
  }

  const copyDirectory = join(userDataDirectory, 'test-only-extension-copy')
  cpSync(extensionDirectory, copyDirectory, { recursive: true, errorOnExist: true })
  const copiedManifestPath = join(copyDirectory, 'manifest.json')
  const copiedManifest = JSON.parse(readFileSync(copiedManifestPath, 'utf8'))
  const originalServiceWorker = copiedManifest.background.service_worker
  const wrapperPath = 'surffish-test-web-navigation-worker.js'
  copiedManifest.background.service_worker = wrapperPath
  writeFileSync(copiedManifestPath, `${JSON.stringify(copiedManifest, null, 2)}\n`)

  const shimSource = `(() => {
  const names = ${JSON.stringify(webNavigationEventNames)};
  const eventState = Object.create(null);
  const api = Object.create(null);
  for (const name of names) {
    const listeners = new Set();
    eventState[name] = listeners;
    api[name] = {
      addListener(listener) { if (typeof listener === 'function') listeners.add(listener); },
      removeListener(listener) { listeners.delete(listener); },
      hasListener(listener) { return listeners.has(listener); },
      hasListeners() { return listeners.size > 0; },
      __listenerCount() { return listeners.size; }
    };
  }
  try {
    Object.defineProperty(globalThis.chrome, 'webNavigation', {
      configurable: true, enumerable: true, value: api
    });
  } catch (error) {
    globalThis.__surffishWebNavigationShimError = String(error);
  }
  globalThis.__surffishWebNavigationShim = { names, eventState };
  globalThis.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.__surffishProbe !== 'webNavigationListenerShim') return;
    sendResponse({
      defined: typeof globalThis.chrome.webNavigation === 'object',
      defineError: globalThis.__surffishWebNavigationShimError ?? null,
      listenerCounts: Object.fromEntries(names.map((name) => [name, eventState[name].size]))
    });
    return true;
  });
})();
importScripts(${JSON.stringify(originalServiceWorker)});
`
  writeFileSync(join(copyDirectory, wrapperPath), shimSource)
  loadedExtensionDirectory = copyDirectory
  report.testShim = {
    enabled: true,
    type: 'listener-registration-only',
    loadedFromTemporaryCopy: true,
    sourceBuildModified: false,
    emittedNavigationEvents: false,
    implementedNavigationDataMethods: false,
    wrappedServiceWorker: originalServiceWorker,
    registeredEventNames: webNavigationEventNames
  }
}

function recordConsoleError(details) {
  if (report.consoleErrors.length >= consoleLimit) return
  const level = Number(details?.level)
  if (level < 2 && details?.type !== 'exception') return
  const message = String(details?.message ?? details?.text ?? 'Unspecified console error').slice(0, 600)
  report.consoleErrors.push({
    url: String(details?.sourceId ?? details?.url ?? '').slice(0, 300),
    level: Number.isFinite(level) ? level : null,
    lineNumber: Number.isFinite(details?.lineNumber) ? details.lineNumber : null,
    message
  })
}

function attachWebContentsDiagnostics(contents) {
  contents.on('console-message', (event, legacyLevel, legacyMessage, legacyLine, legacySourceId) => {
    const details = event && typeof event === 'object' && 'details' in event ? event.details : event
    if (details && typeof details === 'object' && 'message' in details) {
      const level = details.level === 'error' ? 3 : details.level === 'warning' ? 2 : details.level === 'debug' ? 0 : 1
      recordConsoleError({ ...details, level })
    } else {
      recordConsoleError({
        level: legacyLevel,
        message: legacyMessage,
        lineNumber: legacyLine,
        sourceId: legacySourceId
      })
    }
  })
  contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (report.failedLoads.length < 50) {
      report.failedLoads.push({
        errorCode,
        errorDescription: String(errorDescription).slice(0, 300),
        url: String(validatedURL).slice(0, 300),
        isMainFrame: Boolean(isMainFrame)
      })
    }
  })
  contents.on('render-process-gone', (_event, details) => {
    report.rendererCrashes.push({
      reason: details?.reason ?? null,
      exitCode: details?.exitCode ?? null,
      url: contents.getURL().slice(0, 300)
    })
  })
}

app.on('web-contents-created', (_event, contents) => attachWebContentsDiagnostics(contents))

function openWindow() {
  return new BrowserWindow({
    show: false,
    width: 720,
    height: 520,
    webPreferences: {
      session: browserSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
}

function extensionContextExpression() {
  return `(() => ({
    runtimeId: globalThis.chrome?.runtime?.id ?? null,
    hasRuntimeMessaging: typeof globalThis.chrome?.runtime?.sendMessage === 'function',
    hasStorageLocal: typeof globalThis.chrome?.storage?.local?.get === 'function',
    hasStorageOnChanged: typeof globalThis.chrome?.storage?.onChanged?.addListener === 'function',
    browserNamespace: typeof globalThis.browser !== 'undefined',
    pageWorld: typeof globalThis.chrome === 'undefined' ? 'no-chrome-namespace' : 'chrome-namespace-present'
  }))()`
}

async function evaluateInDebugger(debuggerSession, expression, contextId, sessionId) {
  const params = { expression, returnByValue: true, awaitPromise: true, timeout: 7000 }
  if (contextId !== undefined) params.contextId = contextId
  const result = await withTimeout(debuggerSession.sendCommand('Runtime.evaluate', params, sessionId), 8000, 'evaluate extension/page context')
  if (result.exceptionDetails) {
    return { error: result.exceptionDetails.text ?? 'Runtime.evaluate exception' }
  }
  return result.result?.value ?? null
}

async function getPageSnapshot(window) {
  return withTimeout(window.webContents.executeJavaScript(`(() => ({
    title: document.title,
    readyState: document.readyState,
    bodyText: (document.body?.innerText ?? '').trim().slice(0, 1200),
    roots: ['app-root', '#app', '#root', 'main', 'form'].map((selector) => ({
      selector,
      count: document.querySelectorAll(selector).length
    })),
    forms: [...document.forms].map((form) => ({
      id: form.id || null,
      fields: [...form.elements].filter((field) => field instanceof HTMLInputElement).map((field) => ({
        type: field.type,
        name: field.name || null,
        autocomplete: field.autocomplete || null,
        valuePresent: field.value.length > 0
      }))
    })),
    extensionScripts: [...document.querySelectorAll('script[src]')]
      .map((script) => script.src)
      .filter((src) => src.startsWith('chrome-extension://'))
      .slice(0, 20),
    extensionStylesheets: [...document.querySelectorAll('link[rel=stylesheet]')]
      .map((link) => link.href)
      .filter((href) => href.startsWith('chrome-extension://'))
      .slice(0, 20)
  }))()`, true), 10000, 'read page snapshot')
}

async function inspectPageContentScript() {
  report.page = { loaded: false, contentScriptContext: null, snapshot: null, targetDiscoveryError: null }
  try {
    await withTimeout(pageWindow.loadURL(pageURL), 10000, 'load inert test page')
    report.page.loaded = true
    await delay(1500)
    report.page.snapshot = await getPageSnapshot(pageWindow)
    if (report.manifest?.name === 'Bramble') {
      const probeId = `surffish-webauthn-${Date.now()}`
      const probeExpression = `(() => {
        const credentials = navigator.credentials;
        const isJavaScriptOverride = (method) => typeof method === 'function' && !Function.prototype.toString.call(method).includes('[native code]');
        const state = {
          credentialsAvailable: !!credentials,
          createOverridden: isJavaScriptOverride(credentials?.create),
          getOverridden: isJavaScriptOverride(credentials?.get),
          relayResult: null
        };
        globalThis.__surffishBrambleWebAuthnProbe = state;
        const id = ${JSON.stringify(probeId)};
        const listener = (event) => {
          if (event.source !== window || event.data?.__bramble_pk !== 'res' || event.data?.id !== id) return;
          state.relayResult = event.data.result ?? null;
          window.removeEventListener('message', listener);
        };
        window.addEventListener('message', listener);
        window.postMessage({ __bramble_pk: 'req', id, method: 'get', payload: {} }, location.origin);
        return true;
      })()`
      await withTimeout(pageWindow.webContents.executeJavaScript(probeExpression, true), 5000, 'start Bramble WebAuthn bridge probe')
      let bridgeProbe = null
      for (let attempt = 0; attempt < 60; attempt += 1) {
        bridgeProbe = await pageWindow.webContents.executeJavaScript('globalThis.__surffishBrambleWebAuthnProbe ?? null', true)
        if (bridgeProbe?.relayResult) break
        await delay(50)
      }
      report.page.brambleWebAuthnBridge = bridgeProbe ?? { error: 'The page did not expose the bridge probe result.' }
      if (!bridgeProbe?.relayResult) report.page.brambleWebAuthnBridge.relayTimeout = true
    }
  } catch (error) {
    report.page.error = error instanceof Error ? error.message : String(error)
    return
  }

  const debuggerSession = pageWindow.webContents.debugger
  try {
    debuggerSession.attach('1.3')
    pageDebuggerAttached = true
    debuggerSession.on('message', (_event, method, params) => {
      if (method !== 'Runtime.executionContextCreated') return
      const context = params?.context
      if (context) {
        extensionContexts.push({
          id: context.id,
          origin: context.origin ?? '',
          name: context.name ?? '',
          isDefault: context.auxData?.isDefault === true
        })
      }
    })
    await withTimeout(debuggerSession.sendCommand('Runtime.enable'), 5000, 'enable renderer Runtime domain')
    try {
      await withTimeout(debuggerSession.sendCommand('Target.setDiscoverTargets', { discover: true }), 5000, 'enable target discovery')
    } catch (error) {
      report.page.targetDiscoveryError = error instanceof Error ? error.message : String(error)
    }
    await delay(100)

    const pageContext = extensionContexts.find((context) => context.isDefault)
    const defaultPageApis = pageContext
      ? await evaluateInDebugger(debuggerSession, extensionContextExpression(), pageContext.id)
      : null
    const matchingContexts = extensionContexts.filter((context) =>
      context.origin.includes(extension.id) || context.name.includes(extension.id)
    )
    const matchingEvaluation = []
    for (const context of matchingContexts) {
      try {
        matchingEvaluation.push({
          origin: context.origin,
          name: context.name,
          apis: await evaluateInDebugger(debuggerSession, extensionContextExpression(), context.id)
        })
      } catch (error) {
        matchingEvaluation.push({
          origin: context.origin,
          name: context.name,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
    report.page.contentScriptContext = {
      injectedIsolatedWorldCount: matchingContexts.length,
      worlds: matchingEvaluation,
      pageMainWorld: defaultPageApis
    }
  } catch (error) {
    report.page.debuggerError = error instanceof Error ? error.message : String(error)
  }
}

function apiPresenceExpression() {
  return `(() => {
    const c = globalThis.chrome ?? {};
    const has = (value) => typeof value === 'function';
    return {
      runtime: has(c.runtime?.getManifest),
      runtimeMessaging: has(c.runtime?.sendMessage),
      storageLocal: has(c.storage?.local?.get),
      storageSession: has(c.storage?.session?.get),
      storageSync: has(c.storage?.sync?.get),
      storageManaged: has(c.storage?.managed?.get),
      storageOnChanged: has(c.storage?.onChanged?.addListener),
      alarms: has(c.alarms?.create) && has(c.alarms?.get) && has(c.alarms?.clear),
      idle: has(c.idle?.queryState),
      offscreen: has(c.offscreen?.createDocument) && has(c.offscreen?.closeDocument),
      identity: has(c.identity?.getAuthToken),
      webAuthenticationProxy: typeof c.webAuthenticationProxy !== 'undefined',
      webNavigation: has(c.webNavigation?.getAllFrames) && has(c.webNavigation?.onCompleted?.addListener),
      webRequest: has(c.webRequest?.onBeforeRequest?.addListener),
      webRequestAuthProvider: has(c.webRequest?.onAuthRequired?.addListener),
      contextMenus: has(c.contextMenus?.create),
      notifications: has(c.notifications?.create),
      commands: has(c.commands?.getAll) && has(c.commands?.onCommand?.addListener),
      scripting: has(c.scripting?.executeScript),
      scriptingRegisterContentScripts: has(c.scripting?.registerContentScripts),
      scriptingUnregisterContentScripts: has(c.scripting?.unregisterContentScripts),
      tabsGetCurrent: has(c.tabs?.getCurrent),
      tabsOnUpdated: has(c.tabs?.onUpdated?.addListener),
      tabsOnActivated: has(c.tabs?.onActivated?.addListener),
      webNavigationOnCommitted: has(c.webNavigation?.onCommitted?.addListener),
      webNavigationOnCompleted: has(c.webNavigation?.onCompleted?.addListener),
      webNavigationGetAllFrames: has(c.webNavigation?.getAllFrames),
      webRequestOnCompleted: has(c.webRequest?.onCompleted?.addListener),
      sidePanel: has(c.sidePanel?.open) && has(c.sidePanel?.setOptions),
      permissions: has(c.permissions?.request),
      nativeMessaging: has(c.runtime?.connectNative) && has(c.runtime?.sendNativeMessage),
      tabs: has(c.tabs?.query) && has(c.tabs?.sendMessage),
      browserNamespace: typeof globalThis.browser !== 'undefined'
    };
  })()`
}

async function inspectBackgroundTargets() {
  report.backgroundTargets = webContents.getAllWebContents()
    .map((contents) => ({ id: contents.id, type: contents.getType(), url: contents.getURL() }))
    .filter((contents) => contents.url.startsWith(extension.url))
    .map(({ id, type, url }) => ({ id, type, url: url.slice(0, 400) }))

  if (!pageDebuggerAttached) return
  const debuggerSession = pageWindow.webContents.debugger
  let targets
  try {
    targets = await withTimeout(debuggerSession.sendCommand('Target.getTargets'), 5000, 'list extension DevTools targets')
  } catch (error) {
    report.serviceWorkerProbe = { error: `Target.getTargets failed: ${error instanceof Error ? error.message : String(error)}` }
    return
  }
  report.backgroundTargets.push(...(targets.targetInfos ?? [])
    .filter((target) => target.url.startsWith(extension.url) && ['service_worker', 'background_page'].includes(target.type))
    .map((target) => ({ type: target.type, title: target.title, url: target.url.slice(0, 400), targetId: target.targetId })))

  const workerTarget = (targets.targetInfos ?? []).find((target) =>
    target.type === 'service_worker' && target.url.startsWith(extension.url)
  )
  if (!workerTarget) {
    report.serviceWorkerProbe = { available: false, reason: 'No extension service_worker target was exposed by the renderer DevTools Protocol session.' }
    return
  }

  let attachedSessionId
  try {
    const attached = await withTimeout(debuggerSession.sendCommand('Target.attachToTarget', {
      targetId: workerTarget.targetId,
      flatten: true
    }), 5000, 'attach to service worker')
    attachedSessionId = attached.sessionId
    await withTimeout(debuggerSession.sendCommand('Runtime.enable', {}, attachedSessionId), 5000, 'enable service-worker Runtime domain')
    const apiPresence = await evaluateInDebugger(debuggerSession, apiPresenceExpression(), undefined, attachedSessionId)
    const storageProbeExpression = `(() => new Promise(async (resolve) => {
      const key = '__surffish_runtime_probe_${Date.now()}';
      const result = { storageLocalRoundTrip: null, storageOnChangedEvent: null, storageSessionRoundTrip: null, errors: [] };
      const local = globalThis.chrome?.storage?.local;
      if (local && typeof local.set === 'function' && typeof local.get === 'function') {
        let changed = false;
        const listener = (changes, areaName) => { if (areaName === 'local' && Object.prototype.hasOwnProperty.call(changes, key)) changed = true; };
        try {
          chrome.storage.onChanged?.addListener(listener);
          await local.set({ [key]: 'inert-probe-value' });
          const values = await local.get(key);
          await new Promise((done) => setTimeout(done, 150));
          result.storageLocalRoundTrip = values?.[key] === 'inert-probe-value';
          result.storageOnChangedEvent = changed;
        } catch (error) { result.errors.push('storage.local: ' + String(error)); }
        finally {
          chrome.storage.onChanged?.removeListener(listener);
          try { await local.remove(key); } catch {}
        }
      }
      const session = globalThis.chrome?.storage?.session;
      if (session && typeof session.set === 'function' && typeof session.get === 'function') {
        try {
          await session.set({ [key]: 'inert-probe-value' });
          const values = await session.get(key);
          result.storageSessionRoundTrip = values?.[key] === 'inert-probe-value';
          await session.remove(key);
        } catch (error) { result.errors.push('storage.session: ' + String(error)); }
      }
      resolve(result);
    }))()`
    const storage = await evaluateInDebugger(debuggerSession, storageProbeExpression, undefined, attachedSessionId)
    report.serviceWorkerProbe = {
      available: true,
      targetType: workerTarget.type,
      apiPresence,
      storageBehavior: storage
    }
  } catch (error) {
    report.serviceWorkerProbe = {
      available: true,
      targetType: workerTarget.type,
      error: error instanceof Error ? error.message : String(error)
    }
  } finally {
    if (attachedSessionId) {
      try {
        await debuggerSession.sendCommand('Target.detachFromTarget', { sessionId: attachedSessionId })
      } catch {}
    }
  }
}

function snapshotServiceWorkers() {
  try {
    const running = browserSession.serviceWorkers.getAllRunning()
    report.serviceWorkerLifecycle.runningWorkers = Object.entries(running)
      .map(([versionId, info]) => ({
        versionId: Number(versionId),
        scope: info.scope,
        scriptUrl: info.scriptUrl,
        renderProcessId: info.renderProcessId
      }))
      .filter((worker) => extension?.url && worker.scriptUrl.startsWith(extension.url))
  } catch (error) {
    report.serviceWorkerLifecycle.snapshotError = error instanceof Error ? error.message : String(error)
  }
}

async function inspectExtensionPage(path, pageKind) {
  if (!path) return { declared: false, loaded: false }
  const window = openWindow()
  if (pageKind === 'popup') popupWindow = window
  else optionsWindow = window
  const url = new URL(path, extension.url).toString()
  const result = { declared: true, path, loaded: false, url, snapshot: null, error: null }
  try {
    await withTimeout(window.loadURL(url), 10000, `load extension ${pageKind}`)
    result.loaded = true
    await delay(1200)
    result.snapshot = await getPageSnapshot(window)
    result.runtimeApis = await withTimeout(window.webContents.executeJavaScript(apiPresenceExpression(), true), 8000, `read ${pageKind} API presence`).catch((error) => ({ error: String(error) }))
    if (testOnlyWebNavigationShim && pageKind === 'popup') {
      result.testShimStatus = await withTimeout(window.webContents.executeJavaScript(
        `globalThis.chrome.runtime.sendMessage({ __surffishProbe: 'webNavigationListenerShim' })`, true
      ), 8000, 'query test-only webNavigation shim').catch((error) => ({ error: String(error) }))
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
  }
  return result
}

async function waitForReadyExtension(extensionId, readyExtensionIds, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  while (!readyExtensionIds.has(extensionId) && Date.now() < deadline) {
    await delay(50)
  }
  report.extensionReady = readyExtensionIds.has(extensionId)
}

async function run() {
  progress('waiting for Electron app readiness')
  await app.whenReady()
  prepareTestOnlyWebNavigationShim()
  progress('Electron app ready')
  const readyExtensionIds = new Set()
  browserSession = session.fromPartition(`persist:surffish-real-extension-${Date.now()}`)
  browserSession.serviceWorkers.on('registration-completed', (_event, details) => {
    if (report.serviceWorkerLifecycle.registrations.length < 50) {
      report.serviceWorkerLifecycle.registrations.push({ scope: details.scope })
    }
  })
  browserSession.serviceWorkers.on('running-status-changed', (event) => {
    const details = event?.details ?? event
    if (report.serviceWorkerLifecycle.statusChanges.length < 100) {
      report.serviceWorkerLifecycle.statusChanges.push({
        versionId: details?.versionId ?? null,
        runningStatus: details?.runningStatus ?? null
      })
    }
  })
  browserSession.serviceWorkers.on('console-message', (_event, details) => {
    if (details?.level >= 2 && report.serviceWorkerLifecycle.consoleErrors.length < 100) {
      report.serviceWorkerLifecycle.consoleErrors.push({
        message: String(details.message ?? '').slice(0, 600),
        source: details.source ?? null,
        sourceUrl: String(details.sourceUrl ?? '').slice(0, 400),
        lineNumber: details.lineNumber ?? null,
        level: details.level
      })
    }
  })
  browserSession.extensions.on('extension-ready', (_event, readyExtension) => {
    readyExtensionIds.add(readyExtension.id)
  })

  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(`<!doctype html><html><head><meta charset="utf-8"><title>Surffish Inert Login Form</title></head><body>
      <main><h1>Inert compatibility test page</h1><form autocomplete="on">
        <label>Username <input type="text" name="username" autocomplete="username"></label>
        <label>Password <input type="password" name="password" autocomplete="current-password"></label>
        <button type="button">No-op sign-in</button>
      </form></main></body></html>`)
  })
  await new Promise((resolveServer, rejectServer) => {
    server.once('error', rejectServer)
    server.listen(0, '127.0.0.1', resolveServer)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  pageURL = `http://127.0.0.1:${address.port}/`
  allowedOrigin = new URL(pageURL).origin
  report.networkPolicy = `Only ${allowedOrigin} is allowed; all other HTTP(S)/WebSocket requests are cancelled.`
  const externalOrigins = new Set()
  progress('loopback fixture ready; network block attached')
  browserSession.webRequest.onBeforeRequest({
    urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*']
  }, (details, callback) => {
    let origin = 'unparseable-url'
    try { origin = new URL(details.url).origin } catch {}
    const allowed = origin === allowedOrigin
    if (!allowed) {
      externalOrigins.add(origin)
      report.blockedRequestCount += 1
      if (report.blockedRequests.length < blockedRequestLimit) {
        report.blockedRequests.push({ origin, resourceType: details.resourceType ?? null, method: details.method ?? null })
      }
    }
    callback({ cancel: !allowed })
  })

  try {
    progress('loading extension')
    extension = await withTimeout(browserSession.extensions.loadExtension(loadedExtensionDirectory), 20000, 'load unpacked extension')
    report.extensionLoaded = true
    report.extension = { id: extension.id, name: extension.name, version: extension.version, url: extension.url }
    progress('extension loaded; waiting for extension-ready')
    await waitForReadyExtension(extension.id, readyExtensionIds)
    progress(`extension-ready=${report.extensionReady}`)
  } catch (error) {
    report.loadError = error instanceof Error ? error.message : String(error)
  }

  if (extension) {
    snapshotServiceWorkers()
    progress('opening inert page for content-script probe')
    pageWindow = openWindow()
    pageWindow.webContents.debugger.on('message', (_event, method, params) => {
      if (method === 'Runtime.exceptionThrown' && report.consoleErrors.length < consoleLimit) {
        recordConsoleError({ type: 'exception', level: 2, message: params?.exceptionDetails?.text ?? 'Runtime exception', url: params?.exceptionDetails?.url })
      }
    })
    await inspectPageContentScript()
    report.page.extensionInstalled = true

    progress('opening extension popup')
    report.popup = await inspectExtensionPage(report.manifest.actionPopup, 'popup')
    progress('checking options declaration')
    report.options = await inspectExtensionPage(report.manifest.optionsPage, 'options')
    await delay(500)
    snapshotServiceWorkers()
    progress('inspecting extension background targets')
    await inspectBackgroundTargets()
  }

  report.blockedOrigins = [...externalOrigins].sort()
  report.webContents = webContents.getAllWebContents().map((contents) => ({
    id: contents.id,
    type: contents.getType(),
    url: contents.getURL().slice(0, 400)
  })).filter((contents) => extension?.url && contents.url.startsWith(extension.url))
  snapshotServiceWorkers()
  progress('diagnostics complete')

}

async function cleanup() {
  if (pageDebuggerAttached && pageWindow && !pageWindow.isDestroyed()) {
    try { pageWindow.webContents.debugger.detach() } catch {}
  }
  for (const window of [popupWindow, optionsWindow, pageWindow]) {
    if (window && !window.isDestroyed()) window.destroy()
  }
  if (extension && browserSession) {
    try {
      browserSession.extensions.removeExtension(extension.id)
      report.cleanup = { extensionUnloaded: browserSession.extensions.getExtension(extension.id) === null }
    } catch (error) {
      report.cleanup = { extensionUnloaded: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
  report.cleanup ??= { extensionUnloaded: !extension }
  if (server) {
    server.closeAllConnections?.()
    await withTimeout(new Promise((resolveServer) => server.close(resolveServer)), 5000, 'stop loopback fixture').catch((error) => {
      report.cleanup.serverCloseError = error instanceof Error ? error.message : String(error)
    })
  }
  try {
    rmSync(userDataDirectory, { recursive: true, force: true })
    userDataRemoved = true
  } catch {}
  if (report.cleanup) report.cleanup.temporaryUserDataRemoved = userDataRemoved
}

run().catch((error) => {
  report.harnessError = error instanceof Error ? error.stack ?? error.message : String(error)
  process.exitCode = 1
}).finally(async () => {
  await cleanup()
  console.log(`SURFFISH_REAL_EXTENSION_PROBE_REPORT=${JSON.stringify(report)}`)
  console.log('This is a compatibility observation only. It did not sign in, import a vault, or fill any credentials.')
  if (app.isReady()) app.quit()
})
