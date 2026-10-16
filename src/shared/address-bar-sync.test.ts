import assert from 'node:assert/strict'
import test from 'node:test'
import { addressDisplayValue, isAddressEdited, isTypingIn, liveAddressValue, nextAddressValue } from './address-bar-sync.ts'

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

test('a keystroke React has not committed yet still counts as typing (typed text was replaced by a late URL)', () => {
  // The bar still showed the previous page (the tab broadcast for the new one was in flight), the
  // user typed over the selected URL, and the URL update's sync ran before the keystroke's state
  // was committed. The rendered value still said "unedited", so the new URL replaced "surftube".
  const previous = 'http://www.surftube.test/@vsauce'
  const current = 'http://www.surftube.test/home'
  const input = { value: 'surftube' }
  assert.equal(nextAddressValue({ value: previous, synced: previous, next: current, typing: true, reason: 'url' }), current, 'the stale rendered value would overwrite the keystroke')
  assert.equal(liveAddressValue(input, previous), 'surftube', 'the field itself is what the bar shows')
  assert.equal(nextAddressValue({ value: liveAddressValue(input, previous), synced: previous, next: current, typing: true, reason: 'url' }), null, 'so the typed text is kept')
  // Once it is no longer being typed in, the same text still gives way to the next navigation.
  assert.equal(nextAddressValue({ value: liveAddressValue(input, previous), synced: previous, next: current, typing: false, reason: 'url' }), current)
})

test('with no input mounted the rendered value is used', () => {
  assert.equal(liveAddressValue(null, 'https://example.com/'), 'https://example.com/')
  assert.equal(liveAddressValue(undefined, ''), '')
})
