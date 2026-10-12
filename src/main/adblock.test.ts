import assert from 'node:assert/strict'
import test from 'node:test'
import { ElectronBlocker } from '@ghostery/adblocker-electron'
import {
  chromeUserAgent,
  extractIncludes,
  FILTER_ENVIRONMENT,
  FILTER_LIST_SOURCES,
  FULL_FILTER_CONFIG,
  isFullFilterConfig,
  isExtensionExemptRequest,
  isProtectedVideoDeliveryUrl,
  isWebPageUrl,
  prepareFilterListText,
  REQUIRED_FILTER_LIST_IDS
} from './adblock-policy.ts'

const FIXTURE_FILTERS = [
  'http://127.0.0.1:*/blocked.js$script',
  '@@http://127.0.0.1:*/allowed.js$script'
].join('\n')

test('Ghostery fixture engine blocks matching requests and honors exceptions', () => {
  const blocker = ElectronBlocker.parse(FIXTURE_FILTERS, FULL_FILTER_CONFIG)

  const decide = (path: string) => {
    let response: Electron.CallbackResponse | undefined
    // The Electron adapter reads these fields from the full webRequest details object.
    const details = {
      id: 1,
      url: `http://127.0.0.1:54321/${path}`,
      resourceType: 'script',
      referrer: 'http://127.0.0.1:54321/page',
      webContentsId: 1
    } as Parameters<ElectronBlocker['onBeforeRequest']>[0]
    blocker.onBeforeRequest(details, (result) => { response = result })
    return response
  }

  assert.deepEqual(decide('blocked.js'), { cancel: true })
  assert.deepEqual(decide('allowed.js'), {})
  assert.deepEqual(decide('unmatched.js'), {})
})

test('full filter config enables cosmetics, scriptlets, CSP and preprocessors and survives cache serialization', () => {
  const blocker = ElectronBlocker.parse(FIXTURE_FILTERS, FULL_FILTER_CONFIG)
  const restored = ElectronBlocker.deserialize(blocker.serialize())

  assert.equal(isFullFilterConfig(blocker.config), true)
  assert.equal(isFullFilterConfig(restored.config), true)
  assert.equal(restored.config.loadNetworkFilters, true)
  assert.equal(restored.config.loadCosmeticFilters, true)
  assert.equal(restored.config.loadCSPFilters, true)
  assert.equal(restored.config.enableHtmlFiltering, false)
  assert.equal(restored.config.enableMutationObserver, true)
  assert.equal(restored.config.loadGenericCosmeticsFilters, true)
  assert.equal(restored.config.loadPreprocessors, true)
  // A cache written by the old network-only build must be rejected and rebuilt.
  const legacy = ElectronBlocker.parse(FIXTURE_FILTERS, { ...FULL_FILTER_CONFIG, loadCosmeticFilters: false, loadCSPFilters: false })
  assert.equal(isFullFilterConfig(legacy.config), false)
})

test('list sources use uBO uAssets directly and cover the uBO default set', () => {
  const ids = FILTER_LIST_SOURCES.map((source) => source.id)
  for (const id of ['ublock-filters', 'ublock-badware', 'ublock-privacy', 'ublock-unbreak', 'ublock-quick-fixes', 'easylist', 'easyprivacy', 'peter-lowe']) {
    assert.ok(ids.includes(id), id)
  }
  for (const id of REQUIRED_FILTER_LIST_IDS) assert.ok(ids.includes(id), id)
  for (const source of FILTER_LIST_SOURCES) {
    assert.equal(new URL(source.url).protocol, 'https:', source.url)
    assert.ok(!source.url.includes('ghostery/adblocker'), `should not use the Ghostery mirror: ${source.url}`)
  }
  assert.equal(new Set(ids).size, ids.length, 'list ids are unique')
})

test('preprocessor environment targets desktop Chromium with blocking webRequest', () => {
  const env = new Map(FILTER_ENVIRONMENT)
  assert.equal(env.get('env_chromium'), true)
  assert.equal(env.get('env_firefox'), false)
  assert.equal(env.get('env_mobile'), false)
  assert.equal(env.get('env_mv3'), false)
  assert.equal(env.get('ext_ubol'), false)
  assert.equal(env.get('cap_html_filtering'), false)
})

