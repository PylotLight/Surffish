import { app } from 'electron'
import { Buffer } from 'node:buffer'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NewTabBackground, NewTabBackgroundRefreshResult } from '../shared/types'
import {
  MAX_NEW_TAB_PHOTO_BYTES,
  MAX_REMOTE_NEW_TAB_BACKGROUNDS,
  NEW_TAB_PHOTO_REFRESH_INTERVAL_MS,
  WIKIMEDIA_NATURE_SEARCHES,
  parseCachedNewTabBackgrounds,
  parseWikimediaPhotoSearchResults,
  type WikimediaPhotoCandidate
} from '../shared/new-tab-photo-feed'
import { getBrowserSession } from './browser-session'
import { getMainWindow } from './window'

const CACHE_FILENAME = 'new-tab-photo-cache.json'
const USER_AGENT = 'Sockfish New Tab background photos/0.1 (+https://github.com/PylotLight/Sockfish)'
const REQUEST_TIMEOUT_MS = 12_000
const RESULTS_PER_SEARCH = 12
const MAX_DOWNLOAD_ATTEMPTS_PER_SEARCH = 4
const MANUAL_REFRESH_COOLDOWN_MS = 5 * 60 * 1000
const THUMBNAIL_HOSTS = new Set(['upload.wikimedia.org', 'thumb.wikimedia.org'])

interface PhotoCacheFile {
  version: 1
  updatedAt: number | null
  lastAttemptAt: number | null
  backgrounds: NewTabBackground[]
}

let cacheLoaded = false
let cachedBackgrounds: NewTabBackground[] = []
let updatedAt: number | null = null
let lastAttemptAt: number | null = null
let refreshInProgress: Promise<NewTabBackgroundRefreshResult> | null = null

function cachePath(): string {
  return join(app.getPath('userData'), CACHE_FILENAME)
}

function safeTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= Date.now() ? value : null
}

function loadCache(): void {
  if (cacheLoaded) return
  cacheLoaded = true
  try {
    const stored = JSON.parse(readFileSync(cachePath(), 'utf8')) as unknown
    if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return
    const record = stored as Record<string, unknown>
    if (record.version !== 1) return
    cachedBackgrounds = parseCachedNewTabBackgrounds(record.backgrounds)
    updatedAt = safeTimestamp(record.updatedAt)
    lastAttemptAt = safeTimestamp(record.lastAttemptAt)
  } catch {
    // A missing or damaged photo cache must never block the New Tab or alter other profile files.
  }
}

function snapshot(): NewTabBackground[] {
  loadCache()
  return cachedBackgrounds.slice(0, MAX_REMOTE_NEW_TAB_BACKGROUNDS).map((background) => ({ ...background }))
}

function persistCache(): void {
  const file = cachePath()
  const temporaryFile = `${file}.tmp`
  const record: PhotoCacheFile = {
    version: 1,
    updatedAt,
    lastAttemptAt,
    backgrounds: cachedBackgrounds.slice(0, MAX_REMOTE_NEW_TAB_BACKGROUNDS)
  }
  mkdirSync(app.getPath('userData'), { recursive: true, mode: 0o700 })
  writeFileSync(temporaryFile, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporaryFile, file)
}

function isAllowedThumbnailUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && THUMBNAIL_HOSTS.has(url.hostname.toLowerCase()) && !url.username && !url.password
  } catch {
    return false
  }
}

async function fetchThroughBrowserSession(url: string, accept: string): Promise<Response> {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new Error('Photo request URL was invalid.')
  }
  const isCommonsApi = parsedUrl.protocol === 'https:' && parsedUrl.hostname === 'commons.wikimedia.org' && parsedUrl.pathname === '/w/api.php' && !parsedUrl.username && !parsedUrl.password
  if (!isAllowedThumbnailUrl(url) && !isCommonsApi) {
    throw new Error('Photo request was not to an approved Wikimedia host.')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    // The dedicated Electron session uses the saved browser proxy; omit cookies and referrers.
    const response = await getBrowserSession().fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, Accept: accept },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`Wikimedia request failed with HTTP ${response.status}.`)
    const finalUrl = response.url ? new URL(response.url) : new URL(url)
    if (finalUrl.protocol !== 'https:' || (!THUMBNAIL_HOSTS.has(finalUrl.hostname) && finalUrl.hostname !== 'commons.wikimedia.org')) {
      throw new Error('Wikimedia returned a response from an unapproved host.')
    }
    return response
  } finally {
    clearTimeout(timer)
  }
}

function createSearchUrl(query: string): string {
  const url = new URL('https://commons.wikimedia.org/w/api.php')
  url.searchParams.set('action', 'query')
  url.searchParams.set('format', 'json')
  url.searchParams.set('formatversion', '2')
  url.searchParams.set('maxlag', '1')
  url.searchParams.set('generator', 'search')
  url.searchParams.set('gsrsearch', query)
  url.searchParams.set('gsrnamespace', '6')
  url.searchParams.set('gsrlimit', String(RESULTS_PER_SEARCH))
  url.searchParams.set('prop', 'imageinfo')
  url.searchParams.set('iiprop', 'url|size|mime|thumbmime|extmetadata')
  url.searchParams.set('iiurlwidth', '1600')
  url.searchParams.set('iiextmetadatafilter', 'LicenseShortName|LicenseUrl|Artist|ObjectName')
  return url.toString()
}

async function findCandidates(query: string): Promise<WikimediaPhotoCandidate[]> {
  const response = await fetchThroughBrowserSession(createSearchUrl(query), 'application/json')
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') throw new Error('Wikimedia did not return JSON search metadata.')
  return parseWikimediaPhotoSearchResults(await response.json())
}

