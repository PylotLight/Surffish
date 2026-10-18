// End-to-end smoke for PDF form filling, saved signatures and page-made (blob:) PDFs in the built-in
// editor. Build first (`bun run build`). Three app launches on one throwaway profile:
//   1. an AcroForm fixture (pdf-lib, made here): text / multiline / comb / checkbox / radio / editable
//      combo / multi-select list, a calculated total (AFSimple_Calculate + AFNumber_Format, run in the
//      pdf.js QuickJS sandbox), a required field, /Tabs /R order, Reset form, a signature field on
//      page 2 signed through the field (and saved for later); save, reopen with pdf-lib and check the
//      values and appearance streams (and the rendering with poppler when installed); Flatten on save.
//   2. restart: the saved signature is still there (encrypted on disk); delete it.
//   3. a page-made blob: PDF opened in a new tab (target=_blank), Edit PDF, fill, save, back to viewer.
//   4. Fields mode on a plain PDF with no form: draw a text, paragraph, checkbox, radio group, dropdown,
//      date and signature field, move one, delete one (undo / redo), fill them all, save, and check the
//      file with pdf-lib (types, flags, font size, date action, rects) and poppler.
//
//   bun scripts/electron-pdf-forms-smoke.mjs            (macOS / Linux desktop or under xvfb-run)
//   bun scripts/electron-pdf-forms-smoke.mjs --headless (Linux without a display: ozone headless)
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFRef, PDFString, StandardFonts } from 'pdf-lib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const electron = createRequire(import.meta.url)('electron')
const headless = process.argv.includes('--headless')
const work = mkdtempSync(join(tmpdir(), 'surffish-pdf-forms-'))
const home = join(work, 'home')
const input = join(work, 'form.pdf')
const output = join(work, 'form-filled.pdf')
const SIG_RECT = [60, 300, 280, 360]
const plainInput = join(work, 'plain.pdf')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(label, check, timeout = Number(process.env.SMOKE_WAIT_MS || 30_000)) {
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
const step = (text) => console.log(`✓ ${text}`)

// --- Fixtures ----------------------------------------------------------------------------------

function jsAction(context, code) {
  return context.obj({ S: 'JavaScript', JS: PDFHexString.fromText(code) })
}

async function makeFormPdf() {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  const form = document.getForm()
  const context = document.context
  const page = document.addPage([500, 700])
  const page2 = document.addPage([500, 700])
  page.drawText('Surffish form smoke', { x: 40, y: 660, size: 18, font })
  page2.drawText('Page 2: sign below', { x: 40, y: 660, size: 18, font })
  const text = (name, y, options = {}) => {
    const field = form.createTextField(name)
    field.addToPage(page, { x: options.x ?? 40, y, width: options.width ?? 200, height: options.height ?? 22, font })
    return field
  }
  // Created bottom-up on purpose: /Tabs /R must still tab top-down.
  const total = text('total', 260, { x: 280, width: 120 })
  const price = text('price', 260, { x: 160, width: 100 })
  const qty = text('qty', 260, { x: 40, width: 100 })
  const zip = text('zip', 520, { width: 120 })
  zip.setMaxLength(5)
  zip.enableCombing()
  const notes = text('notes', 560, { height: 44 })
  notes.enableMultiline()
  const name = text('name', 620)
  name.enableRequired()
  const agree = form.createCheckBox('agree')
  agree.addToPage(page, { x: 40, y: 480, width: 16, height: 16 })
  const color = form.createRadioGroup('color')
  for (const [index, option] of ['red', 'green', 'blue'].entries()) color.addOptionToPage(option, page, { x: 40 + index * 40, y: 440, width: 16, height: 16 })
  const country = form.createDropdown('country')
  country.addOptions(['Australia', 'France', 'Japan'])
  country.enableEditing()
  country.addToPage(page, { x: 40, y: 400, width: 160, height: 22, font })
  const langs = form.createOptionList('langs')
  langs.addOptions(['English', 'French', 'German', 'Japanese'])
  langs.enableMultiselect()
  langs.addToPage(page, { x: 40, y: 300, width: 160, height: 80, font })
  const page2Text = form.createTextField('page2.note')
  page2Text.addToPage(page2, { x: 60, y: 400, width: 200, height: 22, font })
  // Calculated, formatted total.
  total.acroField.dict.set(PDFName.of('AA'), context.obj({
    C: jsAction(context, 'AFSimple_Calculate("PRD", new Array ("qty", "price"));'),
    F: jsAction(context, 'AFNumber_Format(2, 0, 0, 0, "", true);'),
    K: jsAction(context, 'AFNumber_Keystroke(2, 0, 0, 0, "", true);')
  }))
  form.acroForm.dict.set(PDFName.of('CO'), context.obj([total.acroField.ref]))
  page.node.set(PDFName.of('Tabs'), PDFName.of('R'))
  // A signature field (pdf-lib has no creator for these).
  const sig = context.register(context.obj({
    Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFString.of('signer'), Rect: SIG_RECT, F: 4, P: page2.ref,
    MK: context.obj({ BC: [0, 0, 0] })
  }))
  page2.node.addAnnot(sig)
  form.acroForm.addField(sig)
  writeFileSync(input, await document.save())
}

async function makePlainPdf() {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  const page = document.addPage([500, 700])
  for (const [text, y] of [['Plain PDF, no form', 660], ['Full name', 610], ['Notes', 560], ['I agree', 480], ['Size', 440], ['Country', 400], ['Date of birth', 360]]) page.drawText(text, { x: 40, y, size: text.startsWith('Plain') ? 18 : 11, font })
  const page2 = document.addPage([500, 700])
  page2.drawText('Sign here', { x: 40, y: 560, size: 11, font })
  writeFileSync(plainInput, await document.save())
}

// --- App + DevTools ----------------------------------------------------------------------------

const consoleLines = []
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
      if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) consoleLines.push(`[${message.params.type}] ${message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ')}`.slice(0, 400))
      if (message.method === 'Runtime.exceptionThrown') consoleLines.push(`[exception] ${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`.slice(0, 600))
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
  async mouse(type, x, y, buttons = 0) {
    await this.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 })
  }
  /** Drag from one PDF point to another on a page (page 500×700, unrotated), with real mouse input. */
  async dragOnPage(pageNumber, [x1, y1], [x2, y2]) {
    const [a, b] = await this.eval(`(() => {
      const layer = document.querySelector('.page[data-page-number="${pageNumber}"] .fieldEditLayer')
      const r = layer.getBoundingClientRect()
      const at = (x, y) => [r.left + (x / 500) * r.width, r.top + ((700 - y) / 700) * r.height]
      return [at(${x1}, ${y1}), at(${x2}, ${y2})]
    })()`)
    await this.mouse('mouseMoved', a[0], a[1])
    await this.mouse('mousePressed', a[0], a[1], 1)
    for (let i = 1; i <= 4; i += 1) await this.mouse('mouseMoved', a[0] + ((b[0] - a[0]) * i) / 4, a[1] + ((b[1] - a[1]) * i) / 4, 1)
    await this.mouse('mouseReleased', b[0], b[1])
  }
  async type(selector, text) {
    await this.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: 'center' }); el.focus(); if ('select' in el) el.select() })()`)
    await this.send('Input.insertText', { text })
  }
  close() { this.#socket.close() }
}

class App {
  port = 0
  log = ''
  constructor(args) {
    const argv = [join(root, 'out/main/index.js'), '--remote-debugging-port=0', ...args]
    if (headless) argv.splice(1, 0, '--ozone-platform=headless', '--no-sandbox', '--disable-gpu')
    this.process = spawn(electron, argv, {
      cwd: root,
      env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), SURFFISH_PDF_EDITOR_SMOKE_SAVE_PATH: output, ELECTRON_ENABLE_LOGGING: '0', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.process.stdout.on('data', (chunk) => { this.log += chunk })
    this.process.stderr.on('data', (chunk) => {
      this.log += chunk
      if (!this.port) this.port = Number(/DevTools listening on ws:\/\/[^:/]+:(\d+)\//.exec(this.log)?.[1] ?? 0)
    })
  }
  async targets() {
    if (!this.port) throw new Error('no DevTools port yet')
    return (await fetch(`http://127.0.0.1:${this.port}/json/list`)).json()
  }
  async attach(match, label) {
    const found = await until(label, async () => (await this.targets()).find((target) => target.type === 'page' && match(target.url)))
    return Target.open(found.webSocketDebuggerUrl)
  }
  async quit() {
    if (this.process.exitCode !== null || this.process.signalCode !== null) return
    const exited = new Promise((resolve) => this.process.once('exit', resolve))
    this.process.kill('SIGTERM')
    if (await Promise.race([exited.then(() => true), sleep(8000).then(() => false)])) return
    this.process.kill('SIGKILL')
    await exited
  }
}

