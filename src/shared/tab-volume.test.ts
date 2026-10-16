import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeHttpOrigin, parseBrowserPreferences } from './persistence.ts'
import {
  MAX_SAVED_SITE_VOLUMES,
  effectiveMediaVolume,
  formatTabVolume,
  isDefaultTabVolume,
  normalizeTabVolume,
  parseSiteVolumes,
  resolveTabVolume,
  stepTabVolume,
  tabVolumeLevel,
  withSiteVolume,
  type TabVolumeState
} from './tab-volume.ts'

test('volume is kept in 0..1 and rounded to whole percent (no boost)', () => {
  assert.equal(normalizeTabVolume(0.333), 0.33)
  assert.equal(normalizeTabVolume(1.7), 1)
  assert.equal(normalizeTabVolume(-0.2), 0)
  assert.equal(normalizeTabVolume(Number.NaN), null)
  assert.equal(normalizeTabVolume('0.5'), null)
  assert.equal(isDefaultTabVolume(0.999), true)
  assert.equal(isDefaultTabVolume(0.9), false)
})

test('steps clamp at the ends', () => {
  assert.equal(stepTabVolume(0.5, 0.05), 0.55)
  assert.equal(stepTabVolume(0.98, 0.05), 1)
  assert.equal(stepTabVolume(0.03, -0.05), 0)
  assert.equal(stepTabVolume(0.7, -0.1), 0.6)
})

test('a media element plays at page volume × tab volume', () => {
  assert.equal(effectiveMediaVolume(0.8, 0.5), 0.4)
  assert.equal(effectiveMediaVolume(1, 0), 0)
  assert.equal(effectiveMediaVolume(0.6, 1), 0.6)
  assert.equal(effectiveMediaVolume(Number.NaN, 0.5), 0.5)
  assert.equal(effectiveMediaVolume(2, 2), 1)
})

test('icon level: muted wins, then off / low / high', () => {
  assert.equal(tabVolumeLevel(0.8, true), 'muted')
  assert.equal(tabVolumeLevel(0, false), 'off')
  assert.equal(tabVolumeLevel(0.3, false), 'low')
  assert.equal(tabVolumeLevel(0.5, false), 'high')
  assert.equal(formatTabVolume(0.456), '46%')
})

test('a tab keeps its level within a site and takes the saved level of a new site', () => {
  const saved: Record<string, number> = { 'https://music.test': 0.4 }
  const lookup = (origin: string): number | undefined => saved[origin]
  const state: TabVolumeState = { volume: 1, volumeOrigin: null }
  assert.equal(resolveTabVolume(state, 'https://music.test', lookup), 0.4)
  state.volume = 0.7 // set on the tab, same site
  assert.equal(resolveTabVolume(state, 'https://music.test', lookup), 0.7)
  // A local page / about:blank keeps the tab's level.
  assert.equal(resolveTabVolume(state, null, lookup), 0.7)
  assert.equal(resolveTabVolume(state, 'https://news.test', lookup), 1)
  assert.equal(state.volumeOrigin, 'https://news.test')
  assert.equal(resolveTabVolume(state, 'https://music.test', lookup), 0.4)
})

test('saved levels: newest last, 100% dropped, capped', () => {
  let saved = withSiteVolume({}, 'https://a.test', 0.5)
  saved = withSiteVolume(saved, 'https://b.test', 0.2)
  saved = withSiteVolume(saved, 'https://a.test', 0.6)
  assert.deepEqual(Object.keys(saved), ['https://b.test', 'https://a.test'])
  saved = withSiteVolume(saved, 'https://b.test', 1)
  assert.deepEqual(saved, { 'https://a.test': 0.6 })
  let many: Record<string, number> = {}
  for (let i = 0; i < MAX_SAVED_SITE_VOLUMES + 5; i += 1) many = withSiteVolume(many, `https://s${i}.test`, 0.5)
  assert.equal(Object.keys(many).length, MAX_SAVED_SITE_VOLUMES)
  assert.equal(Object.keys(many)[0], 'https://s5.test')
})

test('saved levels parse from disk with origins normalised and junk dropped', () => {
  const parsed = parseSiteVolumes({ 'https://example.com/path': 0.25, 'https://loud.test': 1, 'file:///tmp': 0.5, 'https://big.test': 3, 'https://bad.test': 'x' }, normalizeHttpOrigin)
  assert.deepEqual(parsed, { 'https://example.com': 0.25 })
  assert.deepEqual(parseSiteVolumes(null, normalizeHttpOrigin), {})
  const preferences = parseBrowserPreferences({ version: 1, siteVolume: { 'https://quiet.test': 0.3 } })
  assert.deepEqual(preferences.siteVolume, { 'https://quiet.test': 0.3 })
  assert.deepEqual(parseBrowserPreferences(null).siteVolume, {})
})