function hasImageSignature(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (mimeType === 'image/png') return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  if (mimeType === 'image/webp') return bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' && Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP'
  return false
}

async function downloadPhoto(candidate: WikimediaPhotoCandidate): Promise<NewTabBackground> {
  if (!isAllowedThumbnailUrl(candidate.imageUrl)) throw new Error('Photo thumbnail host was not approved.')
  const response = await fetchThroughBrowserSession(candidate.imageUrl, 'image/jpeg,image/png,image/webp')
  const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) throw new Error('Wikimedia returned an unsupported image type.')
  const reportedLength = Number(response.headers.get('content-length') ?? 0)
  if (reportedLength > MAX_NEW_TAB_PHOTO_BYTES) throw new Error('Wikimedia thumbnail exceeds the local photo-cache size limit.')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length === 0 || bytes.length > MAX_NEW_TAB_PHOTO_BYTES || !hasImageSignature(bytes, mimeType)) {
    throw new Error('Wikimedia thumbnail did not pass image validation.')
  }
  return {
    id: candidate.id,
    src: `data:${mimeType};base64,${bytes.toString('base64')}`,
    title: candidate.title,
    creator: candidate.creator,
    sourceUrl: candidate.sourceUrl,
    licenseName: candidate.licenseName,
    licenseUrl: candidate.licenseUrl
  }
}

function shuffled<T>(values: readonly T[]): T[] {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!]
  }
  return result
}

function notifyRenderer(): void {
  const contents = getMainWindow()?.webContents
  if (contents && !contents.isDestroyed()) contents.send('browser:new-tab-backgrounds:changed', snapshot())
}

function result(updated: boolean, error: string | null): NewTabBackgroundRefreshResult {
  return { backgrounds: snapshot(), updated, error }
}

async function refreshFromCommons(): Promise<NewTabBackgroundRefreshResult> {
  const attemptedAt = Date.now()
  lastAttemptAt = attemptedAt
  try {
    persistCache()
  } catch (error) {
    console.warn('Could not update the New Tab photo refresh timestamp:', error)
  }

  const currentIds = new Set(cachedBackgrounds.map((photo) => photo.id))
  const downloaded: NewTabBackground[] = []
  const searchOffset = Math.floor(attemptedAt / NEW_TAB_PHOTO_REFRESH_INTERVAL_MS) % WIKIMEDIA_NATURE_SEARCHES.length
  let lastFailure: unknown = null

  for (let offset = 0; offset < WIKIMEDIA_NATURE_SEARCHES.length && downloaded.length < MAX_REMOTE_NEW_TAB_BACKGROUNDS; offset += 1) {
    const query = WIKIMEDIA_NATURE_SEARCHES[(searchOffset + offset) % WIKIMEDIA_NATURE_SEARCHES.length]!
    try {
      const candidates = shuffled(await findCandidates(query))
        .filter((candidate) => !currentIds.has(candidate.id) && !downloaded.some((photo) => photo.id === candidate.id))
      let selectedFromThisSearch = false
      for (const candidate of candidates.slice(0, MAX_DOWNLOAD_ATTEMPTS_PER_SEARCH)) {
        try {
          downloaded.push(await downloadPhoto(candidate))
          selectedFromThisSearch = true
          break
        } catch (error) {
          lastFailure = error
        }
      }
      if (!selectedFromThisSearch) continue
    } catch (error) {
      lastFailure = error
    }
  }

  if (downloaded.length === 1) {
    const previous = cachedBackgrounds.find((photo) => photo.id !== downloaded[0]?.id)
    if (previous) downloaded.push(previous)
  }

  if (downloaded.length === 0) {
    console.warn('New Tab photo refresh found no new validated Wikimedia photos:', lastFailure ?? 'no eligible results')
    try {
      persistCache()
    } catch (error) {
      console.warn('Could not persist the New Tab photo refresh timestamp:', error)
    }
    return result(false, 'No new licensed nature photos were available. Your saved or offline backgrounds remain in use.')
  }

  cachedBackgrounds = downloaded.slice(0, MAX_REMOTE_NEW_TAB_BACKGROUNDS)
  updatedAt = attemptedAt
  try {
    persistCache()
  } catch (error) {
    console.warn('New Tab photos were loaded but could not be saved for offline use:', error)
  }
  notifyRenderer()
  return result(true, null)
}

export function getNewTabBackgrounds(): NewTabBackground[] {
  loadCache()
  const now = Date.now()
  if (lastAttemptAt === null || now - lastAttemptAt >= NEW_TAB_PHOTO_REFRESH_INTERVAL_MS) {
    void refreshNewTabBackgrounds(false)
  }
  return snapshot()
}

export function refreshNewTabBackgrounds(force = true): Promise<NewTabBackgroundRefreshResult> {
  loadCache()
  if (refreshInProgress) return refreshInProgress
  const now = Date.now()
  if (!force && lastAttemptAt !== null && now - lastAttemptAt < NEW_TAB_PHOTO_REFRESH_INTERVAL_MS) {
    return Promise.resolve(result(false, null))
  }
  if (force && lastAttemptAt !== null && now - lastAttemptAt < MANUAL_REFRESH_COOLDOWN_MS) {
    return Promise.resolve(result(false, 'Please wait a few minutes before asking Wikimedia for another photo set.'))
  }
  refreshInProgress = refreshFromCommons().finally(() => { refreshInProgress = null })
  return refreshInProgress
}
