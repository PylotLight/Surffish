// Self-contained page for the screenshot tool. Loaded into its own transparent WebContentsView
// stacked above every other layer (like the tab overview), so it never touches the React shell.
//
// Main drives it with one message, `show`, carrying the mode:
//   select   – the visible page, frozen, dimmed; drag a region, or pick Visible area / Full page /
//              Scrolling (then drag a band to set the width and start line, or Enter for the top of the view)
//   scrolling – the view shrinks to a bar over the live page: Auto-scroll, Done, Cancel and the size so far
//   busy     – "Capturing full page…" while CDP (or the scroll-and-stitch fallback) runs
//   preview  – the view shrinks to a small popover: Copy, Save…, Annotate, close
//   annotate – full page area: arrow, box, pen, text, blur and redact on a canvas, then Copy/Save/Done
// The page only ever sends back a region rect, button intents and (after annotating) PNG bytes.
export const SCREENSHOT_PAGE_HTML = String.raw`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  :root { color-scheme: dark; --accent: #1684ff; --panel: rgba(24, 28, 34, .96); --line: rgba(255,255,255,.12); --text: #e8edf3; --muted: #94a0ae; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; color: var(--text);
    font: 500 12px/1.3 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
    -webkit-user-select: none; user-select: none; }
  [hidden] { display: none !important; }
  button { font: inherit; color: inherit; background: rgba(255,255,255,.08); border: 1px solid var(--line); border-radius: 7px;
    height: 28px; padding: 0 10px; cursor: default; white-space: nowrap; }
  button:hover { background: rgba(255,255,255,.14); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  button.primary { background: var(--accent); border-color: transparent; color: #fff; }
  button.primary:hover { background: #2b90ff; }
  button[aria-pressed="true"] { background: rgba(22,132,255,.28); border-color: var(--accent); }
  kbd { font: inherit; color: var(--muted); }

  /* select */
  #select { position: fixed; inset: 0; cursor: crosshair; }
  #frozen { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  #shade { position: absolute; inset: 0; background: rgba(0,0,0,.38); }
  #selection { position: absolute; border: 1px solid #fff; box-shadow: 0 0 0 9999px rgba(0,0,0,.38), 0 0 0 1px rgba(0,0,0,.5) inset; }
  #selection-size { position: absolute; padding: 2px 6px; border-radius: 5px; background: rgba(0,0,0,.72); font-size: 11px; white-space: nowrap; pointer-events: none; }
  #select-bar { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); display: flex; gap: 6px; align-items: center;
    padding: 6px; border-radius: 10px; background: var(--panel); border: 1px solid var(--line); box-shadow: 0 8px 28px rgba(0,0,0,.4); cursor: default; }
  #select-bar .hint { padding: 0 8px 0 6px; color: var(--muted); }
  .badge { padding: 2px 7px; border-radius: 99px; background: rgba(160, 110, 255, .22); color: #d6c4ff; font-size: 11px; }

  /* scrolling bar: the view itself is sized to the bar */
  #scrolling { position: fixed; inset: 0; display: flex; align-items: center; gap: 6px; padding: 0 8px 0 12px;
    background: var(--panel); border: 1px solid var(--line); border-radius: 12px; }
  #scrolling .hint { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
  #scroll-dims { color: var(--text); font-variant-numeric: tabular-nums; white-space: nowrap; }
  #scroll-dims.limit { color: #ff8a80; }

  /* busy */
  #busy { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(0,0,0,.25); }
  #busy div { padding: 10px 16px; border-radius: 10px; background: var(--panel); border: 1px solid var(--line); }

  /* preview popover: the view itself is sized to the card */
  #preview { position: fixed; inset: 0; display: flex; flex-direction: column; gap: 8px; padding: 10px;
    background: var(--panel); border: 1px solid var(--line); border-radius: 12px; }
  #preview header { display: flex; align-items: center; gap: 8px; height: 22px; }
  #preview header strong { font-weight: 600; }
  #preview header .dims { color: var(--muted); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #preview header button { height: 22px; width: 22px; padding: 0; border-radius: 6px; background: transparent; border: none; color: var(--muted); }
  #preview header button:hover { background: rgba(255,255,255,.1); color: var(--text); }
  #thumb-wrap { flex: 1; min-height: 0; border-radius: 8px; overflow: hidden; display: grid; place-items: center;
    background: repeating-conic-gradient(#20262e 0 25%, #1a1f26 0 50%) 0 0 / 16px 16px; }
  #thumb { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
  #preview .actions { display: flex; gap: 6px; }
  #preview .actions button { flex: 1; }
  #status { min-height: 15px; color: var(--muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #status.ok { color: #7fd99a; }
  #status.error { color: #ff8a80; }

  /* annotate */
  #annotate { position: fixed; inset: 0; display: flex; flex-direction: column; background: rgb(14, 17, 21); }
  #tools { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--line); background: var(--panel); flex-wrap: wrap; }
  #tools .sep { width: 1px; height: 20px; background: var(--line); margin: 0 4px; }
  #tools .spacer { flex: 1; }
  .swatch { width: 22px; height: 22px; padding: 0; border-radius: 50%; border: 2px solid transparent; }
  .swatch[aria-pressed="true"] { border-color: #fff; }
  #stage { flex: 1; min-height: 0; overflow: auto; display: grid; place-items: center; padding: 16px;
    background: repeating-conic-gradient(#191e25 0 25%, #14181e 0 50%) 0 0 / 20px 20px; }
  #canvas-wrap { position: relative; line-height: 0; box-shadow: 0 8px 30px rgba(0,0,0,.5); }
  #canvas-wrap canvas { display: block; max-width: calc(100vw - 32px); max-height: calc(100vh - 80px); }
  #draft { position: absolute; inset: 0; width: 100%; height: 100%; cursor: crosshair; }
  #text-input { position: absolute; z-index: 2; min-width: 60px; background: rgba(0,0,0,.35); border: 1px dashed rgba(255,255,255,.7);
    outline: none; padding: 0 2px; font-weight: 700; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; line-height: 1.2; }
  #annotate-status { color: var(--muted); font-size: 11px; padding: 0 4px; }
</style>
</head>
<body>
<section id="select" hidden>
  <img id="frozen" alt="" draggable="false">
  <div id="shade"></div>
  <div id="selection" hidden></div>
  <div id="selection-size" hidden></div>
  <div id="select-bar">
    <span class="hint">Drag to capture a region</span>
    <span class="badge" id="select-private" hidden>Private</span>
    <button id="btn-visible" class="primary" title="Enter">Visible Area</button>
    <button id="btn-full" title="F">Full Page</button>
    <button id="btn-scroll" title="S">Scrolling</button>
    <button id="btn-scroll-top" class="primary" title="Enter" hidden>Start at Top</button>
    <button id="btn-cancel" title="Esc">Cancel</button>
  </div>
</section>

<section id="scrolling" hidden>
  <span class="hint" id="scroll-hint" title="Scroll (wheel, keys or Auto-scroll) to where the capture should end, then press Done or Enter, or click the page at that spot">Scroll, then Done or click the end</span>
  <span id="scroll-dims"></span>
  <span class="badge" id="scroll-private" hidden>Private</span>
  <button id="btn-scroll-auto" aria-pressed="false" title="A">Auto-scroll</button>
  <button id="btn-scroll-done" class="primary" title="Enter">Done</button>
  <button id="btn-scroll-cancel" title="Esc">Cancel</button>
</section>

<section id="busy" hidden><div id="busy-text">Capturing full page…</div></section>

<section id="preview" hidden>
  <header>
    <strong>Screenshot</strong>
    <span class="dims" id="dims"></span>
    <span class="badge" id="preview-private" hidden title="Nothing is saved unless you choose Save">Private</span>
    <button id="btn-close" title="Close (Esc)" aria-label="Close">✕</button>
  </header>
  <div id="thumb-wrap"><img id="thumb" alt="Screenshot preview" draggable="false"></div>
  <div class="actions">
    <button id="btn-copy" class="primary" title="⌘/Ctrl+C">Copy</button>
    <button id="btn-save" title="⌘/Ctrl+S">Save…</button>
    <button id="btn-annotate">Annotate</button>
  </div>
  <div id="status"></div>
</section>

<section id="annotate" hidden>
  <div id="tools">
    <button data-tool="arrow" aria-pressed="true" title="Arrow (A)">Arrow</button>
    <button data-tool="box" title="Box (B)">Box</button>
    <button data-tool="pen" title="Pen (P)">Pen</button>
    <button data-tool="text" title="Text (T)">Text</button>
    <button data-tool="blur" title="Blur a region (U)">Blur</button>
    <button data-tool="redact" title="Black out a region (R)">Redact</button>
    <span class="sep"></span>
    <button class="swatch" data-color="#ff3b30" style="background:#ff3b30" aria-pressed="true" aria-label="Red"></button>
    <button class="swatch" data-color="#ffcc00" style="background:#ffcc00" aria-label="Yellow"></button>
    <button class="swatch" data-color="#34c759" style="background:#34c759" aria-label="Green"></button>
    <button class="swatch" data-color="#0a84ff" style="background:#0a84ff" aria-label="Blue"></button>
    <button class="swatch" data-color="#ffffff" style="background:#ffffff" aria-label="White"></button>
    <button class="swatch" data-color="#000000" style="background:#000000;border-color:#555" aria-label="Black"></button>
    <span class="sep"></span>
    <button id="btn-undo" title="⌘/Ctrl+Z">Undo</button>
    <span id="annotate-status"></span>
    <span class="spacer"></span>
    <button id="btn-annotate-cancel" title="Esc">Cancel</button>
    <button id="btn-annotate-copy" title="⌘/Ctrl+C">Copy</button>
    <button id="btn-annotate-save" title="⌘/Ctrl+S">Save…</button>
    <button id="btn-annotate-done" class="primary" title="Enter">Done</button>
  </div>
  <div id="stage">
    <div id="canvas-wrap">
      <canvas id="canvas"></canvas>
      <canvas id="draft"></canvas>
    </div>
  </div>
</section>

<script>
(() => {
  const api = window.surffishScreenshot
  const $ = (id) => document.getElementById(id)
  const sections = { select: $('select'), busy: $('busy'), preview: $('preview'), annotate: $('annotate'), scrolling: $('scrolling') }
  let mode = 'hidden'
  let image = null          // { url, width, height, pixelRatio }
  let baseImage = null      // HTMLImageElement of the current screenshot
  let statusTimer = null

  function show(name) {
    mode = name
    for (const [key, el] of Object.entries(sections)) el.hidden = key !== name
  }

  function setStatus(text, kind) {
    const target = mode === 'annotate' ? $('annotate-status') : $('status')
    target.textContent = text || ''
    target.className = kind || ''
    if (statusTimer) clearTimeout(statusTimer)
    if (text && kind === 'ok') statusTimer = setTimeout(() => { target.textContent = ''; target.className = '' }, 2400)
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('image'))
      img.src = url
    })
  }

  // ---------- select ----------
  let dragStart = null
  // Scrolling picked: the next drag sets the capture's width and start line instead of a region.
  let scrollPick = false
  const selectHint = document.querySelector('#select-bar .hint')
  function setScrollPick(on) {
    scrollPick = on
    selectHint.textContent = on ? 'Drag to set the width and start line' : 'Drag to capture a region'
    $('btn-visible').hidden = on
    $('btn-full').hidden = on
    $('btn-scroll').hidden = on
    $('btn-scroll-top').hidden = !on
    $('btn-cancel').textContent = on ? 'Back' : 'Cancel'
  }
  const selection = $('selection')
  const sizeLabel = $('selection-size')

  function clampPoint(event) {
    return { x: Math.max(0, Math.min(innerWidth, event.clientX)), y: Math.max(0, Math.min(innerHeight, event.clientY)) }
  }
  function dragRectFrom(a, b) {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
  }
  function paintSelection(rect) {
    selection.hidden = false
    $('shade').hidden = true
    Object.assign(selection.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.width + 'px', height: rect.height + 'px' })
    const ratio = image ? image.width / innerWidth : 1
    sizeLabel.hidden = false
    sizeLabel.textContent = Math.round(rect.width * ratio) + ' × ' + Math.round(rect.height * ratio)
    sizeLabel.style.left = rect.x + 'px'
    sizeLabel.style.top = Math.max(0, rect.y - 22) + 'px'
  }
  function resetSelection() {
    dragStart = null
    selection.hidden = true
    sizeLabel.hidden = true
    $('shade').hidden = false
  }

  $('select').addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('#select-bar')) return
    dragStart = clampPoint(event)
    $('select').setPointerCapture(event.pointerId)
  })
  $('select').addEventListener('pointermove', (event) => {
    if (!dragStart) return
    paintSelection(dragRectFrom(dragStart, clampPoint(event)))
  })
  $('select').addEventListener('pointerup', (event) => {
    if (!dragStart) return
    const rect = dragRectFrom(dragStart, clampPoint(event))
    resetSelection()
    if (rect.width >= 4 && rect.height >= 4) {
      if (scrollPick) api.scrolling(rect)
      else api.region(rect)
    }
  })
  $('btn-visible').addEventListener('click', () => api.visible())
  $('btn-full').addEventListener('click', () => api.full())
  $('btn-cancel').addEventListener('click', () => { if (scrollPick) setScrollPick(false); else api.cancel() })
  $('btn-scroll').addEventListener('click', () => setScrollPick(true))
  $('btn-scroll-top').addEventListener('click', () => api.scrolling(null))

  // ---------- scrolling ----------
  let autoScrolling = false
  function toggleAuto() { api.scrollAuto(!autoScrolling) }
  $('btn-scroll-auto').addEventListener('click', toggleAuto)
  $('btn-scroll-done').addEventListener('click', () => api.scrollDone())
  $('btn-scroll-cancel').addEventListener('click', () => api.cancel())
  api.onScrollState((state) => {
    if (!state || typeof state !== 'object' || mode !== 'scrolling') return
    const dims = $('scroll-dims')
    dims.textContent = Number(state.width) + ' × ' + Number(state.height) + (state.atLimit ? ' · size limit' : '')
    dims.className = state.atLimit ? 'limit' : ''
    autoScrolling = state.auto === true
    $('btn-scroll-auto').setAttribute('aria-pressed', String(autoScrolling))
    $('btn-scroll-auto').textContent = autoScrolling ? 'Stop' : 'Auto-scroll'
  })

  // ---------- preview ----------
  $('btn-close').addEventListener('click', () => api.cancel())
  $('btn-copy').addEventListener('click', () => api.copy(null))
  $('btn-save').addEventListener('click', () => api.save(null))
  $('btn-annotate').addEventListener('click', () => api.annotate(true))

  // ---------- annotate ----------
  const canvas = $('canvas')
  const draft = $('draft')
  const ctx = canvas.getContext('2d')
  const draftCtx = draft.getContext('2d')
  let tool = 'arrow'
  let color = '#ff3b30'
  let ops = []
  let current = null
  let textInput = null

  const unit = () => Math.max(1, (image && image.pixelRatio) || 1)
  const lineWidth = () => 3 * unit()
  const fontSize = () => Math.round(20 * unit())

  for (const button of document.querySelectorAll('[data-tool]')) {
    button.addEventListener('click', () => selectTool(button.dataset.tool))
  }
  for (const button of document.querySelectorAll('[data-color]')) {
    button.addEventListener('click', () => {
      color = button.dataset.color
      for (const other of document.querySelectorAll('[data-color]')) other.setAttribute('aria-pressed', String(other === button))
    })
  }
  function selectTool(name) {
    commitText()
    tool = name
    for (const other of document.querySelectorAll('[data-tool]')) other.setAttribute('aria-pressed', String(other.dataset.tool === name))
    draft.style.cursor = name === 'text' ? 'text' : 'crosshair'
  }

  function toImagePoint(event) {
    const rect = draft.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height))
    }
  }

  function normalized(op) {
    return { x: Math.min(op.x1, op.x2), y: Math.min(op.y1, op.y2), w: Math.abs(op.x2 - op.x1), h: Math.abs(op.y2 - op.y1) }
  }

  function drawArrow(target, op) {
    const { x1, y1, x2, y2 } = op
    const angle = Math.atan2(y2 - y1, x2 - x1)
    const head = Math.max(10, op.width * 4.5)
    target.strokeStyle = op.color
    target.fillStyle = op.color
    target.lineWidth = op.width
    target.lineCap = 'round'
    target.beginPath()
    target.moveTo(x1, y1)
    target.lineTo(x2 - Math.cos(angle) * head * 0.6, y2 - Math.sin(angle) * head * 0.6)
    target.stroke()
    target.beginPath()
    target.moveTo(x2, y2)
    target.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7))
    target.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7))
    target.closePath()
    target.fill()
  }

  function pixelate(op) {
    const { x, y, w, h } = normalized(op)
    const left = Math.floor(x), top = Math.floor(y), width = Math.ceil(w), height = Math.ceil(h)
    if (width < 1 || height < 1) return
    const block = Math.max(6, Math.round(10 * unit()))
    const small = document.createElement('canvas')
    small.width = Math.max(1, Math.ceil(width / block))
    small.height = Math.max(1, Math.ceil(height / block))
    const smallCtx = small.getContext('2d')
    smallCtx.imageSmoothingEnabled = true
    smallCtx.drawImage(canvas, left, top, width, height, 0, 0, small.width, small.height)
    ctx.save()
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(small, 0, 0, small.width, small.height, left, top, width, height)
    ctx.restore()
  }

  function drawOp(target, op, isDraft) {
    target.save()
    if (op.type === 'arrow') drawArrow(target, op)
    else if (op.type === 'box') {
      const { x, y, w, h } = normalized(op)
      target.strokeStyle = op.color
      target.lineWidth = op.width
      target.lineJoin = 'round'
      target.strokeRect(x, y, w, h)
    } else if (op.type === 'pen') {
      target.strokeStyle = op.color
      target.lineWidth = op.width
      target.lineCap = 'round'
      target.lineJoin = 'round'
      target.beginPath()
      op.points.forEach((point, index) => index === 0 ? target.moveTo(point.x, point.y) : target.lineTo(point.x, point.y))
      if (op.points.length === 1) target.lineTo(op.points[0].x + 0.01, op.points[0].y)
      target.stroke()
    } else if (op.type === 'text') {
      target.fillStyle = op.color
      target.font = '700 ' + op.size + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'
      target.textBaseline = 'top'
      target.lineWidth = Math.max(2, op.size / 7)
      target.strokeStyle = op.color === '#000000' ? 'rgba(255,255,255,.85)' : 'rgba(0,0,0,.55)'
      op.text.split('\n').forEach((line, index) => {
        target.strokeText(line, op.x, op.y + index * op.size * 1.2)
        target.fillText(line, op.x, op.y + index * op.size * 1.2)
      })
    } else if (op.type === 'redact') {
      const { x, y, w, h } = normalized(op)
      target.fillStyle = isDraft ? 'rgba(0,0,0,.75)' : '#000'
      target.fillRect(x, y, w, h)
    } else if (op.type === 'blur') {
      if (isDraft) {
        const { x, y, w, h } = normalized(op)
        target.setLineDash([6 * unit(), 4 * unit()])
        target.strokeStyle = '#fff'
        target.lineWidth = Math.max(1, unit())
        target.fillStyle = 'rgba(255,255,255,.12)'
        target.fillRect(x, y, w, h)
        target.strokeRect(x, y, w, h)
      } else {
        pixelate(op)
      }
    }
    target.restore()
  }

  function render() {
    if (!baseImage) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(baseImage, 0, 0)
    for (const op of ops) drawOp(ctx, op, false)
    $('btn-undo').disabled = ops.length === 0
  }
  function renderDraft() {
    draftCtx.clearRect(0, 0, draft.width, draft.height)
    if (current) drawOp(draftCtx, current, true)
  }

  draft.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    const point = toImagePoint(event)
    if (tool === 'text') {
      event.preventDefault()
      if (textInput) commitText()
      else openTextInput(event, point)
      return
    }
    commitText()
    draft.setPointerCapture(event.pointerId)
    current = tool === 'pen'
      ? { type: 'pen', color, width: lineWidth(), points: [point] }
      : { type: tool, color, width: lineWidth(), x1: point.x, y1: point.y, x2: point.x, y2: point.y }
    renderDraft()
  })
  draft.addEventListener('pointermove', (event) => {
    if (!current) return
    const point = toImagePoint(event)
    if (current.type === 'pen') current.points.push(point)
    else { current.x2 = point.x; current.y2 = point.y }
    renderDraft()
  })
  draft.addEventListener('pointerup', () => {
    if (!current) return
    const op = current
    current = null
    renderDraft()
    if (op.type !== 'pen') {
      const { w, h } = normalized(op)
      const tiny = 3 * unit()
      if (op.type === 'arrow' ? Math.hypot(w, h) < tiny * 2 : (w < tiny || h < tiny)) return
    }
    ops.push(op)
    render()
  })

  function openTextInput(event, point) {
    const wrap = $('canvas-wrap').getBoundingClientRect()
    const cssScale = wrap.width / canvas.width
    const input = document.createElement('div')
    input.id = 'text-input'
    input.contentEditable = 'plaintext-only'
    input.style.left = (event.clientX - wrap.left) + 'px'
    input.style.top = (event.clientY - wrap.top) + 'px'
    input.style.fontSize = Math.max(10, fontSize() * cssScale) + 'px'
    input.style.color = color
    input.dataset.x = String(point.x)
    input.dataset.y = String(point.y)
    input.dataset.color = color
    input.addEventListener('keydown', (keyEvent) => {
      keyEvent.stopPropagation()
      if (keyEvent.key === 'Enter' && !keyEvent.shiftKey) { keyEvent.preventDefault(); commitText() }
      else if (keyEvent.key === 'Escape') { keyEvent.preventDefault(); cancelText() }
    })
    $('canvas-wrap').appendChild(input)
    textInput = input
    setTimeout(() => input.focus(), 0)
  }
  function cancelText() {
    if (textInput) textInput.remove()
    textInput = null
  }
  function commitText() {
    if (!textInput) return
    const text = (textInput.innerText || '').replace(/\s+$/, '')
    const op = { type: 'text', color: textInput.dataset.color, size: fontSize(), x: Number(textInput.dataset.x), y: Number(textInput.dataset.y), text }
    cancelText()
    if (text.trim()) { ops.push(op); render() }
  }

  function undo() {
    if (textInput) { cancelText(); return }
    ops.pop()
    render()
  }

  function exportPng() {
    commitText()
    return new Promise((resolve) => canvas.toBlob((blob) => {
      if (!blob) { resolve(null); return }
      blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), () => resolve(null))
    }, 'image/png'))
  }
  async function annotatedBytes() {
    commitText()
    return ops.length > 0 ? exportPng() : null
  }

  async function startAnnotate() {
    if (!image) return
    baseImage = baseImage || await loadImage(image.url)
    canvas.width = draft.width = baseImage.naturalWidth
    canvas.height = draft.height = baseImage.naturalHeight
    ops = []
    current = null
    cancelText()
    selectTool('arrow')
    render()
    renderDraft()
  }

  function leaveAnnotate(keep) {
    if (!keep && ops.length > 0 && !confirm('Discard your annotations?')) return
    if (!keep || ops.length === 0) { cancelText(); ops = []; api.annotate(false); return }
    exportPng().then((bytes) => { if (bytes) api.update(bytes); else api.annotate(false) })
  }

  $('btn-undo').addEventListener('click', undo)
  $('btn-annotate-cancel').addEventListener('click', () => leaveAnnotate(false))
  $('btn-annotate-done').addEventListener('click', () => leaveAnnotate(true))
  $('btn-annotate-copy').addEventListener('click', async () => api.copy(await annotatedBytes()))
  $('btn-annotate-save').addEventListener('click', async () => api.save(await annotatedBytes()))

  // ---------- keys ----------
  // Cmd/Ctrl combos are intercepted in main (so the app menu never sees them) and arrive as onKey.
  api.onKey(async (action) => {
    if (mode === 'select') {
      if (action === 'enter') api.visible()
    } else if (mode === 'preview') {
      if (action === 'copy') api.copy(null)
      else if (action === 'save') api.save(null)
    } else if (mode === 'annotate') {
      if (textInput && action !== 'save') return
      if (action === 'undo') undo()
      else if (action === 'copy') api.copy(await annotatedBytes())
      else if (action === 'save') api.save(await annotatedBytes())
    }
  })
  addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey) return
    if (mode === 'select') {
      if (event.key === 'Escape') { event.preventDefault(); if (dragStart) resetSelection(); else if (scrollPick) setScrollPick(false); else api.cancel() }
      else if (event.key === 'Enter') { event.preventDefault(); if (scrollPick) api.scrolling(null); else api.visible() }
      else if (event.key.toLowerCase() === 'f' && !scrollPick) { event.preventDefault(); api.full() }
      else if (event.key.toLowerCase() === 's' && !scrollPick) { event.preventDefault(); setScrollPick(true) }
    } else if (mode === 'scrolling') {
      if (event.key === 'Escape') { event.preventDefault(); api.cancel() }
      else if (event.key === 'Enter') { event.preventDefault(); api.scrollDone() }
      else if (event.key.toLowerCase() === 'a') { event.preventDefault(); toggleAuto() }
    } else if (mode === 'preview' || mode === 'busy') {
      if (event.key === 'Escape') { event.preventDefault(); api.cancel() }
    } else if (mode === 'annotate') {
      if (event.key === 'Escape') { event.preventDefault(); leaveAnnotate(false) }
      else if (event.key === 'Enter') { event.preventDefault(); leaveAnnotate(true) }
      else {
        const shortcut = { a: 'arrow', b: 'box', p: 'pen', t: 'text', u: 'blur', r: 'redact' }[event.key.toLowerCase()]
        if (shortcut) { event.preventDefault(); selectTool(shortcut) }
      }
    }
  })
  addEventListener('contextmenu', (event) => event.preventDefault())

  // ---------- from main ----------
  api.onShow(async (payload) => {
    if (!payload || typeof payload !== 'object') return
    if (payload.image) {
      image = payload.image
      baseImage = null
      $('frozen').src = image.url
      $('thumb').src = image.url
    }
    $('select-private').hidden = !payload.isPrivate
    $('preview-private').hidden = !payload.isPrivate
    $('scroll-private').hidden = !payload.isPrivate
    if (payload.mode === 'select') {
      resetSelection()
      setScrollPick(payload.scrolling === true)
      show('select')
    } else if (payload.mode === 'scrolling') {
      autoScrolling = false
      $('scroll-dims').textContent = ''
      $('scroll-dims').className = ''
      $('btn-scroll-auto').setAttribute('aria-pressed', 'false')
      $('btn-scroll-auto').textContent = 'Auto-scroll'
      show('scrolling')
    } else if (payload.mode === 'busy') {
      $('busy-text').textContent = payload.message || 'Capturing…'
      show('busy')
    } else if (payload.mode === 'preview') {
      cancelText()
      $('dims').textContent = image ? image.width + ' × ' + image.height + (payload.truncated ? ' · page cut off at the size limit' : '') : ''
      show('preview')
      setStatus(payload.message || '', payload.messageKind || '')
      $('btn-copy').focus()
    } else if (payload.mode === 'annotate') {
      show('annotate')
      setStatus('')
      await startAnnotate()
    } else {
      show('hidden')
    }
  })
  api.onStatus((payload) => {
    if (payload && typeof payload === 'object') setStatus(String(payload.text || ''), payload.kind === 'ok' || payload.kind === 'error' ? payload.kind : '')
  })
  api.ready()
})()
</script>
</body>
</html>`
