import assert from 'node:assert/strict'
import test from 'node:test'
import { buildScreenShareChoices, MAX_WINDOW_CHOICES, screenShareAllowedFor } from './screen-share.ts'

test('only secure contexts may ask for the screen picker', () => {
  assert.equal(screenShareAllowedFor('https://meet.google.com'), true)
  assert.equal(screenShareAllowedFor('http://localhost:3000'), true)
  assert.equal(screenShareAllowedFor('http://127.0.0.1:8080/'), true)
  assert.equal(screenShareAllowedFor('http://app.localhost'), true)
  assert.equal(screenShareAllowedFor('http://example.com'), false)
  assert.equal(screenShareAllowedFor('file:///etc/passwd'), false)
  assert.equal(screenShareAllowedFor('not a url'), false)
})

test('fallback chooser: this tab, screens, then a capped list of other windows', () => {
  const windows = Array.from({ length: 9 }, (_unused, index) => ({ id: `window:${index}:0`, name: `Window ${index}` }))
  const choices = buildScreenShareChoices([
    { id: 'screen:1:0', name: 'Entire screen' },
    { id: 'window:99:0', name: 'Surffish' },
    { id: 'window:98:0', name: '   ' },
    ...windows
  ], { canShareTab: true, ownWindowNames: ['Surffish'] })
  assert.deepEqual(choices.slice(0, 2).map((choice) => choice.label), ['This tab', 'Entire screen'])
  const windowChoices = choices.filter((choice) => choice.kind === 'source' && choice.source.kind === 'window')
  assert.equal(windowChoices.length, MAX_WINDOW_CHOICES)
  assert.ok(!choices.some((choice) => choice.label === 'Surffish'), 'Surffish windows are left out')
})

test('several screens are numbered; no tab choice for a subframe request; long names are cut', () => {
  const choices = buildScreenShareChoices([
    { id: 'screen:1:0', name: 'Screen 1' },
    { id: 'screen:2:0', name: 'DELL U2723QE' },
    { id: 'window:5:0', name: 'x'.repeat(80) }
  ], { canShareTab: false })
  assert.deepEqual(choices.slice(0, 2).map((choice) => choice.label), ['Screen 1', 'Screen 2 (DELL U2723QE)'])
  assert.ok(choices[2]!.label.endsWith('…'))
  assert.equal(choices[2]!.label.length, 48)
})
