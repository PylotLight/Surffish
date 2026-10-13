/**
 * "Copy as cURL" / "Copy as fetch" for a captured request. Pure, so the escaping is unit-tested:
 * whatever a page put in a URL, header or body must come out as inert data in the shell / JS.
 */
import type { NetworkHeader } from './types'

export interface SnippetRequest {
  method: string
  url: string
  headers: NetworkHeader[]
  /** Request payload as captured; null when there is none (or Chromium didn't keep it). */
  body: string | null
}

/** HTTP/2 pseudo-headers and ones the client computes itself. */
const SKIPPED_HEADERS = new Set(['content-length', 'host', 'connection'])

function keptHeaders(headers: NetworkHeader[]): NetworkHeader[] {
  return headers.filter((header) => !header.name.startsWith(':') && !SKIPPED_HEADERS.has(header.name.toLowerCase()))
}

/**
 * POSIX shell quoting. Plain printable ASCII goes in single quotes (nothing is special inside
 * them except the quote itself). Anything else (newlines, control characters, non-ASCII) uses
 * bash/zsh ANSI-C quoting $'...' with every risky character escaped (non-ASCII as UTF-8 bytes).
 */
export function shellQuote(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return `'${value.replace(/'/g, `'\\''`)}'`
  let out = "$'"
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (character === '\\') out += '\\\\'
    else if (character === "'") out += "\\'"
    else if (character === '\n') out += '\\n'
    else if (character === '\r') out += '\\r'
    else if (character === '\t') out += '\\t'
    else if (code >= 0x20 && code <= 0x7e) out += character
    // UTF-8 bytes as \xHH: unlike \u, it doesn't depend on the shell's locale.
    else for (const byte of new TextEncoder().encode(character)) out += `\\x${byte.toString(16).padStart(2, '0')}`
  }
  return `${out}'`
}

export function toCurl(request: SnippetRequest): string {
  const method = request.method.toUpperCase()
  const parts = [`curl ${shellQuote(request.url)}`]
  const hasBody = request.body !== null && request.body !== ''
  // curl infers GET (no body) and POST (--data); spell out anything else.
  // HEAD needs --head: with -X HEAD curl waits for a body that never comes.
  if (method === 'HEAD') parts.push('--head')
  else if (!(method === 'GET' && !hasBody) && !(method === 'POST' && hasBody)) parts.push(`-X ${shellQuote(method)}`)
  let compressed = false
  for (const header of keptHeaders(request.headers)) {
    if (header.name.toLowerCase() === 'accept-encoding') compressed = true
    // "Name;" sends a header with an empty value ("Name:" would remove it).
    parts.push(`-H ${shellQuote(header.value === '' ? `${header.name};` : `${header.name}: ${header.value}`)}`)
  }
  if (hasBody) parts.push(`--data-raw ${shellQuote(request.body ?? '')}`)
  if (compressed) parts.push('--compressed')
  return parts.join(' \\\n  ')
}

/** A JS string literal. JSON is valid JS; also escape U+2028/9 and "</script" for pasting into HTML. */
export function jsString(value: string): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
    .replace(/<\/(script)/gi, '<\\/$1')
}

/** Headers fetch() can't set from a page; credentials:'include' sends the cookie instead. */
const FETCH_FORBIDDEN = new Set(['cookie', 'cookie2', 'referer', 'origin', 'user-agent', 'accept-encoding', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'keep-alive', 'via', 'dnt', 'expect', 'date', 'proxy-connection'])

function isForbiddenFetchHeader(name: string): boolean {
  const key = name.toLowerCase()
  return FETCH_FORBIDDEN.has(key) || key.startsWith('sec-') || key.startsWith('proxy-') || key.startsWith('access-control-request-')
}

export function toFetch(request: SnippetRequest): string {
  const method = request.method.toUpperCase()
  const headers = keptHeaders(request.headers).filter((header) => !isForbiddenFetchHeader(header.name))
  const referrer = request.headers.find((header) => header.name.toLowerCase() === 'referer')?.value
  const lines: string[] = []
  if (headers.length) {
    lines.push('  "headers": {')
    lines.push(headers.map((header) => `    ${jsString(header.name.toLowerCase())}: ${jsString(header.value)}`).join(',\n'))
    lines.push('  },')
  }
  if (referrer) lines.push(`  "referrer": ${jsString(referrer)},`)
  const hasBody = request.body !== null && request.body !== '' && method !== 'GET' && method !== 'HEAD'
  lines.push(`  "body": ${hasBody ? jsString(request.body ?? '') : 'null'},`)
  lines.push(`  "method": ${jsString(method)},`)
  lines.push('  "mode": "cors",')
  lines.push('  "credentials": "include"')
  return `fetch(${jsString(request.url)}, {\n${lines.join('\n')}\n});`
}
