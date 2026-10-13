/**
 * Network inspector mock / override rules: match a URL pattern + method, then answer with a
 * fixed status, headers and body, or block the request. Applied in main through CDP Fetch on
 * inspected tabs. Pure, so matching and validation are unit-tested.
 */
import type { NetworkHeader } from './types'

export type NetworkOverrideAction = 'respond' | 'block'

export interface NetworkOverrideRule {
  id: string
  enabled: boolean
  /** Matches when the URL contains it; `*` matches any run of characters. Case-sensitive. */
  urlPattern: string
  /** `*` for any method, else e.g. GET / POST (case-insensitive). */
  method: string
  action: NetworkOverrideAction
  status: number
  headers: NetworkHeader[]
  body: string
}

export const MAX_OVERRIDE_RULES = 50
export const MAX_OVERRIDE_BODY_CHARACTERS = 1_000_000
const MAX_PATTERN_LENGTH = 2048
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const METHOD = /^[A-Za-z]{1,16}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Unanchored glob: the pieces between `*` must appear in order. */
export function overridePatternMatches(pattern: string, url: string): boolean {
  if (!pattern) return false
  const pieces = pattern.split('*')
  let position = 0
  for (const piece of pieces) {
    if (!piece) continue
    const index = url.indexOf(piece, position)
    if (index < 0) return false
    position = index + piece.length
  }
  return true
}

export function overrideMethodMatches(ruleMethod: string, method: string): boolean {
  return ruleMethod === '*' || ruleMethod.toUpperCase() === method.toUpperCase()
}

/** URL without its #fragment (never sent, and CDP leaves it out too). */
function withoutFragment(url: string): string {
  const index = url.indexOf('#')
  return index < 0 ? url : url.slice(0, index)
}

/** First enabled rule for this request, in list order. */
export function matchOverrideRule(rules: NetworkOverrideRule[], request: { url: string; method: string }): NetworkOverrideRule | null {
  const url = withoutFragment(request.url)
  return rules.find((rule) => rule.enabled && overrideMethodMatches(rule.method, request.method) && overridePatternMatches(rule.urlPattern, url)) ?? null
}

export function hasActiveOverrides(rules: NetworkOverrideRule[]): boolean {
  return rules.some((rule) => rule.enabled)
}

/**
 * CDP Fetch.enable patterns: `*pattern*` with CDP's `?` wildcard and `\` escape neutralised, so
 * Chromium pauses a superset of what the rules match (main re-checks each paused request).
 */
export function cdpFetchPatterns(rules: NetworkOverrideRule[]): Array<{ urlPattern: string; requestStage: 'Request' }> {
  const patterns = new Set<string>()
  for (const rule of rules) {
    if (!rule.enabled) continue
    const escaped = rule.urlPattern.replace(/[\\?]/g, (character) => `\\${character}`)
    patterns.add(`*${escaped}*`.replace(/\*{2,}/g, '*'))
  }
  return [...patterns].map((urlPattern) => ({ urlPattern, requestStage: 'Request' as const }))
}

function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  return btoa(binary)
}

export type OverrideCdpCommand =
  | { method: 'Fetch.fulfillRequest'; params: { requestId: string; responseCode: number; responseHeaders: NetworkHeader[]; body: string } }
  | { method: 'Fetch.failRequest'; params: { requestId: string; errorReason: 'BlockedByClient' } }

/** The CDP command that carries out a rule for one paused request. */
export function overrideCommand(rule: NetworkOverrideRule, requestId: string): OverrideCdpCommand {
  if (rule.action === 'block') return { method: 'Fetch.failRequest', params: { requestId, errorReason: 'BlockedByClient' } }
  const headers = rule.headers.map((header) => ({ name: header.name, value: header.value }))
  if (!headers.some((header) => header.name.toLowerCase() === 'content-type') && rule.body) headers.push({ name: 'Content-Type', value: 'text/plain; charset=utf-8' })
  headers.push({ name: 'X-Surffish-Override', value: rule.id })
  return { method: 'Fetch.fulfillRequest', params: { requestId, responseCode: rule.status, responseHeaders: headers, body: base64Utf8(rule.body) } }
}

