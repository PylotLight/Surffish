import assert from 'node:assert/strict'
import test from 'node:test'
import { addressDisplayValue, isAddressEdited, isTypingIn, nextAddressValue } from './address-bar-sync.ts'

const AUTH = 'https://scaledown.ai/auth'
const APP = 'https://scaledown.ai/app/chat'

test('a URL change reaches an unfocused bar', () => {
  assert.equal(nextAddressValue({ value: AUTH, synced: AUTH, next: APP, typing: false, reason: 'url' }), APP)
})

test('a focused but untouched bar still follows redirects / pushState (the stuck-on-/auth bug)', () => {
  assert.equal(nextAddressValue({ value: AUTH, synced: AUTH, next: APP, typing: true, reason: 'url' }), APP)
})

test('half-typed text survives URL changes while the user is typing', () => {
  assert.equal(nextAddressValue({ value: 'scaled', synced: AUTH, next: APP, typing: true, reason: 'url' }), null)
})

test('typed text left behind in a bar that lost focus gives way to the next navigation', () => {
  assert.equal(nextAddressValue({ value: 'scaled', synced: AUTH, next: APP, typing: false, reason: 'url' }), APP)
})

test('blur keeps typed text but resyncs an untouched bar that fell behind', () => {
  assert.equal(nextAddressValue({ value: 'scaled', synced: AUTH, next: AUTH, typing: false, reason: 'blur' }), null)
  assert.equal(nextAddressValue({ value: AUTH, synced: AUTH, next: APP, typing: false, reason: 'blur' }), APP)
  assert.equal(nextAddressValue({ value: APP, synced: APP, next: APP, typing: false, reason: 'blur' }), null)
})

test('switching tabs always shows the new tab, dropping typed text', () => {
  assert.equal(nextAddressValue({ value: 'scaled', synced: AUTH, next: APP, typing: true, reason: 'tab' }), APP)
  assert.equal(nextAddressValue({ value: APP, synced: AUTH, next: APP, typing: true, reason: 'tab' }), null)
})

test('the local New Tab page shows an empty bar', () => {
  assert.equal(addressDisplayValue(APP, true), '')
  assert.equal(addressDisplayValue(APP, false), APP)
  assert.equal(nextAddressValue({ value: '', synced: '', next: APP, typing: true, reason: 'url' }), APP)
})

test('edited means "differs from the last synced URL"', () => {
  assert.equal(isAddressEdited(AUTH, AUTH), false)
  assert.equal(isAddressEdited(`${AUTH}x`, AUTH), true)
})

test('typing needs the input focused and its document focused (activeElement alone sticks across views)', () => {
  const input = {}
  assert.equal(isTypingIn(input, { activeElement: input, hasFocus: () => true }), true)
  // Focus moved to the page WebContentsView / an extension popup: activeElement stays the input.
  assert.equal(isTypingIn(input, { activeElement: input, hasFocus: () => false }), false)
  assert.equal(isTypingIn(input, { activeElement: {}, hasFocus: () => true }), false)
  assert.equal(isTypingIn(null, { activeElement: null, hasFocus: () => true }), false)
})
