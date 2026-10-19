import { BrowserWindow, app, ipcMain, shell } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getMainWindow } from './window'
import { APP_NAME } from '../shared/config'
import { buildFeedbackPayload, feedbackValidationError, type FeedbackContext, type FeedbackInput } from '../shared/feedback'

const mainDirectory = dirname(fileURLToPath(import.meta.url))

// The shared feedback gateway (a Cloudflare Worker that files the GitHub issue).
// Empty means "not configured in this build"; the window says so instead of failing.
const FEEDBACK_URL = (process.env.SURFFISH_FEEDBACK_URL ?? '').replace(/\/+$/, '')
const FEEDBACK_APP_PATH = '/feedback/surffish'
const SUBMIT_TIMEOUT_MS = 15000

let feedbackWindow: BrowserWindow | null = null
let ipcRegistered = false

/** Help → Send Feedback… : a small, self-contained window (no tab, no token). */
export function openFeedback(): void {
  const existing = feedbackWindow
  if (existing && !existing.isDestroyed()) {
    existing.show()
    existing.focus()
    return
  }

  const parent = getMainWindow()
  const window = new BrowserWindow({
    title: `${APP_NAME} Feedback`,
    width: 560,
    height: 660,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f1115',
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    webPreferences: {
      preload: join(mainDirectory, '../preload/feedback.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  })
  feedbackWindow = window
  window.on('closed', () => {
    if (feedbackWindow === window) feedbackWindow = null
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  void window
    .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(feedbackPage(FEEDBACK_URL !== ''))}`)
    .then(() => {
      if (!window.isDestroyed()) window.show()
    })
    .catch(() => {
      if (!window.isDestroyed()) window.close()
    })
  registerFeedbackIpc()
}

function registerFeedbackIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true

  ipcMain.handle('browser:feedback:submit', async (event, raw: unknown) => {
    if (!isFeedbackSender(event.sender)) throw new Error('Feedback is available only from the feedback window.')
    if (!FEEDBACK_URL) return { ok: false, error: 'Feedback is not configured in this build.' }

    const input = normalizeInput(raw)
    const invalid = feedbackValidationError(input)
    if (invalid) return { ok: false, error: invalid }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS)
    try {
      const response = await fetch(`${FEEDBACK_URL}${FEEDBACK_APP_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildFeedbackPayload(input, contextFromRuntime())),
        signal: controller.signal
      })
      if (!response.ok) return { ok: false, error: `The feedback service returned ${response.status}. Please try again.` }
      const issue = (await response.json()) as { url?: unknown }
      if (typeof issue.url !== 'string') return { ok: false, error: 'The feedback service returned no issue link.' }
      return { ok: true, url: issue.url }
    } catch {
      return { ok: false, error: 'Could not reach the feedback service. Check your connection and try again.' }
    } finally {
      clearTimeout(timer)
    }
  })

  ipcMain.handle('browser:feedback:open', async (event, url: unknown) => {
    if (!isFeedbackSender(event.sender)) return false
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return false
    await shell.openExternal(url)
    return true
  })
}

function isFeedbackSender(sender: Electron.WebContents): boolean {
  return feedbackWindow !== null && !feedbackWindow.isDestroyed() && sender === feedbackWindow.webContents
}

function normalizeInput(raw: unknown): FeedbackInput {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const kind = record.kind === 'bug' || record.kind === 'idea' || record.kind === 'other' ? record.kind : undefined
  return {
    message: typeof record.message === 'string' ? record.message : '',
    kind,
    contact: typeof record.contact === 'string' ? record.contact : undefined
  }
}

function contextFromRuntime(): FeedbackContext {
  return {
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    locale: app.getLocale()
  }
}

/** Self-contained page. The form talks to the preload bridge; the main process does the POST. */
function feedbackPage(configured: boolean): string {
  const disabled = configured ? '' : ' disabled'
  const notice = configured
    ? "Tell us what happened or what you'd like to see. Your app version and OS are attached automatically."
    : 'Feedback is not configured in this build.'
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'">',
    '<title>Surffish Feedback</title><style>',
    ':root{color-scheme:dark}',
    '*{box-sizing:border-box}',
    'body{margin:0;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#e7e9ee;background:#0f1115;padding:22px}',
    'h1{font-size:17px;margin:0 0 6px}',
    'p.muted{color:#9aa1ad;margin:0 0 18px}',
    'label{display:block;margin:0 0 14px}',
    'span.l{display:block;margin:0 0 6px;color:#c7ccd6;font-weight:600}',
    'textarea,input,select{width:100%;padding:9px 10px;border-radius:8px;border:1px solid #2b303b;background:#161a21;color:#e7e9ee;font:inherit}',
    'textarea{resize:vertical;min-height:132px}',
    '.row{display:flex;align-items:center;gap:12px;margin-top:4px}',
    'button{padding:9px 16px;border:0;border-radius:8px;background:#3f7ef7;color:#fff;font:inherit;font-weight:600;cursor:pointer}',
    'button[disabled]{opacity:.5;cursor:default}',
    '.status{color:#9aa1ad}',
    '.err{color:#ff8a8a}',
    'a.issue{display:block;margin-top:14px;color:#7fb0ff;word-break:break-all}',
    '</style></head><body>',
    '<h1>Send feedback</h1>',
    '<p class="muted">', notice, '</p>',
    '<label><span class="l">Message</span><textarea id="m" placeholder="Describe the bug or idea…"></textarea></label>',
    '<label><span class="l">Type</span><select id="k"><option value="bug">Bug</option><option value="idea">Idea</option><option value="other" selected>Other</option></select></label>',
    '<label><span class="l">Contact (optional)</span><input id="c" type="email" placeholder="you@example.com"></label>',
    '<div class="row"><button id="send"', disabled, '>Submit</button><span id="status" class="status"></span></div>',
    '<a id="issue" class="issue" href="#" hidden></a>',
    '<script>',
    "var $=function(id){return document.getElementById(id)};",
    "var send=$('send'),status=$('status'),issue=$('issue');",
    "issue.addEventListener('click',function(e){e.preventDefault();if(issue.dataset.url){window.surffishFeedback.openIssue(issue.dataset.url)}});",
    "send.addEventListener('click',function(){",
    "var message=$('m').value.trim();",
    "if(!message){status.textContent='Please write a message.';status.className='status err';return}",
    "send.disabled=true;issue.hidden=true;status.className='status';status.textContent='Sending\\u2026';",
    "window.surffishFeedback.submit({message:message,kind:$('k').value,contact:$('c').value}).then(function(result){",
    "send.disabled=false;",
    "if(result&&result.ok){status.textContent='Thank you! Issue created:';status.className='status';issue.hidden=false;issue.dataset.url=result.url;issue.textContent=result.url}",
    "else{status.className='status err';status.textContent=(result&&result.error)||'Something went wrong.'}",
    "},function(){send.disabled=false;status.className='status err';status.textContent='Something went wrong.'});",
    "});",
    '</script></body></html>'
  ].join('')
}
