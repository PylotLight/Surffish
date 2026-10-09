import { useState } from 'react'
import { APP_NAME } from '../../../shared/config'

interface Props {
  platform?: NodeJS.Platform
}

export default function TrayDemo({ platform }: Props): React.JSX.Element {
  const [badge, setBadge] = useState(3)
  const [note, setNote] = useState<string | null>(null)
  const isMac = platform === 'darwin'

  const say = (msg: string): void => {
    setNote(msg)
    window.setTimeout(() => setNote(null), 3000)
  }

  return (
    <section className="grid">
      <div className="card span2">
        <h2>System tray</h2>
        <p className="muted">
          The main process owns a <code>Tray</code> (<code>src/main/tray.ts</code>). Left-clicking
          the icon pops the context menu — it never auto-shows the window. Showing happens only
          via the “Show window” menu item. Icons live in <code>assets/</code> (regenerate with{' '}
          <code>bun run assets</code>).
        </p>
        <div className="row wrap">
          <button className="btn" onClick={() => void window.api.win.hide()}>
            Hide window
          </button>
          <button className="btn ghost" onClick={() => void window.api.win.show()}>
            Show window
          </button>
          <button className="btn ghost" onClick={() => void window.api.win.minimize()}>
            Minimize
          </button>
          <button
            className="btn ghost"
            onClick={() =>
              window.api
                .win.flash()
                .then(() => say('Window flash requested (Windows/Linux).'))
                .catch(() => say('Flash failed.'))
            }
          >
            Flash window
          </button>
        </div>
      </div>

      <div className="card">
        <h2>App &amp; dock {isMac ? '' : '(macOS only)'}</h2>
        <p className="muted">
          <code>app.hide()</code> hides the app (⌘H behavior). <code>app.dock.hide()</code> goes
          further — tray-only mode with no dock icon. Restore via the tray menu or below.
        </p>
        <div className="row wrap">
          <button
            className="btn"
            disabled={!isMac}
            onClick={() => void window.api.app.hide().then(() => say('App hidden.'))}
          >
            Hide app
          </button>
          <button
            className="btn ghost"
            disabled={!isMac}
            onClick={() => void window.api.dock.hide().then(() => say('Dock icon hidden — tray only.'))}
          >
            Hide dock icon
          </button>
          <button
            className="btn ghost"
            disabled={!isMac}
            onClick={() => void window.api.dock.show().then(() => say('Dock icon restored.'))}
          >
            Show dock icon
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Notification</h2>
        <p className="muted">Delivered by the main process via Electron Notification.</p>
        <button
          className="btn"
          onClick={() =>
            window.api
              .notify(APP_NAME, 'Hello from the tray demo!')
              .then((ok) => say(ok ? 'Notification sent.' : 'Notifications not supported here.'))
          }
        >
          Send notification
        </button>
      </div>

      <div className="card">
        <h2>Dock badge {isMac ? '' : '(macOS only)'}</h2>
        <p className="muted">Sets the app icon badge via the main process.</p>
        <div className="row">
          <input
            type="number"
            min={0}
            max={99}
            value={badge}
            onChange={(e) => setBadge(Number(e.target.value))}
            className="narrow"
          />
          <button
            className="btn"
            disabled={!isMac}
            onClick={() => window.api.dock.setBadge(badge).then(() => say(`Badge → ${badge}.`))}
          >
            Set
          </button>
          <button
            className="btn ghost"
            disabled={!isMac}
            onClick={() => window.api.dock.setBadge(0).then(() => say('Badge cleared.'))}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="card span2">
        <h2>External links</h2>
        <p className="muted">
          Renderer links never open inside the window — the main process allow-lists{' '}
          <code>https://</code> and opens them in your browser.
        </p>
        <div className="row wrap">
          <button
            className="btn ghost"
            onClick={() => void window.api.shell.open('https://www.electronjs.org/')}
          >
            electronjs.org
          </button>
          <button className="btn ghost" onClick={() => void window.api.shell.open('https://bun.com/')}>
            bun.com
          </button>
        </div>
      </div>

      {note && <div className="toast glass"> {note}</div>}
    </section>
  )
}
