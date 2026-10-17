// Feedback shaping for the shared feedback gateway. Deliberately pure — no
// Electron, no I/O — so it is unit-testable and safe to import from anywhere.

export type FeedbackKind = 'bug' | 'idea' | 'other'

export interface FeedbackInput {
  message: string
  kind?: FeedbackKind
  contact?: string
}

export interface FeedbackContext {
  appVersion: string
  platform: string
  arch: string
  electron?: string
  locale?: string
}

export const FEEDBACK_MAX_MESSAGE = 20000

/** A human-readable problem with the input, or null when it is sendable. */
export function feedbackValidationError(input: FeedbackInput): string | null {
  if (!input.message || !input.message.trim()) return 'Please describe your feedback.'
  if (input.message.length > FEEDBACK_MAX_MESSAGE) return 'That message is too long — please shorten it.'
  return null
}

/** The JSON body the gateway expects, with app/OS context attached. */
export function buildFeedbackPayload(input: FeedbackInput, context: FeedbackContext): Record<string, unknown> {
  const metadata: Record<string, string> = {
    version: context.appVersion,
    platform: `${context.platform} ${context.arch}`
  }
  if (context.electron) metadata.electron = context.electron
  if (context.locale) metadata.locale = context.locale
  if (input.contact && input.contact.trim()) metadata.contact = input.contact.trim()

  const payload: Record<string, unknown> = {
    app: 'surffish',
    message: input.message.trim(),
    metadata
  }
  // The gateway's `type` maps onto GitHub labels.
  if (input.kind === 'bug') payload.type = 'bug'
  else if (input.kind === 'idea') payload.type = 'feature'
  return payload
}
