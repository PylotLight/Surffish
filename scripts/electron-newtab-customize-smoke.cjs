// New Tab "Customize" panel + weather city search / providers + wider vertical position, against
// the production build. All weather traffic goes to a fake `fetch` installed in this (main) process
// before the app loads, so CI never touches the network:
//   1. The New Tab draws the gear, but the panel's code isn't loaded until the gear is used (lazy chunk).
//   2. A weather setting saved before city search (free text "Melbourne") still loads and saves its place once.
//   3. Gear opens the right-side panel (focus inside, aria-expanded); changes apply live to the page behind.
//   4. Vertical position: 0 % puts the icons right under the clocks, 100 % right above the photo credit,
//      never off-screen in a short window; a fast drag ends where it stopped (no echo snap-back).
//   5. City search: debounced suggestions with region + country; picking one saves its coordinates.
//   6. Providers: MET Norway (with an identifying User-Agent), a failing wttr.in shows a friendly error,
//      OpenWeather asks for a key then works once one is saved; °F.
//   7. Escape / a press outside close it (focus back on the gear); Settings → New Tab shares the same
//      state and its "Customize on New Tab" button opens the panel.
// `bun run build && bun run test:electron-newtab-customize` (headless Linux: xvfb-run -a ...).
// SMOKE_SHOTS=<dir> also saves screenshots of the New Tab with the panel open.
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const userData = join(tmpdir(), `surffish-newtab-customize-smoke-${process.pid}`)
const shots = process.env.SMOKE_SHOTS ? resolve(process.env.SMOKE_SHOTS) : ''
const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
async function waitFor(predicate, description) {
  const deadline = Date.now() + smoke.waitMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const value = await predicate()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await delay(40)
  }
  throw new Error(`Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError.message}` : ''}`)
}

// ---- fake weather network ------------------------------------------------------------------
const PLACES = [
  { name: 'Melbourne', admin1: 'Victoria', country: 'Australia', country_code: 'AU', latitude: -37.814, longitude: 144.96332, timezone: 'Australia/Melbourne' },
  { name: 'Melbourne', admin1: 'Florida', country: 'United States', country_code: 'US', latitude: 28.08363, longitude: -80.60811, timezone: 'America/New_York' },
  { name: 'Melton', admin1: 'Victoria', country: 'Australia', country_code: 'AU', latitude: -37.68339, longitude: 144.58566 }
]
const calls = []
const realFetch = globalThis.fetch
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const headers = new Headers(init?.headers)
  const lat = Number(url.searchParams.get('latitude') ?? url.searchParams.get('lat') ?? url.pathname.slice(1).split(',')[0])
  switch (url.hostname) {
    case 'geocoding-api.open-meteo.com': {
      const name = (url.searchParams.get('name') ?? '').toLowerCase()
      calls.push({ host: url.hostname, name })
      return json({ results: PLACES.filter((place) => place.name.toLowerCase().startsWith(name)) })
    }
    case 'api.open-meteo.com':
      calls.push({ host: url.hostname, lat })
      return json({ current: { temperature_2m: lat > 0 ? 27.2 : 15.3, weather_code: 2 } })
    case 'api.met.no':
      calls.push({ host: url.hostname, lat, ua: headers.get('user-agent') })
      if (!/Surffish\/\S+ \(\+https:\/\/github\.com\/PylotLight\/Surffish\)/.test(headers.get('user-agent') ?? '')) return json({ error: 'identify yourself' }, 403)
      return json({ properties: { timeseries: [{ data: { instant: { details: { air_temperature: 9.4 } }, next_1_hours: { summary: { symbol_code: 'lightrain_day' } } } }] } })
    case 'wttr.in':
      calls.push({ host: url.hostname })
      return new Response('Unknown location; please try ~-37.8,144.9', { status: 503 })
    case 'api.openweathermap.org':
      calls.push({ host: url.hostname, appid: url.searchParams.get('appid') })
      if (url.searchParams.get('appid') !== 'smoke-key-123') return json({ cod: 401, message: 'Invalid API key' }, 401)
      return json({ main: { temp: 21.6 }, weather: [{ description: 'scattered clouds' }] })
    case 'get.geojs.io':
      calls.push({ host: url.hostname })
      return json({ city: 'Boardman', region: 'Oregon', country: 'United States', country_code: 'US', latitude: '45.8401', longitude: '-119.705' })
    default:
      return realFetch(input, init)
  }
}
const callsTo = (host) => calls.filter((call) => call.host === host)

async function run() {
  app.setPath('userData', userData)
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', smoke.ADBLOCK_CONFIG).serialize(), { mode: 0o600 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
  // Saved before city search existed: free-text city, old px offset.
  writeFileSync(join(userData, 'browser-preferences.json'), `${JSON.stringify({
    version: 1,
    newTabPreferences: { weatherEnabled: true, weatherLocation: 'Melbourne', iconVerticalOffset: 340, showClock: true },
    pinnedSites: ['github.test', 'news.test', 'example.test', 'wiki.test', 'video.test', 'forum.test'].map((host) => ({ title: host, url: `https://${host}/` }))
  })}\n`)
  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  const mainWindow = await waitFor(() => BaseWindow.getAllWindows()[0], 'the main window')
  mainWindow.setBounds({ x: 0, y: 0, width: 1280, height: 860 })
  const surface = (name) => mainWindow.contentView.children.find((view) => { try { return new URL(view.webContents.getURL()).searchParams.get('surface') === name } catch { return false } })
  await waitFor(() => surface('content') && surface('toolbar'), 'the renderer surfaces')
  const toolbar = surface('toolbar').webContents
  const content = surface('content').webContents
  const ev = (expression) => smoke.evaluate(content, expression)
  const prefs = async () => (await ev('window.api.browser.preferences.get()')).newTabPreferences
  const shot = async (name) => {
    if (!shots) return
    mkdirSync(shots, { recursive: true })
    await delay(350)
    writeFileSync(join(shots, `${name}.png`), (await content.capturePage()).toPNG())
  }
  // React-controlled inputs need the native setter + an input event.
  const setRange = (label, value) => ev(`(() => {
    const input = document.querySelector('.new-tab-customize [aria-label="${label}"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '${value}')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  const setSelect = (label, value) => ev(`(() => {
    const select = document.querySelector('.new-tab-customize [aria-label="${label}"]')
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, '${value}')
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  const typeInto = (selector, text) => ev(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    input.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(text)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  const widgetText = () => ev('document.querySelector(".new-tab-weather-widget")?.textContent ?? ""')
  await waitFor(() => smoke.evaluate(toolbar, 'document.readyState === "complete" && Boolean(window.api?.browser?.chrome)'), 'the toolbar renderer')

  smoke.step('New Tab: gear drawn, panel code not loaded yet')
  await waitFor(() => ev('Boolean(document.querySelector(".new-tab-page .new-tab-customize-gear") && document.querySelectorAll(".new-tab-icon-tile").length >= 6)'), 'the New Tab with its icons and the gear')
  assert.equal(await ev('document.querySelector(".new-tab-customize-gear").getAttribute("aria-expanded")'), 'false')
  assert.equal(await ev('Boolean(document.querySelector(".new-tab-customize"))'), false, 'no panel in the DOM before the gear is used')
  assert.deepEqual(await ev('performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => /NewTab(CustomizePanel|SettingsFields)/.test(name))'), [], 'the panel chunk is not fetched at first paint')

  smoke.step('Legacy free-text city loads and saves its place once')
  await waitFor(async () => /15°C · Partly cloudy/.test(await widgetText()) && /Open-Meteo · Melbourne/.test(await widgetText()), 'Open-Meteo weather for the old "Melbourne" setting')
  await waitFor(async () => (await prefs()).weatherPlace?.latitude === -37.814, 'the looked-up place saved')
  const migrated = await prefs()
  assert.equal(migrated.weatherLocation, 'Melbourne, Victoria, Australia')
  assert.equal(migrated.iconVerticalPosition, 69, 'old 340 px offset mapped to 69 %')
  const geocodesAfterMigration = callsTo('geocoding-api.open-meteo.com').length
  assert.equal(geocodesAfterMigration, 1, 'geocoded exactly once')
  await shot('after-newtab-gear')

  smoke.step('Gear opens the panel; focus moves in')
  await ev('document.querySelector(".new-tab-customize-gear").click()')
  await waitFor(() => ev(`(() => {
    const panel = document.querySelector('.new-tab-customize.is-open')
    if (!panel) return false
    const rect = panel.getBoundingClientRect()
    return Math.abs(rect.right - innerWidth) <= 1 && rect.left > innerWidth / 2 && getComputedStyle(panel).transform === 'none'
  })()`), 'the panel slid in at the right edge')
  assert.equal(await ev('document.querySelector(".new-tab-customize-gear").getAttribute("aria-expanded")'), 'true')
  assert.equal(await ev('document.activeElement?.getAttribute("aria-label")'), 'Close Customize New Tab', 'focus on the close button')
  assert.equal(await ev('getComputedStyle(document.querySelector(".new-tab-customize")).backdropFilter'), 'none', 'no CSS backdrop-filter on the panel')
  const missing = await ev(`${JSON.stringify(['Default new tab page', 'Show site names under icons', 'Icon size', 'Links per row', 'Vertical position', 'Dim', 'Blur', 'Show local clock', 'Show date', 'Use 24-hour time', 'Show seconds', 'Primary New Tab time zone', 'Show weather', 'Weather city or town', 'Weather provider', 'Weather temperature unit'])}.filter((label) => !document.querySelector('.new-tab-customize [aria-label="' + label + '"]'))`)
  assert.deepEqual(missing, [], 'every New Tab setting is in the panel')
  await shot('after-panel-open')

  smoke.step('Live: site names + dim apply to the page behind')
  assert.equal(await ev('document.querySelectorAll(".new-tab-icon-tile.has-label").length'), 0)
  await ev('document.querySelector(\'.new-tab-customize [aria-label="Show site names under icons"]\').click()')
  await waitFor(() => ev('document.querySelectorAll(".new-tab-icon-tile.has-label").length >= 6'), 'site names under the icons')
  await setRange('Dim', 60)
  await waitFor(() => ev('document.querySelector(".new-tab-page").style.getPropertyValue("--new-tab-dim") === "0.60"'), 'the dim applied live')

  smoke.step('Vertical position: top to bottom, never off-screen')
  const geometry = () => ev(`(() => {
    const track = document.querySelector('.new-tab-icon-track').getBoundingClientRect()
    const groups = document.querySelector('.new-tab-link-groups').getBoundingClientRect()
    const widgets = document.querySelector('.new-tab-widgets').getBoundingClientRect()
    const credit = document.querySelector('.new-tab-photo-footer').getBoundingClientRect()
    return { trackTop: track.top, trackBottom: track.bottom, top: groups.top, bottom: groups.bottom, widgetsBottom: widgets.bottom, creditTop: credit.top, height: innerHeight }
  })()`)
  await setRange('Vertical position', 0)
  await waitFor(async () => { const g = await geometry(); return Math.abs(g.top - g.trackTop) <= 1 }, 'icons at the top of the free space')
  const top = await geometry()
  assert.ok(top.top >= top.widgetsBottom, `icons clear the clocks at 0 % (${top.top} vs ${top.widgetsBottom})`)
  assert.ok(top.top - top.widgetsBottom <= 40, `0 % sits right under the clocks (${top.top - top.widgetsBottom}px gap)`)
  await shot('after-vertical-0')
  await setRange('Vertical position', 100)
  await waitFor(async () => { const g = await geometry(); return Math.abs(g.bottom - g.trackBottom) <= 1 }, 'icons at the bottom of the free space')
  const bottom = await geometry()
  assert.ok(bottom.bottom <= bottom.creditTop + 4, `icons clear the photo credit at 100 % (${bottom.bottom} vs ${bottom.creditTop})`)
  assert.ok(bottom.top - top.top > 400, `the range spans most of the page (${Math.round(bottom.top - top.top)}px at 860 px tall)`)
  await shot('after-vertical-100')
  const fullHeight = bottom.height
  mainWindow.setSize(900, 540) // the window's minimum height
  await waitFor(async () => (await geometry()).height < fullHeight - 200, `the short window (content was ${fullHeight}px)`)
  await delay(200)
  const short = await geometry()
  assert.ok(short.bottom <= short.height && short.top >= 0, `icons stay on screen in a short window (${Math.round(short.top)}–${Math.round(short.bottom)} of ${short.height})`)
  mainWindow.setSize(1280, 860)
  await waitFor(async () => (await geometry()).height >= fullHeight - 2, 'the window back to full size')
  // A fast drag: 21 steps in ~0.2 s, then hold still; the page must not jump back to an older value.
  for (let value = 0; value <= 100; value += 5) await setRange('Vertical position', value === 100 ? 42 : value)
  await delay(1_200)
  assert.equal(await ev('document.querySelector(".new-tab-icon-track").style.getPropertyValue("--new-tab-icon-position")'), '0.420', 'the drag ends where it stopped')
  await waitFor(async () => (await prefs()).iconVerticalPosition === 42, 'the final value saved')

  smoke.step('City search: debounced suggestions, picking saves coordinates')
  const before = callsTo('geocoding-api.open-meteo.com').length
  for (const text of ['m', 'me', 'mel', 'melb']) await typeInto('.new-tab-customize [aria-label="Weather city or town"]', text)
  await waitFor(() => ev('document.querySelectorAll(".weather-city-list [role=option]").length === 2'), 'two Melbourne suggestions')
  assert.deepEqual(await ev('[...document.querySelectorAll(".weather-city-list [role=option]")].map((li) => li.querySelector("strong").textContent + " | " + li.querySelector("span").textContent)'), [
    'Melbourne | Victoria, Australia',
    'Melbourne | Florida, United States'
  ])
  assert.deepEqual(callsTo('geocoding-api.open-meteo.com').slice(before).map((call) => call.name), ['melb'], 'one geocode for the typed word (debounced)')
  await shot('after-city-search')
  await ev('[...document.querySelectorAll(".weather-city-list [role=option]")][1].dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }))')
  await waitFor(async () => (await prefs()).weatherPlace?.region === 'Florida', 'the Florida place saved')
  assert.equal((await prefs()).weatherPlace.latitude, 28.0836)
  await waitFor(async () => /27°C · Partly cloudy/.test(await widgetText()), 'weather for Melbourne, Florida')
  assert.equal(await ev('document.querySelector(\'.new-tab-customize [aria-label="Weather city or town"]\').value'), 'Melbourne, Florida, United States')

  smoke.step('Providers: MET Norway, a failing wttr.in, OpenWeather with a key; °F')
  await setSelect('Weather provider', 'met-norway')
  await waitFor(async () => /9°C · Light rain/.test(await widgetText()) && /MET Norway · Melbourne/.test(await widgetText()), 'MET Norway weather')
  assert.ok(callsTo('api.met.no').every((call) => /^Surffish\//.test(call.ua)), 'MET Norway gets the identifying User-Agent')
  await setSelect('Weather provider', 'wttr')
  await waitFor(async () => /wttr\.in is having trouble \(HTTP 503\)/.test(await widgetText()), 'a friendly wttr.in error on the page')
  assert.match(await ev('document.querySelector(".new-tab-customize .weather-preview").textContent'), /wttr\.in is having trouble/, 'the panel shows it too')
  assert.doesNotMatch(await widgetText(), /invoking remote method/)
  await setSelect('Weather provider', 'openweathermap')
  await waitFor(async () => /Add your OpenWeather API key/.test(await widgetText()), 'OpenWeather asks for a key')
  await waitFor(() => ev('Boolean(document.querySelector(\'.new-tab-customize [aria-label="OpenWeather API key"]\'))'), 'the key field')
  await typeInto('.new-tab-customize [aria-label="OpenWeather API key"]', 'smoke-key-123')
  await ev('document.querySelector(".new-tab-customize .weather-key-form button[type=submit]").click()')
  await waitFor(() => ev('/Key saved/.test(document.querySelector(".new-tab-customize").textContent)'), 'the key saved')
  assert.deepEqual(await ev('window.api.browser.newTabWeather.keys()'), { openweathermap: true })
  assert.equal((await ev('window.api.browser.newTabWeather.setKey("openweathermap", "bad key!")')).ok, false, 'a malformed key is refused as a value, not a thrown IPC error')
  // Saving the key reloads the reading at once.
  await waitFor(async () => /22°C · Scattered clouds/.test(await widgetText()) && /OpenWeather · Melbourne/.test(await widgetText()), 'OpenWeather weather with the saved key')
  await ev('[...document.querySelectorAll(\'.new-tab-customize [aria-label="Weather temperature unit"] [role=radio]\')].find((b) => b.textContent === "°F").click()')
  await waitFor(async () => /71°F/.test(await widgetText()), '°F on the page')

  smoke.step('Approximate location (IP lookup)')
  await ev('[...document.querySelectorAll(".new-tab-customize .settings-link-action")].find((b) => /approximate/.test(b.textContent)).click()')
  await waitFor(async () => (await prefs()).weatherPlace?.name === 'Boardman', 'the approximate place saved')

  smoke.step('Escape and a press outside close it; focus back on the gear')
  await ev('document.activeElement?.blur(); window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
  await waitFor(() => ev('!document.querySelector(".new-tab-customize.is-open") && document.querySelector(".new-tab-customize").inert'), 'the panel closed by Escape')
  assert.equal(await ev('document.activeElement?.getAttribute("aria-label")'), 'Customize New Tab', 'focus back on the gear')
  await ev('document.querySelector(".new-tab-customize-gear").click()')
  await waitFor(() => ev('Boolean(document.querySelector(".new-tab-customize.is-open"))'), 'reopened')
  await ev('document.querySelector(".new-tab-content").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))')
  await waitFor(() => ev('!document.querySelector(".new-tab-customize.is-open")'), 'the panel closed by a press outside')

  smoke.step('Settings → New Tab shares the state; "Customize on New Tab" opens the panel')
  await smoke.evaluate(toolbar, 'window.api.browser.chrome.set({ sidebarMode: "newtab" })')
  await waitFor(() => ev('document.querySelector(\'.settings-view-newtab:not(.new-tab-customize) [aria-label="Weather provider"]\')?.value === "openweathermap"'), 'Settings → New Tab with the panel’s provider')
  assert.equal(await ev('document.querySelector(\'.settings-view-newtab [aria-label="Vertical position"]\').value'), '42')
  assert.equal(await ev('document.querySelector(\'.settings-view-newtab [aria-label="Weather city or town"]\').value'), 'Boardman, Oregon, United States')
  await shot('before-style-settings-page')
  await ev('[...document.querySelectorAll(".settings-view-newtab .settings-action")].find((b) => b.textContent === "Customize on New Tab").click()')
  await waitFor(() => ev('!document.querySelector(".settings-subnav") && Boolean(document.querySelector(".new-tab-page .new-tab-customize.is-open"))'), 'the New Tab with the panel open')
  console.log('Electron New Tab customize smoke passed.')
}

run().then(() => app.exit(0), (error) => {
  console.error('Electron New Tab customize smoke failed:', error)
  app.exit(1)
}).finally(() => smoke.removeProfile?.(userData))
