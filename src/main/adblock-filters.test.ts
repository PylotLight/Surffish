import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFilterEngine, frameStartPayload, frameUpdateStyles } from './adblock-filters.ts'
import { SCRIPTLET_RESOURCES_URL, type FilterListSource } from './adblock-policy.ts'

// Minimal resources.json with a real-shaped scriptlet so +js rules compile.
const RESOURCES = JSON.stringify({
  redirects: [],
  scriptlets: [
    {
      name: 'set-constant.js',
      aliases: ['set.js'],
      body: 'function setConstant(a, b) { window.__sockfishSet = [a, b] }',
      dependencies: []
    },
    {
      name: 'json-prune.js',
      aliases: [],
      body: 'function jsonPrune(a) { window.__sockfishPrune = a }',
      dependencies: []
    }
  ]
})

const MAIN_LIST = [
  '! Title: fixture',
  '!#include part.txt',
  '||ads.example^$script',
  'example.com##.banner-ad',
  '##.generic-ad-slot',
  'www.youtube.com##+js(json-prune, playerResponse.adPlacements)',
  '!#if env_firefox',
  'example.com##.firefox-only',
  '!#endif',
  '!#if env_chromium',
  'example.com##.chromium-only',
  '!#endif',
  '!#if cap_html_filtering',
  'example.com##^script:has-text(ads)',
  '!#else',
  'example.com##+js(set, noHtmlFiltering, true)',
  '!#endif'
].join('\n')

const SOURCES: FilterListSource[] = [
  { id: 'ublock-filters', url: 'https://lists.example/filters/main.txt' },
  { id: 'ublock-quick-fixes', url: 'https://lists.example/filters/quick.txt' },
  { id: 'easylist', url: 'https://lists.example/easylist.txt' },
  { id: 'optional-broken', url: 'https://lists.example/missing.txt' }
]

function fixtureFetch(requested: string[]) {
  return async (url: string): Promise<Response> => {
    requested.push(url)
    if (url === SCRIPTLET_RESOURCES_URL) return new Response(RESOURCES)
    if (url.endsWith('/main.txt')) return new Response(MAIN_LIST)
    if (url.endsWith('/part.txt')) return new Response('||included.example^')
    if (url.endsWith('/quick.txt')) return new Response('www.youtube.com##+js(set, ytcfg.flag, false)')
    if (url.endsWith('/easylist.txt')) return new Response('##.easylist-ad')
    return new Response('missing', { status: 404 })
  }
}

test('builds a full engine from lists, expands includes and tolerates optional failures', async () => {
  const requested: string[] = []
  const built = await buildFilterEngine(fixtureFetch(requested), SOURCES)
  assert.ok(requested.includes('https://lists.example/filters/part.txt'), 'include fetched')
  assert.deepEqual(built.loadedLists, ['ublock-filters', 'ublock-quick-fixes', 'easylist'])
  assert.deepEqual(built.failedLists, ['optional-broken'])

  const decide = (url: string) => {
    let response: Electron.CallbackResponse | undefined
    built.engine.onBeforeRequest({ id: 1, url, resourceType: 'script', referrer: 'https://news.example/', webContentsId: 1 } as Parameters<typeof built.engine.onBeforeRequest>[0], (result) => { response = result })
    return response
  }
  assert.deepEqual(decide('https://ads.example/a.js'), { cancel: true })
  assert.deepEqual(decide('https://included.example/a.js'), { cancel: true })
  assert.deepEqual(decide('https://cdn.example/app.js'), {})
})

test('fails when a required list is missing so the previous engine stays active', async () => {
  const fetch = async (url: string): Promise<Response> => {
    if (url === SCRIPTLET_RESOURCES_URL) return new Response(RESOURCES)
    if (url.endsWith('/quick.txt')) return new Response('down', { status: 503 })
    return fixtureFetch([])(url)
  }
  await assert.rejects(buildFilterEngine(fetch, SOURCES), /ublock-quick-fixes/)
})

test('frame start payload carries YouTube scriptlets and site CSS, honoring !#if', async () => {
  const { engine } = await buildFilterEngine(fixtureFetch([]), SOURCES)

  const youtube = frameStartPayload(engine, 'https://www.youtube.com/watch?v=abc')
  assert.equal(youtube.active, true)
  assert.equal(youtube.observe, true)
  const youtubeScripts = youtube.scripts.join('\n')
  assert.match(youtubeScripts, /__sockfishPrune/)
  assert.match(youtubeScripts, /playerResponse\\?\.adPlacements/)
  assert.match(youtubeScripts, /__sockfishSet/)

  const example = frameStartPayload(engine, 'https://example.com/')
  assert.match(example.styles, /\.banner-ad/)
  assert.match(example.styles, /\.chromium-only/)
  assert.doesNotMatch(example.styles, /\.firefox-only/)
  assert.match(example.scripts.join('\n'), /noHtmlFiltering/)

  assert.deepEqual(frameStartPayload(engine, 'about:blank'), { active: false, styles: '', scripts: [], observe: false })
})

test('generic cosmetic CSS is returned only for DOM features the page has', async () => {
  const { engine } = await buildFilterEngine(fixtureFetch([]), SOURCES)
  const styles = frameUpdateStyles(engine, 'https://news.example/', { classes: ['generic-ad-slot', 'content'], ids: [], hrefs: [] })
  assert.match(styles, /\.generic-ad-slot/)
  assert.equal(frameUpdateStyles(engine, 'https://news.example/', { classes: ['content'] }), '')
  assert.equal(frameUpdateStyles(engine, 'https://news.example/', { classes: 'not-an-array' }), '')
})
