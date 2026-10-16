// New Tab clock display options, against the production build, with a fixed fake time
// (Friday 16 October 2026 23:05:07 in Melbourne) installed in the New Tab renderer:
//   1. A profile saved before the options (use24HourTime: false) opens as 12-hour, unchanged look.
//   2. Changes in the Customize panel apply live: seconds, 12/24-hour, AM/PM, date format, date off,
//      size / weight / digit style, world-clock difference + "Tomorrow", greeting.
//   3. Seconds tick once a second only while shown; otherwise the next update is minute-aligned.
//   4. Settings → New Tab shows and edits the same values.
// `bun run build && bun run test:electron-newtab-clock` (headless Linux: xvfb-run -a ...).
// SMOKE_SHOTS=<dir> saves screenshots (default look + a few option combinations).
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const userData = join(tmpdir(), `surffish-newtab-clock-smoke-${process.pid}`)
const shots = process.env.SMOKE_SHOTS ? resolve(process.env.SMOKE_SHOTS) : ''
const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
async function waitFor(predicate, description) {
  const deadline = Date.now() + smoke.waitMs
  let lastError
  let last
  while (Date.now() < deadline) {
    try {
      last = await predicate()
      if (last) return last
    } catch (error) {
      lastError = error
    }
    await delay(40)
  }
  throw new Error(`Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError.message}` : ''}`)
}

// Fixed locale so Intl output is predictable on every runner.
app.commandLine.appendSwitch('lang', 'en-US')
const FIXED_ISO = '2026-10-16T12:05:07.000Z' // 23:05:07 AEDT

async function run() {
  app.setPath('userData', userData)
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', smoke.ADBLOCK_CONFIG).serialize(), { mode: 0o600 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
  // Saved before the clock display options: the old boolean, explicit zones (no dependence on the runner's TZ).
  writeFileSync(join(userData, 'browser-preferences.json'), `${JSON.stringify({
    version: 1,
    newTabPreferences: {
      showClock: true, showDate: true, use24HourTime: false, showSeconds: false, timeZone: 'Australia/Melbourne',
      worldClocks: [{ id: 'akl', label: 'Auckland', timeZone: 'Pacific/Auckland' }, { id: 'lon', label: 'London', timeZone: 'Europe/London' }]
    },
    pinnedSites: ['github.test', 'news.test'].map((host) => ({ title: host, url: `https://${host}/` }))
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
  const toggle = (label) => ev(`document.querySelector('${scope} [aria-label="${label}"]').click()`)
  const segment = (label, text, root = scope) => ev(`(() => {
    const button = [...document.querySelectorAll('${root} [aria-label="${label}"] [role=radio]')].find((b) => b.textContent === ${JSON.stringify(text)})
    if (!button) throw new Error('no ${text} in ${label}')
    button.click()
  })()`)
  const setSelect = (label, value) => ev(`(() => {
    const select = document.querySelector('${scope} [aria-label="${label}"]')
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, '${value}')
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  // Every clock on the page: time, label, difference line, date.
  const clocks = () => ev(`[...document.querySelectorAll('.new-tab-page .new-tab-clock')].map((clock) => ({
    time: clock.querySelector('.new-tab-clock-time')?.textContent ?? null,
    label: clock.querySelector('.new-tab-clock-label')?.textContent ?? null,
    diff: clock.querySelector('.new-tab-clock-diff')?.textContent ?? null,
    date: clock.querySelector('.new-tab-clock-date')?.textContent ?? null
  }))`)
  const field = (key) => async () => (await clocks()).map((clock) => clock[key])
  const expectClocks = async (key, expected, description) => {
    try {
      await waitFor(async () => JSON.stringify(await field(key)()) === JSON.stringify(expected), description)
    } catch (error) {
      throw new Error(`${error.message} Got ${JSON.stringify(await field(key)())}, want ${JSON.stringify(expected)}`)
    }
  }
  const timeStyle = () => ev(`(() => { const style = getComputedStyle(document.querySelector('.new-tab-page .new-tab-clock-time')); return { size: parseFloat(style.fontSize), weight: style.fontWeight, numeric: style.fontVariantNumeric } })()`)
  await waitFor(() => smoke.evaluate(toolbar, 'document.readyState === "complete" && Boolean(window.api?.browser?.chrome)'), 'the toolbar renderer')

  smoke.step('Old profile: use24HourTime false → 12-hour, default size/weight/digits')
  await waitFor(() => ev('document.querySelectorAll(".new-tab-page .new-tab-clock").length === 3'), 'the main clock and two world clocks')
  const migrated = await prefs()
  assert.equal(migrated.timeFormat, '12h')
  assert.deepEqual([migrated.dateFormat, migrated.clockSize, migrated.clockWeight, migrated.clockTabularDigits, migrated.showGreeting, migrated.worldClockShowDifference], ['long', 'm', 'light', true, false, false])
  const defaults = await timeStyle()
  assert.equal(defaults.weight, '300', 'Light, the original weight')
  assert.equal(defaults.numeric, 'tabular-nums')
  assert.ok(Math.abs(defaults.size - 38.4) < 0.6, `M is the original clamp(24px, 3vw, 42px) at 1280 px (${defaults.size})`)

  smoke.step('Fixed fake time in the New Tab renderer')
  await ev(`(() => {
    const RealDate = Date
    window.__smokeNow = RealDate.parse(${JSON.stringify(FIXED_ISO)})
    class FakeDate extends RealDate {
      constructor(...args) { if (args.length) super(...args); else super(window.__smokeNow) }
      static now() { return window.__smokeNow }
    }
    window.Date = FakeDate
    // Record the clock's re-arm delays (the tick re-arms with ~step - now % step).
    window.__smokeDelays = []
    const realSetTimeout = window.setTimeout
    window.setTimeout = (fn, ms, ...rest) => { if (ms > 500) window.__smokeDelays.push(ms); return realSetTimeout(fn, ms, ...rest) }
  })()`)
  await ev('document.querySelector(".new-tab-customize-gear").click()')
  await waitFor(() => ev('Boolean(document.querySelector(".new-tab-customize.is-open [aria-label=\\"Time format\\"]"))'), 'the Customize panel with the clock options')
  const missing = await ev(`${JSON.stringify(['Show local clock', 'Time format', 'Show AM/PM', 'Show seconds', 'Show date', 'Date format', 'Clock size', 'Clock weight', 'Monospaced digits', 'Show greeting', 'Show world clock time difference', 'Show world clock day'])}.filter((label) => !document.querySelector('${scope} [aria-label="' + label + '"]'))`)
  assert.deepEqual(missing, [], 'every clock option is in the panel')
  assert.equal(await ev(`document.querySelector('${scope} [aria-label="Time format"] [aria-checked=true]')?.textContent`), '12-hour')

  smoke.step('Seconds on: re-renders with the fake time, ticks every second')
  await toggle('Show seconds')
  await expectClocks('time', ['11:05:07 PM', '1:05:07 AM', '1:05:07 PM'], 'the fake time with seconds, 12-hour')
  await expectClocks('date', ['Friday, October 16', 'Saturday, October 17', 'Friday, October 16'], 'long dates')
  await delay(50)
  await ev('window.__smokeDelays = []')
  await waitFor(() => ev('window.__smokeDelays.some((ms) => ms < 1100)'), 'a one-second re-arm while seconds show')
  await shot('after-12h-seconds')

  smoke.step('Seconds off: minute-aligned again')
  await toggle('Show seconds')
  await expectClocks('time', ['11:05 PM', '1:05 AM', '1:05 PM'], 'no seconds')
  await ev('window.__smokeDelays = []')
  // Fake now is 7 s past the minute, so the next update is ~53 s away, never 1 s.
  await ev('window.__smokeNow += 1')
  await toggle('Show greeting') // any re-run of the tick effect re-arms the timer
    await waitFor(() => ev('window.__smokeDelays.some((ms) => ms > 50_000 && ms <= 60_015)'), 'a minute-aligned re-arm')
  const delays = await ev('window.__smokeDelays')
  assert.ok(!delays.some((ms) => ms < 1_100), `no one-second re-arm with seconds off (${delays.join(', ')})`)
  await waitFor(() => ev('document.querySelector(".new-tab-greeting")?.textContent === "Good evening"'), 'the greeting')

  smoke.step('24-hour; AM/PM toggle only matters in 12-hour')
  await toggle('Show AM/PM')
  await expectClocks('time', ['11:05', '1:05', '1:05'], '12-hour without AM/PM')
  await segment('Time format', '24-hour')
  await expectClocks('time', ['23:05', '01:05', '13:05'], '24-hour')
  assert.equal(await ev(`document.querySelector('${scope} [aria-label="Show AM/PM"]').disabled`), true, 'AM/PM disabled on 24-hour')

  smoke.step('Date formats and date off')
  await setSelect('Date format', 'short')
  await expectClocks('date', ['Fri, Oct 16', 'Sat, Oct 17', 'Fri, Oct 16'], 'short dates')
  await setSelect('Date format', 'numeric')
  await expectClocks('date', ['10/16/2026', '10/17/2026', '10/16/2026'], 'numeric dates (en-US order)')
  await setSelect('Date format', 'iso')
  await expectClocks('date', ['2026-10-16', '2026-10-17', '2026-10-16'], 'ISO dates')

  smoke.step('World clocks: difference and day')
  await toggle('Show world clock time difference')
  await expectClocks('diff', [null, '+2h', '\u221210h'], 'differences from Melbourne')
  await toggle('Show world clock day')
  await expectClocks('diff', [null, 'Tomorrow · +2h', '\u221210h'], '"Tomorrow" for Auckland only')
  await shot('after-24h-iso-world-diff-greeting')
  await toggle('Show date')
  await expectClocks('date', [null, null, null], 'dates hidden')

  smoke.step('Size, weight, digits')
  await segment('Clock size', 'XL')
  await waitFor(async () => (await timeStyle()).size > 70, 'XL clock')
  await segment('Clock size', 'S')
  await waitFor(async () => (await timeStyle()).size < 30, 'S clock')
  await segment('Clock size', 'L')
  await segment('Clock weight', 'Bold')
  await waitFor(async () => Number((await timeStyle()).weight) >= 600, 'bold clock')
  await toggle('Monospaced digits')
  await waitFor(async () => (await timeStyle()).numeric === 'normal', 'proportional digits')
  await shot('after-l-bold-no-date')

  smoke.step('Saved, and Settings → New Tab shows the same values')
  await waitFor(async () => {
    const saved = await prefs()
    return saved.timeFormat === '24h' && saved.showAmPm === false && saved.dateFormat === 'iso' && saved.clockSize === 'l' && saved.clockWeight === 'bold' &&
      saved.clockTabularDigits === false && saved.showGreeting && saved.worldClockShowDifference && saved.worldClockShowDay && !saved.showDate && !saved.showSeconds
  }, 'every option saved')
  assert.equal('use24HourTime' in await prefs(), false, 'old key gone')
  await smoke.evaluate(toolbar, 'window.api.browser.chrome.set({ sidebarMode: "newtab" })')
  const page = '.settings-view-newtab:not(.new-tab-customize)'
  await waitFor(() => ev(`document.querySelector('${page} [aria-label="Clock size"] [aria-checked=true]')?.textContent === 'L'`), 'Settings → New Tab with size L')
  assert.equal(await ev(`document.querySelector('${page} [aria-label="Time format"] [aria-checked=true]').textContent`), '24-hour')
  assert.equal(await ev(`document.querySelector('${page} [aria-label="Date format"]').value`), 'iso')
  await shot('after-settings-page')
  await segment('Clock weight', 'Regular', page)
  await waitFor(async () => (await prefs()).clockWeight === 'regular', 'Settings edits the same preference')
  console.log('Electron New Tab clock smoke passed.')
}

run().then(() => app.exit(0), (error) => {
  console.error('Electron New Tab clock smoke failed:', error)
  app.exit(1)
}).finally(() => smoke.removeProfile?.(userData))
