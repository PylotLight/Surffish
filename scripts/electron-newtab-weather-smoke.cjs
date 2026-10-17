// New Tab weather size + forecast, against the production build, with a fake weather fetch in main
// (Open-Meteo and wttr.in answers built around Melbourne's real today, so CI never touches the network):
//   1. A profile saved before these options opens with today's look: one line, no icon, no daily
//      request, Weather size 100 %.
//   2. Forecast → Today adds today's high/low + rain chance; 3 / 5 / 7 days add a column per day
//      (localized weekday, icon, high, low, rain %), clamped to the provider (wttr.in: 3, with a note).
//   3. The Weather size slider (50–250 %) is live while dragging, holds where it stops, scales the
//      reading and the rows; the forecast never runs into the icons, also in a small window, and a
//      top-right forecast pushes the clocks/icons down instead of overlapping them.
//   4. Settings → New Tab shows and edits the same values.
// `bun run build && bun run test:electron-newtab-weather` (headless Linux: xvfb-run -a ...).
// SMOKE_SHOTS=<dir> saves screenshots (200 % + 5 days, 3 days, Settings page, top right 7 days).
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const userData = join(tmpdir(), `surffish-newtab-weather-smoke-${process.pid}`)
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

app.commandLine.appendSwitch('lang', 'en-US')

// Melbourne's today and the next days, as the providers would give them (local dates).
const melbourneDate = (offsetDays) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.now() + offsetDays * 86_400_000)
const DATES = Array.from({ length: 8 }, (_, i) => melbourneDate(i))
const weekday = (date) => new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
const requests = []
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
globalThis.__surffishWeatherFetch = async (input) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  requests.push(url.href)
  if (url.hostname === 'api.open-meteo.com') {
    const body = { current: { temperature_2m: 15.3, weather_code: 2 } }
    if (url.searchParams.get('daily')) {
      body.daily = {
        time: DATES.slice(0, 7),
        weather_code: [2, 61, 3, 0, 95, 71, 45],
        temperature_2m_max: [22.4, 17.2, 19.1, 24.6, 21, 12, 16],
        temperature_2m_min: [11.6, 9.8, 8.5, 12, 14.2, 3, 7],
        precipitation_probability_max: [10, 85, 20, 0, 60, 40, 15]
      }
    }
    return json(body)
  }
  if (url.hostname === 'wttr.in') {
    return json({
      current_condition: [{ temp_C: '16', weatherDesc: [{ value: 'Sunny' }] }],
      weather: DATES.slice(0, 3).map((date, i) => ({ date, maxtempC: String(20 + i), mintempC: String(10 + i), hourly: [{ time: '1200', weatherCode: ['113', '296', '338'][i], chanceofrain: String(i * 30), chanceofsnow: '0' }] }))
    })
  }
  throw new Error(`net::ERR_BLOCKED_BY_CLIENT (unexpected weather host ${url.hostname} in the smoke)`)
}

