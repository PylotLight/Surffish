// Integration smoke for Built-in AI (Electron 45 ses.registerLocalAIHandler, experimental), against
// the production build, in a real tab:
//   1. On (seeded settings) + Echo provider: LanguageModel.availability() is 'available',
//      create() + prompt() answers from the Surffish utility process, a session keeps its history,
//      measureContextUsage works, promptStreaming() streams the answer.
//   2. OpenAI-compatible provider (a fake loopback server): the page's conversation goes to
//      /v1/chat/completions and the answer comes back to the page.
//   3. Off (Settings toggle over IPC): the page's API says 'unavailable' and the utility process exits.
// `bun run build && bun run test:electron-local-ai`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-local-ai-smoke.cjs`).
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, webContents: allWebContents } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const userData = join(tmpdir(), `surffish-local-ai-smoke-${process.pid}`)
const completions = []
const server = createServer((request, response) => {
  if (request.method === 'POST' && request.url === '/v1/chat/completions') {
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      const parsed = JSON.parse(body)
      completions.push(parsed)
      const last = parsed.messages.at(-1)?.content ?? ''
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: `fake(${parsed.model}): ${last} [${parsed.messages.length}]` } }] }))
    })
    return
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  response.end('<!doctype html><meta charset="utf-8"><title>Local AI fixture</title><p>fixture</p>')
})

const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
async function waitFor(predicate, description, timeout = smoke.waitMs) {
  const deadline = Date.now() + timeout
  let lastError
  while (Date.now() < deadline) {
    try {
      const value = await predicate()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await delay(50)
  }
  throw new Error(`Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError}` : ''}`)
}
const pageContents = (predicate) => allWebContents.getAllWebContents().find((contents) => !contents.isDestroyed() && predicate(contents.getURL(), contents))
const localAIProcesses = () => app.getAppMetrics().filter((metric) => metric.type === 'Utility' && (metric.name === 'Surffish Local AI' || metric.serviceName === 'Surffish Local AI'))

async function run() {
  app.setPath('userData', userData)
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  const blocker = ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', smoke.ADBLOCK_CONFIG)
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), blocker.serialize(), { mode: 0o600 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
  writeFileSync(join(userData, 'browser-local-ai.json'), JSON.stringify({ enabled: true, provider: 'echo' }))
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const origin = `http://127.0.0.1:${server.address().port}`
  const fixtureUrl = `${origin}/ai`
  writeFileSync(join(userData, 'browser-session.json'), JSON.stringify({ version: 1, tabs: [fixtureUrl], activeIndex: 0 }))

  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  const mainWindow = await waitFor(() => BaseWindow.getAllWindows()[0], 'the main window')
  const toolbar = await waitFor(() => mainWindow.contentView.children.map((view) => view.webContents).find((contents) => contents && !contents.isDestroyed() && /[?&]surface=toolbar/.test(contents.getURL()) && !contents.isLoading()), 'the toolbar surface')
  const page = await waitFor(() => pageContents((url, contents) => url === fixtureUrl && !contents.isLoading()), 'the fixture tab')

  smoke.step('Echo provider answers the page')
  assert.equal(await smoke.evaluate(page, 'typeof LanguageModel'), 'function', 'LanguageModel is exposed to pages')
  assert.equal(await smoke.evaluate(page, 'LanguageModel.availability()'), 'available')
  assert.equal(await smoke.evaluate(page, 'LanguageModel.create().then((model) => model.prompt("hello there"))'), 'Echo: hello there')
  const session = await smoke.evaluate(page, `(async () => {
    const model = await LanguageModel.create({ initialPrompts: [{ role: 'system', content: 'Be brief.' }] })
    const first = await model.prompt('one')
    const second = await model.prompt('two')
    const measured = await model.measureContextUsage('four score and seven years')
    let streamed = ''
    for await (const chunk of model.promptStreaming('three')) streamed += chunk
    return { first, second, measured, streamed, usage: model.contextUsage, window: model.contextWindow }
  })()`)
  assert.equal(session.first, 'Echo: one')
  assert.equal(session.second, 'Echo: two')
  assert.ok(session.measured > 0, `measureContextUsage: ${session.measured}`)
  assert.equal(session.streamed, 'Echo: three', 'promptStreaming streams the answer')
  assert.ok(session.usage > 0 && session.window === 8192, `context usage ${session.usage} / ${session.window}`)
  assert.equal(localAIProcesses().length, 1, `one Surffish Local AI utility process (${JSON.stringify(app.getAppMetrics().filter((metric) => metric.type === 'Utility').map((metric) => [metric.name, metric.serviceName]))})`)

  smoke.step('OpenAI-compatible provider (fake loopback server)')
  const switched = await smoke.evaluate(toolbar, `window.api.browser.localAI.setSettings({ provider: 'openai-compatible', baseUrl: ${JSON.stringify(`${origin}/v1`)}, model: 'fake-model' })`)
  assert.equal(switched.provider, 'openai-compatible')
  const answer = await smoke.evaluate(page, `(async () => {
    const model = await LanguageModel.create({ initialPrompts: [{ role: 'system', content: 'You are a test.' }] })
    return model.prompt('ping')
  })()`)
  assert.equal(answer, 'fake(fake-model): ping [2]')
  assert.deepEqual(completions.at(-1).messages, [{ role: 'system', content: 'You are a test.' }, { role: 'user', content: 'ping' }])
  const rejected = await smoke.evaluate(toolbar, `window.api.browser.localAI.setSettings({ baseUrl: 'https://example.com/v1' })`)
  assert.equal(rejected.baseUrl, `${origin}/v1`, 'a non-loopback server URL is refused (kept the old one)')

  smoke.step('Off: unavailable, utility process gone')
  const off = await smoke.evaluate(toolbar, 'window.api.browser.localAI.setSettings({ enabled: false })')
  assert.equal(off.enabled, false)
  page.reload()
  await waitFor(() => !page.isLoading() && page.getURL() === fixtureUrl, 'the fixture page reloaded')
  await waitFor(async () => (await smoke.evaluate(page, 'LanguageModel.availability()')) === 'unavailable', 'LanguageModel.availability() to say unavailable')
  await waitFor(() => localAIProcesses().length === 0, 'the Surffish Local AI process to exit')
  console.log('Electron local AI smoke passed.')
}

run().then(() => {
  server.close()
  app.exit(0)
}).catch((error) => {
  console.error(error)
  server.close()
  app.exit(1)
})
