require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { mkdtempSync } = require('node:fs')
const { removeProfile } = require('./smoke-profile.cjs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { app, BrowserWindow, session } = require('electron')

const fixtureRoot = join(__dirname, 'fixtures', 'extension-probes')
const allCases = [
  { name: 'chromium-mv2', expected: 'documented baseline; must pass' },
  { name: 'bitwarden-mv2', expected: 'observational; Bitwarden-like API permissions and action UI' },
  { name: 'chromium-mv3', expected: 'observational; MV3 service-worker support is not documented' },
  { name: 'firefox-mv3', expected: 'observational; this tests Firefox package rejection/partial parsing in a Chromium host' }
]
const requestedCase = process.argv[2]
const cases = requestedCase ? allCases.filter((probeCase) => probeCase.name === requestedCase) : allCases
if (requestedCase && cases.length === 0) {
  console.error(`Unknown extension probe case: ${requestedCase}`)
  process.exit(2)
}
const report = {
  electronVersion: process.versions.electron,
  chromiumVersion: process.versions.chrome,
  fixtureOnly: true,
  ok: false,
  cases: []
}

let server
let pageURL
let userDataDirectory
const openWindows = new Set()

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitForPageValue(webContents, expression, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const value = await webContents.executeJavaScript(expression)
      if (value) return value
    } catch {
      // The page may still be committing its first navigation.
    }
    await delay(50)
  }
  return null
}

function openWindow(options) {
  const window = new BrowserWindow({
    show: false,
    width: 600,
    height: 400,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      ...options
    }
  })
  openWindows.add(window)
  window.once('closed', () => openWindows.delete(window))
  return window
}

async function runCase(probeCase) {
  const extensionDirectory = join(fixtureRoot, probeCase.name)
  const partition = `persist:surffish-extension-probe-${probeCase.name}-${Date.now()}`
  const browserSession = session.fromPartition(partition)
  const readyExtensionIds = new Set()
  browserSession.extensions.on('extension-ready', (_event, readyExtension) => {
    readyExtensionIds.add(readyExtension.id)
  })

  const result = {
    name: probeCase.name,
    expected: probeCase.expected,
    loaded: false,
    extensionReadyEvent: false,
    pageLoaded: false,
    contentScriptMarker: null,
    mainWorldMarker: null,
    contentScriptReply: null,
    popupLoaded: null,
    loadError: null,
    pageError: null,
    popupError: null
  }
  let extension
  let pageWindow
  let popupWindow

  try {
    extension = await browserSession.extensions.loadExtension(extensionDirectory)
    result.loaded = true
    result.extensionId = extension.id
    result.manifestVersion = extension.manifest?.manifest_version ?? null
    result.manifestName = extension.name
    result.loadedExtensionCount = browserSession.extensions.getAllExtensions().length
    result.extensionReadyEvent = readyExtensionIds.has(extension.id)

    pageWindow = openWindow({ session: browserSession })
    await pageWindow.loadURL(pageURL)
    result.pageLoaded = true

    if (probeCase.name === 'firefox-mv3') {
      const firefoxProbe = await waitForPageValue(
        pageWindow.webContents,
        'document.documentElement.dataset.surffishFirefoxProbe || null'
      )
      result.mainWorldMarker = await waitForPageValue(
        pageWindow.webContents,
        'document.documentElement.dataset.surffishFirefoxMainWorld || null'
      )
      if (firefoxProbe) {
        try {
          result.contentScriptReply = JSON.parse(firefoxProbe)
          result.contentScriptMarker = result.contentScriptReply.browserNamespace ? 'browser-namespace-present' : 'browser-namespace-missing'
        } catch (error) {
          result.pageError = `Firefox-shape content script returned invalid JSON: ${String(error)}`
        }
      }
    } else {
      const serialized = await waitForPageValue(
        pageWindow.webContents,
        'document.documentElement.dataset.surffishExtensionProbe || null'
      )
      if (serialized) {
        try {
          result.contentScriptReply = JSON.parse(serialized)
        } catch (error) {
          result.pageError = `Content script returned invalid JSON: ${String(error)}`
        }
      }
    }
    result.extensionReadyEvent = readyExtensionIds.has(extension.id)

    const manifestAction = extension.manifest?.action || extension.manifest?.browser_action
    const popupPath = manifestAction?.default_popup
    if (popupPath) {
      popupWindow = openWindow({ session: browserSession })
      const extensionBaseURL = extension.url.endsWith('/') ? extension.url : `${extension.url}/`
      try {
        await popupWindow.loadURL(`${extensionBaseURL}${popupPath}`)
        result.popupLoaded = await waitForPageValue(
          popupWindow.webContents,
          'document.documentElement.dataset.surffishPopupLoaded || null',
          3000
        ) === 'true'
      } catch (error) {
        result.popupError = error instanceof Error ? error.message : String(error)
        result.popupLoaded = false
      }
    }
  } catch (error) {
    result.loadError = error instanceof Error ? error.message : String(error)
  } finally {
    if (popupWindow && !popupWindow.isDestroyed()) popupWindow.destroy()
    if (pageWindow && !pageWindow.isDestroyed()) pageWindow.destroy()
    if (extension) {
      try {
        browserSession.extensions.removeExtension(extension.id)
        result.unloaded = browserSession.extensions.getExtension(extension.id) === null
      } catch (error) {
        result.unloadError = error instanceof Error ? error.message : String(error)
      }
    }
  }

  return result
}

