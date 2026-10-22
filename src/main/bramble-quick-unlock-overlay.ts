/**
 * Surffish's quick unlock panel, drawn over Bramble's popup in its own sandboxed WebContentsView
 * (never inside Bramble's page). Loaded as a data: URL with the bramble-quick-unlock.cjs preload.
 *
 * Modes (set by main): pin (PIN pad, optional Touch ID button) and notice (an error, e.g. after a
 * lockout). There is deliberately no master password mode: when the PIN cannot be used, Bramble's
 * own form is the only screen. "Use master password" hides the panel for this lock and leaves
 * Bramble's own form in front.
 */
export const QUICK_UNLOCK_OVERLAY_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Surffish quick unlock</title>
<style>
  :root { color-scheme: light dark; --bg: #f7f7f8; --fg: #18181b; --muted: #71717a; --card: #ffffff; --border: #e4e4e7; --accent: #2563eb; --error: #dc2626; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111113; --fg: #f4f4f5; --muted: #a1a1aa; --card: #1c1c1f; --border: #2e2e33; --accent: #60a5fa; --error: #f87171; } }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--fg); font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; user-select: none; }
  main { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 20px; }
  h1 { font-size: 17px; font-weight: 600; margin: 0; }
  p { margin: 0; color: var(--muted); text-align: center; max-width: 340px; }
  .dots { display: flex; gap: 10px; height: 18px; align-items: center; }
  .dot { width: 12px; height: 12px; border-radius: 50%; border: 1.5px solid var(--muted); }
  .dot.on { background: var(--fg); border-color: var(--fg); }
  .pad { display: grid; grid-template-columns: repeat(3, 64px); gap: 10px; }
  .pad button, .action { font: inherit; color: var(--fg); background: var(--card); border: 1px solid var(--border); border-radius: 12px; cursor: pointer; }
  .pad button { height: 52px; font-size: 20px; }
  .pad button:active, .action:active { transform: scale(0.97); }
  .pad .ghost { background: transparent; border-color: transparent; font-size: 14px; color: var(--muted); }
  .action { padding: 10px 16px; min-width: 212px; }
  .action.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .link { font: inherit; background: none; border: 0; color: var(--accent); cursor: pointer; padding: 4px; }
  .error { color: var(--error); min-height: 20px; text-align: center; max-width: 340px; }
  .shake { animation: shake 0.3s; }
  @keyframes shake { 25% { transform: translateX(-6px); } 75% { transform: translateX(6px); } }
  [hidden] { display: none !important; }
  .brand { font-size: 11px; color: var(--muted); letter-spacing: 0.02em; }
</style>
</head>
<body>
<main>
  <div class="brand">Surffish quick unlock</div>
  <h1 id="title">Unlock Bramble</h1>
  <section id="pin-mode" hidden>
    <div style="display:flex;flex-direction:column;align-items:center;gap:14px">
      <p id="pin-hint">Enter your PIN</p>
      <div class="dots" id="dots" aria-live="polite"></div>
      <div class="pad" id="pad" role="group" aria-label="PIN pad"></div>
      <button class="action" id="touch-id" type="button" hidden>Unlock with Touch ID</button>
    </div>
  </section>
  <div class="error" id="error" role="alert"></div>
  <button class="link" id="use-master" type="button">Use master password</button>
</main>
<script>
(() => {
  const api = window.surffishQuickUnlock;
  const $ = (id) => document.getElementById(id);
  let mode = 'pin';
  let pin = '';
  let busy = false;
  let maxLength = 8;
  let touchId = false;
  const dots = $('dots');
  const render = () => {
    dots.textContent = '';
    const shown = Math.max(4, pin.length);
    for (let i = 0; i < shown; i++) {
      const dot = document.createElement('span');
      dot.className = 'dot' + (i < pin.length ? ' on' : '');
      dots.appendChild(dot);
    }
  };
  const setError = (text) => { $('error').textContent = text || ''; if (text) { dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake'); } };
  const setBusy = (value) => { busy = value; document.querySelectorAll('button').forEach((el) => { if (el.id !== 'use-master') el.disabled = value; }); };
  const handle = (result) => {
    setBusy(false);
    if (!result) return;
    if (result.status === 'wrong') { pin = ''; render(); setError(result.attemptsLeft === 1 ? 'Wrong PIN. 1 try left before quick unlock is turned off.' : 'Wrong PIN. ' + result.attemptsLeft + ' tries left.'); }
    else if (result.status === 'error') { pin = ''; render(); setError(result.message || 'Quick unlock failed.'); }
    else if (result.status === 'ok') { setError(''); $('pin-hint').textContent = 'Unlocking…'; setBusy(true); }
  };
  const submitPin = () => {
    if (busy || pin.length < 4) return;
    setBusy(true);
    const value = pin;
    api.submitPin(value).then(handle, () => handle({ status: 'error' }));
  };
  const press = (digit) => {
    if (busy || pin.length >= maxLength) return;
    pin += digit; setError(''); render();
  };
  const pad = $('pad');
  for (const key of ['1','2','3','4','5','6','7','8','9','back','0','ok']) {
    const button = document.createElement('button');
    button.type = 'button';
    if (key === 'back') { button.textContent = '⌫'; button.className = 'ghost'; button.setAttribute('aria-label', 'Delete'); button.onclick = () => { if (!busy) { pin = pin.slice(0, -1); render(); } }; }
    else if (key === 'ok') { button.textContent = 'Unlock'; button.className = 'ghost'; button.onclick = submitPin; }
    else { button.textContent = key; button.onclick = () => press(key); }
    pad.appendChild(button);
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); api.useMasterPassword(); return; }
    if (mode !== 'pin') return;
    if (/^[0-9]$/.test(event.key)) { event.preventDefault(); press(event.key); }
    else if (event.key === 'Backspace') { event.preventDefault(); if (!busy) { pin = pin.slice(0, -1); render(); } }
    else if (event.key === 'Enter') { event.preventDefault(); submitPin(); }
  });
  $('touch-id').onclick = () => { if (busy) return; setBusy(true); api.touchId().then(handle, () => handle({ status: 'error' })); };
  $('use-master').onclick = () => api.useMasterPassword();
  api.onShow((state) => {
    mode = state.mode;
    touchId = !!state.touchId;
    pin = ''; render(); setBusy(false); setError(state.error || '');
    $('pin-hint').textContent = 'Enter your PIN';
    $('pin-mode').hidden = mode !== 'pin';
    $('touch-id').hidden = mode !== 'pin' || !touchId;
    if (mode === 'pin' && touchId && state.autoTouchId) $('touch-id').click();
  });
  api.onResult(handle);
  render();
  api.ready();
})();
</script>
</body>
</html>
`;
