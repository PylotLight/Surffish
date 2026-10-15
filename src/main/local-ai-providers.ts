import { messageText, type LocalAISettings, type PromptMessage } from '../shared/local-ai'

/**
 * Answers a Prompt API conversation. Runs in the local AI utility process. Add a provider here and
 * to LOCAL_AI_PROVIDERS (src/shared/local-ai.ts); `history` is the session's whole conversation
 * (initial prompts, appended and earlier turns, then this prompt).
 */
type Provider = (history: PromptMessage[], settings: LocalAISettings, signal?: AbortSignal) => Promise<string>

const echo: Provider = async (history) => {
  const last = [...history].reverse().find((message) => message.role === 'user')
  return `Echo: ${last ? messageText(last) : ''}`
}

const openAICompatible: Provider = async (history, settings, signal) => {
  const response = await fetch(`${settings.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...(settings.model ? { model: settings.model } : {}),
      messages: history.map((message) => ({ role: message.role, content: messageText(message) })),
      stream: false
    }),
    signal
  })
  if (!response.ok) throw new Error(`AI provider: HTTP ${response.status}`)
  const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] }
  const content = body.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('AI provider: no message in the response')
  return content
}

const PROVIDERS: Record<LocalAISettings['provider'], Provider> = { echo, 'openai-compatible': openAICompatible }

export function respond(history: PromptMessage[], settings: LocalAISettings, signal?: AbortSignal): Promise<string> {
  return PROVIDERS[settings.provider](history, settings, signal)
}

/** Rough token count for contextUsage/measureContextUsage (≈4 characters a token). */
export function estimateTokens(messages: PromptMessage[]): number {
  return Math.ceil(messages.reduce((total, message) => total + messageText(message).length, 0) / 4)
}
