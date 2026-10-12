import { resolveNavigationTarget } from './navigation'

/** Local documents Surffish will open when the OS hands it a file (Open With, drag onto the Dock icon, default app). */
const LOCAL_DOCUMENT_EXTENSIONS = new Set(['pdf', 'html', 'htm', 'xhtml'])

function extensionOf(pathname: string): string {
  const name = pathname.split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** A file:// URL for a local PDF or HTML document, with no host, query or fragment tricks. */
export function isLocalDocumentUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'file:' && (url.hostname === '' || url.hostname === 'localhost') && !url.search && LOCAL_DOCUMENT_EXTENSIONS.has(extensionOf(decodeURIComponent(url.pathname)))
  } catch {
    return false
  }
}

function filePathToUrl(path: string): string | null {
  // Absolute POSIX paths, and Windows drive paths (C:\docs\a.pdf).
  const windows = /^[a-z]:[\\/]/i.test(path)
  if (!path.startsWith('/') && !windows) return null
  const normalized = windows ? `/${path.replace(/\\/g, '/')}` : path
  try {
    const url = new URL('file://')
    url.pathname = normalized
    return url.toString()
  } catch {
    return null
  }
}

/**
 * Resolve something the OS asked Surffish to open (a default-browser link, a command-line argument,
 * an opened file) to a tab target. Only explicit http(s) URLs and local PDF/HTML documents are
 * accepted; searches, bare words and every other scheme are refused.
 */
export function externalOpenTarget(value: string): string | null {
  const input = value.trim()
  if (!input || input.startsWith('-')) return null
  if (/^https?:\/\//i.test(input)) return resolveNavigationTarget(input)
  if (/^file:/i.test(input)) {
    try {
      const url = new URL(input)
      url.hash = ''
      return isLocalDocumentUrl(url.toString()) ? url.toString() : null
    } catch {
      return null
    }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(input) && !/^[a-z]:[\\/]/i.test(input)) return null
  const fileUrl = filePathToUrl(input)
  return fileUrl && isLocalDocumentUrl(fileUrl) ? fileUrl : null
}

/**
 * Targets from a process argv (Windows/Linux pass default-browser links and opened files as
 * arguments). The executable, the app entry script and Chromium switches never match.
 */
export function externalOpenTargetsFromArgv(argv: readonly string[]): string[] {
  const targets: string[] = []
  for (const value of argv.slice(1)) {
    if (value === '--') continue
    const target = externalOpenTarget(value)
    if (target && !targets.includes(target)) targets.push(target)
  }
  return targets
}
