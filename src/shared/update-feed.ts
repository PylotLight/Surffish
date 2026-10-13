/**
 * Update notifications from a GitHub-style releases Atom feed: pure parsing, semver comparison,
 * skip / remind-later decisions and preference normalization. No Electron imports, so the main
 * process, the preload types and the unit tests can all share it.
 */

export const DEFAULT_UPDATE_FEED_URL = 'https://github.com/PylotLight/Surffish/releases.atom'
/** First check waits this long after launch so it never competes with restoring tabs. */
export const UPDATE_INITIAL_DELAY_MS = 30_000
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
export const UPDATE_REMIND_LATER_MS = 24 * 60 * 60 * 1000
/** Release feeds are a few hundred KB at most; anything bigger is not a feed. */
export const UPDATE_FEED_MAX_BYTES = 2 * 1024 * 1024
const MAX_FEED_URL_LENGTH = 2048
const MAX_NOTES_LENGTH = 20_000

export interface ReleaseFeedEntry {
  /** Tag as published, e.g. "v0.1.2". */
  tag: string
  /** Tag without a leading "v", e.g. "0.1.2". */
  version: string
  title: string
  /** ISO timestamp from <updated>, or '' when missing. */
  updated: string
  /** Release page (rel="alternate" link), or '' when missing or not http(s). */
  link: string
  /** Raw HTML from <content type="html">, entity-decoded. Never render it as HTML. */
  contentHtml: string
}

export interface UpdatePreferences {
  /** Custom feed URL; '' means the default GitHub releases feed. */
  feedUrl: string
  /** Also offer pre-releases (tags like v0.2.0-beta.1). */
  betaChannel: boolean
  skippedVersion: string | null
  /** "Remind me later": no badge or notification for this version until remindAfter. */
  remindLaterVersion: string | null
  remindAfter: number | null
  /** Last version a native notification was shown for, so each release notifies once. */
  notifiedVersion: string | null
  lastChecked: number | null
}

export const DEFAULT_UPDATE_PREFERENCES: UpdatePreferences = {
  feedUrl: '',
  betaChannel: false,
  skippedVersion: null,
  remindLaterVersion: null,
  remindAfter: null,
  notifiedVersion: null,
  lastChecked: null
}

export type UpdateCheckStatus = 'idle' | 'checking' | 'up-to-date' | 'available' | 'unavailable' | 'error'

export interface UpdateReleaseInfo {
  version: string
  tag: string
  title: string
  updated: string
  link: string
  /** Release notes converted to plain text (safe to render as text). */
  notes: string
}

/** Everything the Settings "About & updates" section and the badge render. */
export interface UpdateState {
  currentVersion: string
  status: UpdateCheckStatus
  /** Human-readable status line, e.g. "Update check unavailable (repo private)". */
  message: string | null
  latest: UpdateReleaseInfo | null
  /** A newer release exists and is not skipped or snoozed: show the badge. */
  showBadge: boolean
  /** A newer release exists (even if skipped or snoozed). */
  updateAvailable: boolean
  skippedVersion: string | null
  lastChecked: number | null
  feedUrl: string
  defaultFeedUrl: string
  betaChannel: boolean
  download: UpdateDownloadState
}

export interface UpdateDownloadState {
  state: 'none' | 'downloading' | 'completed' | 'failed'
  filename: string | null
  /** Completed .dmg (macOS): the UI may offer "Open installer". */
  canOpenInstaller: boolean
  /** Completed download whose file still exists: the UI may offer "Show in folder". */
  canReveal: boolean
}

// ---------------------------------------------------------------------------------------------
// Semver

export interface ParsedSemver {
  major: number
  minor: number
  patch: number
  prerelease: Array<string | number>
}

const SEMVER_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/i

export function parseSemver(input: string): ParsedSemver | null {
  const match = SEMVER_PATTERN.exec(input.trim())
  if (!match) return null
  const [, major, minor, patch, pre] = match
  const prerelease = pre
    ? pre.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part))
    : []
  if (prerelease.some((part) => part === '')) return null
  return { major: Number(major), minor: Number(minor), patch: Number(patch), prerelease }
}