async function run() {
  app.setPath('userData', userData)
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', smoke.ADBLOCK_CONFIG).serialize(), { mode: 0o600 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
  // Saved before weather size / forecast existed.
  writeFileSync(join(userData, 'browser-preferences.json'), `${JSON.stringify({
    version: 1,
    newTabPreferences: {
      showClock: true, showDate: true, timeFormat: '24h', timeZone: 'Australia/Melbourne', clockScale: 100,
      worldClocks: [{ id: 'lon', label: 'London', timeZone: 'Europe/London' }],
      weatherEnabled: true, weatherProvider: 'open-meteo', weatherLocation: 'Melbourne, Victoria, Australia',
      weatherPlace: { name: 'Melbourne', region: 'Victoria', country: 'Australia', latitude: -37.814, longitude: 144.9633, timeZone: 'Australia/Melbourne' }
    },
    pinnedSites: ['github.test', 'news.test', 'mail.test', 'docs.test', 'music.test', 'maps.test', 'shop.test', 'video.test', 'chat.test', 'notes.test'].map((host) => ({ title: host, url: `https://${host}/` }))
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
  const scope = '.new-tab-customize'
  const setRange = (label, value, root = scope) => ev(`(() => {
    const input = document.querySelector('${root} [aria-label="${label}"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '${value}')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  const setSelect = (label, value, root = scope) => ev(`(() => {
    const select = document.querySelector('${root} [aria-label="${label}"]')
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, '${value}')
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  const segment = (label, text, root = scope) => ev(`(() => {
    const button = [...document.querySelectorAll('${root} [aria-label="${label}"] [role=radio]')].find((b) => b.textContent === ${JSON.stringify(text)})
    if (!button) throw new Error('no ${text} in ${label}')
    button.click()
  })()`)
  const reveal = (label, root = scope) => ev(`(() => {
    const control = document.querySelector('${root} [aria-label="${label}"]')
    let scroller = control.parentElement
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
    if (scroller) scroller.scrollTop += control.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientHeight / 2
  })()`)
  // Everything the checks need, page-relative.
  const weather = () => ev(`(() => {
    const page = document.querySelector('.new-tab-page')
    const widget = document.querySelector('.new-tab-page .new-tab-weather-widget')
    if (!page || !widget) return null
    const p = page.getBoundingClientRect()
    const rel = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top - p.top, bottom: r.bottom - p.top, left: r.left - p.left, right: r.right - p.left } }
    return {
      text: widget.textContent,
      corner: widget.classList.contains('is-corner'),
      glyph: Boolean(widget.querySelector('strong .new-tab-weather-glyph')),
      today: widget.querySelector('.new-tab-weather-today')?.textContent ?? null,
      days: [...widget.querySelectorAll('.new-tab-weather-days li')].map((li) => ({
        day: li.querySelector('.new-tab-weather-day')?.textContent,
        icon: li.querySelector('.new-tab-weather-glyph')?.getAttribute('aria-label'),
        hi: li.querySelector('.new-tab-weather-hi')?.textContent,
        lo: li.querySelector('.new-tab-weather-lo')?.textContent,
        pop: li.querySelector('.new-tab-weather-pop')?.textContent
      })),
      font: parseFloat(getComputedStyle(widget.querySelector('strong') ?? widget).fontSize),
      dayFont: widget.querySelector('.new-tab-weather-days') ? parseFloat(getComputedStyle(widget.querySelector('.new-tab-weather-days')).fontSize) : null,
      box: rel(widget),
      rows: rel(widget.querySelector('.new-tab-weather-days')),
      widgets: rel(document.querySelector('.new-tab-widgets')),
      icons: rel(document.querySelector('.new-tab-link-groups')),
      credit: rel(document.querySelector('.new-tab-photo-footer')),
      width: p.width,
      height: p.height
    }
  })()`)
  // New Tab screenshots without the Customize panel over the right of the page, then reopen it.
  const panelOpen = () => ev('Boolean(document.querySelector(".new-tab-customize.is-open"))')
  const shotWithoutPanel = async (name) => {
    if (!shots) return
    await ev('document.querySelector(".new-tab-customize-gear").click()')
    await waitFor(async () => !(await panelOpen()), 'the Customize panel to close')
    await shot(name)
    await ev('document.querySelector(".new-tab-customize-gear").click()')
    await waitFor(panelOpen, 'the Customize panel to reopen')
  }
  const overlaps = (a, b) => Boolean(a && b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1)
  const expectLayout = (w, what) => {
    assert.ok(w.box.left >= -1 && w.box.right <= w.width + 1, `weather inside the page horizontally (${what}: ${JSON.stringify(w.box)} in ${w.width})`)
    assert.ok(w.icons, `icons on the page (${what})`)
    assert.ok(!overlaps(w.box, w.icons), `weather clears the icons (${what}: weather ${JSON.stringify(w.box)}, icons ${JSON.stringify(w.icons)})`)
    if (w.corner) assert.ok(!overlaps(w.box, w.widgets), `the top-right forecast clears the clocks (${what}: weather ${JSON.stringify(w.box)}, clocks ${JSON.stringify(w.widgets)})`)
    else assert.ok(w.box.bottom <= w.widgets.bottom + 1, `weather is part of the clock block (${what})`)
    assert.ok(w.icons.top < w.height - 40, `icons start on the page (${what}: ${JSON.stringify(w.icons)} in ${w.height})`)
  }
  await waitFor(() => smoke.evaluate(toolbar, 'document.readyState === "complete" && Boolean(window.api?.browser?.chrome)'), 'the toolbar renderer')

  smoke.step('Old profile: today\'s look (one line, no icon, no daily request), size 100 %, Current only')
  const first = await waitFor(async () => { const w = await weather(); return w && /15°C · Partly cloudy/.test(w.text) ? w : null }, 'the current reading')
  assert.equal(first.glyph, false, 'no icon on the current-only reading')
  assert.deepEqual([first.today, first.days.length], [null, 0], 'no forecast rows')
  assert.ok(Math.abs(first.font - 14) < 0.5, `100 % is the original 14 px reading (${first.font})`)
  assert.ok(requests.length >= 1 && requests.every((href) => !href.includes('daily=')), `Current only asks no daily data (${requests.join(' ')})`)
  assert.ok(requests.every((href) => href.includes('forecast_days=1')), 'one forecast day, as before')
  const migrated = await prefs()
  assert.deepEqual([migrated.weatherScale, migrated.weatherForecast], [100, 'current'])

  smoke.step('Customize panel: Forecast + Weather size are there')
  await ev('document.querySelector(".new-tab-customize-gear").click()')
  await waitFor(() => ev(`Boolean(document.querySelector('.new-tab-customize.is-open [aria-label="Weather forecast"]'))`), 'the Customize panel with the forecast option')
  assert.deepEqual(await ev(`[...document.querySelector('${scope} [aria-label="Weather forecast"]').options].map((o) => o.textContent)`), ['Current only', 'Today', '3 days', '5 days', '7 days'])
  assert.deepEqual(await ev(`(() => { const r = document.querySelector('${scope} [aria-label="Weather size"]'); return [r.min, r.max, r.step, r.value] })()`), ['50', '250', '5', '100'])

  smoke.step('Today: high/low and rain chance under the reading (one daily request)')
  const before = requests.length
  await setSelect('Weather forecast', 'today')
  const today = await waitFor(async () => { const w = await weather(); return w?.today ? w : null }, 'today\'s high/low')
  assert.equal(today.today, '↑22°↓12°10%', 'today\'s high, low and rain chance')
  assert.equal(today.glyph, true, 'the reading gets its icon')
  assert.ok(requests.slice(before).some((href) => href.includes('daily=weather_code') && href.includes('forecast_days=7')), 'a daily request')

  smoke.step('5 days: a column per day, localized weekdays, no new request (3/5/7 share the daily data)')
  const daily = requests.length
  await setSelect('Weather forecast', 'days5')
  const five = await waitFor(async () => { const w = await weather(); return w?.days.length === 5 ? w : null }, 'five forecast columns')
  assert.deepEqual(five.days.map((d) => d.day), ['Today', ...DATES.slice(1, 5).map(weekday)])
  assert.deepEqual(five.days[1], { day: weekday(DATES[1]), icon: 'Rain', hi: '17°', lo: '10°', pop: '85%' })
  assert.deepEqual(five.days.map((d) => d.icon), ['Partly cloudy', 'Rain', 'Cloudy', 'Clear', 'Thunderstorms'])
  expectLayout(five, '5 days at 100 %')
  await delay(600)
  assert.equal(requests.length, daily, 'switching between forecast views reuses the reading')

  smoke.step('Weather size: live while dragging, holds where it stops, scales the reading and the rows')
  await setRange('Weather size', 250)
  await waitFor(async () => Math.abs((await weather()).font - 35) < 0.6, '250 % reading (2.5 × 14 px)')
  await setRange('Weather size', 50)
  await waitFor(async () => Math.abs((await weather()).font - 7) < 0.6, '50 % reading')
  for (let value = 50; value <= 250; value += 5) await setRange('Weather size', value === 250 ? 200 : value)
  await delay(1_200)
  const big = await weather()
  assert.ok(Math.abs(big.font - 28) < 0.6, `the drag ends where it stopped (${big.font})`)
  assert.ok(Math.abs(big.dayFont - 23) < 0.6, `the rows scale too (${big.dayFont})`)
  await waitFor(async () => (await prefs()).weatherScale === 200, 'the final size saved')
  await delay(300)
  assert.ok(Math.abs((await weather()).font - 28) < 0.6, 'no bounce-back after saving')
  expectLayout(big, '5 days at 200 %')
  await shotWithoutPanel('weather-200-5day')

  smoke.step('Small window: the forecast and icons stay apart and on screen')
  mainWindow.setSize(900, 540)
  await waitFor(async () => (await weather()).height < 600, 'the short window')
  await delay(300)
  const small = await weather()
  expectLayout(small, '5 days at 200 %, 900×540')
  assert.ok(small.font < 28 && small.font >= 14 - 0.5, `a forecast too tall for the short window shrinks to fit, at most to half (${small.font})`)
  await shot('weather-small-200-5day')
  await setRange('Weather size', 100)
  await setSelect('Weather forecast', 'days7')
  await waitFor(async () => (await weather()).days.length === 7, 'seven columns')
  await delay(200)
  expectLayout(await weather(), '7 days at 100 %, 900×540')

  smoke.step('Top right with 7 days: the clocks and icons make room (Customize panel open beside it)')
  await segment('Weather position', 'Top right')
  const corner = await waitFor(async () => { const w = await weather(); return w?.corner && w.days.length === 7 ? w : null }, 'the top-right forecast')
  await delay(300)
  expectLayout(await weather(), 'top right, 7 days, 900×540, panel open')
  mainWindow.setSize(1280, 860)
  await waitFor(async () => (await weather()).height > 700, 'the window back to full size')
  await delay(300)
  const cornerFull = await weather()
  expectLayout(cornerFull, 'top right, 7 days, 1280×860')
  assert.ok(corner.days.every((d) => d.day && d.hi && d.lo), 'every row has a weekday, high and low')
  await shot('weather-corner-7day')
  await segment('Weather position', 'Below clock')

  smoke.step('3 days, then wttr.in on 7 days: capped at 3 with a note')
  await setSelect('Weather forecast', 'days3')
  const three = await waitFor(async () => { const w = await weather(); return w && !w.corner && w.days.length === 3 ? w : null }, 'three columns')
  expectLayout(three, '3 days')
  await shotWithoutPanel('weather-3day')
  await setSelect('Weather forecast', 'days7')
  await setSelect('Weather provider', 'wttr')
  const wttr = await waitFor(async () => { const w = await weather(); return w && /16°C · Sunny/.test(w.text) && w.days.length === 3 ? w : null }, 'wttr.in\'s three days')
  assert.match(wttr.text, /wttr\.in · Melbourne · 3-day max/, 'the cap is noted on the page')
  assert.deepEqual(wttr.days.map((d) => [d.icon, d.hi, d.lo, d.pop]), [['Clear', '20°', '10°', '0%'], ['Rain', '21°', '11°', '30%'], ['Snow', '22°', '12°', '60%']])
  assert.match(await ev(`document.querySelector('${scope} [aria-label="Weather forecast"]').closest('.settings-row').textContent`), /wttr\.in gives 3 days/, 'Settings explains the cap')
  await segment('Weather temperature unit', '°F')
  await waitFor(async () => JSON.stringify((await weather()).days.map((d) => d.hi)) === JSON.stringify(['68°', '70°', '72°']), 'highs in °F')
  await segment('Weather temperature unit', '°C')
  await setSelect('Weather provider', 'open-meteo')
  await setSelect('Weather forecast', 'days5')
  await setRange('Weather size', 200)
  await waitFor(async () => { const w = await weather(); return w && /15°C/.test(w.text) && w.days.length === 5 && Math.abs(w.font - 28) < 0.6 }, 'back to Open-Meteo, 5 days, 200 %')

  smoke.step('Settings → New Tab shows and edits the same values')
  await smoke.evaluate(toolbar, 'window.api.browser.chrome.set({ sidebarMode: "newtab" })')
  const page = '.settings-view-newtab:not(.new-tab-customize)'
  await waitFor(() => ev(`document.querySelector('${page} [aria-label="Weather size"]')?.value === '200'`), 'Settings → New Tab with weather size 200 %')
  assert.equal(await ev(`document.querySelector('${page} [aria-label="Weather forecast"]').value`), 'days5')
  await reveal('Weather forecast', page)
  await shot('weather-settings-page')
  await setSelect('Weather forecast', 'days3', page)
  await waitFor(async () => (await prefs()).weatherForecast === 'days3', 'Settings edits the forecast')
  await setRange('Weather size', 150, page)
  await waitFor(async () => (await prefs()).weatherScale === 150, 'Settings edits the weather size')
  console.log(`[newtab-weather] requests: ${requests.length} (${requests.filter((href) => href.includes('daily=')).length} with daily data)`)
  console.log('Electron New Tab weather smoke passed.')
}

run().then(() => app.exit(0), (error) => {
  console.error('Electron New Tab weather smoke failed:', error)
  app.exit(1)
}).finally(() => smoke.removeProfile?.(userData))
