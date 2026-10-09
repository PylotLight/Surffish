import { useState } from 'react'

export default function Kitchen(): React.JSX.Element {
  const [pong, setPong] = useState<string>('—')
  const [name, setName] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [level, setLevel] = useState(50)
  const [confirming, setConfirming] = useState(false)
  const [deleted, setDeleted] = useState(false)

  const v = window.api.versions

  return (
    <section className="grid">
      <div className="card span2">
        <h2>IPC ping</h2>
        <p className="muted">
          Renderer → preload (<code>contextBridge</code>) → main (<code>ipcMain.handle</code>).
        </p>
        <div className="row">
          <button
            className="btn"
            onClick={() =>
              window.api
                .ping()
                .then(setPong)
                .catch((err: unknown) => setPong(`error: ${String(err)}`))
            }
          >
            Send ping
          </button>
          <code className="pill">pong: {pong}</code>
        </div>
      </div>

      <div className="card">
        <h2>Versions</h2>
        <ul className="kv">
          <li>
            <span>Electron</span>
            <code>{v.electron()}</code>
          </li>
          <li>
            <span>Chrome</span>
            <code>{v.chrome()}</code>
          </li>
          <li>
            <span>Node (main)</span>
            <code>{v.node()}</code>
          </li>
          <li>
            <span>Bundler</span>
            <code>electron-vite</code>
          </li>
        </ul>
      </div>

      <div className="card">
        <h2>Controls</h2>
        <label className="field">
          <span>Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="type something…"
          />
        </label>
        <label className="field row between">
          <span>Enable feature</span>
          <button
            role="switch"
            aria-checked={enabled}
            className={`switch${enabled ? ' on' : ''}`}
            onClick={() => setEnabled((x) => !x)}
          >
            <span className="knob" />
          </button>
        </label>
        <label className="field">
          <span>
            Level: <code>{level}</code>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={level}
            onChange={(e) => setLevel(Number(e.target.value))}
          />
        </label>
        <p className="muted preview">
          Hello{name ? `, ${name}` : ''}! Feature is {enabled ? 'on' : 'off'} at {level}%.
        </p>
      </div>

      <div className="card">
        <h2>Buttons</h2>
        <div className="row wrap">
          <button className="btn">Primary</button>
          <button className="btn ghost">Ghost</button>
          <button className="btn danger" onClick={() => setConfirming(true)}>
            Danger
          </button>
        </div>
        {confirming && (
          <div className="modal-backdrop">
            <div className="modal glass strong">
              <h3>Are you sure?</h3>
              <p className="muted">This is a renderer-side confirm dialog.</p>
              <div className="row end">
                <button className="btn ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
                <button
                  className="btn danger"
                  onClick={() => {
                    setDeleted(true)
                    setConfirming(false)
                  }}
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}
        {deleted && <p className="muted">Deleted (not really — demo).</p>}
      </div>
    </section>
  )
}
