import { describe, expect, test } from 'bun:test'
import { brambleCameraDecision, isBrambleExtensionOrigin } from './bramble-camera.ts'

const ID = 'abcdefghijklmnopabcdefghijklmnop'
const OPTIONS = `chrome-extension://${ID}/options.html`

describe('isBrambleExtensionOrigin', () => {
  test('only the loaded Bramble extension', () => {
    expect(isBrambleExtensionOrigin(OPTIONS, ID)).toBe(true)
    expect(isBrambleExtensionOrigin(`chrome-extension://${ID}/`, ID)).toBe(true)
    expect(isBrambleExtensionOrigin('chrome-extension://otherotherotherotherotherotherot/options.html', ID)).toBe(false)
    expect(isBrambleExtensionOrigin(`https://${ID}/options.html`, ID)).toBe(false)
    expect(isBrambleExtensionOrigin(OPTIONS, null)).toBe(false)
    expect(isBrambleExtensionOrigin(undefined, ID)).toBe(false)
    expect(isBrambleExtensionOrigin('not a url', ID)).toBe(false)
  })
})

describe('brambleCameraDecision', () => {
  test('video-only requests from Bramble are allowed', () => {
    expect(brambleCameraDecision('media', OPTIONS, ID, { mediaTypes: ['video'] })).toBe('allow')
    expect(brambleCameraDecision('media', OPTIONS, ID, { mediaType: 'video' })).toBe('allow')
  })
  test('microphone or unknown media from Bramble is denied (visibly, by the caller)', () => {
    expect(brambleCameraDecision('media', OPTIONS, ID, { mediaTypes: ['video', 'audio'] })).toBe('deny')
    expect(brambleCameraDecision('media', OPTIONS, ID, { mediaTypes: ['audio'] })).toBe('deny')
    expect(brambleCameraDecision('media', OPTIONS, ID, { mediaTypes: [] })).toBe('deny')
    expect(brambleCameraDecision('media', OPTIONS, ID, { mediaType: 'audio' })).toBe('deny')
    expect(brambleCameraDecision('media', OPTIONS, ID, { mediaType: 'unknown' })).toBe('deny')
  })
  test('other origins and permissions fall through to the site policy', () => {
    expect(brambleCameraDecision('media', 'https://example.com/', ID, { mediaTypes: ['video'] })).toBe('not-bramble')
    expect(brambleCameraDecision('geolocation', OPTIONS, ID, {})).toBe('not-bramble')
    expect(brambleCameraDecision('media', OPTIONS, null, { mediaTypes: ['video'] })).toBe('not-bramble')
  })
})
