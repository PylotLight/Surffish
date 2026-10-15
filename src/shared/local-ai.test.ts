import { describe, expect, test } from 'bun:test'
import { DEFAULT_LOCAL_AI_SETTINGS, isLocalAIOrigin, isLoopbackBaseUrl, messageText, parseLocalAISettings } from './local-ai'

describe('local AI settings', () => {
  test('off by default, echo provider', () => {
    expect(parseLocalAISettings(null)).toEqual(DEFAULT_LOCAL_AI_SETTINGS)
    expect(parseLocalAISettings({ enabled: 'yes' }).enabled).toBe(false)
  })
  test('loopback servers only', () => {
    expect(isLoopbackBaseUrl('http://127.0.0.1:1234/v1')).toBe(true)
    expect(isLoopbackBaseUrl('http://localhost:11434/v1')).toBe(true)
    expect(isLoopbackBaseUrl('https://api.openai.com/v1')).toBe(false)
    expect(isLoopbackBaseUrl('file:///etc/passwd')).toBe(false)
    expect(parseLocalAISettings({ baseUrl: 'http://127.0.0.1:1234/v1/' }).baseUrl).toBe('http://127.0.0.1:1234/v1')
  })
  test('a bad change keeps the current value', () => {
    const current = { enabled: true, provider: 'openai-compatible' as const, baseUrl: 'http://127.0.0.1:9/v1', model: 'm' }
    expect(parseLocalAISettings({ baseUrl: 'https://example.com/v1', provider: 'nope' }, current)).toEqual(current)
    expect(parseLocalAISettings({ enabled: false }, current)).toEqual({ ...current, enabled: false })
  })
  test('origins and message text', () => {
    expect(isLocalAIOrigin('https://example.com')).toBe(true)
    expect(isLocalAIOrigin('chrome-extension://abc')).toBe(true)
    expect(isLocalAIOrigin('file://')).toBe(false)
    expect(messageText({ role: 'user', content: [{ type: 'text', value: 'a' }, { type: 'image', value: new ArrayBuffer(1) }, { type: 'text', value: 'b' }] })).toBe('ab')
  })
})