/** Strict validation for a rule from the UI. Throws a user-facing message. */
export function validateOverrideRule(input: unknown): NetworkOverrideRule {
  if (!isRecord(input)) throw new Error('An override needs a URL pattern and an action.')
  const id = typeof input.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(input.id) ? input.id : ''
  if (!id) throw new Error('Override is missing its id.')
  const urlPattern = typeof input.urlPattern === 'string' ? input.urlPattern.trim() : ''
  if (!urlPattern) throw new Error('Enter a URL pattern, e.g. api.example.com/v1/*.')
  if (urlPattern.length > MAX_PATTERN_LENGTH) throw new Error('That URL pattern is too long.')
  if (/[\r\n]/.test(urlPattern)) throw new Error('URL patterns are a single line.')
  const rawMethod = typeof input.method === 'string' ? input.method.trim() : '*'
  const method = rawMethod === '' || rawMethod === '*' ? '*' : rawMethod.toUpperCase()
  if (method !== '*' && !METHOD.test(method)) throw new Error(`“${rawMethod}” isn't an HTTP method.`)
  const action: NetworkOverrideAction = input.action === 'block' ? 'block' : input.action === 'respond' ? 'respond' : (() => { throw new Error('Choose Respond or Block.') })()
  const status = action === 'block' ? 0 : Number(input.status)
  if (action === 'respond' && (!Number.isInteger(status) || status < 100 || status > 599)) throw new Error('Status must be a number from 100 to 599.')
  const headers: NetworkHeader[] = []
  for (const raw of Array.isArray(input.headers) ? input.headers : []) {
    if (!isRecord(raw)) continue
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    const value = typeof raw.value === 'string' ? raw.value.trim() : ''
    if (!name && !value) continue
    if (!HEADER_NAME.test(name)) throw new Error(`“${name}” isn't a valid header name.`)
    if (/[\r\n\0]/.test(value)) throw new Error(`Header ${name} can't contain line breaks.`)
    headers.push({ name, value })
  }
  if (headers.length > 50) throw new Error('Up to 50 headers per override.')
  const body = action === 'respond' && typeof input.body === 'string' ? input.body : ''
  if (body.length > MAX_OVERRIDE_BODY_CHARACTERS) throw new Error('Override bodies are limited to 1 MB.')
  return { id, enabled: input.enabled !== false, urlPattern, method, action, status, headers: action === 'block' ? [] : headers, body }
}

export function validateOverrideRules(input: unknown): NetworkOverrideRule[] {
  if (!Array.isArray(input)) throw new Error('Overrides must be a list.')
  if (input.length > MAX_OVERRIDE_RULES) throw new Error(`Up to ${MAX_OVERRIDE_RULES} overrides.`)
  const rules = input.map(validateOverrideRule)
  const ids = new Set<string>()
  for (const rule of rules) {
    if (ids.has(rule.id)) throw new Error('Two overrides share an id.')
    ids.add(rule.id)
  }
  return rules
}

/** A text blob for a "Paste headers" box: `Name: value` per line. */
export function parseHeaderLines(text: string): NetworkHeader[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const index = line.indexOf(':')
    return index <= 0 ? { name: line, value: '' } : { name: line.slice(0, index).trim(), value: line.slice(index + 1).trim() }
  })
}

export function formatHeaderLines(headers: NetworkHeader[]): string {
  return headers.map((header) => `${header.name}: ${header.value}`).join('\n')
}

/** What the Network view and the toolbar badge show about overrides. */
export interface NetworkOverridesState {
  rules: NetworkOverrideRule[]
  /** Some rule is on and the inspector is capturing, so requests are being intercepted. */
  active: boolean
  /** How many requests each rule has answered or blocked this session. */
  hits: Record<string, number>
}

export interface NetworkReplayResult {
  ok: boolean
  status: number | null
  statusText: string
  /** Response body bytes read (capped). */
  sizeBytes: number
  sizeCapped: boolean
  durationMs: number
  finalUrl: string
  redirected: boolean
  error: string | null
}

export interface NetworkHarExportResult {
  saved: boolean
  path: string | null
  entries: number
  bodies: number
  error: string | null
}

export interface NetworkCopyResult {
  text: string
  /** Set when the snippet can't fully reproduce the request (payload not retained / truncated). */
  warning: string | null
}