test('expands same-origin !#include directives only', () => {
  const list = [
    '! Title: uBlock filters',
    '!#include filters-2026.txt',
    '!#include ./filters-general.txt',
    '!#include https://evil.example/list.txt',
    '||ads.example^'
  ].join('\n')
  assert.deepEqual(extractIncludes(list, 'https://ublockorigin.github.io/uAssets/filters/filters.txt'), [
    'https://ublockorigin.github.io/uAssets/filters/filters-2026.txt',
    'https://ublockorigin.github.io/uAssets/filters/filters-general.txt'
  ])
  assert.deepEqual(extractIncludes(list, 'not a url'), [])
})

test('escapes literal % only inside scriptlet arguments', () => {
  const raw = [
    'www.youtube.com##+js(no-xhr-if, /fexp=v1%[-%0-9C]{300\\,}/ method:POST)',
    'example.com#@#+js(set, a, 50%)',
    '||example.com/100%25.js$script',
    '! comment ##+js(set, a, 1%)',
    'example.org##.ad'
  ].join('\n')
  const prepared = prepareFilterListText(raw).split('\n')
  assert.equal(prepared[0], 'www.youtube.com##+js(no-xhr-if, /fexp=v1%25[-%250-9C]{300\\,}/ method:POST)')
  assert.equal(prepared[1], 'example.com#@#+js(set, a, 50%25)')
  assert.equal(prepared[2], '||example.com/100%25.js$script')
  assert.equal(prepared[3], '! comment ##+js(set, a, 1%)')
  assert.equal(prepared[4], 'example.org##.ad')
  assert.equal(decodeURIComponent('/fexp=v1%25[-%250-9C]'), '/fexp=v1%[-%0-9C]')
})

test('allows googlevideo delivery hosts without allowing lookalike domains', () => {
  for (const url of [
    'https://googlevideo.com/videoplayback',
    'https://r1---sn-example.googlevideo.com/videoplayback',
    'https://R1---SN-EXAMPLE.GOOGLEVIDEO.COM:443/videoplayback'
  ]) {
    assert.equal(isProtectedVideoDeliveryUrl(url), true, url)
  }

  for (const url of [
    'https://googlevideo.com.attacker.example/videoplayback',
    'https://notgooglevideo.com/videoplayback',
    'not a URL'
  ]) {
    assert.equal(isProtectedVideoDeliveryUrl(url), false, url)
  }
  assert.equal(isProtectedVideoDeliveryUrl(undefined), false)
})

test('isWebPageUrl accepts only http(s)', () => {
  assert.equal(isWebPageUrl('https://www.youtube.com/watch?v=x'), true)
  assert.equal(isWebPageUrl('http://example.com'), true)
  assert.equal(isWebPageUrl('about:blank'), false)
  assert.equal(isWebPageUrl('chrome-extension://abc/popup.html'), false)
  assert.equal(isWebPageUrl(''), false)
  assert.equal(isWebPageUrl(null), false)
})

test('browser user agent drops Electron and app tokens but keeps Chrome', () => {
  const raw = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) surffish/0.1.0 Chrome/152.0.7977.130 Electron/44.7.0 Safari/537.36'
  assert.equal(chromeUserAgent(raw), 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36')
})

test('the ad blocker never blocks extension resources or hosts extensions rely on', () => {
  const none: ReadonlySet<string> = new Set()
  const extPay: ReadonlySet<string> = new Set(['extensionpay.com'])
  assert.equal(isExtensionExemptRequest({ url: 'chrome-extension://dabkegjlekdcmefifaolmdhnhdcplklo/content.css' }, none), true)
  assert.equal(isExtensionExemptRequest({ url: 'https://ads.example/x.js', referrer: 'chrome-extension://abc/popup.html' }, none), true)
  assert.equal(isExtensionExemptRequest({ url: 'https://ads.example/x.js', frameUrl: 'chrome-extension://abc/options.html' }, none), true)
  assert.equal(isExtensionExemptRequest({ url: 'https://extensionpay.com/extension/x/api/v2/user' }, extPay), true)
  assert.equal(isExtensionExemptRequest({ url: 'https://cdn.extensionpay.com/x.js' }, extPay), true)
  assert.equal(isExtensionExemptRequest({ url: 'https://js.stripe.com/v3', referrer: 'https://extensionpay.com/extension/x/choose-plan' }, extPay), true)
  assert.equal(isExtensionExemptRequest({ url: 'https://extensionpay.com/x' }, none), false)
  assert.equal(isExtensionExemptRequest({ url: 'https://extensionpay.com.evil.example/x' }, extPay), false)
  assert.equal(isExtensionExemptRequest({ url: 'https://doubleclick.net/ad.js', referrer: 'https://news.ycombinator.com/' }, extPay), false)
})
