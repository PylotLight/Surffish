/**
 * The Glance chrome page: a full-window transparent view under the glance page view. It draws the
 * dimmed backdrop, the card's shadow and rounded frame, and the header (title + URL, Back, Open as
 * Tab, Open in Split View, Close). A press on the backdrop closes the glance. Loaded from a data:
 * URL with the narrow preload in preload/glance.cjs; never shown remote content.
 */
export const GLANCE_PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Glance</title>
<style>
  :root { color-scheme: light dark; --card: #f6f6f7; --text: #1d1d1f; --muted: #6e6e73; --line: rgba(0,0,0,.08); --hover: rgba(0,0,0,.07); --accent: #2f6fed; }
  @media (prefers-color-scheme: dark) { :root { --card: #2a2a2d; --text: #f2f2f4; --muted: #a1a1a6; --line: rgba(255,255,255,.09); --hover: rgba(255,255,255,.09); --accent: #6d9bff; } }
  html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; font: 13px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--text); user-select: none; }
  #backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.42); opacity: 0; transition: opacity 140ms ease-out; }
  body.shown #backdrop { opacity: 1; }
  #card { position: fixed; background: var(--card); border-radius: 12px; box-shadow: 0 18px 60px rgba(0,0,0,.38), 0 0 0 1px var(--line); overflow: hidden; transform: scale(.985); opacity: 0; transition: opacity 140ms ease-out, transform 160ms ease-out; }
  body.shown #card { transform: none; opacity: 1; }
  header { display: flex; align-items: center; gap: 6px; height: 40px; padding: 0 8px 0 10px; box-sizing: border-box; border-bottom: 1px solid var(--line); }
  #where { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
  #title { font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #url { font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #badge { display: none; font-size: 11px; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 1px 7px; }
  body.private #badge { display: inline-block; }
  button { appearance: none; border: 0; background: transparent; color: var(--text); font: inherit; font-size: 12px; height: 28px; padding: 0 9px; border-radius: 7px; display: inline-flex; align-items: center; gap: 5px; cursor: default; white-space: nowrap; }
  button:hover { background: var(--hover); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  button[disabled] { opacity: .35; }
  button.icon { width: 28px; padding: 0; justify-content: center; font-size: 15px; }
  kbd { font: inherit; font-size: 11px; color: var(--muted); }
  #split { display: none; }
  body.can-split #split { display: inline-flex; }
  #progress { position: absolute; left: 0; top: 39px; height: 2px; width: 0; background: var(--accent); opacity: 0; transition: width 400ms ease-out, opacity 200ms; }
  body.loading #progress { width: 70%; opacity: 1; }
</style></head>
<body>
<div id="backdrop"></div>
<div id="card" role="dialog" aria-label="Glance">
  <header>
    <button id="back" class="icon" title="Back" aria-label="Back" disabled>&#8249;</button>
    <div id="where"><div id="title"></div><div id="url"></div></div>
    <span id="badge">Private</span>
    <button id="split" title="Open in Split View">Split View</button>
    <button id="promote" title="Open as Tab (⌘/Ctrl+Enter)">Open as Tab <kbd id="promote-key"></kbd></button>
    <button id="close" class="icon" title="Close (Esc)" aria-label="Close Glance">&#215;</button>
  </header>
  <div id="progress"></div>
</div>
<script>
  const mac = navigator.platform.toUpperCase().includes('MAC')
  document.getElementById('promote-key').textContent = mac ? '\\u2318\\u21b5' : 'Ctrl+\\u21b5'
  const card = document.getElementById('card')
  const place = (rect) => { Object.assign(card.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.width + 'px', height: rect.height + 'px' }) }
  window.glance.onLayout((layout) => {
    place(layout.card)
    requestAnimationFrame(() => document.body.classList.add('shown'))
  })
  window.glance.onState((state) => {
    document.getElementById('title').textContent = state.title
    document.getElementById('url').textContent = state.url
    document.getElementById('back').disabled = !state.canGoBack
    document.body.classList.toggle('loading', Boolean(state.loading))
    document.body.classList.toggle('private', Boolean(state.private))
    document.body.classList.toggle('can-split', Boolean(state.canSplit))
  })
  // A press anywhere outside the card (the dimmed backdrop) closes the glance.
  document.getElementById('backdrop').addEventListener('mousedown', (event) => { if (event.button === 0) window.glance.close() })
  document.getElementById('close').addEventListener('click', () => window.glance.close())
  document.getElementById('promote').addEventListener('click', () => window.glance.promote())
  document.getElementById('split').addEventListener('click', () => window.glance.split())
  document.getElementById('back').addEventListener('click', () => window.glance.back())
</script>
</body></html>`;
