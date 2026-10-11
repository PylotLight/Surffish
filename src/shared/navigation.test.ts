import assert from 'node:assert/strict'
import test from 'node:test'
import { isBrowserTabSleeping, isYouTubeUrl, resolveNavigationTarget, SURFFISH_QUICK_LINKS_URL } from './navigation.ts'

test('keeps explicit HTTP and HTTPS URLs as URLs', () => {
  assert.equal(resolveNavigationTarget('https://example.org/path'), 'https://example.org/path')
  assert.equal(resolveNavigationTarget('http://example.org'), 'http://example.org/')
})

test('adds HTTPS to domain-like addresses', () => {
  assert.equal(resolveNavigationTarget('example.org'), 'https://example.org/')
  assert.equal(resolveNavigationTarget('example.org:8443/a'), 'https://example.org:8443/a')
})

test('uses HTTP for loopback development addresses', () => {
  assert.equal(resolveNavigationTarget('localhost:3000'), 'http://localhost:3000/')
  assert.equal(resolveNavigationTarget('127.0.0.1:8080'), 'http://127.0.0.1:8080/')
})

test('sends ordinary text to Brave Search by default', () => {
  assert.equal(resolveNavigationTarget('cats'), 'https://search.brave.com/search?q=cats')
  assert.equal(resolveNavigationTarget('best coffee near me'), 'https://search.brave.com/search?q=best+coffee+near+me')
})

test('sends searches to the selected provider', () => {
  assert.equal(resolveNavigationTarget('cats', 'duckduckgo'), 'https://duckduckgo.com/?q=cats')
  assert.equal(resolveNavigationTarget('cats', 'google'), 'https://www.google.com/search?q=cats')
  assert.equal(resolveNavigationTarget('cats', 'bing'), 'https://www.bing.com/search?q=cats')
})

test('rejects unsafe schemes and empty input', () => {
  assert.equal(resolveNavigationTarget('javascript:alert(1)'), null)
  assert.equal(resolveNavigationTarget('file:///etc/passwd'), null)
  assert.equal(resolveNavigationTarget('   '), null)
})

test('does not mark the renderer-owned New Tab as sleeping when it has no BrowserView', () => {
  assert.equal(isBrowserTabSleeping(false, SURFFISH_QUICK_LINKS_URL), false)
  assert.equal(isBrowserTabSleeping(false, 'https://example.org/'), true)
  assert.equal(isBrowserTabSleeping(true, 'https://example.org/'), false)
})

test('recognizes YouTube destinations without matching lookalike hosts or schemes', () => {
  assert.equal(isYouTubeUrl('https://www.youtube.com/watch?v=abc'), true)
  assert.equal(isYouTubeUrl('https://music.youtube.com/watch?v=abc'), true)
  assert.equal(isYouTubeUrl('https://youtu.be/abc'), true)
  assert.equal(isYouTubeUrl('https://www.youtube-nocookie.com/embed/abc'), true)
  assert.equal(isYouTubeUrl('https://youtube.com.attacker.example/watch?v=abc'), false)
  assert.equal(isYouTubeUrl('https://notyoutube.com/watch?v=abc'), false)
  assert.equal(isYouTubeUrl('javascript:https://youtube.com/'), false)
  assert.equal(isYouTubeUrl('not a URL'), false)
})
