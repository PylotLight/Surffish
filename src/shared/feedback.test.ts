import { describe, expect, test } from 'bun:test'
import { FEEDBACK_MAX_MESSAGE, buildFeedbackPayload, feedbackValidationError } from './feedback'

const context = { appVersion: '0.1.22', platform: 'darwin', arch: 'arm64', electron: '38.0.0', locale: 'en-GB' }

describe('feedbackValidationError', () => {
  test('rejects empty and whitespace-only messages', () => {
    expect(feedbackValidationError({ message: '' })).toBeTruthy()
    expect(feedbackValidationError({ message: '   \n ' })).toBeTruthy()
  })

  test('rejects over-long messages', () => {
    expect(feedbackValidationError({ message: 'x'.repeat(FEEDBACK_MAX_MESSAGE + 1) })).toBeTruthy()
  })

  test('accepts a normal message', () => {
    expect(feedbackValidationError({ message: 'Sidebar hides the close button' })).toBeNull()
  })
})

describe('buildFeedbackPayload', () => {
  test('always tags the app and attaches platform context', () => {
    const payload = buildFeedbackPayload({ message: '  hello  ' }, context)
    expect(payload.app).toBe('surffish')
    expect(payload.message).toBe('hello')
    expect(payload.metadata).toEqual({
      version: '0.1.22',
      platform: 'darwin arm64',
      electron: '38.0.0',
      locale: 'en-GB'
    })
    expect(payload.type).toBeUndefined()
  })

  test('maps bug and idea kinds onto gateway types', () => {
    expect(buildFeedbackPayload({ message: 'x', kind: 'bug' }, context).type).toBe('bug')
    expect(buildFeedbackPayload({ message: 'x', kind: 'idea' }, context).type).toBe('feature')
    expect(buildFeedbackPayload({ message: 'x', kind: 'other' }, context).type).toBeUndefined()
  })

  test('includes contact only when provided and non-empty', () => {
    expect((buildFeedbackPayload({ message: 'x', contact: '  ' }, context).metadata as Record<string, string>).contact).toBeUndefined()
    expect((buildFeedbackPayload({ message: 'x', contact: ' a@b.co ' }, context).metadata as Record<string, string>).contact).toBe('a@b.co')
  })

  test('omits optional context when absent', () => {
    const payload = buildFeedbackPayload({ message: 'x' }, { appVersion: '1', platform: 'win32', arch: 'x64' })
    expect(payload.metadata).toEqual({ version: '1', platform: 'win32 x64' })
  })
})
