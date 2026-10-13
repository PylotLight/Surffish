// End-to-end smoke test for the built-in PDF editor. Builds nothing: run `bun run build` (or
// `electron-vite build`) first. Launches the real app on a throwaway profile with a generated PDF,
// enters edit mode from the toolbar API, adds a free-text annotation, rotates page 1, saves (the save
// path comes from SURFFISH_PDF_EDITOR_SMOKE_SAVE_PATH, honoured only by unpackaged builds) and checks
// the written file with pdf-lib.
//
//   node scripts/electron-pdf-editor-smoke.mjs            (macOS / Linux desktop)
//   node scripts/electron-pdf-editor-smoke.mjs --headless (Linux without a display: ozone headless)
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const electron = createRequire(import.meta.url)('electron')
const port = Number(process.env.SURFFISH_SMOKE_DEBUG_PORT ?? 9447)
const headless = process.argv.includes('--headless')
const work = mkdtempSync(join(tmpdir(), 'surffish-pdf-editor-'))
const input = join(work, 'smoke.pdf')
const output = join(work, 'smoke-edited.pdf')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(label, check, timeout = 30_000) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try {
      last = await check()
      if (last) return last
    } catch (error) {
      last = error
    }
    await sleep(250)
  }
  throw new Error(`Timed out waiting for ${label}${last instanceof Error ? `: ${last.message}` : ''}`)
}

async function makePdf() {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  for (let index = 0; index < 2; index += 1) {
    const page = document.addPage([400, 500])
    page.drawText(`Surffish smoke page ${index + 1}`, { x: 40, y: 440, size: 18, font })
    if (index === 0) {
      page.drawText('Highlight me please', { x: 40, y: 400, size: 16, font })
      const field = document.getForm().createTextField('smoke.name')
      field.addToPage(page, { x: 40, y: 300, width: 200, height: 24 })
    }
  }
  writeFileSync(input, await document.save())
}

class Target {
  #socket
  #next = 1
  #pending = new Map()
  static async open(url) {
    const target = new Target()
    target.#socket = new WebSocket(url)
    await new Promise((resolve, reject) => {
      target.#socket.addEventListener('open', resolve, { once: true })
      target.#socket.addEventListener('error', reject, { once: true })
    })
    target.#socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      const pending = target.#pending.get(message.id)
      if (!pending) return
      target.#pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
    })
    return target
  }
  send(method, params = {}) {
    const id = this.#next++
    this.#socket.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }))
  }
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }
  close() { this.#socket.close() }
}

