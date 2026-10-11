export type DownloadState = 'progressing' | 'paused' | 'interrupted' | 'completed' | 'cancelled' | 'failed'

/** Safe-to-render download history; no full URLs or local file paths are exposed. */
export interface DownloadEntry {
  id: string
  filename: string
  source: string
  startedAt: number
  completedAt: number | null
  receivedBytes: number
  totalBytes: number
  state: DownloadState
  canResume: boolean
  fileAvailable: boolean
  message: string | null
}

export function safeDownloadSource(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.hostname || 'Unknown source'
    if (url.protocol === 'blob:' && url.origin !== 'null') return new URL(url.origin).hostname || 'Unknown source'
    if (url.protocol === 'file:') return 'Local file'
    if (url.protocol === 'data:') return 'Embedded content'
    return 'Unknown source'
  } catch {
    return 'Unknown source'
  }
}

export function safeStoredDownloadSource(value: string): string {
  if (value === 'Local file' || value === 'Embedded content') return value
  return safeDownloadSource(value.includes('://') ? value : `https://${value}`)
}

export function safeDownloadFilename(value: string): string {
  const safe = value
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .at(-1)
    ?.replace(/[\\/]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 240)
  return safe || 'Download'
}

export function getDownloadProgress(receivedBytes: number, totalBytes: number): number | null {
  if (!Number.isFinite(receivedBytes) || !Number.isFinite(totalBytes) || totalBytes <= 0) return null
  return Math.max(0, Math.min(100, Math.round((Math.max(0, receivedBytes) / totalBytes) * 100)))
}

export function formatDownloadSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown size'
  if (bytes < 1024) return `${Math.floor(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
