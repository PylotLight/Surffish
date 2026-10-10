import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFrequentSites, MAX_FREQUENT_SITES, toQuickLinkSite } from './quick-links.ts'
import type { BrowsingHistoryEntry, PinnedSite } from './types'

function visit(id: string, url: string, title: string, visitedAt: number): BrowsingHistoryEntry {
  return { id, url, title, visitedAt }
}

test('ranks frequent origins by visits and uses the latest local page title', () => {
  const history = [
    visit('1', 'https://alpha.test/first', 'Alpha old title', 10),
    visit('2', 'https://beta.test/', 'Beta', 20),
    visit('3', 'https://alpha.test/latest', 'Alpha latest title', 30),
    visit('4', 'https://alpha.test/third', 'Alpha middle title', 15),
    visit('5', 'http://gamma.test/path', 'Gamma', 40)
  ]
  assert.deepEqual(buildFrequentSites(history, []), [
    { title: 'Alpha latest title', url: 'https://alpha.test', origin: 'https://alpha.test' },
    { title: 'Gamma', url: 'http://gamma.test', origin: 'http://gamma.test' },
    { title: 'Beta', url: 'https://beta.test', origin: 'https://beta.test' }
  ])
})

test('omits pinned origins from frequent tiles and respects the local tile cap', () => {
  const pins: PinnedSite[] = [{ title: 'Favorite Alpha', url: 'https://alpha.test/' }]
  const history = Array.from({ length: MAX_FREQUENT_SITES + 3 }, (_, index) => visit(
    String(index), `https://site${index}.test/`, `Site ${index}`, index
  ))
  history.unshift(visit('alpha', 'https://alpha.test/page', 'Alpha', 1000))
  const sites = buildFrequentSites(history, pins)
  assert.equal(sites.length, MAX_FREQUENT_SITES)
  assert.ok(sites.every((site) => site.origin !== 'https://alpha.test'))
  assert.equal(sites[0]?.origin, 'https://site10.test')
})

test('normalizes favorite tiles by origin and rejects unsafe or credential-bearing URLs', () => {
  assert.deepEqual(toQuickLinkSite({ title: '  Example  ', url: 'https://example.test/path?q=secret' }), {
    title: 'Example', url: 'https://example.test', origin: 'https://example.test'
  })
  assert.equal(toQuickLinkSite({ title: 'Unsafe', url: 'javascript:alert(1)' }), null)
  assert.equal(toQuickLinkSite({ title: 'Credentials', url: 'https://user:pass@example.test/' }), null)
})