async function targets() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`)
  return response.json()
}

async function attach(match, label) {
  const found = await until(label, async () => (await targets()).find((target) => target.type === 'page' && match(target.url)))
  return Target.open(found.webSocketDebuggerUrl)
}

await makePdf()
const home = join(work, 'home')
const args = [join(root, 'out/main/index.js'), `--remote-debugging-port=${port}`, input]
if (headless) args.splice(1, 0, '--ozone-platform=headless', '--no-sandbox', '--disable-gpu')
const app = spawn(electron, args, {
  cwd: root,
  env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), SURFFISH_PDF_EDITOR_SMOKE_SAVE_PATH: output, ELECTRON_ENABLE_LOGGING: '0' },
  stdio: ['ignore', 'pipe', 'pipe']
})
let appLog = ''
app.stdout.on('data', (chunk) => { appLog += chunk })
app.stderr.on('data', (chunk) => { appLog += chunk })

let failed = false
try {
  const toolbar = await attach((url) => url.includes('surface=toolbar'), 'the toolbar renderer')
  await until('the PDF to show in the built-in viewer', async () => (await toolbar.eval('window.api.browser.state()')).pdf === 'viewer', 45_000)
  console.log('✓ PDF opened in the built-in viewer; toolbar offers Edit PDF')
  if ((await toolbar.eval('window.api.browser.togglePdfEditor()')) !== true) throw new Error('togglePdfEditor() refused')

  const editor = await attach((url) => url.startsWith('surffish-pdf://editor/pdf-editor.html'), 'the editor page')
  await until('pages to render', () => editor.eval(`document.querySelectorAll('.pdfViewer .page canvas').length > 0 && document.querySelectorAll('#pageList li').length === 2`), 45_000)
  const state = await toolbar.eval('window.api.browser.state()')
  if (state.pdf !== 'editor' || !state.title.startsWith('Editing – smoke.pdf')) throw new Error(`unexpected editor state ${JSON.stringify(state)}`)
  console.log(`✓ editor loaded (${state.title})`)

  // Network isolation: the editor session refuses anything but its own scheme.
  const blocked = await editor.eval(`fetch('https://example.com/').then(() => 'reached', () => 'blocked')`)
  if (blocked !== 'blocked') throw new Error('the editor page reached the network')
  console.log('✓ editor page has no network access')

  // Free text: switch tool, create one at the page centre, type, commit.
  await editor.eval(`document.querySelector('[data-tool="freetext"]').click()`)
  await until('free text mode', () => editor.eval(`document.querySelector('[data-tool="freetext"]').classList.contains('is-active')`))
  await sleep(300)
  await editor.eval(`(() => {
    const layer = document.querySelector('.annotationEditorLayer')
    const box = layer.getBoundingClientRect()
    const x = box.left + box.width / 2, y = box.top + box.height / 3
    for (const type of ['pointerdown', 'pointerup']) layer.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, isPrimary: true, pointerType: 'mouse' }))
    layer.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y, button: 0 }))
  })()`)
  await until('a free text editor', () => editor.eval(`Boolean(document.querySelector('.freeTextEditor .internal'))`))
  await editor.eval(`document.querySelector('.freeTextEditor .internal').focus()`)
  await editor.send('Input.insertText', { text: 'Hello from Surffish' })
  await editor.eval(`document.querySelector('[data-tool="none"]').click()`)
  // Undo / redo of the annotation.
  await until('undo to be available', () => editor.eval(`!document.getElementById('undo').disabled`))
  const hasText = `[...document.querySelectorAll('.freeTextEditor')].some((node) => !node.hidden && node.textContent.includes('Hello from Surffish'))`
  // pdf.js can record a no-op step when the text box is committed, so press Undo until it goes.
  await until('the text box to be undone', async () => {
    if (!(await editor.eval(hasText))) return true
    await editor.eval(`document.getElementById('undo').click()`)
    await sleep(300)
    return false
  }, 8000).catch(async (error) => {
    console.error(await editor.eval(`[...document.querySelectorAll('.freeTextEditor')].map((node) => node.outerHTML.slice(0, 300)).join('\\n')`))
    throw error
  })
  await editor.eval(`document.getElementById('redo').click()`)
  await until('the text box to be redone', () => editor.eval(hasText))
  console.log('✓ undo / redo')

  // Ink: draw a stroke across the page.
  await editor.eval(`document.querySelector('[data-tool="ink"]').click()`)
  await until('ink mode', () => editor.eval(`document.querySelector('.annotationEditorLayer.inkEditing') !== null`))
  await editor.eval(`(() => {
    const layer = document.querySelector('.annotationEditorLayer')
    const box = layer.getBoundingClientRect()
    const at = (t) => ({ bubbles: true, clientX: box.left + box.width * (0.2 + t * 0.5), clientY: box.top + box.height * 0.7, button: 0, buttons: 1, isPrimary: true, pointerId: 1, pointerType: 'mouse' })
    layer.dispatchEvent(new PointerEvent('pointerdown', at(0)))
    for (let i = 1; i <= 10; i += 1) window.dispatchEvent(new PointerEvent('pointermove', at(i / 10)))
    window.dispatchEvent(new PointerEvent('pointerup', { ...at(1), buttons: 0 }))
  })()`)
  await editor.eval(`document.querySelector('[data-tool="none"]').click()`)
  await until('an ink drawing', () => editor.eval(`Boolean(document.querySelector('.inkEditor'))`))
  console.log('✓ ink drawing added')

  // Signature: the dialog opens, draw on the pad, Add.
  await editor.eval(`document.querySelector('[data-tool="signature"]').click()`)
  await until('the signature dialog', () => editor.eval(`document.getElementById('signatureDialog').open`))
  await editor.eval(`(() => {
    const pad = document.getElementById('signaturePad')
    const box = pad.getBoundingClientRect()
    const at = (t) => ({ bubbles: true, clientX: box.left + box.width * (0.1 + t * 0.8), clientY: box.top + box.height * (0.5 + Math.sin(t * 6) * 0.3), pointerId: 2, isPrimary: true, pointerType: 'mouse', buttons: 1 })
    pad.dispatchEvent(new PointerEvent('pointerdown', at(0)))
    for (let i = 1; i <= 20; i += 1) pad.dispatchEvent(new PointerEvent('pointermove', at(i / 20)))
    pad.dispatchEvent(new PointerEvent('pointerup', at(1)))
    document.getElementById('signatureAdd').click()
  })()`)
  await until('a signature', () => editor.eval(`!document.getElementById('signatureDialog').open && Boolean(document.querySelector('.signatureEditor:not([hidden])'))`))
  await editor.eval(`document.querySelector('[data-tool="none"]').click()`)
  console.log('✓ signature added')

  // AcroForm: fill the text field.
  await until('the form field', () => editor.eval(`Boolean(document.querySelector('.annotationLayer input[type="text"], .annotationLayer input:not([type])'))`))
  await editor.eval(`document.querySelector('.annotationLayer input').focus()`)
  await editor.send('Input.insertText', { text: 'Ada Lovelace' })
  await editor.eval(`document.querySelector('.annotationLayer input').blur()`)
  console.log('✓ form field filled')

  const shot = await editor.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(process.env.SURFFISH_SMOKE_SCREENSHOT ?? join(work, 'editor.png'), Buffer.from(shot.data, 'base64'))

  await until('unsaved changes', async () => (await toolbar.eval('window.api.browser.state()')).title.startsWith('• Editing'))
  console.log('✓ free text annotation added; tab title marks unsaved changes')

  // Page tool: rotate page 1 right (pdf-lib), which reloads the document.
  await editor.eval(`document.querySelector('#pageList li[data-index="0"] [aria-label="Rotate page 1 right"]').click()`)
  await until('the rotate to finish', () => editor.eval(`!document.body.classList.contains('is-busy') && document.querySelectorAll('#pageList li').length === 2`))
  await sleep(500)

  await editor.eval(`document.getElementById('save').click()`)
  await until('the saved file', () => existsSync(output), 20_000)
  await until('the tab to be clean', async () => (await toolbar.eval('window.api.browser.state()')).title.startsWith('Editing'))
  const saved = await PDFDocument.load(readFileSync(output))
  const rotation = saved.getPage(0).getRotation().angle
  const annots = saved.getPages().flatMap((page) => {
    const list = page.node.Annots()
    return list ? list.asArray().map((ref) => saved.context.lookup(ref)) : []
  })
  const subtypes = annots.map((annot) => annot.get(PDFName.of('Subtype'))?.toString())
  if (saved.getPageCount() !== 2) throw new Error(`expected 2 pages, got ${saved.getPageCount()}`)
  if (rotation !== 90) throw new Error(`expected page 1 rotated 90°, got ${rotation}`)
  for (const subtype of ['/FreeText', '/Ink', '/Widget']) {
    if (!subtypes.includes(subtype)) throw new Error(`no ${subtype} annotation saved (found ${subtypes.join(', ') || 'none'})`)
  }
  // The signature is saved as an ink-like (or stamp) annotation; count annotations beyond the form widget.
  if (subtypes.filter((subtype) => subtype !== '/Widget').length < 3) throw new Error(`expected text, drawing and signature (found ${subtypes.join(', ')})`)
  const ink = annots.find((annot) => annot.get(PDFName.of('Subtype'))?.toString() === '/Ink')
  const inkColor = ink?.get(PDFName.of('C'))?.asArray?.().map((part) => Math.round(part.asNumber() * 100) / 100)
  if (!inkColor || inkColor[0] < 0.7 || inkColor[1] > 0.3) throw new Error(`drawing did not use the chosen colour (C=${JSON.stringify(inkColor)})`)
  const value = saved.getForm().getTextField('smoke.name').getText()
  if (value !== 'Ada Lovelace') throw new Error(`form value not saved (got ${value})`)
  console.log(`✓ saved ${output}: 2 pages, page 1 rotated 90°, form value kept, annotations ${subtypes.join(', ')}`)

  // Back to viewer.
  await toolbar.eval('window.api.browser.togglePdfEditor()')
  await until('the viewer again', async () => (await toolbar.eval('window.api.browser.state()')).pdf === 'viewer', 30_000)
  console.log('✓ back to the built-in viewer')
  toolbar.close()
  editor.close()
} catch (error) {
  failed = true
  console.error('✗', error instanceof Error ? error.message : error)
  console.error(appLog.split('\n').slice(-40).join('\n'))
} finally {
  app.kill('SIGTERM')
  await sleep(500)
  if (!process.env.SURFFISH_SMOKE_KEEP) rmSync(work, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
