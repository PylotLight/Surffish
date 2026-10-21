/**
 * A mini window's New Tab (the browser's surffish://quick-links tab, opened with + or ⌘/Ctrl+T in a
 * mini window). In a browser window the New Tab is drawn by that window's content renderer; a mini
 * window has no shell, so this small page stands in for it in the page area: the New Tab page's own
 * Favourites and Frequently visited sites (shared/quick-links.ts, the same lists), and a click on
 * the empty space shows the header's address field (it is already open and focused on a New Tab).
 * Only made while a New Tab is the window's active tab; released as soon as it isn't.
 * Loaded from a data: URL with the narrow preload in preload/mini-window.cjs; never remote content.
 */
export const MINI_WINDOW_NEW_TAB_HTML = `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src https: http: data:">
<title>Mini Window New Tab</title>
<style>
  :root { color-scheme: light dark; --bg: rgb(250,250,251); --text: #1d1d1f; --muted: #6e6e73; --tile: rgba(0,0,0,.04); --hover: rgba(0,0,0,.08); --accent: #2f6fed; }
  @media (prefers-color-scheme: dark) { :root { --bg: rgb(30,30,32); --text: #f2f2f4; --muted: #a1a1a6; --tile: rgba(255,255,255,.06); --hover: rgba(255,255,255,.12); --accent: #6d9bff; } }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text); font: 12px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; user-select: none; overflow: hidden; }
  main { box-sizing: border-box; height: 100%; padding: 56px 14px 14px; display: flex; flex-direction: column; align-items: center; overflow-y: auto; }
  h1 { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  #hint { color: var(--muted); font-size: 12px; margin: 0 0 14px; text-align: center; }
  #hint kbd { font: inherit; border: 1px solid var(--hover); border-radius: 4px; padding: 0 4px; }
  #private { display: none; color: var(--muted); font-size: 11px; margin: 0 0 10px; }
  body.private #private { display: block; }
  #sites { display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 6px; width: 100%; max-width: 420px; padding: 0; margin: 0; list-style: none; }
  .site { appearance: none; border: 0; background: transparent; color: inherit; font: inherit; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 4px; border-radius: 10px; cursor: default; min-width: 0; width: 100%; }
  .site:hover { background: var(--hover); }
  .site:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .icon { width: 36px; height: 36px; border-radius: 10px; background: var(--tile); display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 600; color: var(--muted); overflow: hidden; }
  .icon img { width: 20px; height: 20px; }
  .label { max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 11px; }
  #empty { display: none; color: var(--muted); font-size: 11px; }
  body.empty #empty { display: block; }
</style></head>
<body>
<main id="page" aria-label="New Tab">
  <h1>New Tab</h1>
  <p id="private">Private: nothing from this tab is saved.</p>
  <p id="hint">Search or type an address above · <kbd id="key">⌘L</kbd></p>
  <ul id="sites" aria-label="Favourites and frequently visited sites"></ul>
  <p id="empty">Favourites and frequently visited sites show here.</p>
</main>
<script>
  if (!/Mac/.test(navigator.platform)) document.getElementById('key').textContent = 'Ctrl+L'
  const list = document.getElementById('sites')
  let key = ''
  window.miniWindow.onNewTab((state) => {
    document.body.classList.toggle('private', Boolean(state.private))
    const sites = Array.isArray(state.sites) ? state.sites : []
    document.body.classList.toggle('empty', sites.length === 0)
    const next = JSON.stringify(sites)
    if (next === key) return
    key = next
    list.replaceChildren(...sites.map((site) => {
      const item = document.createElement('li')
      const button = document.createElement('button')
      button.className = 'site'
      button.type = 'button'
      button.title = site.title + ' · ' + site.origin
      const icon = document.createElement('span')
      icon.className = 'icon'
      const letter = (site.title || site.origin.replace(/^https?:\\/\\/(www\\.)?/, '')).trim().charAt(0).toUpperCase()
      icon.textContent = letter
      if (site.faviconUrl) {
        const img = new Image()
        img.alt = ''
        img.onload = () => icon.replaceChildren(img)
        img.src = site.faviconUrl
      }
      const label = document.createElement('span')
      label.className = 'label'
      label.textContent = site.title
      button.append(icon, label)
      button.addEventListener('click', (event) => { event.stopPropagation(); window.miniWindow.openSite(site.url) })
      item.append(button)
      return item
    }))
  })
  // A click on the empty page: the address field (shown and focused again if it was put away).
  document.getElementById('page').addEventListener('mousedown', (event) => { if (!event.target.closest('.site')) { event.preventDefault(); window.miniWindow.showAddress() } })
</script>
</body></html>`
