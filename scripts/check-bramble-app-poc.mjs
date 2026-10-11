import assert from 'node:assert/strict'
import { createHash, createPublicKey, randomBytes, verify as verifySignature } from 'node:crypto'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const sourceDirectory = process.argv[2]
if (!sourceDirectory) {
  console.error('Usage: node scripts/check-bramble-app-poc.mjs <Bramble-dist-firefox-directory>')
  process.exit(2)
}
if (typeof WebSocket === 'undefined') throw new Error('This smoke test requires Node.js with its built-in WebSocket client.')

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const mainEntry = join(repoRoot, 'out', 'main', 'index.js')
const require = createRequire(import.meta.url)
const electronExecutable = require('electron')
const temporaryRoot = mkdtempSync(join(tmpdir(), 'surffish-bramble-app-poc-'))
const userData = join(temporaryRoot, 'profile')
const screenshotPath = process.env.SURFFISH_BRAMBLE_SCREENSHOT ?? '/workspace/bramble-poc-verification.png'
const appOutput = []
const secretsToRedact = []
let child
let mainConnection
let popupConnection
let setupConnection
let browserConnection
let rpConnection
let rpServer
let autofillResults = null

function capture(stream, label) {
  stream?.on('data', (chunk) => {
    appOutput.push(`${label}: ${String(chunk)}`)
    if (appOutput.join('').length > 40_000) appOutput.splice(0, appOutput.length - 20)
  })
}

function redactSecrets(text) {
  return secretsToRedact.reduce((safe, secret) => secret ? safe.split(secret).join('[redacted]') : safe, text)
}

function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new Error('Could not reserve a debug port.'))
      const port = address.port
      server.close((error) => error ? reject(error) : resolvePort(port))
    })
  })
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

async function waitFor(description, operation, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs
  let lastError
  while (Date.now() < end) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`Surffish exited with ${child.exitCode} while waiting for ${description}.`)
    }
    try {
      const value = await operation()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await delay(200)
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError}` : ''}.`)
}

async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl)
  const pending = new Map()
  const executionContexts = []
  let nextId = 1
  await new Promise((resolveOpen, rejectOpen) => {
    const timer = setTimeout(() => rejectOpen(new Error('CDP WebSocket connection timed out.')), 10_000)
    socket.addEventListener('open', () => { clearTimeout(timer); resolveOpen() }, { once: true })
    socket.addEventListener('error', () => { clearTimeout(timer); rejectOpen(new Error('CDP WebSocket connection failed.')) }, { once: true })
  })
  socket.addEventListener('message', (event) => {
    let packet
    try { packet = JSON.parse(String(event.data)) } catch { return }
    if (packet.method === 'Runtime.executionContextCreated' && packet.params?.context) executionContexts.push(packet.params.context)
    if (packet.method === 'Runtime.executionContextDestroyed') {
      const destroyedId = packet.params?.executionContextId
      const index = executionContexts.findIndex((context) => context.id === destroyedId)
      if (index >= 0) executionContexts.splice(index, 1)
    }
    if (packet.id && pending.has(packet.id)) {
      const entry = pending.get(packet.id)
      pending.delete(packet.id)
      clearTimeout(entry.timer)
      if (packet.error) entry.reject(new Error(packet.error.message ?? JSON.stringify(packet.error)))
      else entry.resolve(packet.result ?? {})
    }
  })
  return {
    socket,
    get executionContexts() { return [...executionContexts] },
    send(method, params = {}) {
      const id = nextId++
      return new Promise((resolveCommand, rejectCommand) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          rejectCommand(new Error(`CDP command timed out: ${method}`))
        }, 15_000)
        pending.set(id, { resolve: resolveCommand, reject: rejectCommand, timer })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    async evaluate(expression) {
      const response = await this.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true
      })
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? 'Renderer evaluation failed.')
      return response.result?.value
    },
    close() {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer)
        entry.reject(new Error('CDP connection closed.'))
      }
      pending.clear()
      try { socket.close() } catch {}
    }
  }
}

function getTargets(port) {
  return fetch(`http://127.0.0.1:${port}/json/list`).then(async (response) => {
    if (!response.ok) throw new Error(`DevTools target list returned HTTP ${response.status}.`)
    return response.json()
  })
}

function nodeAttribute(node, name) {
  const attributes = node.attributes ?? []
  for (let index = 0; index < attributes.length; index += 2) {
    if (attributes[index] === name) return attributes[index + 1]
  }
  return undefined
}

function findNode(node, predicate) {
  if (predicate(node)) return node
  const children = [...(node.shadowRoots ?? []), ...(node.children ?? [])]
  if (node.contentDocument) children.push(node.contentDocument)
  for (const child of children) {
    const found = findNode(child, predicate)
    if (found) return found
  }
  return null
}

async function dispatchMouseClick(connection, point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Could not locate the requested visible button.')
  await connection.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
  await connection.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  await connection.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
}

async function clickButtonByText(connection, text) {
  const point = await connection.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((candidate) => {
      const lines = candidate.innerText.trim().split(/\\r?\\n/);
      return lines.length > 0 && lines[0] === ${JSON.stringify(text)};
    });
    if (!button) return null;
    button.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`)
  await dispatchMouseClick(connection, point)
}

async function clickElementBySelector(connection, selector) {
  const point = await connection.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) return null;
    element.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`)
  await dispatchMouseClick(connection, point)
}

async function findVisibleLoginSuggestion(connection, name, username, password) {
  await connection.send('DOM.enable')
  const { root } = await connection.send('DOM.getDocument', { depth: -1, pierce: true })
  const row = findNode(root, (node) => node.nodeName === 'DIV' && typeof nodeAttribute(node, 'data-entry-id') === 'string')
  if (!row?.nodeId) return null
  const resolved = await connection.send('DOM.resolveNode', { nodeId: row.nodeId })
  const inspection = await connection.send('Runtime.callFunctionOn', {
    objectId: resolved.object.objectId,
    functionDeclaration: 'function (expectedName, expectedUsername, expectedPassword) { const text = this.innerText ?? this.textContent ?? ""; return { matches: text.includes(expectedName) && text.includes(expectedUsername), passwordHidden: !text.includes(expectedPassword) }; }',
    arguments: [{ value: name }, { value: username }, { value: password }],
    returnByValue: true
  })
  if (inspection.result?.value?.passwordHidden !== true) throw new Error('Bramble exposed the synthetic password in its visible suggestion row.')
  if (inspection.result?.value?.matches !== true) return null
  const box = await connection.send('DOM.getBoxModel', { nodeId: row.nodeId })
  const border = box.model?.border
  if (!Array.isArray(border) || border.length < 8 || box.model?.width <= 0 || box.model?.height <= 0) return null
  return {
    point: {
      x: (border[0] + border[2] + border[4] + border[6]) / 4,
      y: (border[1] + border[3] + border[5] + border[7]) / 4
    }
  }
}

