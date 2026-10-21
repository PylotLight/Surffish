export const QUICK_LINK_BACKGROUND_ROTATION_MS = 15 * 60 * 1000

export function getQuickLinkBackgroundIndex(timestampMs: number, imageCount: number): number {
  if (!Number.isFinite(timestampMs) || !Number.isInteger(imageCount) || imageCount < 1) return 0
  const rotationSlot = Math.floor(timestampMs / QUICK_LINK_BACKGROUND_ROTATION_MS)
  return ((rotationSlot % imageCount) + imageCount) % imageCount
}

export function nextQuickLinkBackgroundIndex(currentIndex: number, imageCount: number): number {
  if (!Number.isInteger(imageCount) || imageCount < 1) return 0
  const current = Number.isInteger(currentIndex) ? currentIndex : 0
  const normalized = ((current % imageCount) + imageCount) % imageCount
  return (normalized + 1) % imageCount
}

/** A New Tab photo without its image (credit and licence), for the bundled offline ones. */
export type NewTabBackgroundCredit = { id: string; title: string; creator: string; sourceUrl: string; licenseName: string; licenseUrl: string }

/**
 * The two photos bundled with the app (src/renderer/src/assets/quick-links-backgrounds/`file`): the
 * New Tab's backgrounds when no Wikimedia photo is cached. The browser's New Tab (Browser.tsx) imports
 * the files; a mini window's New Tab (main/mini-window.ts) reads the same files from the renderer build.
 */
export const OFFLINE_NEW_TAB_BACKGROUNDS: ReadonlyArray<NewTabBackgroundCredit & { file: string }> = [
  {
    id: 'fallback-forest-lake',
    file: 'forest-lake.webp',
    title: 'Forest lake',
    creator: 'Pixel.la Free Stock Photos',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Landscape-nature-forest-lake_(24300004076).jpg',
    licenseName: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/'
  },
  {
    id: 'fallback-mountain-lake',
    file: 'tranquil-mountain-lake.webp',
    title: 'Tranquil mountain lake',
    creator: 'Andrew Spencer',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Tranquil_mountain_lake_(Unsplash).jpg',
    licenseName: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/'
  }
]

/** The New Tab's two backgrounds: the cached Wikimedia photos first, topped up with the offline ones. */
export function withOfflinePhotoFallbacks<T extends { id: string }>(photos: readonly T[], offline: readonly T[]): T[] {
  const combined = [...photos, ...offline.filter((fallback) => !photos.some((photo) => photo.id === fallback.id))].slice(0, 2)
  return combined.length > 0 ? combined : [...offline]
}

/**
 * Which of `backgrounds` (withOfflinePhotoFallbacks) a New Tab opened at `timestampMs` shows: the
 * newest cached photo when there is one (the browser's New Tab jumps to it once the cache answers),
 * else the offline photo of this fifteen-minute slot (its first paint).
 */
export function newTabBackgroundIndexOnOpen(timestampMs: number, backgrounds: readonly { id: string }[], offlineIds: readonly string[]): number {
  if (backgrounds.length === 0) return 0
  if (!offlineIds.includes(backgrounds[0]!.id)) return 0
  return getQuickLinkBackgroundIndex(timestampMs, backgrounds.length)
}