async function openEditor(app, expectPages = 2) {
  const toolbar = await app.attach((url) => url.includes('surface=toolbar'), 'the toolbar renderer')
  await until('the PDF in the built-in viewer', async () => (await toolbar.eval('window.api.browser.state()')).pdf === 'viewer', 45_000)
  if ((await toolbar.eval('window.api.browser.togglePdfEditor()')) !== true) throw new Error('togglePdfEditor() refused')
  const editor = await app.attach((url) => url.startsWith('surffish-pdf://editor/pdf-editor.html'), 'the editor page')
  await editor.send('Runtime.enable')
  await until('pages to render', () => editor.eval(`document.querySelectorAll('.pdfViewer .page canvas').length > 0 && document.querySelectorAll('#pageList li').length === ${expectPages}`), 45_000)
  return { toolbar, editor }
}

// --- Checks on saved files ---------------------------------------------------------------------

function appearanceText(document, field) {
  const widget = field.acroField.getWidgets()[0]
  const normal = widget.getNormalAppearance()
  const stream = normal instanceof PDFRef ? document.context.lookup(normal) : normal
  if (!(stream instanceof PDFRawStream)) return ''
  return Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1')
}

function annotationsOf(document, pageIndex) {
  const list = document.getPage(pageIndex).node.Annots()
  return list ? list.asArray().map((ref) => document.context.lookup(ref)) : []
}