async function inspectViewport(connection) {
  return connection.evaluate(`(() => {
    const root = document.documentElement;
    const body = document.body;
    const elements = [root, body, ...document.querySelectorAll('*')].filter(Boolean);
    const rootStyle = getComputedStyle(root);
    const bodyStyle = getComputedStyle(body);
    const hasScrollableOverflow = (axis) => {
      const scrollSize = axis === 'x' ? 'scrollWidth' : 'scrollHeight';
      const clientSize = axis === 'x' ? 'clientWidth' : 'clientHeight';
      const overflow = axis === 'x' ? 'overflowX' : 'overflowY';
      return elements.some((element) => {
        const style = getComputedStyle(element);
        return element[scrollSize] > element[clientSize] + 1 && ['auto', 'scroll'].includes(style[overflow]);
      });
    };
    return {
      width: innerWidth,
      height: innerHeight,
      scrollWidth: Math.max(root.scrollWidth, body?.scrollWidth ?? 0),
      scrollHeight: Math.max(root.scrollHeight, body?.scrollHeight ?? 0),
      overflowX: [rootStyle.overflowX, bodyStyle.overflowX],
      overflowY: [rootStyle.overflowY, bodyStyle.overflowY],
      horizontalScrollable: ![rootStyle.overflowX, bodyStyle.overflowX].some((value) => ['hidden', 'clip'].includes(value)) || hasScrollableOverflow('x'),
      verticalScrollable: ![rootStyle.overflowY, bodyStyle.overflowY].some((value) => ['hidden', 'clip'].includes(value)) || hasScrollableOverflow('y')
    };
  })()`)
}

function assertViewportFitsOrScrolls(viewport, name) {
  assert.ok(viewport.scrollWidth <= viewport.width + 1 || viewport.horizontalScrollable, `${name} overflows horizontally without a scroll path: ${JSON.stringify(viewport)}.`)
  assert.ok(viewport.scrollHeight <= viewport.height + 1 || viewport.verticalScrollable, `${name} overflows vertically without a scroll path: ${JSON.stringify(viewport)}.`)
}

async function clickPromptAction(connection, action) {
  await connection.send('DOM.enable')
  const { root } = await connection.send('DOM.getDocument', { depth: -1, pierce: true })
  const button = findNode(root, (node) => node.nodeName === 'BUTTON' && nodeAttribute(node, 'data-tp-action') === action)
  if (!button?.nodeId) throw new Error(`Bramble's closed-shadow passkey prompt did not expose action ${action} to DevTools.`)
  const resolved = await connection.send('DOM.resolveNode', { nodeId: button.nodeId })
  const result = await connection.send('Runtime.callFunctionOn', {
    objectId: resolved.object.objectId,
    functionDeclaration: 'function () { this.click(); return true; }',
    returnByValue: true,
    userGesture: true
  })
  if (result.exceptionDetails || result.result?.value !== true) throw new Error(`Could not click Bramble passkey action ${action}.`)
}

async function stopChild() {
  if (!child || child.exitCode !== null) return
  try {
    if (process.platform === 'linux' && child.pid) process.kill(-child.pid, 'SIGTERM')
    else child.kill('SIGTERM')
  } catch {}
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    delay(5000)
  ])
  if (child.exitCode === null) {
    try {
      if (process.platform === 'linux' && child.pid) process.kill(-child.pid, 'SIGKILL')
      else child.kill('SIGKILL')
    } catch {}
  }
}