async function run() {
  userDataDirectory = mkdtempSync(join(tmpdir(), 'surffish-extension-probe-'))
  app.setPath('userData', userDataDirectory)
  app.disableHardwareAcceleration()
  await app.whenReady()

  server = createServer((_request, response) => {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    })
    response.end('<!doctype html><html><head><meta charset="utf-8"><title>Extension Probe Host</title></head><body><main>Loopback extension test fixture</main></body></html>')
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  pageURL = `http://127.0.0.1:${address.port}/`

  for (const probeCase of cases) {
    report.cases.push(await runCase(probeCase))
  }

  const baseline = report.cases.find((item) => item.name === 'chromium-mv2')
  for (const item of report.cases) {
    item.apiPresence = item.contentScriptReply?.apis ?? null
  }
  if (baseline) {
    assert.ok(baseline.loaded, `Electron must load the documented MV2 fixture: ${baseline.loadError || 'no extension returned'}`)
    assert.equal(baseline.pageLoaded, true, 'MV2 test page should load on the persistent extension session')
    assert.ok(baseline.contentScriptReply, 'MV2 content script should publish its probe result')
    assert.equal(baseline.contentScriptReply?.backgroundReply, true, `MV2 content script must reach its background page: ${baseline.contentScriptReply?.backgroundError || 'no background reply'}`)
    assert.equal(baseline.contentScriptReply?.background?.backgroundKind, 'background-page')
    assert.equal(baseline.contentScriptReply?.background?.storageLocalRoundTrip, true, 'documented chrome.storage.local should also work from the MV2 background page')
    assert.equal(baseline.contentScriptReply?.storageLocalRoundTrip, true, 'documented chrome.storage.local should complete a set/get round trip from a content script')
    assert.equal(baseline.popupLoaded, true, `MV2 popup document must render: ${baseline.popupError || 'no popup readiness marker'}`)
    assert.equal(baseline.unloaded, true, 'the runtime should remove a test extension from its session')
  }

  report.ok = true
  console.log(`SURFFISH_EXTENSION_PROBE_REPORT=${JSON.stringify(report)}`)
  console.log(`Electron extension probe ${requestedCase || 'matrix'} completed. MV3 and Firefox-shape outcomes are observations, not support claims.`)
}

async function cleanup() {
  for (const window of openWindows) {
    if (!window.isDestroyed()) window.destroy()
  }
  if (server) {
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
  }
  if (app.isReady()) app.quit()
  if (userDataDirectory) removeProfile(userDataDirectory)
}

run().then(cleanup).catch(async (error) => {
  report.ok = false
  report.error = error instanceof Error ? error.message : String(error)
  console.error('Electron extension compatibility probe failed:', error)
  console.log(`SURFFISH_EXTENSION_PROBE_REPORT=${JSON.stringify(report)}`)
  process.exitCode = 1
  await cleanup()
  process.exitCode = 1
})
