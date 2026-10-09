import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveNavigationTarget } from './navigation.ts'

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

test('sends ordinary text to DuckDuckGo', () => {
  assert.equal(resolveNavigationTarget('cats'), 'https://duckduckgo.com/?q=cats')
  assert.equal(resolveNavigationTarget('best coffee near me'), 'https://duckduckgo.com/?q=best+coffee+near+me')
})

test('rejects unsafe schemes and empty input', () => {
  assert.equal(resolveNavigationTarget('javascript:alert(1)'), null)
  assert.equal(resolveNavigationTarget('file:///etc/passwd'), null)
  assert.equal(resolveNavigationTarget('   '), null)
})