try {
  const port = await getFreePort()
  const rpHtml = '<!doctype html><html><head><meta charset="utf-8"><title>Surffish Bramble local passkey RP</title></head><body><main><h1>Local Bramble passkey POC</h1><p id="status">Local-only test relying party; no account or external service.</p></main></body></html>'
  const autofillHtml = '<!doctype html><html><head><meta charset="utf-8"><title>Surffish Bramble local autofill form</title></head><body><main><h1>Local Bramble autofill regression</h1><p id="status">Waiting for local form fill.</p><form id="login-form" method="post" action="/autofill-submit" autocomplete="on"><label for="username">Username</label><input id="username" name="username" type="text" autocomplete="username"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password"><button id="submit-login" type="submit">Submit local form</button></form><script>document.querySelector("#login-form").addEventListener("submit", (event) => { event.preventDefault(); const complete = Boolean(document.querySelector("#username").value && document.querySelector("#password").value); document.querySelector("#status").textContent = complete ? "Local form submission verified." : "Local form is missing credentials."; });</script></main></body></html>'
  let unexpectedFormPosts = 0
  rpServer = createHttpServer((request, response) => {
    if (request.method === 'POST' && (request.url ?? '').startsWith('/autofill')) {
      unexpectedFormPosts += 1
      request.resume()
      response.writeHead(204).end()
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end((request.url ?? '').startsWith('/autofill') ? autofillHtml : rpHtml)
  })
  await new Promise((resolveListen, rejectListen) => {
    rpServer.once('error', rejectListen)
    rpServer.listen(0, '127.0.0.1', resolveListen)
  })
  const rpAddress = rpServer.address()
  if (!rpAddress || typeof rpAddress === 'string') throw new Error('Could not start the local WebAuthn relying-party test server.')
  const rpUrl = `http://localhost:${rpAddress.port}/`
  const autofillUrl = `http://127.0.0.1:${rpAddress.port}/autofill`
  const electronArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userData}`,
    '--no-first-run',
    '--disable-background-networking',
    '--disable-component-update',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
    mainEntry
  ]
  let executable = electronExecutable
  let args = electronArgs
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    executable = '/usr/bin/xvfb-run'
    args = ['-a', electronExecutable, ...electronArgs]
  }
  child = spawn(executable, args, {
    detached: process.platform === 'linux',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      SURFFISH_BRAMBLE_POC_DEV_AUTOLOAD: '1',
      SURFFISH_BRAMBLE_EXTENSION_DIR: resolve(sourceDirectory),
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1'
    }
  })
  capture(child.stdout, 'stdout')
  capture(child.stderr, 'stderr')
  child.once('error', (error) => appOutput.push(`spawn: ${error.message}`))

  await waitFor('Surffish DevTools endpoint', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`)
    return response.ok
  }, 45_000)
  const mainTarget = await waitFor('Surffish renderer target', async () => {
    const targets = await getTargets(port)
    return targets.find((target) => target.type === 'page' && target.url.includes('/out/renderer/index.html'))
  }, 45_000)
  mainConnection = await connectCdp(mainTarget.webSocketDebuggerUrl)
  const browserVersion = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json())
  browserConnection = await connectCdp(browserVersion.webSocketDebuggerUrl)
  const initialState = await waitFor('Bramble extension installation in the Surffish session', async () => {
    const value = await mainConnection.evaluate('window.api?.browser?.bramble?.get ? window.api.browser.bramble.get() : null')
    return value?.installed && !value.loading ? value : null
  }, 30_000)
  assert.equal(initialState.installed, true)

  const brambleAnchor = await waitFor('Bramble toolbar button to mount in the renderer', async () => mainConnection.evaluate(`(() => {
    const button = document.querySelector('.bramble-toolbar-button');
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  })()`), 10_000)
  assert.ok(brambleAnchor && brambleAnchor.width > 0 && brambleAnchor.height > 0)
  await clickElementBySelector(mainConnection, '.bramble-toolbar-button')
  const popupTarget = await waitFor('Bramble popup window opened by Surffish IPC', async () => {
    const targets = await getTargets(port)
    return targets.find((target) => target.type === 'page' && target.url.startsWith('chrome-extension://') && target.url.endsWith('/popup.html'))
  }, 30_000)
  popupConnection = await connectCdp(popupTarget.webSocketDebuggerUrl)
  const popup = await waitFor("Bramble's first-run action popup", async () => {
    const value = await popupConnection.evaluate(`(() => ({
      title: document.title,
      readyState: document.readyState,
      bodyText: document.body?.innerText ?? '',
      rootChildren: document.querySelector('#root')?.children.length ?? 0
    }))()`)
    return value?.readyState === 'complete' && value?.rootChildren > 0 && value?.bodyText.includes('Create your vault') ? value : null
  }, 20_000)
  assert.equal(popup.title, 'Vault')
  const popupViewport = await popupConnection.evaluate('({ width: innerWidth, height: innerHeight })')
  assert.equal(popupViewport.width, 500)
  assert.equal(popupViewport.height, 550)
  const popupLayout = await inspectViewport(popupConnection)
  assertViewportFitsOrScrolls(popupLayout, 'Bramble launcher popup')
  const launcherWindowInfo = await popupConnection.evaluate('({ x: window.screenX, y: window.screenY, width: window.outerWidth, height: window.outerHeight, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight })')
  const mainWindowInfo = await mainConnection.evaluate('({ x: window.screenX, y: window.screenY, width: window.outerWidth, height: window.outerHeight, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight })')
  assert.equal(launcherWindowInfo.width, 500)
  assert.equal(launcherWindowInfo.height, 550)
  assert.equal(launcherWindowInfo.viewportWidth, 500)
  assert.equal(launcherWindowInfo.viewportHeight, 550)
  assert.ok(launcherWindowInfo.y > mainWindowInfo.y + brambleAnchor.y + brambleAnchor.height)
  assert.ok(launcherWindowInfo.y < mainWindowInfo.y + brambleAnchor.y + brambleAnchor.height + 120)
  const popupBridge = await popupConnection.evaluate(`(() => {
    const api = globalThis.browser ?? globalThis.chrome;
    const openOptionsPage = api?.runtime?.openOptionsPage;
    return {
      preloadBridge: typeof globalThis.surffishBramble?.openOptionsPage,
      runtimeMethod: typeof openOptionsPage,
      wrappedForSurffish: typeof openOptionsPage === 'function' && Function.prototype.toString.call(openOptionsPage).includes('brambleBridge'),
      createButton: [...document.querySelectorAll('button')].map((button) => ({ text: button.innerText.trim(), disabled: button.disabled })).find((button) => button.text === 'Create your vault') ?? null
    };
  })()`)
  assert.equal(popupBridge.preloadBridge, 'function')
  assert.equal(popupBridge.runtimeMethod, 'function')
  assert.equal(popupBridge.wrappedForSurffish, true)
  await clickButtonByText(popupConnection, 'Create your vault')
  let setupTarget
  try {
    setupTarget = await waitFor("Bramble's options/setup page to open after Create your vault", async () => {
      const targets = await getTargets(port)
      return targets.find((target) => target.type === 'page' && target.url.startsWith('chrome-extension://') && target.url.includes('/options.html'))
    }, 20_000)
  } catch (error) {
    const targets = (await getTargets(port)).filter((target) => target.type === 'page' && target.url.startsWith('chrome-extension://')).map(({ id, type, url }) => ({ id, type, url }))
    let popupState = null
    try {
      popupState = await popupConnection.evaluate(`(() => ({
        bodyText: document.body?.innerText.slice(0, 500) ?? '',
        button: [...document.querySelectorAll('button')].map((button) => ({ text: button.innerText.trim(), disabled: button.disabled })).find((button) => button.text === 'Create your vault' || button.text === 'Opening…') ?? null
      }))()`)
    } catch (diagnosticError) {
      popupState = { error: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError) }
    }
    throw new Error(`Create your vault did not open Setup/Restore. Bridge: ${JSON.stringify(popupBridge)}; popup: ${JSON.stringify(popupState)}; extension targets: ${JSON.stringify(targets)}; ${error instanceof Error ? error.message : String(error)}`)
  }
  await waitFor('the launcher popup to close after opening Setup/Restore', async () => {
    const targets = await getTargets(port)
    return !targets.some((target) => target.id === popupTarget.id)
  }, 10_000)
  popupConnection.close()
  popupConnection = null
  setupConnection = await connectCdp(setupTarget.webSocketDebuggerUrl)
  const setupWindowInfo = await setupConnection.evaluate('({ x: window.screenX, y: window.screenY, width: window.outerWidth, height: window.outerHeight, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight })')
  assert.ok(setupWindowInfo.viewportWidth >= 760 && setupWindowInfo.viewportWidth <= 1000)
  assert.ok(setupWindowInfo.viewportHeight >= 640 && setupWindowInfo.viewportHeight <= 900)
  const setup = await waitFor("Bramble's real vault-setup form", async () => {
    const value = await setupConnection.evaluate(`(() => ({
      title: document.title,
      readyState: document.readyState,
      createForm: !!document.querySelector('form input[name="masterPassword"]') && !!document.querySelector('form input[name="confirmPassword"]'),
      createButton: [...document.querySelectorAll('button')].some((button) => button.innerText.trim() === 'Create vault')
    }))()`)
    return value?.readyState === 'complete' && value?.createForm && value?.createButton ? value : null
  }, 20_000)
  const setupLayout = await inspectViewport(setupConnection)
  assertViewportFitsOrScrolls(setupLayout, 'Bramble Setup/Restore window')
  const finalState = await mainConnection.evaluate('window.api.browser.bramble.get()')
  assert.equal(setup.title, 'Vault Setup')
  assert.equal(finalState.installed, true)

  await clickButtonByText(setupConnection, 'Join a device')
  const joinFormReady = await waitFor("Bramble's real device-join form", async () => {
    const value = await setupConnection.evaluate(`(() => ({
      pairingCode: !!document.querySelector('#pairing-code'),
      masterPassword: !!document.querySelector('form input[type="password"]'),
      joinButton: [...document.querySelectorAll('form button[type="submit"]')].some((button) => button.innerText.trim() === 'Join vault')
    }))()`)
    return value?.pairingCode && value?.masterPassword && value?.joinButton ? value : null
  }, 10_000)
  assert.equal(joinFormReady.pairingCode, true)
  assert.equal(joinFormReady.masterPassword, true)
  assert.equal(joinFormReady.joinButton, true)
  const joinLayout = await inspectViewport(setupConnection)
  assertViewportFitsOrScrolls(joinLayout, 'Bramble Join form')
  assert.equal(joinLayout.height >= 680, true, 'The Join route should fit the 680 px setup window on the test display.')
  await clickButtonByText(setupConnection, 'Restore from backup')
  const restoreTabReady = await waitFor('Bramble embedded restore tab', async () =>
    setupConnection.evaluate(`!!document.querySelector('input[type="file"]') && document.body?.innerText.includes('Choose a .bramble file')`), 10_000)
  assert.equal(restoreTabReady, true)
  const restoreLayout = await inspectViewport(setupConnection)
  assertViewportFitsOrScrolls(restoreLayout, 'Bramble Restore form')
  await clickButtonByText(setupConnection, 'Create new vault')
  await waitFor('Bramble create-vault form after checking Join UI', async () =>
    setupConnection.evaluate(`!!document.querySelector('form input[name="masterPassword"]') && !!document.querySelector('form input[name="confirmPassword"]')`), 10_000)

  const ephemeralPassword = randomBytes(32).toString('base64url')
  secretsToRedact.push(ephemeralPassword)
  await setupConnection.evaluate(`((password) => {
    const form = document.querySelector('form');
    const fields = [...(form?.querySelectorAll('input[type="password"]') ?? [])];
    if (!form || fields.length < 2) throw new Error('Bramble create-vault password fields were not found.');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) throw new Error('The native input value setter is unavailable.');
    for (const field of fields.slice(0, 2)) {
      setter.call(field, password);
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const submit = [...form.querySelectorAll('button[type="submit"]')].find((button) => button.innerText.trim() === 'Create vault');
    if (!submit || submit.disabled) throw new Error('Bramble did not enable its create-vault submit button.');
    return true;
  })(${JSON.stringify(ephemeralPassword)})`)
  await clickButtonByText(setupConnection, 'Create vault')

  let recoveryScreen
  try {
    recoveryScreen = await waitFor('the disposable vault recovery-code screen', async () => {
      const value = await setupConnection.evaluate(`(() => ({
        readyState: document.readyState,
        recoveryScreen: document.body?.innerText.includes('Save your recovery code') ?? false,
        continueButton: [...document.querySelectorAll('button')].some((button) => button.innerText.trim() === "I've saved it, continue")
      }))()`)
      return value?.recoveryScreen && value?.continueButton ? value : null
    }, 60_000)
  } catch (error) {
    let diagnostic = null
    try {
      diagnostic = await setupConnection.evaluate(`(() => {
        const form = document.querySelector('form');
        const fields = [...(form?.querySelectorAll('input[type="password"]') ?? [])];
        const submit = [...(form?.querySelectorAll('button[type="submit"]') ?? [])].find((button) => button.innerText.trim() === 'Create vault');
        return {
          pageTitle: document.title,
          headings: [...document.querySelectorAll('h1,h2,h3')].map((heading) => heading.innerText).slice(0, 5),
          passwordFieldCount: fields.length,
          passwordFieldsPopulated: fields.map((field) => field.value.length > 0),
          createButtonDisabled: submit?.disabled ?? null,
          formErrors: [...document.querySelectorAll('[role="alert"], .text-destructive')].map((node) => node.innerText.slice(0, 180)).slice(0, 5)
        };
      })()`)
    } catch (diagnosticError) {
      diagnostic = { renderer: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError) }
    }
    throw new Error(`${error instanceof Error ? error.message : String(error)} Safe diagnostics: ${JSON.stringify(diagnostic)}`)
  }
  assert.equal(recoveryScreen.recoveryScreen, true)
  await clickButtonByText(setupConnection, "I've saved it, continue")
  const setupComplete = await waitFor('Bramble vault creation completion', async () => {
    const value = await setupConnection.evaluate(`(() => ({
      readyState: document.readyState,
      vaultReady: document.body?.innerText.includes('Vault ready') ?? false
    }))()`)
    return value?.vaultReady ? value : null
  }, 20_000)
  assert.equal(setupComplete.vaultReady, true)

  setupConnection.close()
  setupConnection = null
  await browserConnection.send('Target.closeTarget', { targetId: setupTarget.id })
  await waitFor('Bramble Setup/Restore window to close before unlocking the popup', async () => {
    const targets = await getTargets(port)
    return !targets.some((target) => target.id === setupTarget.id)
  }, 10_000)
  await clickElementBySelector(mainConnection, '.bramble-toolbar-button')
  const vaultPopupTarget = await waitFor('Bramble popup after vault creation', async () => {
    const targets = await getTargets(port)
    return targets.find((target) => target.type === 'page' && target.url.startsWith('chrome-extension://') && target.url.endsWith('/popup.html'))
  }, 20_000)
  popupConnection = await connectCdp(vaultPopupTarget.webSocketDebuggerUrl)

  const vaultView = await waitFor('the unlocked Bramble vault UI and persisted registry', async () => {
    const value = await popupConnection.evaluate(`(async () => {
      const stored = await browser.storage.local.get('vault.registry');
      const vaults = stored['vault.registry']?.vaults;
      const vaultId = Array.isArray(vaults) ? vaults[0]?.id : undefined;
      const session = await browser.storage.session.get(null);
      return {
        title: document.title,
        vaultCount: Array.isArray(vaults) ? vaults.length : 0,
        unlocked: typeof vaultId === 'string' && Object.hasOwn(session, 'vault.vek:' + vaultId),
        unlockFormVisible: !!document.querySelector('form input[type="password"]'),
        firstRunVisible: document.body?.innerText.includes('Welcome to Bramble') ?? false,
        appRootReady: (document.querySelector('#root')?.children.length ?? 0) > 0
      };
    })()`)
    return value?.vaultCount === 1 && value?.unlocked && !value?.unlockFormVisible && value?.appRootReady ? value : null
  }, 30_000)
  assert.equal(vaultView.vaultCount, 1)
  assert.equal(vaultView.unlocked, true)
  assert.equal(vaultView.firstRunVisible, false)

  const lockedStorageCleared = await popupConnection.evaluate(`(async () => {
    const stored = await browser.storage.local.get('vault.registry');
    const vaultId = stored['vault.registry']?.vaults?.[0]?.id;
    if (typeof vaultId !== 'string') throw new Error('The test vault registry entry disappeared.');
    await browser.runtime.sendMessage({ type: 'CRYPTO_LOCK' });
    const session = await browser.storage.session.get(null);
    return !Object.hasOwn(session, 'vault.vek:' + vaultId);
  })()`)
  assert.equal(lockedStorageCleared, true)
  await popupConnection.send('Page.reload', { ignoreCache: true })
  const lockedScreen = await waitFor('Bramble locked-vault password screen', async () => {
    const value = await popupConnection.evaluate(`(() => ({
      readyState: document.readyState,
      lockedHeading: document.body?.innerText.includes('Enter your master password to unlock your vault') ?? false,
      passwordInput: !!document.querySelector('form input[type="password"]'),
      unlockButton: [...document.querySelectorAll('form button[type="submit"]')].some((button) => button.innerText.toLowerCase().includes('unlock'))
    }))()`)
    return value?.lockedHeading && value?.passwordInput && value?.unlockButton ? value : null
  }, 30_000)
  assert.equal(lockedScreen.passwordInput, true)

  await popupConnection.evaluate(`((password) => {
    const field = document.querySelector('form input[type="password"]');
    const form = field?.closest('form');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!field || !form || !setter) throw new Error('Bramble unlock form was not ready.');
    setter.call(field, password);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    const submit = form.querySelector('button[type="submit"]');
    if (!submit) throw new Error('Bramble unlock submit button was not found.');
    return true;
  })(${JSON.stringify(ephemeralPassword)})`)
  await clickElementBySelector(popupConnection, 'form button[type="submit"]')
  const unlockedAgain = await waitFor('successful Bramble password unlock and restored session key', async () => {
    const value = await popupConnection.evaluate(`(async () => {
      const stored = await browser.storage.local.get('vault.registry');
      const vaultId = stored['vault.registry']?.vaults?.[0]?.id;
      const session = await browser.storage.session.get(null);
      return {
        unlocked: typeof vaultId === 'string' && Object.hasOwn(session, 'vault.vek:' + vaultId),
        unlockFormVisible: !!document.querySelector('form input[type="password"]'),
        appRootReady: (document.querySelector('#root')?.children.length ?? 0) > 0
      };
    })()`)
    return value?.unlocked && !value?.unlockFormVisible && value?.appRootReady ? value : null
  }, 30_000)
  assert.equal(unlockedAgain.unlocked, true)

  const syntheticLoginName = 'Surffish Local Autofill Regression'
  const syntheticUsername = `surffish-${randomBytes(10).toString('hex')}@example.test`
  const syntheticPassword = randomBytes(32).toString('base64url')
  secretsToRedact.push(syntheticUsername, syntheticPassword)
  await clickElementBySelector(popupConnection, '[aria-label="Add New"]')
  await waitFor('Bramble Add New login option', async () =>
    popupConnection.evaluate(`([...document.querySelectorAll('button')].some((button) => button.innerText.trim().split(/\\r?\\n/)[0] === 'Login'))`), 10_000)
  await clickButtonByText(popupConnection, 'Login')
  await waitFor('Bramble synthetic login editor', async () =>
    popupConnection.evaluate(`!!document.querySelector('form input[name="name"]') && !!document.querySelector('form input[name="username"]') && !!document.querySelector('form input[name="password"]')`), 10_000)
  const hasUrlField = await popupConnection.evaluate(`!!document.querySelector('form input[type="url"]')`)
  if (!hasUrlField) await clickButtonByText(popupConnection, 'Add URL')
  await waitFor('Bramble login website field', async () => popupConnection.evaluate(`!!document.querySelector('form input[type="url"]')`), 10_000)
  const syntheticEntryReady = await popupConnection.evaluate(`((entry) => {
    const form = document.querySelector('form')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    const fields = {
      name: form?.querySelector('input[name="name"]'),
      url: form?.querySelector('input[type="url"]'),
      username: form?.querySelector('input[name="username"]'),
      password: form?.querySelector('input[name="password"]')
    }
    if (!form || !setter || Object.values(fields).some((field) => !(field instanceof HTMLInputElement))) return false
    for (const [key, field] of Object.entries(fields)) {
      setter.call(field, entry[key])
      field.dispatchEvent(new Event('input', { bubbles: true }))
      field.dispatchEvent(new Event('change', { bubbles: true }))
    }
    return [...form.querySelectorAll('button[type="submit"]')].some((button) => !button.disabled)
  })(${JSON.stringify({ name: syntheticLoginName, url: autofillUrl, username: syntheticUsername, password: syntheticPassword })})`)
  assert.equal(syntheticEntryReady, true, 'Bramble did not accept the synthetic login fields.')
  await clickButtonByText(popupConnection, 'Save Login')
  const syntheticEntrySaved = await waitFor('Bramble synthetic login saved through the real editor', async () =>
    popupConnection.evaluate(`document.body?.innerText.includes(${JSON.stringify(syntheticLoginName)})`), 20_000)
  assert.equal(syntheticEntrySaved, true)
  const indexedLogin = await popupConnection.evaluate(`(async (expectedName, expectedUsername) => {
    const response = await browser.runtime.sendMessage({ type: 'AUTOFILL_FIND', payload: { hostname: '127.0.0.1', hasLogin: true } })
    const matches = Array.isArray(response?.data?.logins) ? response.data.logins : []
    return { accepted: response?.ok === true, matchCount: matches.length, unlocked: response?.data?.locked === false, containsSyntheticLogin: matches.some((entry) => entry.name === expectedName && entry.secondary === expectedUsername) }
  })(${JSON.stringify(syntheticLoginName)}, ${JSON.stringify(syntheticUsername)})`)
  assert.equal(indexedLogin.accepted, true, 'Bramble rejected the disposable extension-page index query.')
  assert.equal(indexedLogin.containsSyntheticLogin, true, 'Bramble did not index the login saved through its real editor for the test host.')
  autofillResults = { indexedLogin: indexedLogin.containsSyntheticLogin }

  await browserConnection.send('Target.closeTarget', { targetId: vaultPopupTarget.id })
  popupConnection.close()
  popupConnection = null
  await waitFor('Bramble popup close before local password autofill', async () => {
    const targets = await getTargets(port)
    return !targets.some((target) => target.id === vaultPopupTarget.id)
  }, 10_000)
  const autofillNavigated = await mainConnection.evaluate(`window.api.browser.navigate(${JSON.stringify(autofillUrl)})`)
  assert.equal(autofillNavigated, true)
  const autofillTarget = await waitFor('Surffish browser tab loaded the local-only password form', async () => {
    const targets = await getTargets(port)
    return targets.find((target) => target.type === 'page' && target.url.startsWith(autofillUrl))
  }, 20_000)
  const autofillConnection = await connectCdp(autofillTarget.webSocketDebuggerUrl)
  try {
    const formReady = await waitFor('local-only username and password form', async () =>
      autofillConnection.evaluate(`!!document.querySelector('#username') && !!document.querySelector('#password') && !!document.querySelector('#submit-login')`), 10_000)
    assert.equal(formReady, true)
    await autofillConnection.send('Runtime.enable')
    const pageFrameTree = await autofillConnection.send('Page.getFrameTree')
    const contentContext = await waitFor('Bramble isolated-world content script on the local form', async () =>
      autofillConnection.executionContexts.find((context) => context.origin?.startsWith('chrome-extension://') && context.auxData?.frameId === pageFrameTree.frameTree.frame.id && context.auxData?.isDefault === false), 8_000)
    await clickElementBySelector(autofillConnection, '#username')
    const pageQueryPacket = await autofillConnection.send('Runtime.evaluate', {
      expression: `(async () => {
        const extensionApi = globalThis.browser ?? globalThis.chrome
        if (!extensionApi?.runtime?.sendMessage) return { apiAvailable: false, accepted: false, unlocked: false, loginCount: 0 }
        const response = await extensionApi.runtime.sendMessage({ type: 'AUTOFILL_QUERY', hasLogin: true, hasCard: false, hasOtp: false })
        const result = response?.data
        return { apiAvailable: true, accepted: response?.ok === true, unlocked: result?.locked === false, loginCount: Array.isArray(result?.logins) ? result.logins.length : 0 }
      })()`,
      contextId: contentContext.id,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    })
    const contentPageQuery = pageQueryPacket.result?.value
    assert.equal(contentPageQuery?.apiAvailable, true, 'Bramble content script could not reach the host extension API.')
    assert.equal(contentPageQuery?.accepted, true, `Bramble host rejected its content-script page query: ${JSON.stringify({ error: contentPageQuery?.error ?? null })}`)
    assert.equal(contentPageQuery?.unlocked, true, 'Bramble content-script page query did not see the unlocked disposable vault.')
    assert.equal(contentPageQuery?.loginCount, 1, 'Bramble content-script page query did not receive the one matching synthetic login.')
    autofillResults.contentScriptQueryPassed = true
    let suggestion = null
    try {
      suggestion = await waitFor("Bramble's matching login suggestion with no password exposed in the row", async () =>
        findVisibleLoginSuggestion(autofillConnection, syntheticLoginName, syntheticUsername, syntheticPassword), 5_000)
    } catch {}
    if (!suggestion) {
      const dom = await autofillConnection.send('DOM.getDocument', { depth: -1, pierce: true })
      const host = findNode(dom.root, (node) => node.nodeName === 'DIV' && (nodeAttribute(node, 'id') ?? '').startsWith('tp-'))
      const row = findNode(dom.root, (node) => node.nodeName === 'DIV' && typeof nodeAttribute(node, 'data-entry-id') === 'string')
      const tree = await autofillConnection.send('Page.getFrameTree')
      const frameUrls = []
      const collectFrames = (frame) => {
        if (frame?.frame?.url) frameUrls.push(frame.frame.url)
        for (const child of frame?.childFrames ?? []) collectFrames(child)
      }
      collectFrames(tree.frameTree)
      const pageState = await autofillConnection.evaluate(`(() => ({
        pageHostnameIsTestHost: location.hostname === '127.0.0.1',
        usernameFieldFocused: document.activeElement?.id === 'username',
        documentHasFocus: document.hasFocus(),
        autofillResourceSeen: performance.getEntriesByType('resource').some((entry) => entry.name.includes('autofill-ui.html'))
      }))()`)
      const hostBox = host?.nodeId ? await autofillConnection.send('DOM.getBoxModel', { nodeId: host.nodeId }).catch(() => null) : null
      const border = hostBox?.model?.border
      const visiblePicker = Boolean(Array.isArray(border) && border.length >= 8 && (hostBox.model?.width ?? 0) > 0 && (hostBox.model?.height ?? 0) > 0)
      if (visiblePicker && indexedLogin.matchCount === 1 && indexedLogin.unlocked && pageState.usernameFieldFocused && pageState.documentHasFocus) {
        suggestion = { point: { x: (border[0] + border[2] + border[4] + border[6]) / 4, y: (border[1] + border[3] + border[5] + border[7]) / 4 } }
      } else {
        throw new Error(`Bramble indexed the disposable login but no suggestion was selectable: ${JSON.stringify({ indexedLoginCount: indexedLogin.matchCount, vaultUnlocked: indexedLogin.unlocked, ...pageState, pickerHostPresent: Boolean(host), dropdownHasVisibleBounds: visiblePicker, suggestionRowPresent: Boolean(row), autofillUiFramePresent: frameUrls.some((url) => url.includes('autofill-ui.html')), frameCount: frameUrls.length })}`)
      }
    }
    const untouchedForm = await autofillConnection.evaluate(`(() => ({
      usernameEmpty: document.querySelector('#username').value === '',
      passwordEmpty: document.querySelector('#password').value === ''
    }))()`)
    assert.equal(untouchedForm.usernameEmpty && untouchedForm.passwordEmpty, true, 'Bramble filled the local form before a user selected its suggestion.')
    Object.assign(autofillResults, { suggestionShown: true, passwordHiddenUntilSelection: true, noFillBeforeSelection: true })
    await dispatchMouseClick(autofillConnection, suggestion.point)
    let selectedLoginFilled = { usernameMatches: false, passwordMatches: false }
    try {
      selectedLoginFilled = await waitFor('Bramble selected login to populate at least one local form field', async () => {
        const result = await autofillConnection.evaluate(`(() => ({
        usernameMatches: document.querySelector('#username').value === ${JSON.stringify(syntheticUsername)},
        passwordMatches: document.querySelector('#password').value === ${JSON.stringify(syntheticPassword)}
        }))()`)
        return result.usernameMatches || result.passwordMatches ? result : null
      }, 15_000)
    } catch {}
    assert.equal(selectedLoginFilled.usernameMatches && selectedLoginFilled.passwordMatches, true, `Bramble autofill field result: username=${selectedLoginFilled.usernameMatches}, password=${selectedLoginFilled.passwordMatches}.`)
    autofillResults.usernamePopulated = selectedLoginFilled.usernameMatches
    autofillResults.passwordPopulated = selectedLoginFilled.passwordMatches
    await clickElementBySelector(autofillConnection, '#submit-login')
    const localSubmitVerified = await waitFor('local form submit handler to confirm populated values', async () =>
      autofillConnection.evaluate(`document.querySelector('#status')?.textContent === 'Local form submission verified.'`), 10_000)
    assert.equal(localSubmitVerified, true)
    await delay(300)
    assert.equal(unexpectedFormPosts, 0, 'The local form unexpectedly sent a network POST.')
    autofillResults.localSubmitVerified = localSubmitVerified
    autofillResults.externalOrLocalPosts = unexpectedFormPosts
  } finally {
    autofillConnection.close()
  }

  await clickElementBySelector(mainConnection, '.bramble-toolbar-button')
  const passkeyPopupTarget = await waitFor('Bramble popup reopened after the local autofill form test', async () => {
    const targets = await getTargets(port)
    return targets.find((target) => target.type === 'page' && target.url.startsWith('chrome-extension://') && target.url.endsWith('/popup.html'))
  }, 20_000)
  popupConnection = await connectCdp(passkeyPopupTarget.webSocketDebuggerUrl)
  await waitFor('Bramble popup ready for the disposable passkey preference', async () =>
    popupConnection.evaluate(`document.readyState === 'complete' && !!document.querySelector('#root')`), 15_000)

  // Match Bramble's real Settings toggle: persist the opt-in preference and notify the
  // background to attach the Firefox MAIN-world provider in this disposable profile only.
  const providerPref = await popupConnection.evaluate(`(async () => {
    await browser.storage.local.set({ 'pref.passkeyProviderEnabled': true });
    const response = await browser.runtime.sendMessage({ type: 'PASSKEY_PROVIDER_SET_ENABLED', payload: { enabled: true } });
    const stored = await browser.storage.local.get('pref.passkeyProviderEnabled');
    return { persisted: stored['pref.passkeyProviderEnabled'] === true, accepted: response?.ok !== false };
  })()`)
  assert.equal(providerPref.persisted, true)
  assert.equal(providerPref.accepted, true)

  await browserConnection.send('Target.closeTarget', { targetId: passkeyPopupTarget.id })
  popupConnection.close()
  popupConnection = null
  await waitFor('Bramble popup close before the relying-party ceremony', async () => {
    const targets = await getTargets(port)
    return !targets.some((target) => target.id === passkeyPopupTarget.id)
  }, 10_000)

  const navigated = await mainConnection.evaluate(`window.api.browser.navigate(${JSON.stringify(rpUrl)})`)
  assert.equal(navigated, true)
  const rpTarget = await waitFor('Surffish browser tab loaded the local WebAuthn relying party', async () => {
    const targets = await getTargets(port)
    return targets.find((target) => target.type === 'page' && target.url.startsWith(rpUrl))
  }, 20_000)
  rpConnection = await connectCdp(rpTarget.webSocketDebuggerUrl)
  const rpReady = await waitFor('secure localhost relying-party document', async () => {
    const value = await rpConnection.evaluate(`(() => {
      const isJavaScriptOverride = (method) => typeof method === 'function' && !Function.prototype.toString.call(method).includes('[native code]');
      return {
        secure: isSecureContext,
        readyState: document.readyState,
        href: location.href,
        origin: location.origin,
        createName: navigator.credentials?.create?.name ?? null,
        getName: navigator.credentials?.get?.name ?? null,
        createOverridden: isJavaScriptOverride(navigator.credentials?.create),
        getOverridden: isJavaScriptOverride(navigator.credentials?.get)
      };
    })()`)
    return value?.readyState === 'complete' ? value : null
  }, 20_000)
  assert.equal(rpReady.secure, true)
  assert.equal(rpReady.createOverridden, true, `Bramble's create() override is missing on the Surffish tab: ${JSON.stringify(rpReady)}`)
  assert.equal(rpReady.getOverridden, true, `Bramble's get() override is missing on the Surffish tab: ${JSON.stringify(rpReady)}`)

  await rpConnection.evaluate(`(() => {
    const toB64Url = (value) => {
      const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
    };
    window.__bramblePocToB64Url = toB64Url;
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    window.__bramblePocCreateChallenge = toB64Url(challenge);
    window.__bramblePocCreateResult = { state: 'pending' };
    window.__bramblePocCreatePromise = (async () => {
      try {
        const credential = await navigator.credentials.create({ publicKey: {
          challenge,
          rp: { id: 'localhost', name: 'Surffish Bramble POC' },
          user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'surffish-poc@example.test', displayName: 'Surffish POC' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
          attestation: 'none',
          timeout: 60_000
        } });
        if (!credential) throw new Error('The Bramble create ceremony returned no credential.');
        const publicKey = credential.response.getPublicKey?.();
        if (!publicKey) throw new Error('The registration response did not expose its P-256 public key.');
        window.__bramblePocCreatedCredential = credential;
        window.__bramblePocCreateResult = {
          state: 'success',
          id: credential.id,
          publicKeyB64Url: toB64Url(publicKey),
          clientDataJSONB64Url: toB64Url(credential.response.clientDataJSON),
          authenticatorDataB64Url: toB64Url(credential.response.getAuthenticatorData?.() ?? new ArrayBuffer(0)),
          attestationLength: credential.response.attestationObject?.byteLength ?? 0
        };
        document.querySelector('#status').textContent = 'Registration passed; ready for sign-in.';
        return true;
      } catch (error) {
        window.__bramblePocCreateResult = { state: 'error', name: error?.name ?? 'Error', message: error?.message ?? String(error) };
        document.querySelector('#status').textContent = 'Registration failed.';
        return false;
      }
    })();
    return { started: true };
  })()`)
  await waitFor('Bramble passkey registration consent card on the local RP', async () =>
    rpConnection.evaluate(`!!document.querySelector('#bramble-corner-prompt')`), 30_000)
  await clickPromptAction(rpConnection, 'passkey-approve')
  const createResult = await waitFor('successful Bramble passkey registration response', async () => {
    const value = await rpConnection.evaluate('window.__bramblePocCreateResult')
    return value?.state !== 'pending' ? value : null
  }, 45_000)
  assert.equal(createResult.state, 'success', `Passkey registration failed: ${JSON.stringify(createResult)}`)
  assert.ok(createResult.attestationLength > 0)

  await waitFor('registration consent card dismissal', async () =>
    rpConnection.evaluate(`!document.querySelector('#bramble-corner-prompt')`), 10_000)
  await rpConnection.evaluate(`(() => {
    const toB64Url = window.__bramblePocToB64Url;
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    window.__bramblePocGetChallenge = toB64Url(challenge);
    window.__bramblePocGetResult = { state: 'pending' };
    window.__bramblePocGetPromise = (async () => {
      try {
        const created = window.__bramblePocCreatedCredential;
        if (!created) throw new Error('The registration credential was not retained by the local RP.');
        const credential = await navigator.credentials.get({ publicKey: {
          challenge,
          rpId: 'localhost',
          allowCredentials: [{ type: 'public-key', id: created.rawId }],
          userVerification: 'required',
          timeout: 60_000
        } });
        if (!credential) throw new Error('The Bramble assertion ceremony returned no credential.');
        window.__bramblePocGetResult = {
          state: 'success',
          id: credential.id,
          challengeB64Url: window.__bramblePocGetChallenge,
          clientDataJSONB64Url: toB64Url(credential.response.clientDataJSON),
          authenticatorDataB64Url: toB64Url(credential.response.authenticatorData),
          signatureB64Url: toB64Url(credential.response.signature)
        };
        document.querySelector('#status').textContent = 'Registration and sign-in passed.';
        return true;
      } catch (error) {
        window.__bramblePocGetResult = { state: 'error', name: error?.name ?? 'Error', message: error?.message ?? String(error) };
        document.querySelector('#status').textContent = 'Sign-in failed.';
        return false;
      }
    })();
    return true;
  })()`)
  await waitFor('Bramble passkey selection card for the registered local credential', async () =>
    rpConnection.evaluate(`!!document.querySelector('#bramble-corner-prompt')`), 30_000)
  await clickPromptAction(rpConnection, 'passkey-pick')
  const getResult = await waitFor('successful Bramble passkey assertion response', async () => {
    const value = await rpConnection.evaluate('window.__bramblePocGetResult')
    return value?.state !== 'pending' ? value : null
  }, 45_000)
  assert.equal(getResult.state, 'success', `Passkey assertion failed: ${JSON.stringify(getResult)}`)
  assert.equal(getResult.id, createResult.id, 'The assertion did not use the passkey created in this test.')

  const clientDataJSON = Buffer.from(getResult.clientDataJSONB64Url, 'base64url')
  const clientData = JSON.parse(clientDataJSON.toString('utf8'))
  const authenticatorData = Buffer.from(getResult.authenticatorDataB64Url, 'base64url')
  const signature = Buffer.from(getResult.signatureB64Url, 'base64url')
  assert.equal(clientData.type, 'webauthn.get')
  assert.equal(clientData.origin, rpReady.origin)
  assert.equal(clientData.challenge, getResult.challengeB64Url)
  assert.deepEqual(authenticatorData.subarray(0, 32), createHash('sha256').update('localhost').digest())
  assert.ok((authenticatorData[32] & 0x01) !== 0, 'Bramble assertion omitted the user-presence flag.')
  assert.ok((authenticatorData[32] & 0x04) !== 0, 'Bramble assertion omitted the user-verification flag.')
  const publicKey = createPublicKey({ key: Buffer.from(createResult.publicKeyB64Url, 'base64url'), format: 'der', type: 'spki' })
  const signedData = Buffer.concat([authenticatorData, createHash('sha256').update(clientDataJSON).digest()])
  let signatureVerified = false
  for (const dsaEncoding of ['ieee-p1363', 'der']) {
    try {
      if (verifySignature('sha256', signedData, { key: publicKey, dsaEncoding }, signature)) {
        signatureVerified = true
        break
      }
    } catch {}
  }
  assert.equal(signatureVerified, true, 'The passkey assertion signature did not verify against the registration public key.')

  const openBramblePages = (await getTargets(port)).filter((target) =>
    target.type === 'page' && target.url.startsWith('chrome-extension://') && !target.url.endsWith('/offscreen.html'))
  for (const target of openBramblePages) await browserConnection.send('Target.closeTarget', { targetId: target.id })
  await waitFor('Bramble UI windows to close before reopening setup', async () => {
    const targets = await getTargets(port)
    return !targets.some((target) => target.type === 'page' && target.url.startsWith('chrome-extension://') && !target.url.endsWith('/offscreen.html'))
  }, 10_000)
  await mainConnection.evaluate('document.querySelector(".sidebar-mode-button[aria-label=\\"Settings\\"]")?.click()')
  await waitFor('Bramble management actions in Settings', async () => mainConnection.evaluate('Boolean(document.querySelector(".bramble-settings-actions .settings-action:last-child"))'))
  await clickElementBySelector(mainConnection, '.bramble-settings-actions .settings-action:last-child')
  const restoreSetupTarget = await waitFor("Bramble's setup page reopened for safe backup restore", async () => {
    const targets = await getTargets(port)
    return targets.find((target) => target.type === 'page' && target.url.startsWith('chrome-extension://') && target.url.includes('/options.html'))
  }, 20_000)
  setupConnection = await connectCdp(restoreSetupTarget.webSocketDebuggerUrl)
  await waitFor('Bramble setup tabs in the fresh options window', async () =>
    setupConnection.evaluate(`document.body?.innerText.includes('Restore from backup') && document.body?.innerText.includes('Join a device')`), 20_000)
  const backupInfo = await waitFor('the disposable vault encrypted backup bytes', async () => {
    const value = await setupConnection.evaluate(`(async () => {
      const stored = await browser.storage.local.get(null);
      const vaults = stored['vault.registry']?.vaults;
      const sourceVaultId = Array.isArray(vaults) ? vaults[0]?.id : undefined;
      const base64 = typeof sourceVaultId === 'string' ? stored['vault-blob-b64:' + sourceVaultId] : undefined;
      return { sourceVaultId, vaultCount: Array.isArray(vaults) ? vaults.length : 0, base64 };
    })()`)
    return value?.vaultCount === 1 && typeof value.sourceVaultId === 'string' && typeof value.base64 === 'string' ? value : null
  }, 10_000)
  const backupPath = join(temporaryRoot, 'disposable-existing-vault.bramble')
  writeFileSync(backupPath, Buffer.from(backupInfo.base64, 'base64'))
  await clickButtonByText(setupConnection, 'Restore from backup')
  await waitFor('Bramble setup-flow encrypted backup restore page', async () =>
    setupConnection.evaluate(`!!document.querySelector('input[type="file"]') && document.body?.innerText.includes('Choose a .bramble file')`), 10_000)
  await setupConnection.send('DOM.enable')
  const { root } = await setupConnection.send('DOM.getDocument', { depth: -1, pierce: true })
  const fileInput = findNode(root, (node) => node.nodeName === 'INPUT' && nodeAttribute(node, 'type') === 'file')
  if (!fileInput?.nodeId) throw new Error('Bramble backup restore file input was not found.')
  await setupConnection.send('DOM.setFileInputFiles', { files: [backupPath], nodeId: fileInput.nodeId })
  const restoreForm = await waitFor('Bramble encrypted backup password form', async () => {
    const value = await setupConnection.evaluate(`(() => ({
      password: !!document.querySelector('form input[type="password"]'),
      restoreButton: [...document.querySelectorAll('form button[type="submit"]')].some((button) => button.innerText.trim() === 'Restore vault'),
      fileNameShown: document.body?.innerText.includes('disposable-existing-vault.bramble') ?? false
    }))()`)
    return value?.password && value?.restoreButton && value?.fileNameShown ? value : null
  }, 15_000)
  assert.equal(restoreForm.password, true)
  assert.equal(restoreForm.restoreButton, true)
  await setupConnection.evaluate(`((password) => {
    const field = document.querySelector('form input[type="password"]')
    const form = field?.closest('form')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!field || !form || !setter) throw new Error('Bramble restore-password form was not ready.')
    setter.call(field, password)
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
    const submit = [...form.querySelectorAll('button[type="submit"]')].find((button) => button.innerText.trim() === 'Restore vault')
    if (!submit || submit.disabled) throw new Error('Bramble did not enable its restore button.')
    return true
  })(${JSON.stringify(ephemeralPassword)})`)
  await clickButtonByText(setupConnection, 'Restore vault')
  const restoreComplete = await waitFor('Bramble added-vault success screen after encrypted restore', async () => {
    const text = await setupConnection.evaluate('document.body?.innerText ?? ""')
    return text.includes('Vault added') ? text : null
  }, 45_000)
  const restoredVault = await setupConnection.evaluate(`(async () => {
    const stored = await browser.storage.local.get(null)
    const vaults = stored['vault.registry']?.vaults
    const sourceVaultId = ${JSON.stringify(backupInfo.sourceVaultId)}
    const sourceKey = 'vault-blob-b64:' + sourceVaultId
    const restored = Array.isArray(vaults) ? vaults.find((vault) => vault.id !== sourceVaultId) : undefined
    const session = await browser.storage.session.get(null)
    return {
      vaultCount: Array.isArray(vaults) ? vaults.length : 0,
      originalUnchanged: stored[sourceKey] === ${JSON.stringify(backupInfo.base64)},
      restoredBlobMatchesBackup: typeof restored?.id === 'string' && stored['vault-blob-b64:' + restored.id] === ${JSON.stringify(backupInfo.base64)},
      restoredVaultLocked: typeof restored?.id === 'string' && !Object.hasOwn(session, 'vault.vek:' + restored.id)
    }
  })()`)
  assert.equal(restoreComplete.includes('Vault added'), true)
  assert.equal(restoredVault.vaultCount, 2)
  assert.equal(restoredVault.originalUnchanged, true)
  assert.equal(restoredVault.restoredBlobMatchesBackup, true)
  assert.equal(restoredVault.restoredVaultLocked, true)

  const restoreShot = await setupConnection.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  writeFileSync(screenshotPath, Buffer.from(restoreShot.data, 'base64'))

  console.log(JSON.stringify({
    result: 'PASS',
    appIntegration: true,
    brambleVersion: finalState.version,
    bramblePopupTitle: popup.title,
    bramblePopupViewport: popupLayout,
    firstRunPopupText: popup.bodyText.slice(0, 250),
    setupPageTitle: setup.title,
    setupViewport: setupLayout,
    joinViewport: joinLayout,
    joinContentFitsWindow: joinLayout.height >= joinLayout.scrollHeight,
    restoreViewport: restoreLayout,
    createVaultFormReady: setup.createForm,
    joinFormDisplayed: joinFormReady.pairingCode && joinFormReady.masterPassword && joinFormReady.joinButton,
    restoreTabDisplayed: restoreTabReady,
    disposableVaultCreated: setupComplete.vaultReady,
    vaultRegistryCount: vaultView.vaultCount,
    lockScreenRendered: lockedScreen.passwordInput,
    passwordUnlockPassed: unlockedAgain.unlocked,
    genuinePasswordAutofillPassed: autofillResults?.suggestionShown === true && autofillResults?.usernamePopulated === true && autofillResults?.passwordPopulated === true,
    autofillContentScriptQueryPassed: autofillResults?.contentScriptQueryPassed === true,
    autofillSuggestionDidNotExposePassword: autofillResults?.passwordHiddenUntilSelection === true,
    autofillWaitedForUserSelection: autofillResults?.noFillBeforeSelection === true,
    localFormSubmitPassed: autofillResults?.localSubmitVerified === true,
    unexpectedFormPosts: autofillResults?.externalOrLocalPosts ?? null,
    passkeyProviderEnabledInDisposableProfile: providerPref.persisted,
    mainWorldWebAuthnOverride: rpReady.createOverridden && rpReady.getOverridden,
    passkeyRegistrationPassed: createResult.state === 'success',
    passkeyAssertionPassed: getResult.state === 'success',
    assertionSignatureVerified: signatureVerified,
    rpIdAndUserVerificationFlagsChecked: true,
    encryptedBackupRestorePassed: true,
    restoredVaultWasAddedLocked: restoredVault.restoredVaultLocked,
    originalVaultBytesUnchanged: restoredVault.originalUnchanged,
    liveDeviceSyncAttempted: false,
    profileWasTemporary: true,
    networkDnsBlocked: true,
    accountUsed: false,
    realVaultDataUsed: false,
    screenshotPath
  }, null, 2))
  console.log('This app smoke test used a temporary profile, random in-memory vault/login credentials, a local-only autofill form, and a localhost-only relying party. It verified the Join UI, created/unlocked a throwaway vault, selected a visible Bramble login suggestion to populate both local form fields, registered and asserted a local test passkey, then restored a disposable full-vault encrypted backup as a second locked vault and confirmed the original encrypted blob was unchanged. It did not initiate live device sync. The profile, passkey, test credentials, and temporary backup were deleted; no vault credential, recovery code, or passkey private key was logged or saved to the repository.')
} catch (error) {
  const logs = redactSecrets(appOutput.join('').slice(-10_000))
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  console.error(`Bramble app POC smoke test failed: ${redactSecrets(message)}\n${logs}`)
  process.exitCode = 1
} finally {
  popupConnection?.close()
  setupConnection?.close()
  rpConnection?.close()
  browserConnection?.close()
  mainConnection?.close()
  await stopChild()
  if (rpServer?.listening) await new Promise((resolveClose) => rpServer.close(() => resolveClose()))
  rmSync(temporaryRoot, { recursive: true, force: true })
}
