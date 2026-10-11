// Offline Electron smoke test for Surffish's full ad-filter engine.
// Uses the production wiring (out/main/adblock-engine.js) and the real sandboxed
// frame preload, against a loopback server. Run `bun run build` first.
//
// Verifies: network blocking + exceptions, site-specific and generic cosmetic
// hiding (incl. nodes added after load), scriptlets running *before* the page's
// own inline scripts, scriptlets in iframes, `%` in scriptlet args, and the
// per-site "allow ads" switch.
const assert = require('node:assert/strict')
const { existsSync, mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { createServer } = require('node:http')
const { app, BrowserWindow, session } = require('electron')

const root = resolve(__dirname, '..')
const enginePath = join(root, 'out/main/adblock-engine.js')
const preloadPath = join(root, 'out/preload/adblock-frame.cjs')

const RESOURCES = JSON.stringify({
  redirects: [],
  scriptlets: [{
    name: 'surffish-record.js',
    aliases: [],
    body: 'function surffishRecord(name, value) { window[name] = value === undefined ? true : value }',
    dependencies: []
  }, {
    // Like uBO's JSONPath helper: a top-level class shared by several scriptlets.
    name: 'surffish-helper.fn',
    aliases: [],
    body: 'class SurffishHelper { static mark(name) { window[name] = true } }',
    dependencies: []
  }, {
    name: 'surffish-class.js',
    aliases: [],
    body: 'function surffishClass(name) { SurffishHelper.mark(name) }',
    dependencies: ['surffish-helper.fn']
  }]
})

const requests = []
let server
let window
let detach

function page(body, head = '') {
  return `<!doctype html><html><head><script>window.__flagBeforePageScripts = window.surffishEarly === 'yes'</script>${head}</head><body>${body}</body></html>`
}

async function run() {
  for (const file of [enginePath, preloadPath]) {
    if (!existsSync(file)) throw new Error(`Missing ${file}; run \`bun run build\` first.`)
  }
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'surffish-adblock-smoke-')))
  await app.whenReady()

  server = createServer((request, response) => {
    requests.push(`${request.headers.host}${request.url}`)
    const html = (body) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(body)
    }
    if (request.url === '/page') {
      return html(page(
        '<div class="ad-banner" id="site-ad">site ad</div><div class="generic-ad">generic ad</div><p id="content">content</p><iframe id="child" src="/frame"></iframe>',
        '<script src="/blocked.js"></script><script src="/allowed.js"></script>'
      ))
    }
    if (request.url === '/frame') return html(page('<p>frame</p>'))
    if (request.url === '/blocked.js' || request.url === '/allowed.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      return response.end(request.url === '/blocked.js' ? 'window.blockedLoaded = true' : 'window.allowedLoaded = true')
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const { port } = server.address()

  const engineModule = await import(pathToFileURL(enginePath).href)
  const lists = {
    'https://fixture.invalid/main.txt': [
      `||127.0.0.1:${port}/blocked.js$script`,
      `||localhost:${port}/blocked.js$script`,
      `@@||127.0.0.1:${port}/allowed.js$script`,
      '127.0.0.1##.ad-banner',
      'localhost##.ad-banner',
      '##.generic-ad',
      '##.late-generic-ad',
      '127.0.0.1##+js(surffish-record, surffishEarly, yes)',
      'localhost##+js(surffish-record, surffishEarly, yes)',
      '127.0.0.1##+js(surffish-record, surffishPercent, 50%)',
      '127.0.0.1##+js(surffish-class, surffishClassOne)',
      '127.0.0.1##+js(surffish-class, surffishClassTwo)'
    ].join('\n'),
    'https://fixture.invalid/quick.txt': '! quick fixes',
    'https://fixture.invalid/easylist.txt': '! easylist'
  }
  const fixtureFetch = async (url) => {
    if (url.endsWith('/resources.json')) return new Response(RESOURCES)
    if (lists[url] !== undefined) return new Response(lists[url])
    return new Response('missing', { status: 404 })
  }
  const { engine } = await engineModule.buildFilterEngine(fixtureFetch, [
    { id: 'ublock-filters', url: 'https://fixture.invalid/main.txt' },
    { id: 'ublock-quick-fixes', url: 'https://fixture.invalid/quick.txt' },
    { id: 'easylist', url: 'https://fixture.invalid/easylist.txt' }
  ])

  const browserSession = session.fromPartition('surffish-adblock-smoke')
  let frameStarts = 0
  detach = engineModule.attachAdblockToSession(browserSession, {
    getEngine: () => engine,
    pageUrlForRequest: (details) => details.resourceType === 'mainFrame' ? details.url : (details.referrer || ''),
    // The per-site switch: ads allowed on localhost only.
    isBlockingDisabledForPage: (pageUrl) => {
      try { return new URL(pageUrl).hostname === 'localhost' } catch { return false }
    },
    onFrameStart: () => { frameStarts += 1 }
  }, preloadPath)

  window = new BrowserWindow({
    show: false,
    webPreferences: {
      session: browserSession,
      contextIsolation: true,
      sandbox: true,
      nodeIntegrationInSubFrames: true,
      // Headless Linux without a display server: SURFFISH_OFFSCREEN=1 with --ozone-platform=headless.
      offscreen: process.env.SURFFISH_OFFSCREEN === '1'
    }
  })

  const evaluate = (code) => window.webContents.executeJavaScript(code)
  const waitFor = async (code, timeout = 5000) => {
    const deadline = Date.now() + timeout
    let value
    do {
      value = await evaluate(code)
      if (value) return value
      await new Promise((r) => setTimeout(r, 25))
    } while (Date.now() < deadline)
    return value
  }

  // ---- Blocking on (127.0.0.1) ----
  await window.loadURL(`http://127.0.0.1:${port}/page`)
  await waitFor('window.allowedLoaded === true')
  await evaluate(`(() => { const d = document.createElement('div'); d.className = 'late-generic-ad'; d.id = 'late'; d.textContent = 'late'; document.body.appendChild(d) })()`)
  await waitFor(`getComputedStyle(document.getElementById('late')).display === 'none'`, 3000)
  const on = await evaluate(`({
    allowed: window.allowedLoaded === true,
    blocked: window.blockedLoaded === true,
    early: window.__flagBeforePageScripts === true,
    percent: window.surffishPercent,
    sharedHelpers: window.surffishClassOne === true && window.surffishClassTwo === true,
    siteAdHidden: getComputedStyle(document.getElementById('site-ad')).display === 'none',
    genericAdHidden: getComputedStyle(document.querySelector('.generic-ad')).display === 'none',
    lateAdHidden: getComputedStyle(document.getElementById('late')).display === 'none',
    contentVisible: getComputedStyle(document.getElementById('content')).display !== 'none'
  })`)
  const frameEarly = await waitFor(`(() => { try { return document.getElementById('child').contentWindow.__flagBeforePageScripts === true } catch { return false } })()`, 3000)

  assert.equal(on.allowed, true, 'the excepted script should load and run')
  assert.equal(on.blocked, false, 'the matching script should not run')
  assert.ok(!requests.includes(`127.0.0.1:${port}/blocked.js`), 'the blocked request must not reach the server')
  assert.equal(on.early, true, 'scriptlets must run before the page\'s first inline script')
  assert.equal(on.percent, '50%', 'a literal % in scriptlet args must survive decodeURIComponent')
  assert.equal(on.sharedHelpers, true, 'scriptlets sharing a top-level class helper must not collide')
  assert.equal(on.siteAdHidden, true, 'site-specific cosmetic rule should hide the element')
  assert.equal(on.genericAdHidden, true, 'generic cosmetic rule should hide matching DOM')
  assert.equal(on.lateAdHidden, true, 'generic rules should apply to nodes added after load')
  assert.equal(on.contentVisible, true, 'unrelated content must stay visible')
  assert.equal(frameEarly, true, 'scriptlets should also run early inside iframes')

  // ---- Blocking off for this site (localhost) ----
  await window.loadURL(`http://localhost:${port}/page`)
  await waitFor('window.allowedLoaded === true')
  await new Promise((r) => setTimeout(r, 200))
  const off = await evaluate(`({
    blocked: window.blockedLoaded === true,
    early: window.__flagBeforePageScripts === true,
    siteAdHidden: getComputedStyle(document.getElementById('site-ad')).display === 'none'
  })`)
  assert.equal(off.blocked, true, 'with ads allowed for the site, the script should load')
  assert.equal(off.early, false, 'with ads allowed for the site, no scriptlets should run')
  assert.equal(off.siteAdHidden, false, 'with ads allowed for the site, nothing should be hidden')

  console.log('Electron ad-filter smoke test passed:', JSON.stringify({ on, frameEarly, off, frameStarts }))
}

async function cleanup() {
  try { detach?.() } catch {}
  if (window && !window.isDestroyed()) window.destroy()
  if (server) {
    server.closeAllConnections?.()
    await new Promise((r) => server.close(r))
  }
  if (app.isReady()) app.quit()
}

run().then(cleanup).catch(async (error) => {
  console.error('Electron ad-filter smoke test failed:', error)
  process.exitCode = 1
  await cleanup()
})
