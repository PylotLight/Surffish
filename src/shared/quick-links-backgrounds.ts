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
