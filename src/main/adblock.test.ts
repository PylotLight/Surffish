import assert from 'node:assert/strict'
import test from 'node:test'
import { ElectronBlocker } from '@ghostery/adblocker-electron'
import { isNetworkOnlyConfig, isProtectedVideoDeliveryUrl, NETWORK_ONLY_CONFIG } from './adblock-policy.ts'

const FIXTURE_FILTERS = [
  'http://127.0.0.1:*/blocked.js$script',
  '@@http://127.0.0.1:*/allowed.js$script'
].join('\n')

test('Ghostery fixture engine blocks matching requests and honors exceptions', () => {
  const blocker = ElectronBlocker.parse(FIXTURE_FILTERS, NETWORK_ONLY_CONFIG)

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

test('Ghostery fromLists builds the configured network-only engine without external network access', async () => {
  const fetchedUrls: string[] = []
  const blocker = await ElectronBlocker.fromLists(async (url) => {
    fetchedUrls.push(url)
    const body = url.endsWith('resources.json')
      ? JSON.stringify({ redirects: [], scriptlets: [] })
      : FIXTURE_FILTERS
    return new Response(body, { status: 200 })
  }, ['https://filters.example/list.txt'], NETWORK_ONLY_CONFIG)

  assert.ok(fetchedUrls.includes('https://filters.example/list.txt'))
  assert.ok(fetchedUrls.some((url) => url.endsWith('/resources.json')))
  assert.equal(isNetworkOnlyConfig(blocker.config), true)
  assert.equal(blocker.getFilters().networkFilters.length, 2)
})

test('network-only flags stay disabled and survive Ghostery cache serialization', () => {
  const blocker = ElectronBlocker.parse(FIXTURE_FILTERS, NETWORK_ONLY_CONFIG)
  const restored = ElectronBlocker.deserialize(blocker.serialize())

  assert.equal(isNetworkOnlyConfig(blocker.config), true)
  assert.equal(isNetworkOnlyConfig(restored.config), true)
  assert.equal(restored.config.loadNetworkFilters, true)
  assert.equal(restored.config.loadCosmeticFilters, false)
  assert.equal(restored.config.loadCSPFilters, false)
  assert.equal(restored.config.enableHtmlFiltering, false)
  assert.equal(restored.config.enableMutationObserver, false)
  assert.equal(restored.config.loadExtendedSelectors, false)
  assert.equal(restored.config.loadGenericCosmeticsFilters, false)
  assert.equal(isNetworkOnlyConfig(ElectronBlocker.parse(FIXTURE_FILTERS).config), false)
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
