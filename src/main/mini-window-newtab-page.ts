/**
 * A mini window's New Tab (the browser's surffish://quick-links tab, opened with + or ⌘/Ctrl+T in a
 * mini window). In a browser window the New Tab is drawn by that window's content renderer; a mini
 * window has no shell, so this small page stands in for it in the page area, with the browser New
 * Tab's look: its background photo (the same Wikimedia cache and offline photos, picked the same way,
 * main/new-tab-backgrounds.ts newTabBackgroundOnOpen) under Settings → New Tab's dim and blur, with
 * the photo's credit; its clock when that is on (main formats it with shared/new-tab-clock.ts and
 * sends the text); and its Favourites and Frequently visited sites (shared/quick-links.ts, the same
 * lists) as icons on the photo, at the New Tab's icon size, labelled when its labels are on.
 * The address field lives in the header (it is already open and focused on a New Tab); a click on
 * the empty page shows it again after Esc put it away.
 * Only made while a New Tab is the window's active tab; released as soon as it isn't.
 * Loaded from a data: URL with the narrow preload in preload/mini-window.cjs; never remote content.
 */
export const MINI_WINDOW_NEW_TAB_HTML = `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src https: http: data:">
<title>Mini Window New Tab</title>
<style>
  /* The browser New Tab's look (renderer Browser.css .new-tab-*): a dark base, the photo, a radial dim, white icons and text with soft shadows. No backdrop-filter (cheap to composite). */
  :root { color-scheme: dark; --icon: 30px; --dim: .34; --dim-soft: .1; --dim-mid: .22; --blur: 0px; }
  html, body { margin: 0; height: 100%; background: #101419; color: #f2f4f6; font: 12px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; user-select: none; overflow: hidden; }
  #photo { position: fixed; inset: 0; z-index: 0; background: center / cover no-repeat; filter: blur(var(--blur)); transform: scale(1.025); opacity: 0; transition: opacity 500ms ease-out; pointer-events: none; }
  #photo.on { opacity: 1; }
  body::before { content: ''; position: fixed; inset: 0; z-index: 1; pointer-events: none; background: radial-gradient(ellipse at center, rgba(8,12,16,var(--dim-soft)) 0%, rgba(8,12,16,var(--dim-mid)) 58%, rgba(8,12,16,var(--dim)) 100%), linear-gradient(0deg, rgba(8,12,16,.42) 0%, transparent 22%); }
  main { position: relative; z-index: 2; box-sizing: border-box; height: 100%; padding: 18px 12px 34px; display: flex; flex-direction: column; align-items: center; gap: 18px; overflow-y: auto; scrollbar-width: none; }
  main::-webkit-scrollbar { display: none; }
  /* The content sits a little above the middle (the browser New Tab's icons sit low; a mini window is short). */
  main::before, main::after { content: ''; flex: 1 1 0; min-height: 0; }
  main::before { flex-grow: .8; }
  main > * { flex: none; }
  h1 { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .pill { margin: 0; padding: 4px 11px; border: 1px solid rgba(255,255,255,.16); border-radius: 999px; background: rgba(10,15,19,.42); color: rgba(245,247,250,.88); font-size: 11px; text-align: center; text-shadow: none; }
  #private, #empty { display: none; }
  body.private #private { display: block; }
  body.empty #empty { display: block; }
  #clock { display: none; flex-direction: column; align-items: center; gap: 2px; color: rgba(250,252,253,.96); text-shadow: 0 2px 14px rgba(0,0,0,.5); }
  body.clock #clock { display: flex; }
  #time { font-size: clamp(30px, 11vw, 46px); font-weight: 300; font-variant-numeric: tabular-nums; letter-spacing: -.035em; line-height: 1.1; }
  body.weight-regular #time { font-weight: 420; }
  body.weight-bold #time { font-weight: 680; letter-spacing: -.025em; }
  body.proportional #time { font-variant-numeric: normal; }
  #date { font-size: 11.5px; color: rgba(250,252,253,.9); }
  #date:empty { display: none; }
  /* Centred rows (a short last row stays in the middle), at most six across; narrower without labels. */
  #sites { --cell: calc(var(--icon) + 34px); display: flex; flex-wrap: wrap; justify-content: center; gap: 10px 4px; width: 100%; max-width: calc(var(--cell) * 6 + 20px); padding: 0; margin: 0; list-style: none; }
  #sites li { width: var(--cell); min-width: 0; }
  body.nolabels #sites { --cell: calc(var(--icon) + 18px); gap: 10px 8px; }
  .site { appearance: none; border: 0; background: transparent; color: inherit; font: inherit; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 6px 2px; border-radius: 10px; cursor: default; min-width: 0; width: 100%; transition: transform 130ms ease, filter 130ms ease; }
  .site:hover { transform: translateY(-2px) scale(1.06); filter: drop-shadow(0 3px 8px rgba(0,0,0,.65)); }
  .site:focus-visible { outline: 2px solid rgba(255,255,255,.75); outline-offset: 0; }
  .icon { width: var(--icon); height: var(--icon); display: grid; place-items: center; border-radius: 9px; background: rgba(255,255,255,.14); box-shadow: inset 0 0 0 1px rgba(255,255,255,.2); color: rgba(255,255,255,.96); font-size: calc(var(--icon) * .5); font-weight: 650; text-shadow: 0 2px 8px rgba(0,0,0,.84); overflow: hidden; }
  .icon.img { background: transparent; box-shadow: none; overflow: visible; }
  .icon img { display: block; width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 2px 5px rgba(0,0,0,.54)); }
  .label { max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 10.5px; color: rgba(250,252,253,.94); text-shadow: 0 1px 6px rgba(0,0,0,.78); }
  body.nolabels .label { display: none; }
  #credit { position: fixed; z-index: 2; left: 12px; right: 12px; bottom: 9px; margin: 0; display: none; color: rgba(248,250,252,.72); font-size: 10px; line-height: 1.4; text-shadow: 0 1px 5px rgba(0,0,0,.6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  body.photo #credit { display: block; }
  #credit a { color: rgba(248,250,252,.92); text-decoration: underline; text-decoration-color: rgba(248,250,252,.4); text-underline-offset: 2px; cursor: default; }
  #credit a:hover, #credit a:focus-visible { color: #fff; text-decoration-color: currentColor; outline: none; }
  @media (max-height: 300px) { #credit { display: none !important; } main { padding-bottom: 14px; } }
  @media (prefers-reduced-motion: reduce) { #photo { transition: none; } .site { transition: none; } }
</style></head>
<body>
<div id="photo" aria-hidden="true"></div>
<main id="page" aria-label="New Tab">
  <h1>New Tab</h1>
  <p id="private" class="pill">Private tab · nothing from it is saved</p>
  <div id="clock" aria-label="Time"><time id="time"></time><span id="date"></span></div>
  <ul id="sites" aria-label="Favourites and frequently visited sites"></ul>
  <p id="empty" class="pill">Favourites and sites you visit often show here.</p>
</main>
<p id="credit">Photo: <a id="photoTitle" href="#"></a> · <span id="photoBy"></span> · <a id="photoLicense" href="#"></a></p>
<script>
  const list = document.getElementById('sites')
  const photo = document.getElementById('photo')
  const root = document.documentElement.style
  let key = ''
  let photoId = null
  let photoUrls = { source: '', license: '' }
  function setText(element, value) { const text = String(value ?? ''); if (element.textContent !== text) element.textContent = text }
  function showPhoto(next) {
    const id = next ? next.id : null
    document.body.classList.toggle('photo', Boolean(next))
    if (id === photoId) return
    photoId = id
    photo.classList.remove('on')
    if (!next) { photo.style.backgroundImage = ''; return }
    photoUrls = { source: next.sourceUrl, license: next.licenseUrl }
    setText(document.getElementById('photoTitle'), next.title)
    setText(document.getElementById('photoBy'), next.creator)
    setText(document.getElementById('photoLicense'), next.licenseName)
    document.getElementById('credit').title = 'Photo: ' + next.title + ' · ' + next.creator + ' · ' + next.licenseName
    const image = new Image()
    image.onload = () => { if (photoId !== id) return; photo.style.backgroundImage = 'url("' + next.src + '")'; requestAnimationFrame(() => photo.classList.add('on')) }
    image.src = next.src
  }
  window.miniWindow.onNewTab((state) => {
    document.body.classList.toggle('private', Boolean(state.private))
    const look = state.look || {}
    const dim = Math.min(100, Math.max(0, Number(look.dim) || 0))
    root.setProperty('--dim', (dim / 100).toFixed(2))
    root.setProperty('--dim-soft', (dim / 350).toFixed(2))
    root.setProperty('--dim-mid', (dim / 165).toFixed(2))
    root.setProperty('--blur', Math.min(40, Math.max(0, Number(look.blur) || 0)) + 'px')
    // The New Tab's icon size, kept to what fits a narrow window.
    root.setProperty('--icon', Math.min(40, Math.max(24, Number(look.iconSize) || 30)) + 'px')
    document.body.classList.toggle('nolabels', look.labels === false)
    document.body.classList.toggle('weight-regular', look.clockWeight === 'regular')
    document.body.classList.toggle('weight-bold', look.clockWeight === 'bold')
    document.body.classList.toggle('proportional', look.tabular === false)
    showPhoto(state.photo || null)
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
        img.onload = () => { icon.classList.add('img'); icon.replaceChildren(img) }
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
  window.miniWindow.onNewTabClock((clock) => {
    document.body.classList.toggle('clock', Boolean(clock))
    if (!clock) return
    setText(document.getElementById('time'), clock.time)
    setText(document.getElementById('date'), clock.date)
  })
  // The credit's links open in this tab (the page never navigates itself).
  for (const [id, which] of [['photoTitle', 'source'], ['photoLicense', 'license']]) {
    const link = document.getElementById(id)
    link.addEventListener('mousedown', (event) => event.stopPropagation())
    link.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); if (photoUrls[which]) window.miniWindow.openSite(photoUrls[which]) })
  }
  // A click on the empty page: the address field (shown and focused again if it was put away).
  document.body.addEventListener('mousedown', (event) => { if (!event.target.closest('.site, #credit a')) { event.preventDefault(); window.miniWindow.showAddress() } })
</script>
</body></html>`
