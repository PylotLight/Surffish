// Self-contained page for the tab overview. Loaded into its own transparent WebContentsView above
// every other layer, so it never fights the React shell surfaces.
//
// Everything is driven by one number, progress: 0 = the focused tab's thumbnail sits exactly over
// the live page, 1 = the full grid. A pinch moves it directly; buttons, keys and gesture releases
// animate it to 0 or 1 with a spring-ish ease.
export const TAB_OVERVIEW_HTML = String.raw`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  :root { color-scheme: dark; --accent: #1684ff; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; overflow: hidden; background: transparent;
    font: 500 12px/1.3 -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; color: #e8edf3;
    -webkit-user-select: none; user-select: none; }
  body { visibility: hidden; }
  body.ready { visibility: visible; }
  #backdrop { position: fixed; inset: 0; background: rgb(11, 14, 18); opacity: 0; will-change: opacity; }
  #scroller { position: fixed; inset: 0; overflow-y: auto; padding: 64px 48px 48px; }
  body.moving #scroller { overflow: hidden; pointer-events: none; }
  #grid { display: grid; gap: 28px 24px; max-width: 1400px; margin: 0 auto;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
  .card { position: relative; display: flex; flex-direction: column; gap: 8px; cursor: default;
    will-change: transform, opacity; transform-origin: 50% 40%; }
  .thumb { position: relative; width: 100%; aspect-ratio: var(--ratio, 16 / 10); border-radius: 12px;
    overflow: hidden; background: #1b222b; box-shadow: 0 6px 24px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.07);
    transform-origin: 0 0; will-change: transform; transition: box-shadow 160ms ease; }
  .thumb img.shot { width: 100%; height: 100%; object-fit: cover; object-position: top left; display: block; }
  .placeholder { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 10px;
    align-items: center; justify-content: center; color: #8a96a6; }
  .placeholder img { width: 36px; height: 36px; border-radius: 8px; }
  .placeholder .glyph { width: 44px; height: 44px; border-radius: 12px; background: #2a3440; display: grid;
    place-items: center; font-size: 20px; color: #c9d3df; }
  .card.active .thumb { box-shadow: 0 6px 24px rgba(0,0,0,.35), 0 0 0 2px var(--accent); }
  body:not(.moving) .card.selected .thumb, body:not(.moving) .card:hover .thumb { box-shadow: 0 8px 28px rgba(0,0,0,.45), 0 0 0 2px rgba(255,255,255,.55); }
  body:not(.moving) .card.active.selected .thumb, body:not(.moving) .card.active:hover .thumb { box-shadow: 0 8px 28px rgba(0,0,0,.45), 0 0 0 2px var(--accent); }
  .focus { z-index: 10; }
  .focus .thumb { box-shadow: none; }
  .meta { display: flex; align-items: center; gap: 7px; padding: 0 2px; min-width: 0; will-change: opacity; }
  .meta img { width: 14px; height: 14px; border-radius: 3px; flex: none; }
  .meta .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta .badge { color: #8a96a6; flex: none; }
  .close { position: absolute; top: -8px; left: -8px; width: 22px; height: 22px; border-radius: 50%;
    border: 0; background: #e8edf3; color: #11161c; font: 600 13px/22px -apple-system, sans-serif; padding: 0;
    opacity: 0; transform: scale(.8); transition: opacity 120ms ease, transform 120ms ease; z-index: 2; }
  body:not(.moving) .card:hover .close, body:not(.moving) .card.selected .close { opacity: 1; transform: none; }
  .new .thumb { display: grid; place-items: center; background: transparent; box-shadow: none;
    border: 1.5px dashed rgba(255,255,255,.2); font-size: 34px; color: #8a96a6; font-weight: 300; }
  body:not(.moving) .new:hover .thumb, body:not(.moving) .new.selected .thumb { border-color: rgba(255,255,255,.55); color: #e8edf3; box-shadow: none; }
</style>
</head>
<body>
<div id="backdrop"></div>
<div id="scroller"><div id="grid"></div></div>
<script>
(() => {
  const api = window.tabOverview
  const grid = document.getElementById('grid')
  const scroller = document.getElementById('scroller')
  const backdrop = document.getElementById('backdrop')
  const BACKDROP_ALPHA = 0.94

  let items = []
  let pageBounds = null
  let selected = 0
  let focusIndex = -1      // card whose thumbnail flies to and from the page
  let focusFrom = null     // { tx, ty, sx, sy } that puts the focus thumbnail over the page
  let progress = 0
  let shown = false
  let anim = null          // running settle animation

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
  const lerp = (a, b, t) => a + (b - a) * t
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)
  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
  function host(url) { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' } }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n }
  function cards() { return Array.from(grid.children) }

  function render() {
    grid.textContent = ''
    if (pageBounds && pageBounds.width > 0 && pageBounds.height > 0) {
      document.documentElement.style.setProperty('--ratio', pageBounds.width + ' / ' + pageBounds.height)
    }
    items.forEach((item, index) => {
      const card = el('div', 'card' + (item.active ? ' active' : '') + (index === selected ? ' selected' : ''))
      const thumb = el('div', 'thumb')
      if (item.thumbnail) {
        const shot = el('img', 'shot'); shot.src = item.thumbnail; shot.draggable = false; thumb.appendChild(shot)
      } else {
        const ph = el('div', 'placeholder')
        const glyph = () => el('div', 'glyph', (host(item.url)[0] || '•').toUpperCase())
        if (item.faviconUrl) { const f = el('img'); f.src = item.faviconUrl; f.onerror = () => f.replaceWith(glyph()); ph.appendChild(f) }
        else ph.appendChild(glyph())
        ph.appendChild(el('div', '', host(item.url) || 'New Tab'))
        thumb.appendChild(ph)
      }
      const meta = el('div', 'meta')
      if (item.faviconUrl) { const f = el('img'); f.src = item.faviconUrl; f.onerror = () => f.remove(); meta.appendChild(f) }
      meta.appendChild(el('span', 'title', item.title || host(item.url) || 'New Tab'))
      if (item.sleeping) meta.appendChild(el('span', 'badge', '☾'))
      if (item.pinned) meta.appendChild(el('span', 'badge', '★'))
      const close = el('button', 'close', '×')
      close.title = 'Close tab'
      close.addEventListener('click', (event) => { event.stopPropagation(); if (!moving()) api.closeTab(item.id) })
      card.append(close, thumb, meta)
      card.addEventListener('click', (event) => { event.stopPropagation(); if (!moving()) choose(index) })
      card.addEventListener('mouseenter', () => { if (!moving()) setSelected(index, false) })
      grid.appendChild(card)
    })
    const add = el('div', 'card new' + (selected === items.length ? ' selected' : ''))
    const addMeta = el('div', 'meta')
    addMeta.appendChild(el('span', 'title', 'New Tab'))
    add.append(el('div', 'thumb', '+'), addMeta)
    add.addEventListener('click', (event) => { event.stopPropagation(); if (!moving()) api.newTab() })
    add.addEventListener('mouseenter', () => { if (!moving()) setSelected(items.length, false) })
    grid.appendChild(add)
  }

  function reportSelected() {
    api.selected(items[selected] ? items[selected].id : null)
  }

  // Card a pinch out should fly home: the selected tab, else the active one.
  function homeIndex() {
    if (items[selected]) return selected
    return items.findIndex((item) => item.active)
  }

  function moving() { return document.body.classList.contains('moving') }

  function setSelected(index, scroll = true) {
    const all = cards()
    selected = clamp(index, 0, all.length - 1)
    all.forEach((card, i) => card.classList.toggle('selected', i === selected))
    if (scroll) all[selected]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    reportSelected()
  }

  function columns() {
    return getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length || 1
  }

  // Measure where the focus thumbnail sits in the grid (with no transform applied) and work out
  // the transform that lays it exactly over the page.
  function measureFocus(index) {
    cards().forEach((card) => card.classList.remove('focus'))
    focusIndex = index
    focusFrom = null
    const card = cards()[index]
    if (!card || !pageBounds) return
    const thumb = card.querySelector('.thumb')
    const prevCard = card.style.transform, prevThumb = thumb.style.transform
    card.style.transform = 'none'; thumb.style.transform = 'none'
    const r = thumb.getBoundingClientRect()
    card.style.transform = prevCard; thumb.style.transform = prevThumb
    if (!r.width || !r.height) return
    card.classList.add('focus')
    focusFrom = { tx: pageBounds.x - r.left, ty: pageBounds.y - r.top, sx: pageBounds.width / r.width, sy: pageBounds.height / r.height }
  }

  // Draw one frame for a progress value. Nothing here touches layout, only transform/opacity.
  function apply(p) {
    progress = p
    const t = clamp(p, 0, 1)
    backdrop.style.opacity = String(BACKDROP_ALPHA * clamp(t * 1.25, 0, 1))
    const all = cards()
    const count = all.length
    all.forEach((card, i) => {
      if (i === focusIndex && focusFrom) {
        const thumb = card.querySelector('.thumb')
        const k = 1 - easeOutCubic(t)
        // Slight overshoot past 1 when pinching harder keeps it feeling attached to the fingers.
        const extra = p > 1 ? 1 - Math.min(p - 1, 0.25) * 0.2 : 1
        thumb.style.transform = 'translate(' + (focusFrom.tx * k) + 'px,' + (focusFrom.ty * k) + 'px) scale(' + (lerp(1, focusFrom.sx, k) * extra) + ',' + (lerp(1, focusFrom.sy, k) * extra) + ')'
        thumb.style.borderRadius = (12 * t / lerp(1, focusFrom.sx, k)) + 'px'
        card.style.opacity = '1'
        card.style.transform = 'none'
        for (const part of card.querySelectorAll('.meta, .close')) part.style.opacity = String(clamp((t - 0.6) / 0.4, 0, 1))
        return
      }
      // Other cards come in slightly staggered from the focus card outwards.
      const distance = focusIndex >= 0 ? Math.abs(i - focusIndex) : i
      const delay = Math.min(distance / Math.max(count, 1), 1) * 0.25
      const local = clamp((t - delay) / (1 - delay), 0, 1)
      const e = easeOutCubic(local)
      card.style.opacity = String(e)
      card.style.transform = 'scale(' + lerp(0.86, 1, e) + ')'
      for (const part of card.querySelectorAll('.meta, .close')) part.style.opacity = ''
    })
  }

  function stopAnim() { if (anim) cancelAnimationFrame(anim.raf); anim = null }

  function animateTo(target, duration, done) {
    stopAnim()
    const from = progress
    const span = Math.abs(target - from)
    if (span < 0.001) { apply(target); done && done(); return }
    // Shorter trips take proportionally less time, but never feel snappy.
    const ms = Math.max(220, duration * Math.min(1, span))
    const start = performance.now()
    const ease = from === 0 || from === 1 ? easeInOutCubic : easeOutCubic
    const step = (now) => {
      const k = clamp((now - start) / ms, 0, 1)
      apply(lerp(from, target, ease(k)))
      if (k < 1) anim.raf = requestAnimationFrame(step)
      else { anim = null; done && done() }
    }
    anim = { raf: requestAnimationFrame(step) }
  }

  function clearInline() {
    for (const card of cards()) {
      card.style.opacity = ''; card.style.transform = ''
      const thumb = card.querySelector('.thumb')
      if (thumb) { thumb.style.transform = ''; thumb.style.borderRadius = '' }
      for (const part of card.querySelectorAll('.meta, .close')) part.style.opacity = ''
      card.classList.remove('focus')
    }
  }

  function settled(open) {
    document.body.classList.toggle('moving', !open)
    if (open) { clearInline(); backdrop.style.opacity = String(BACKDROP_ALPHA); window.focus(); api.settled(true) }
    else { shown = false; document.body.classList.remove('ready'); api.settled(false) }
  }

  // payload: { items, pageBounds, progress, animate }
  function show(payload) {
    stopAnim()
    items = payload.items || []
    pageBounds = payload.pageBounds || null
    const activeIndex = items.findIndex((item) => item.active)
    selected = activeIndex >= 0 ? activeIndex : 0
    document.body.classList.add('moving')
    render()
    const card = cards()[selected]
    if (card) {
      const r = card.getBoundingClientRect()
      scroller.scrollTop += r.top + r.height / 2 - scroller.clientHeight / 2
    }
    measureFocus(activeIndex)
    apply(payload.progress || 0)
    reportSelected()
    shown = true
    // Reveal only once the first frame at this progress is painted, so the page never flickers.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.body.classList.add('ready')
      api.ready()
      if (payload.animate) animateTo(1, 520, () => settled(true))
    }))
  }

  function setProgress(p) {
    if (!shown) return
    stopAnim()
    if (!moving()) {
      // Pinching back out of a settled grid: fly the active tab home.
      document.body.classList.add('moving')
      clearInline()
      measureFocus(homeIndex())
    }
    apply(p)
  }

  // payload: { open, targetId, duration }
  function settle(payload) {
    if (!shown) { if (!payload.open) api.settled(false); return }
    const target = payload.open ? 1 : 0
    if (!payload.open) {
      document.body.classList.add('moving')
      let index = payload.targetId ? items.findIndex((item) => item.id === payload.targetId) : -1
      if (index < 0) index = homeIndex()
      // Re-measure every time: the grid may have scrolled or reflowed since the last flight.
      clearInline()
      measureFocus(index)
      apply(progress)
    }
    animateTo(target, payload.duration || 480, () => settled(payload.open))
  }

  function choose(index) {
    const item = items[index]
    if (item) api.activate(item.id)
    else if (index === items.length) api.newTab()
  }

  api.onShow(show)
  api.onProgress(setProgress)
  api.onSettle(settle)
  // A committed two-finger swipe while the grid is up steps the selection one card.
  api.onMove((delta) => {
    if (!shown || moving() || !items.length) return
    const from = items[selected] ? selected : Math.max(0, items.findIndex((item) => item.active))
    setSelected(clamp(from + (delta > 0 ? 1 : -1), 0, items.length - 1))
  })
  api.onItems((payload) => {
    if (!shown) return
    items = payload.items || []
    if (payload.pageBounds) pageBounds = payload.pageBounds
    selected = Math.min(selected, items.length)
    reportSelected()
    const top = scroller.scrollTop
    render()
    scroller.scrollTop = top
    focusIndex = -1
    focusFrom = null
    if (moving()) apply(progress)
  })

  backdrop.addEventListener('click', () => { if (!moving()) api.dismiss() })
  scroller.addEventListener('click', (event) => { if (!moving() && (event.target === scroller || event.target === grid)) api.dismiss() })
  window.addEventListener('keydown', (event) => {
    if (!shown || moving()) return
    const total = cards().length
    if (event.key === 'Escape' || (event.metaKey && event.shiftKey && event.code === 'Backslash')) { event.preventDefault(); api.dismiss(); return }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(selected); return }
    if (event.key === 'ArrowRight') { event.preventDefault(); setSelected((selected + 1) % total); return }
    if (event.key === 'ArrowLeft') { event.preventDefault(); setSelected((selected - 1 + total) % total); return }
    if (event.key === 'ArrowDown') { event.preventDefault(); setSelected(Math.min(total - 1, selected + columns())); return }
    if (event.key === 'ArrowUp') { event.preventDefault(); setSelected(Math.max(0, selected - columns())); return }
    if ((event.key === 'Backspace' || (event.metaKey && event.key.toLowerCase() === 'w')) && items[selected]) {
      event.preventDefault(); api.closeTab(items[selected].id)
    }
  })
})()
</script>
</body>
</html>`
