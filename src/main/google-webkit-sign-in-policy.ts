/**
 * Google blocks sign-in from embedded Chromium. Surffish hands Google's sign-in
 * pages to a native WebKit helper and imports the resulting session cookies.
 * Pure helpers live here so they can be unit tested without Electron.
 */

export interface WebKitCookie {
  name: string
  value: string
  domain: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  expirationDate?: number
  sameSite?: string
}

export interface ElectronCookieDetails {
  url: string
  name: string
  value: string
  domain?: string
  path: string
  secure: boolean
  httpOnly: boolean
  expirationDate?: number
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
}

const SIGN_IN_PATHS = [/^\/v3\/signin(\/(identifier|challenge|rejected)[^/]*)?\/?$/i, /^\/ServiceLogin/i, /^\/signin\/v2\/identifier/i, /^\/AccountChooser/i, /^\/InteractiveLogin/i]

/** Top-level Google sign-in pages that Electron would be rejected on. */
export function isGoogleSignInPage(value: string | undefined | null): boolean {
  if (!value) return false
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'accounts.google.com') return false
    return SIGN_IN_PATHS.some((pattern) => pattern.test(url.pathname))
  } catch {
    return false
  }
}

/** Where the tab should go after the session is imported. */
export function signInContinueUrl(value: string): string {
  try {
    const target = new URL(new URL(value).searchParams.get('continue') ?? '')
    if (target.protocol === 'https:' && !isGoogleSignInPage(target.toString())) return target.toString()
  } catch {
    // fall through
  }
  return 'https://www.google.com/'
}

export function isImportableCookieDomain(domain: string): boolean {
  const host = domain.replace(/^\./, '').toLowerCase()
  return host === 'google.com' || host.endsWith('.google.com') || host === 'youtube.com' || host.endsWith('.youtube.com')
}

export function toElectronCookie(cookie: WebKitCookie): ElectronCookieDetails | null {
  if (!cookie || typeof cookie.name !== 'string' || typeof cookie.value !== 'string' || typeof cookie.domain !== 'string') return null
  if (!isImportableCookieDomain(cookie.domain)) return null
  const host = cookie.domain.replace(/^\./, '')
  const path = cookie.path || '/'
  const secure = Boolean(cookie.secure)
  const sameSite = cookie.sameSite?.toLowerCase()
  const details: ElectronCookieDetails = {
    url: `${secure ? 'https' : 'http'}://${host}${path}`,
    name: cookie.name,
    value: cookie.value,
    path,
    secure,
    httpOnly: Boolean(cookie.httpOnly),
    sameSite: sameSite === 'lax' || sameSite === 'strict' ? sameSite : secure ? 'no_restriction' : 'unspecified'
  }
  // A leading dot marks a domain cookie; otherwise keep it host-only (required for __Host-).
  if (cookie.domain.startsWith('.') && !cookie.name.startsWith('__Host-')) details.domain = cookie.domain
  if (typeof cookie.expirationDate === 'number' && Number.isFinite(cookie.expirationDate)) details.expirationDate = cookie.expirationDate
  return details
}

export function parseHelperOutput(stdout: string): WebKitCookie[] {
  const line = stdout.trim().split('\n').pop() ?? ''
  const parsed: unknown = JSON.parse(line)
  if (!Array.isArray(parsed)) throw new Error('Google sign-in helper returned no cookie list.')
  return parsed as WebKitCookie[]
}
