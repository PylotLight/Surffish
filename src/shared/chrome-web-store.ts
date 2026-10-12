/** Chrome Web Store URL / ID helpers shared by main and renderer. No Electron imports. */

const EXTENSION_ID = /^[a-p]{32}$/
const STORE_HOSTS = new Set(['chromewebstore.google.com', 'chrome.google.com'])

export function isChromeExtensionId(value: unknown): value is string {
  return typeof value === 'string' && EXTENSION_ID.test(value)
}

/**
 * Extension ID from a bare ID or a Web Store detail URL:
 *   https://chromewebstore.google.com/detail/<slug>/<id>   (current store)
 *   https://chromewebstore.google.com/detail/<id>
 *   https://chrome.google.com/webstore/detail/<slug>/<id>  (legacy store)
 * Returns null for anything else.
 */
export function parseChromeWebStoreInput(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return null
  if (isChromeExtensionId(trimmed.toLowerCase())) return trimmed.toLowerCase()
  let url: URL
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.port) return null
  if (!STORE_HOSTS.has(url.hostname.toLowerCase())) return null
  const parts = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part))
  const detail = url.hostname === 'chrome.google.com'
    ? parts[0] === 'webstore' && parts[1] === 'detail' ? parts.slice(2) : null
    : parts[0] === 'detail' ? parts.slice(1) : null
  if (!detail || detail.length === 0 || detail.length > 2) return null
  const candidate = detail.at(-1)?.toLowerCase()
  return isChromeExtensionId(candidate) ? candidate : null
}

/** True when `url` is a Web Store extension detail page (where "Add to Surffish" applies). */
export function isChromeWebStoreDetailUrl(url: unknown): boolean {
  return typeof url === 'string' && /^https?:\/\//i.test(url.trim()) && parseChromeWebStoreInput(url) !== null
}

/** Major.minor.build.patch of the Chromium Surffish runs on, as the update service expects. */
export function normalizeChromeVersion(version: string): string {
  const parts = version.split('.').map((part) => Number.parseInt(part, 10)).filter((part) => Number.isFinite(part) && part >= 0)
  while (parts.length < 4) parts.push(0)
  return parts.slice(0, 4).join('.')
}

/** The Web Store's CRX download URL (redirects to the package on Google's CDN). */
export function chromeWebStoreCrxUrl(id: string, chromeVersion: string): string {
  if (!isChromeExtensionId(id)) throw new Error('Not a Chrome extension ID.')
  const x = encodeURIComponent(`id=${id}&uc`)
  return `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=${normalizeChromeVersion(chromeVersion)}&acceptformat=crx2,crx3&x=${x}`
}

export function chromeWebStoreDetailUrl(id: string): string {
  return `https://chromewebstore.google.com/detail/${id}`
}

/** Hosts the CRX download may come from (the update service and Google's download CDNs). */
export function isAllowedChromeWebStoreDownloadUrl(value: string | URL): boolean {
  let url: URL
  try {
    url = typeof value === 'string' ? new URL(value) : value
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return false
  const host = url.hostname.toLowerCase()
  return host === 'clients2.google.com' ||
    host === 'clients2.googleusercontent.com' ||
    host === 'update.googleapis.com' ||
    host === 'edgedl.me.gvt1.com' ||
    host.endsWith('.gvt1.com') ||
    host.endsWith('.googleusercontent.com')
}

/** Compare dotted Chrome extension versions numerically ("1.14" > "1.9"). */
export function compareExtensionVersions(left: string, right: string): number {
  const a = left.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const b = right.split('.').map((part) => Number.parseInt(part, 10) || 0)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference > 0 ? 1 : -1
  }
  return 0
}
