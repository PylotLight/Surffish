export const TRANSLATION_LANGUAGES = [
  { code: 'en', label: 'English' }, { code: 'es', label: 'Spanish' }, { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' }, { code: 'it', label: 'Italian' }, { code: 'pt', label: 'Portuguese' },
  { code: 'ja', label: 'Japanese' }, { code: 'ko', label: 'Korean' }, { code: 'zh-CN', label: 'Chinese (Simplified)' },
  { code: 'zh-TW', label: 'Chinese (Traditional)' }, { code: 'ar', label: 'Arabic' }, { code: 'hi', label: 'Hindi' },
  { code: 'ru', label: 'Russian' }, { code: 'uk', label: 'Ukrainian' }, { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' }, { code: 'tr', label: 'Turkish' }, { code: 'vi', label: 'Vietnamese' },
  { code: 'th', label: 'Thai' }, { code: 'id', label: 'Indonesian' }, { code: 'sv', label: 'Swedish' },
  { code: 'el', label: 'Greek' }, { code: 'he', label: 'Hebrew' }
] as const
export const DEFAULT_TRANSLATION_LANGUAGE = 'en'
const languageCodes = new Set<string>(TRANSLATION_LANGUAGES.map(({ code }) => code))
export function isTranslationLanguage(value: unknown): value is string {
  return typeof value === 'string' && languageCodes.has(value)
}

function isPublicWebUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
    // Keep local/reserved names and IP literals out of the external provider.
    // IPv6 literals are intentionally unsupported, including IPv4-mapped forms.
    if (!hostname || hostname.includes(':') || !hostname.includes('.') || /\.(?:localhost|local|lan|internal|home|test|invalid|onion)\.?$/.test(hostname)) return false
    const ipv4 = hostname.split('.').map(Number)
    if (ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
      const [a, b] = ipv4
      if (a === 0 || a === 10 || a === 127 || (a === 100 && b! >= 64 && b! <= 127) || (a === 169 && b === 254) || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a! >= 224) return false
    }
    return true
  } catch { return false }
}

export function buildPageTranslationUrl(value: unknown, target: unknown): string | null {
  if (!isPublicWebUrl(value) || !isTranslationLanguage(target)) return null
  const pageUrl = new URL(value)
  pageUrl.hash = ''
  const params = new URLSearchParams({ sl: 'auto', tl: target, u: pageUrl.toString() })
  return `https://translate.google.com/translate?${params.toString()}`
}
export function buildTextTranslationUrl(value: unknown, target: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 5000 || !isTranslationLanguage(target)) return null
  const params = new URLSearchParams({ sl: 'auto', tl: target, text: value.trim(), op: 'translate' })
  return `https://translate.google.com/?${params.toString()}`
}