/** Strip a leading "v" (and surrounding whitespace) from a tag. */
export function normalizeVersionTag(tag: string): string {
  return tag.trim().replace(/^v(?=\d)/i, '')
}

export function isPrereleaseVersion(version: string): boolean {
  const parsed = parseSemver(version)
  return parsed !== null && parsed.prerelease.length > 0
}

/** SemVer 2.0 precedence: -1 if a < b, 0 if equal, 1 if a > b. Unparseable versions sort lowest. */
export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a)
  const right = parseSemver(b)
  if (!left || !right) return left ? 1 : right ? -1 : 0
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1
  }
  if (!left.prerelease.length || !right.prerelease.length) {
    if (left.prerelease.length === right.prerelease.length) return 0
    return left.prerelease.length ? -1 : 1
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const x = left.prerelease[index]
    const y = right.prerelease[index]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x > y ? 1 : -1
    if (typeof x === 'number') return -1
    if (typeof y === 'number') return 1
    return x > y ? 1 : -1
  }
  return 0
}

// ---------------------------------------------------------------------------------------------
// Atom parsing (a deliberately small, regex-based reader: release feeds are flat and machine-made)

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }

export function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole
      try { return String.fromCodePoint(code) } catch { return whole }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

function unwrapCdata(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_whole, inner: string) => inner.replace(/[&<>]/g, (char) => (char === '&' ? '&amp;' : char === '<' ? '&lt;' : '&gt;')))
}

function elementText(block: string, name: string): string {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block)
  return match ? decodeXmlEntities(unwrapCdata(match[1] ?? '')).trim() : ''
}

function attribute(tag: string, name: string): string {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag)
  return match ? decodeXmlEntities(match[2] ?? match[3] ?? '') : ''
}

function httpUrlOrEmpty(value: string): string {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : ''
  } catch {
    return ''
  }
}

function entryLink(block: string): string {
  const links = block.match(/<link\b[^>]*>/gi) ?? []
  const alternate = links.find((tag) => {
    const rel = attribute(tag, 'rel')
    return rel === '' || rel === 'alternate'
  })
  return alternate ? httpUrlOrEmpty(attribute(alternate, 'href')) : ''
}