function poppler(tool, args) {
  const result = spawnSync(tool, args, { encoding: 'utf8' })
  return result.error ? null : result
}

// --- Run ---------------------------------------------------------------------------------------

let failed = false
let app = null
let server = null
try {
  await makeFormPdf()

  // 1. Fill, sign, save, flatten.
  app = new App([input])
  const { toolbar, editor } = await openEditor(app)
  step('form fixture opened in the editor')
  await until('the form tools', () => editor.eval(`!document.getElementById('formTools').hidden`))
  await until('form fields', () => editor.eval(`Boolean(document.querySelector('.annotationLayer input[name="name"]'))`))
  await until('form scripts', () => editor.eval(`document.body.dataset.formScripts === 'ready'`))
  // pdf.js's sandbox keeps formatting every field for a moment after Open; edits made in that window
  // don't reach the calculation (upstream race, ~1 s on a slow CI pod).
  await sleep(2000)

  // /Tabs /R: top row first even though it was created last.
  const order = await until('row tab order', async () => {
    const names = await editor.eval(`[...document.querySelector('.page[data-page-number="1"] .annotationLayer').querySelectorAll('input,textarea,select')].map((el) => el.name).filter(Boolean)`)
    return names[0] === 'name' && names.indexOf('qty') > names.indexOf('notes') ? names : null
  })
  step(`tab order follows /Tabs /R (${order.slice(0, 4).join(', ')}…)`)

  // Required highlighting attribute.
  if ((await editor.eval(`document.querySelector('input[name="name"]').getAttribute('aria-required')`)) !== 'true') throw new Error('required field not marked')

  // Reset form clears a filled field.
  await editor.type('input[name="name"]', 'Temporary')
  await editor.eval(`document.querySelector('input[name="notes"], textarea[name="notes"]').focus()`)
  await editor.eval(`document.getElementById('resetForm').click()`)
  await until('the field to reset', () => editor.eval(`document.querySelector('input[name="name"]').value === ''`))
  step('Reset form clears fields')

  // Calculation in the sandbox: qty × price → total, formatted.
  await editor.type('input[name="qty"]', '3')
  await editor.type('input[name="price"]', '4.5')
  await editor.eval(`document.querySelector('input[name="name"]').focus()`)
  const totalValue = await until('the calculated total', async () => {
    const value = await editor.eval(`document.querySelector('input[name="total"]').value`)
    return value === '13.50' ? value : null
  }, 30_000).catch(async (error) => {
    console.error('total =', await editor.eval(`document.querySelector('input[name="total"]').value`))
    throw error
  })
  step(`calculation script ran in the sandbox (total ${totalValue})`)

  await editor.type('input[name="name"]', 'Ada Lovelace')
  await editor.type('textarea[name="notes"]', 'Line one\nLine two')
  await editor.type('input[name="zip"]', '30001')
  await editor.eval(`document.querySelector('input[name="agree"]').click()`)
  await editor.eval(`document.querySelectorAll('input[name="color"]')[1].click()`)
  await editor.type('.surffish-combo-edit', 'Narnia')
  await editor.eval(`(() => {
    const list = document.querySelector('select[name="langs"]')
    for (const option of list.options) option.selected = option.value === 'French' || option.value === 'Japanese'
    list.dispatchEvent(new Event('input', { bubbles: true }))
    list.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await editor.eval(`document.querySelector('input[name="name"]').focus()`)
  step('text, multiline, comb, checkbox, radio, editable combo and multi-select list filled')

  // Tab from the last field on page 1 lands in page 2's field.
  await editor.eval(`(() => { const all = [...document.querySelector('.page[data-page-number="1"] .annotationLayer').querySelectorAll('input:not([type=hidden]),textarea,select')].filter((el) => el.tabIndex >= 0 && !el.disabled); all[all.length - 1].focus() })()`)
  await editor.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await editor.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await until('focus on page 2', () => editor.eval(`Boolean(document.activeElement?.closest('.page[data-page-number="2"]'))`), 20_000)
  step('Tab moves from the last field on page 1 to page 2')

  // Signature field: click it, type a signature, keep it for next time.
  await until('the signature field overlay', () => editor.eval(`Boolean(document.querySelector('.page[data-page-number="2"] .signatureFieldOverlay'))`))
  await editor.eval(`document.querySelector('.signatureFieldOverlay').scrollIntoView({ block: 'center' })`)
  await sleep(300)
  const fieldBox = await editor.eval(`(() => { const r = document.querySelector('.signatureFieldOverlay').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom] })()`)
  await editor.eval(`document.querySelector('.signatureFieldOverlay').click()`)
  await until('the signature dialog', () => editor.eval(`document.getElementById('signatureDialog').open`))
  await editor.eval(`document.querySelector('[data-signature-tab="type"]').click()`)
  await editor.type('#signatureText', 'Ada L')
  await editor.eval(`document.getElementById('signatureRemember').checked = true; document.getElementById('signatureDescription').value = 'Work signature'; document.getElementById('signatureAdd').click()`)
  await until('the signature in the field', () => editor.eval(`!document.getElementById('signatureDialog').open && Boolean(document.querySelector('.signatureEditor:not([hidden])')) && document.querySelector('.signatureFieldOverlay').classList.contains('is-signed')`))
  await sleep(300)
  const placed = await editor.eval(`(() => {
    const sig = document.querySelector('.signatureEditor').getBoundingClientRect()
    return { field: ${JSON.stringify(fieldBox)}, sig: [sig.left, sig.top, sig.right, sig.bottom] }
  })()`)
  const slack = 10 // the editor box adds its own outline
  const inside = placed.sig[0] >= placed.field[0] - slack && placed.sig[1] >= placed.field[1] - slack && placed.sig[2] <= placed.field[2] + slack && placed.sig[3] <= placed.field[3] + slack
  if (!inside) throw new Error(`signature not inside its field: ${JSON.stringify(placed)}`)
  step('clicking the signature field signs it, sized to the field')
  await until('the signature to be saved for later', () => existsSync(join(home, '.config', 'Surffish Dev', 'pdf-signatures.json')) || existsSync(join(home, '.config', 'Surffish', 'pdf-signatures.json')), 10_000).catch(() => null)

  await editor.eval(`document.getElementById('save').click()`)
  await until('the saved file', () => existsSync(output), 20_000)
  await until('the tab to be clean', async () => (await toolbar.eval('window.api.browser.state()')).title.startsWith('Editing'))
  const filled = await PDFDocument.load(readFileSync(output))
  const filledForm = filled.getForm()
  const expectText = { name: 'Ada Lovelace', zip: '30001', qty: '3', price: '4.5', total: '13.5' }
  for (const [field, expected] of Object.entries(expectText)) {
    const value = filledForm.getTextField(field).getText()
    if (value !== expected && !(field === 'total' && value === '13.50')) throw new Error(`${field} saved as ${JSON.stringify(value)}, expected ${expected}`)
  }
  if (!/Line one[\r\n]+Line two/.test(filledForm.getTextField('notes').getText() ?? '')) throw new Error(`notes saved as ${JSON.stringify(filledForm.getTextField('notes').getText())}`)
  if (!filledForm.getCheckBox('agree').isChecked()) throw new Error('checkbox not saved')
  if (filledForm.getRadioGroup('color').getSelected() !== 'green') throw new Error(`radio saved as ${filledForm.getRadioGroup('color').getSelected()}`)
  const country = filledForm.getDropdown('country').getSelected()
  if (country[0] !== 'Narnia') throw new Error(`editable combo saved as ${JSON.stringify(country)}`)
  const langs = filledForm.getOptionList('langs').getSelected()
  if (!(langs.includes('French') && langs.includes('Japanese'))) throw new Error(`list saved as ${JSON.stringify(langs)}`)
  step('saved values read back with pdf-lib')
  // Appearance streams carry the values, so Preview / Acrobat / Chrome show them without regenerating.
  for (const [field, text] of [['name', 'Ada Lovelace'], ['total', '13.50'], ['country', 'Narnia']]) {
    const ap = appearanceText(filled, field === 'country' ? filledForm.getDropdown(field) : filledForm.getTextField(field))
    if (!ap.includes(text)) throw new Error(`appearance stream of ${field} lacks ${text}: ${ap.slice(0, 200)}`)
  }
  const sigAnnots = annotationsOf(filled, 1).filter((annot) => annot instanceof PDFDict && ['/Stamp', '/Ink'].includes(annot.get(PDFName.of('Subtype'))?.toString()))
  if (sigAnnots.length !== 1) throw new Error(`expected one signature annotation on page 2, got ${sigAnnots.length}`)
  const sigRect = sigAnnots[0].get(PDFName.of('Rect'))
  const rect = sigRect instanceof PDFArray ? sigRect.asArray().map((n) => n.asNumber()) : []
  if (!(rect[0] >= SIG_RECT[0] - 2 && rect[1] >= SIG_RECT[1] - 2 && rect[2] <= SIG_RECT[2] + 2 && rect[3] <= SIG_RECT[3] + 2)) throw new Error(`signature saved at ${JSON.stringify(rect)}, field is ${JSON.stringify(SIG_RECT)}`)
  step(`appearance streams written; signature saved inside its field (${rect.map((n) => Math.round(n)).join(', ')})`)
  const rendered = poppler('pdftotext', ['-layout', output, '-'])
  if (rendered && rendered.status === 0) {
    for (const text of ['Ada Lovelace', '13.50', '30001', 'Narnia']) if (!rendered.stdout.replace(/\s+/g, ' ').includes(text.replace(/\s+/g, ' ')) && !rendered.stdout.includes(text.split('').join(' '))) throw new Error(`poppler doesn't render ${text}:\n${rendered.stdout}`)
    step('poppler renders the filled values')
  } else console.log('- poppler not installed; skipped the rendering check')
  copyFileSync(output, join(work, 'form-filled-copy.pdf'))

  // Flatten on save (Save As).
  await editor.eval(`document.getElementById('flattenOnSave').checked = true; document.getElementById('saveAs').click()`)
  await until('the flattened file', async () => {
    const document = await PDFDocument.load(readFileSync(output)).catch(() => null)
    return document && document.getForm().getFields().length === 0
  }, 20_000)
  const flatText = poppler('pdftotext', [output, '-'])
  if (flatText && flatText.status === 0 && !flatText.stdout.includes('Ada Lovelace')) throw new Error(`flattened page lost the value:\n${flatText.stdout}`)
  step('Flatten on save bakes the fields into the page')
  if (process.env.SURFFISH_SMOKE_SCREENSHOT) {
    const shot = await editor.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(process.env.SURFFISH_SMOKE_SCREENSHOT, Buffer.from(shot.data, 'base64'))
  }
  toolbar.close()
  editor.close()
  await app.quit()

  // 2. Restart: the saved signature is still there.
  const store = [join(home, '.config', 'Surffish Dev', 'pdf-signatures.json'), join(home, '.config', 'Surffish', 'pdf-signatures.json')].find((path) => existsSync(path))
  if (store) {
    const raw = readFileSync(store, 'utf8')
    if (raw.includes('Ada L') || !JSON.parse(raw).encrypted) throw new Error('saved signatures are not encrypted on disk')
    step('saved signature stored encrypted')
  }
  await sleep(1000)
  app = new App([input])
  const second = await openEditor(app)
  await second.editor.eval(`document.querySelector('[data-tool="signature"]').click()`)
  await until('the signature dialog', () => second.editor.eval(`document.getElementById('signatureDialog').open`))
  if (!store) {
    // No OS encryption on this machine: signatures are kept for one run only (by design).
    const listed = await second.editor.eval(`document.querySelectorAll('#savedSignatureList .saved-signature').length`)
    if (listed !== 0 || (await second.editor.eval(`document.getElementById('signatureStorageNote').hidden`))) throw new Error('without encryption nothing should persist and the note should show')
    console.log('- no OS encryption here: saved signatures are session-only (note shown)')
  } else {
    await until('the saved signature after restart', () => second.editor.eval(`[...document.querySelectorAll('#savedSignatureList .saved-signature')].some((el) => el.textContent.includes('Work signature'))`))
    step('saved signature survives an app restart')
    await second.editor.eval(`document.querySelector('[data-delete-signature-id]').click()`)
    await until('the signature to be deleted', () => second.editor.eval(`document.getElementById('savedSignatures').hidden`))
    step('saved signature deleted')
  }
  await second.editor.eval(`document.getElementById('signatureCancel').click()`)
  second.toolbar.close()
  second.editor.close()
  await app.quit()

  // 3. A page-made blob: PDF in a new tab.
  rmSync(output, { force: true })
  const blobSource = await PDFDocument.create()
  const blobPage = blobSource.addPage([400, 300])
  blobSource.getForm().createTextField('blob.name').addToPage(blobPage, { x: 40, y: 200, width: 200, height: 24 })
  const blobBase64 = Buffer.from(await blobSource.save()).toString('base64')
  server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><title>Blob maker</title><a id="open" target="_blank">open</a><script>
      const bytes = Uint8Array.from(atob('${blobBase64}'), (c) => c.charCodeAt(0))
      document.getElementById('open').href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
    </script>`)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const pageUrl = `http://127.0.0.1:${server.address().port}/maker.html`
  await sleep(1000)
  app = new App([input])
  const third = await app.attach((url) => url.includes('surface=toolbar'), 'the toolbar renderer')
  await until('the first tab', async () => (await third.eval('window.api.browser.state()')).pdf === 'viewer', 45_000)
  await third.eval(`window.api.browser.navigate(${JSON.stringify(pageUrl)})`)
  const maker = await app.attach((url) => url === pageUrl, 'the blob maker page')
  await until('the blob link', () => maker.eval(`document.getElementById('open').href.startsWith('blob:')`))
  await maker.eval(`document.getElementById('open').click()`)
  await until('the blob PDF tab', async () => {
    const state = await third.eval('window.api.browser.state()')
    return state.url.startsWith('blob:') && state.pdf === 'viewer'
  }, 45_000)
  step('blob: PDF opened in a new tab in the built-in viewer')
  if ((await third.eval('window.api.browser.togglePdfEditor()')) !== true) throw new Error('Edit PDF refused a blob: PDF')
  const blobEditor = await app.attach((url) => url.startsWith('surffish-pdf://editor/pdf-editor.html'), 'the editor page')
  await until('the blob PDF in the editor', () => blobEditor.eval(`document.querySelectorAll('#pageList li').length === 1 && Boolean(document.querySelector('.annotationLayer input'))`), 45_000)
  step('Edit PDF opens the blob: PDF (bytes read from the tab)')
  await blobEditor.type('.annotationLayer input', 'From a blob')
  await blobEditor.eval(`document.querySelector('.annotationLayer input').blur(); document.getElementById('save').click()`)
  await until('the saved blob PDF', () => existsSync(output), 20_000)
  const blobSaved = await PDFDocument.load(readFileSync(output))
  if (blobSaved.getForm().getTextField('blob.name').getText() !== 'From a blob') throw new Error('blob PDF value not saved')
  step('blob: PDF filled and saved')
  await third.eval('window.api.browser.togglePdfEditor()')
  await until('the blob PDF back in the viewer', async () => {
    const state = await third.eval('window.api.browser.state()')
    return state.pdf === 'viewer' && state.url.startsWith('blob:')
  }, 30_000)
  step('Back to viewer restores the blob: PDF tab')
  third.close()
  maker.close()
  blobEditor.close()
  await app.quit()

  // 4. Fields mode: build a form on a plain PDF.
  rmSync(output, { force: true })
  await makePlainPdf()
  await sleep(1000)
  app = new App([plainInput])
  const fourth = await openEditor(app)
  const ed = fourth.editor
  if (!(await ed.eval(`document.getElementById('formTools').hidden`))) throw new Error('a plain PDF should have no form tools')
  await ed.eval(`(() => { const zoom = document.getElementById('zoom'); zoom.value = 'page-fit'; zoom.dispatchEvent(new Event('change')) })()`)
  await sleep(500)
  await ed.eval(`document.getElementById('fieldsMode').click()`)
  await until('the field edit layer', () => ed.eval(`Boolean(document.querySelector('.page[data-page-number="1"] .fieldEditLayer'))`))
  const boxCount = () => ed.eval(`document.querySelectorAll('.fieldBox:not(.is-draft)').length`)
  const addField = async (kind, page, from, to, setup) => {
    const before = await boxCount()
    await ed.eval(`document.querySelector('[data-field-kind="${kind}"]').click()`)
    if (page !== 1) {
      await ed.eval(`document.querySelector('.page[data-page-number="${page}"]').scrollIntoView({ block: 'start' })`)
      await until(`page ${page} edit layer`, () => ed.eval(`Boolean(document.querySelector('.page[data-page-number="${page}"] .fieldEditLayer'))`))
      await sleep(300)
    }
    await ed.dragOnPage(page, from, to)
    await until(`the ${kind} popover`, () => ed.eval(`!document.getElementById('fieldPopover').hidden && document.getElementById('fieldPopover').dataset.kind === '${kind}'`))
    await ed.eval(`(() => { const $ = (id) => document.getElementById(id); ${setup} ; document.getElementById('fieldSubmit').click() })()`)
    const name = await ed.eval(`document.getElementById('fieldName').value`)
    await until(`the new ${kind} field (${name})`, async () => (await ed.eval(`document.getElementById('fieldPopover').hidden && Boolean(document.querySelector('.fieldBox[data-field-name="${name}"]'))`)) && (await boxCount()) > before, 20_000).catch(async (error) => {
      console.error('popover error:', await ed.eval(`document.getElementById('fieldError').textContent`))
      throw error
    })
    return name
  }
  const suggested = await (async () => {
    await ed.eval(`document.querySelector('[data-field-kind="text"]').click()`)
    await ed.dragOnPage(1, [140, 625], [360, 605])
    await until('the text popover', () => ed.eval(`!document.getElementById('fieldPopover').hidden`))
    const value = await ed.eval(`document.getElementById('fieldName').value`)
    await ed.eval(`document.getElementById('fieldCancel').click()`)
    return value
  })()
  if (suggested !== 'Text1') throw new Error(`suggested name ${suggested}, expected Text1`)
  step('Fields mode on a plain PDF; drawing a text field suggests "Text1"')
  await addField('text', 1, [140, 625], [360, 605], `$('fieldName').value = 'full_name'; $('fieldRequired').checked = true; $('fieldFontSize').value = '12'`)
  if ((await ed.eval(`document.getElementById('zoom').value`)) !== 'page-fit') throw new Error('zoom not kept across the reload')
  await addField('multiline', 1, [140, 575], [400, 520], `$('fieldName').value = 'notes'`)
  // A click (no drag) places a default-size checkbox.
  await addField('checkbox', 1, [140, 482], [140, 482], `$('fieldName').value = 'agree'`)
  await addField('radio', 1, [140, 436], [260, 452], `$('fieldName').value = 'size'; $('fieldOptions').value = 'S\\nM\\nL'; $('fieldOptions').dispatchEvent(new Event('input')); $('fieldDefaultChoice').value = 'S'`)
  await addField('dropdown', 1, [140, 395], [300, 415], `$('fieldName').value = 'country'; $('fieldOptions').value = 'Australia\\nFrance\\nJapan'; $('fieldOptions').dispatchEvent(new Event('input'))`)
  await addField('date', 1, [140, 355], [260, 375], `$('fieldName').value = 'dob'; $('fieldDateFormat').value = 'yyyy-mm-dd'`)
  await addField('text', 1, [300, 300], [450, 320], `$('fieldName').value = 'temp'`)
  await addField('signature', 2, [60, 500], [280, 550], `$('fieldName').value = 'signer'`)
  step('text, paragraph, checkbox (click), radio, dropdown, date and signature fields placed')

  // Move "notes" right by dragging its box; delete "temp" (Delete key), undo, redo.
  await ed.eval(`document.querySelector('.page[data-page-number="1"]').scrollIntoView({ block: 'start' })`)
  await sleep(300)
  await ed.dragOnPage(1, [300, 545], [340, 525])
  await until('notes to move', () => ed.eval(`document.querySelector('.fieldBox[data-field-name="notes"]')?.classList.contains('is-selected') && !document.body.classList.contains('is-busy')`), 20_000)
  const tempBox = `.fieldBox[data-field-name="temp"]`
  const idle = `!document.body.classList.contains('is-busy')`
  await until('the temp box', () => ed.eval(`${idle} && Boolean(document.querySelector('${tempBox}'))`))
  await ed.dragOnPage(1, [375, 310], [375, 310])
  await until('the temp popover', () => ed.eval(`!document.getElementById('fieldPopover').hidden && document.getElementById('fieldPopover').dataset.mode === 'edit'`))
  await ed.eval(`document.getElementById('fieldCancel').click()`)
  if (!(await ed.eval(`document.querySelector('${tempBox}').classList.contains('is-selected')`))) throw new Error('clicking a field should select it')
  await ed.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 })
  await ed.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 })
  await until('temp to be deleted', () => ed.eval(`!document.querySelector('${tempBox}') && document.querySelectorAll('.page[data-page-number="1"] .fieldBox').length > 0`), 20_000)
  await ed.eval(`document.getElementById('undo').click()`)
  await until('undo to bring temp back', () => ed.eval(`${idle} && Boolean(document.querySelector('${tempBox}'))`), 20_000)
  await ed.eval(`document.getElementById('redo').click()`)
  await until('redo to delete temp again', () => ed.eval(`!document.querySelector('${tempBox}') && !document.body.classList.contains('is-busy') && document.querySelectorAll('.page[data-page-number="1"] .fieldBox').length > 0`), 20_000)
  step('field moved by dragging; Delete removes a field; Undo / Redo restore and remove it')

  // Edit a field's properties: dropdown default.
  await until('idle', () => ed.eval(idle))
  await ed.dragOnPage(1, [220, 405], [220, 405])
  await until('the dropdown popover', () => ed.eval(`!document.getElementById('fieldPopover').hidden && document.getElementById('fieldPopover').dataset.kind === 'dropdown'`))
  await ed.eval(`document.getElementById('fieldDefaultChoice').value = 'France'; document.getElementById('fieldSubmit').click()`)
  await until('the edit to apply', () => ed.eval(`document.getElementById('fieldPopover').hidden && !document.body.classList.contains('is-busy') && Boolean(document.querySelector('select[name="country"]'))`), 20_000)

  // Fill the new form.
  await ed.eval(`document.getElementById('fieldsMode').click()`)
  await until('fillable fields', () => ed.eval(`!document.body.classList.contains('fields-mode') && Boolean(document.querySelector('.annotationLayer input[name="full_name"]')) && !document.getElementById('formTools').hidden`))
  await until('form scripts', () => ed.eval(`document.body.dataset.formScripts === 'ready'`))
  await sleep(1500)
  if ((await ed.eval(`document.querySelector('input[name="full_name"]').getAttribute('aria-required')`)) !== 'true') throw new Error('new field not required')
  await ed.type('input[name="full_name"]', 'Grace Hopper')
  await ed.type('textarea[name="notes"]', 'Made in Surffish')
  await ed.eval(`document.querySelector('input[name="agree"]').click()`)
  await ed.eval(`document.querySelectorAll('input[name="size"]')[1].click()`)
  await ed.eval(`(() => { const s = document.querySelector('select[name="country"]'); s.value = 'Japan'; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  // AFDate fields turn into a native date picker (input type=date) while focused.
  await ed.eval(`(() => { const el = document.querySelector('input[name="dob"]'); el.scrollIntoView({ block: 'center' }); el.focus() })()`)
  if ((await ed.eval(`document.querySelector('input[name="dob"]').type`)) !== 'date') throw new Error('the date field has no date picker')
  await ed.eval(`(() => { const el = document.querySelector('input[name="dob"]'); el.value = '1906-12-09'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await ed.eval(`document.querySelector('input[name="full_name"]').focus()`)
  await until('the formatted date', () => ed.eval(`document.querySelector('input[name="dob"]').value === '1906-12-09' && document.querySelector('input[name="dob"]').type === 'text'`))
  // Back in Fields mode, resize full_name by its corner handle: the unsaved fills must survive the reload.
  await ed.eval(`document.getElementById('fieldsMode').click()`)
  await until('the edit layer again', () => ed.eval(`Boolean(document.querySelector('.page[data-page-number="1"] .fieldBox[data-field-name="full_name"]'))`))
  await ed.eval(`document.querySelector('.page[data-page-number="1"]').scrollIntoView({ block: 'start' })`)
  await sleep(300)
  await ed.dragOnPage(1, [250, 615], [250, 615])
  await until('full_name selected', () => ed.eval(`document.querySelector('.fieldBox[data-field-name="full_name"]').classList.contains('is-selected') && !document.getElementById('fieldPopover').hidden`))
  if (process.env.SURFFISH_SMOKE_SCREENSHOT) {
    const shot = await ed.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(process.env.SURFFISH_SMOKE_SCREENSHOT.replace(/(\.png)?$/, '-fields.png'), Buffer.from(shot.data, 'base64'))
  }
  await ed.eval(`document.getElementById('fieldCancel').click()`)
  await ed.dragOnPage(1, [360, 605], [420, 598])
  await until('the resize to apply', () => ed.eval(`${idle} && document.querySelector('.fieldBox[data-field-name="full_name"]')?.classList.contains('is-selected')`), 20_000)
  await ed.eval(`document.getElementById('fieldsMode').click()`)
  await until('the fills after the reload', () => ed.eval(`document.querySelector('input[name="full_name"]')?.value === 'Grace Hopper' && document.querySelector('input[name="agree"]').checked && document.querySelector('input[name="dob"]').value === '1906-12-09'`), 20_000)
  step('resizing a field keeps the zoom and the unsaved fills')
  await until('the sign-here overlay on page 2', () => ed.eval(`Boolean(document.querySelector('.page[data-page-number="2"] .signatureFieldOverlay'))`), 20_000)
  step('the new fields are fillable straight away (and the signature field shows "Sign here")')
  await ed.eval(`document.getElementById('save').click()`)
  await until('the saved file', () => existsSync(output), 20_000)
  const built = await PDFDocument.load(readFileSync(output))
  const builtForm = built.getForm()
  const names = builtForm.getFields().map((field) => field.getName()).sort()
  if (names.join() !== 'agree,country,dob,full_name,notes,signer,size') throw new Error(`fields saved: ${names.join()}`)
  const fullName = builtForm.getTextField('full_name')
  if (fullName.getText() !== 'Grace Hopper' || !fullName.isRequired()) throw new Error(`full_name saved as ${fullName.getText()} (required ${fullName.isRequired()})`)
  if (!/\b12 Tf/.test(fullName.acroField.getDefaultAppearance() ?? '')) throw new Error(`full_name DA ${fullName.acroField.getDefaultAppearance()}`)
  if (!builtForm.getTextField('notes').isMultiline() || builtForm.getTextField('notes').getText() !== 'Made in Surffish') throw new Error('notes not saved')
  const nameRect = fullName.acroField.getWidgets()[0].getRectangle()
  if (!(nameRect.x + nameRect.width > 400 && nameRect.y < 603)) throw new Error(`full_name was not resized: ${JSON.stringify(nameRect)}`)
  const notesRect = builtForm.getTextField('notes').acroField.getWidgets()[0].getRectangle()
  if (!(notesRect.x > 160)) throw new Error(`notes was not moved: ${JSON.stringify(notesRect)}`)
  if (!builtForm.getCheckBox('agree').isChecked()) throw new Error('checkbox not saved')
  if (builtForm.getRadioGroup('size').getSelected() !== 'M') throw new Error(`radio saved as ${builtForm.getRadioGroup('size').getSelected()}`)
  if (builtForm.getDropdown('country').getSelected()[0] !== 'Japan') throw new Error(`dropdown saved as ${builtForm.getDropdown('country').getSelected()}`)
  const countryDefault = builtForm.getDropdown('country').acroField.dict.lookup(PDFName.of('DV'))
  if (countryDefault?.decodeText?.() !== 'France') throw new Error(`dropdown default not saved: ${countryDefault}`)
  const dob = builtForm.getTextField('dob')
  if (dob.getText() !== '1906-12-09') throw new Error(`date saved as ${dob.getText()}`)
  const dobFormat = dob.acroField.dict.lookup(PDFName.of('AA')).lookup(PDFName.of('F')).lookup(PDFName.of('JS')).decodeText()
  if (!dobFormat.includes('AFDate_FormatEx("yyyy-mm-dd")')) throw new Error(`date format action ${dobFormat}`)
  const signer = builtForm.getField('signer')
  if (signer.acroField.dict.get(PDFName.of('FT'))?.toString() !== '/Sig' || annotationsOf(built, 1).length !== 1) throw new Error('signature field not saved on page 2')
  step('saved form read back with pdf-lib: types, values, required, font size, date action, moved rect, signature field')
  const builtText = poppler('pdftotext', ['-layout', output, '-'])
  if (builtText && builtText.status === 0) {
    for (const text of ['Grace Hopper', 'Made in Surffish', '1906-12-09', 'Japan']) if (!builtText.stdout.includes(text)) throw new Error(`poppler doesn't render ${text}:\n${builtText.stdout}`)
    step('poppler renders the values of the new fields')
  } else console.log('- poppler not installed; skipped the rendering check')
  fourth.toolbar.close()
  ed.close()
} catch (error) {
  failed = true
  console.error('✗', error instanceof Error ? error.message : error)
  if (consoleLines.length) console.error(`editor console:\n${consoleLines.slice(-30).join('\n')}`)
  console.error(app?.log.split('\n').filter((line) => !/OOM score|dbus|StackChildLayer/.test(line)).slice(-40).join('\n'))
} finally {
  await app?.quit()
  server?.close()
  if (!process.env.SURFFISH_SMOKE_KEEP) rmSync(work, { recursive: true, force: true })
  else console.log(`kept ${work}`)
}
process.exit(failed ? 1 : 0)
