import type { WebContents } from 'electron'

/**
 * Has this tab's page played video or audio since it loaded (muted autoplay counts)? The toolbar
 * shows its contextual Cast button for such a page (shared/toolbar-layout.ts). One flag per page
 * load; `changed` runs only when it flips, so playback adds no IPC beyond one state update.
 */
const played = new WeakSet<WebContents>()

export function trackTabMedia(contents: WebContents, changed: () => void): void {
  contents.on('media-started-playing', () => {
    if (played.has(contents)) return
    played.add(contents)
    changed()
  })
  contents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (!isMainFrame || isInPlace || !played.delete(contents)) return
    changed()
  })
  contents.on('render-process-gone', () => { if (played.delete(contents)) changed() })
}

export function tabPlayedMedia(contents: WebContents | null | undefined): boolean {
  return Boolean(contents && !contents.isDestroyed() && played.has(contents))
}