/** Tag from ".../releases/tag/<tag>" in the link, else the last path segment of the <id>. */
function entryTag(link: string, id: string): string {
  const fromLink = /\/releases\/tag\/([^/?#]+)/.exec(link)?.[1]
  if (fromLink) {
    try { return decodeURIComponent(fromLink) } catch { return fromLink }
  }
  return id.split('/').at(-1)?.trim() ?? ''
}

export function parseReleaseFeed(xml: string): ReleaseFeedEntry[] {
  if (!/<feed\b/i.test(xml)) throw new Error('The update feed is not an Atom feed.')
  const entries: ReleaseFeedEntry[] = []
  for (const match of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    const block = match[1] ?? ''
    const id = elementText(block, 'id')
    const link = entryLink(block)
    const tag = entryTag(link, id)
    const version = normalizeVersionTag(tag)
    if (!tag || !parseSemver(version)) continue
    entries.push({
      tag,
      version,
      title: elementText(block, 'title') || tag,
      updated: elementText(block, 'updated'),
      link,
      contentHtml: elementText(block, 'content')
    })
  }
  return entries
}

/**
 * Release notes HTML → readable plain text (headings, bullets, paragraphs kept as lines). Every
 * tag is dropped, so the result is safe to render as text; links keep only their text.
 */
export function releaseNotesToText(html: string): string {
  let text = html
    .replace(/<(script|style|template|iframe|object|svg)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<h([1-6])\b[^>]*>/gi, (_whole, level: string) => `\n\n${'#'.repeat(Number(level))} `)
    .replace(/<\/h[1-6]\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|ul|ol|li|pre|blockquote|table|tr)\s*>/gi, '\n')
    .replace(/<(p|div|ul|ol|pre|blockquote|table|tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
  text = decodeXmlEntities(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    // Keep lists tight: no blank line between a heading or bullet and the bullet that follows.
    .replace(/^((?:#+|•) [^\n]*)\n\n(?=• )/gm, '$1\n')
    .trim()
  return text.length > MAX_NOTES_LENGTH ? `${text.slice(0, MAX_NOTES_LENGTH).trimEnd()}\n…` : text
}

// ---------------------------------------------------------------------------------------------
// Decisions

export interface LatestReleaseOptions {
  includePrereleases: boolean
}

/** Highest-precedence release in the feed (pre-releases only when the beta channel is on). */
export function pickLatestRelease(entries: readonly ReleaseFeedEntry[], options: LatestReleaseOptions): ReleaseFeedEntry | null {
  let best: ReleaseFeedEntry | null = null
  for (const entry of entries) {
    if (!options.includePrereleases && isPrereleaseVersion(entry.version)) continue
    if (!best || compareSemver(entry.version, best.version) > 0) best = entry
  }
  return best
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return parseSemver(candidate) !== null && compareSemver(candidate, normalizeVersionTag(current)) > 0
}

export interface UpdateDecision {
  updateAvailable: boolean
  /** Badge + Settings highlight. */
  showBadge: boolean
  /** Fire a native notification now. */
  notify: boolean
  skipped: boolean
  snoozed: boolean
}

export function decideUpdate(latestVersion: string | null, currentVersion: string, preferences: UpdatePreferences, now: number): UpdateDecision {
  const none: UpdateDecision = { updateAvailable: false, showBadge: false, notify: false, skipped: false, snoozed: false }
  if (!latestVersion || !isNewerVersion(latestVersion, currentVersion)) return none
  const skipped = preferences.skippedVersion !== null && compareSemver(preferences.skippedVersion, latestVersion) === 0
  const snoozed = !skipped
    && preferences.remindLaterVersion !== null
    && compareSemver(preferences.remindLaterVersion, latestVersion) === 0
    && preferences.remindAfter !== null
    && now < preferences.remindAfter
  const showBadge = !skipped && !snoozed
  const alreadyNotified = preferences.notifiedVersion !== null && compareSemver(preferences.notifiedVersion, latestVersion) === 0
  // A snooze that ran out re-notifies once; otherwise each version notifies once.
  const snoozeExpired = preferences.remindLaterVersion !== null && compareSemver(preferences.remindLaterVersion, latestVersion) === 0 && !snoozed
  return { updateAvailable: true, showBadge, notify: showBadge && (!alreadyNotified || snoozeExpired), skipped, snoozed }
}

/** Should a scheduled check run now? Manual checks always run. */
export function isUpdateCheckDue(lastChecked: number | null, now: number, intervalMs = UPDATE_CHECK_INTERVAL_MS): boolean {
  return lastChecked === null || !Number.isFinite(lastChecked) || now - lastChecked >= intervalMs || lastChecked > now
}

// ---------------------------------------------------------------------------------------------
// Feed URL + errors

/** Accept http(s) URLs only; '' (or the default itself) means "use the default feed". */
export function normalizeFeedUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed || trimmed === DEFAULT_UPDATE_FEED_URL) return ''
  if (trimmed.length > MAX_FEED_URL_LENGTH) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (!url.hostname) return null
    return url.toString()
  } catch {
    return null
  }
}

export const INVALID_FEED_URL_MESSAGE = 'Enter an http(s) feed URL, or leave it blank for the default GitHub releases feed.'

/** What Settings → About & updates gets back from saving: a bad feed URL is an inline message, not a thrown error. */
export type UpdateSettingsResult = { ok: true; state: UpdateState } | { ok: false; error: string }

/**
 * Apply a settings patch from the renderer ({ feedUrl?, betaChannel? }). Invalid input is a
 * validation result for the form, never an exception.
 */
export function applyUpdateSettings(preferences: UpdatePreferences, input: unknown): { ok: true; preferences: UpdatePreferences; changed: boolean } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, error: 'Update settings must be an object.' }
  const patch = input as { feedUrl?: unknown; betaChannel?: unknown }
  const next = { ...preferences }
  if (patch.feedUrl !== undefined) {
    const feedUrl = normalizeFeedUrl(patch.feedUrl)
    if (feedUrl === null) return { ok: false, error: INVALID_FEED_URL_MESSAGE }
    next.feedUrl = feedUrl
  }
  if (typeof patch.betaChannel === 'boolean') next.betaChannel = patch.betaChannel
  const changed = next.feedUrl !== preferences.feedUrl || next.betaChannel !== preferences.betaChannel
  return { ok: true, preferences: next, changed }
}

export function effectiveFeedUrl(preferences: Pick<UpdatePreferences, 'feedUrl'>): string {
  return preferences.feedUrl || DEFAULT_UPDATE_FEED_URL
}

/** Safe for logs: no credentials, query string or fragment (tokenized feed URLs stay private). */
export function redactFeedUrl(input: string): string {
  try {
    const url = new URL(input)
    return `${url.protocol}//${url.host}${url.pathname}${url.search ? '?…' : ''}`
  } catch {
    return '(invalid URL)'
  }
}

function isGitHubHost(feedUrl: string): boolean {
  try {
    const host = new URL(feedUrl).hostname.toLowerCase()
    return host === 'github.com' || host === 'www.github.com'
  } catch {
    return false
  }
}

export interface FeedHttpFailure {
  status: UpdateCheckStatus
  message: string
}

/** Map a non-2xx feed response to what Settings shows. */
export function describeFeedHttpFailure(httpStatus: number, feedUrl: string): FeedHttpFailure {
  const github = isGitHubHost(feedUrl)
  if (httpStatus === 404) {
    return github
      ? { status: 'unavailable', message: 'Update check unavailable (repo private)' }
      : { status: 'unavailable', message: 'Update check unavailable (feed not found)' }
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return { status: 'unavailable', message: 'Update check unavailable (feed needs sign-in or a token)' }
  }
  if (httpStatus === 429) return { status: 'error', message: 'Update check rate-limited; will retry later' }
  return { status: 'error', message: `Update check failed (HTTP ${httpStatus})` }
}

// ---------------------------------------------------------------------------------------------
// Download assets

/**
 * Direct asset URLs worth probing for a GitHub release page ("…/releases/tag/<tag>"), using the
 * release script's artifact name (Surffish-<version>-mac-<arch>.<ext>); .dmg first, then .zip.
 * Empty for non-GitHub feeds or non-macOS platforms (the release page opens instead).
 */
export function releaseAssetCandidates(releaseLink: string, version: string, platform: string, arch: string, productName = 'Surffish'): string[] {
  if (platform !== 'darwin') return []
  let url: URL
  try { url = new URL(releaseLink) } catch { return [] }
  if (url.protocol !== 'https:' || !isGitHubHost(url.toString())) return []
  const match = /^\/([^/]+)\/([^/]+)\/releases\/tag\/([^/]+)\/?$/.exec(url.pathname)
  if (!match || !parseSemver(normalizeVersionTag(version))) return []
  const [, owner, repo, tag] = match
  const macArch = arch === 'x64' ? 'x64' : 'arm64'
  const base = `https://github.com/${owner}/${repo}/releases/download/${tag}/${productName}-${normalizeVersionTag(version)}-mac-${macArch}`
  return [`${base}.dmg`, `${base}.zip`]
}

// ---------------------------------------------------------------------------------------------
// Preferences

function optionalVersion(value: unknown): string | null {
  return typeof value === 'string' && parseSemver(value) ? normalizeVersionTag(value) : null
}

function optionalTime(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

export function parseUpdatePreferences(input: unknown): UpdatePreferences {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ...DEFAULT_UPDATE_PREFERENCES }
  const record = input as Record<string, unknown>
  return {
    feedUrl: normalizeFeedUrl(record.feedUrl) ?? '',
    betaChannel: record.betaChannel === true,
    skippedVersion: optionalVersion(record.skippedVersion),
    remindLaterVersion: optionalVersion(record.remindLaterVersion),
    remindAfter: optionalTime(record.remindAfter),
    notifiedVersion: optionalVersion(record.notifiedVersion),
    lastChecked: optionalTime(record.lastChecked)
  }
}

export function toReleaseInfo(entry: ReleaseFeedEntry): UpdateReleaseInfo {
  return {
    version: entry.version,
    tag: entry.tag,
    title: entry.title,
    updated: entry.updated,
    link: entry.link,
    notes: releaseNotesToText(entry.contentHtml)
  }
}
