import { useEffect, useMemo, useState } from 'react'
import type { GlassState, VibrancyName } from '../../../shared/types'

interface Props {
  platform?: NodeJS.Platform
  query: string
  glass: GlassState | null
  onGlassChange: (g: GlassState) => void
}

interface Item {
  id: number
  time: string
  title: string
  tag: 'Focus' | 'Build' | 'Rest'
}

const SEED: Item[] = [
  { id: 1, time: '09:30', title: 'Review the tray window API', tag: 'Focus' },
  { id: 2, time: '11:00', title: 'Build the glass example', tag: 'Build' },
  { id: 3, time: '13:15', title: 'Search + vibrancy wiring', tag: 'Build' },
  { id: 4, time: '15:00', title: 'Walk and reset', tag: 'Rest' }
]

export default function Glass({ platform, query, glass, onGlassChange }: Props): React.JSX.Element {
  const isMac = platform === 'darwin'
  const [items, setItems] = useState<Item[]>(SEED)
  const [done, setDone] = useState<Set<number>>(new Set([4]))
  const [draft, setDraft] = useState('')
  const [draftTag, setDraftTag] = useState<Item['tag']>('Build')
  const [options, setOptions] = useState<VibrancyName[]>([])

  useEffect(() => {
    if (isMac) window.api.glass.options().then(setOptions).catch(console.error)
  }, [isMac])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((i) => `${i.time} ${i.title} ${i.tag}`.toLowerCase().includes(q))
  }, [items, query])

  const toggleDone = (id: number): void =>
    setDone((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const addItem = (): void => {
    const title = draft.trim()
    if (!title) return
    setItems((prev) => [...prev, { id: Math.max(...prev.map((i) => i.id)) + 1, time: '—', title, tag: draftTag }])
    setDraft('')
  }

  const tasksDone = done.size
  const tasksTotal = items.length

  return (
    <section className="mock">
      <div className="stat-grid">
        <div className="stat glass">
          <span className="stat-label">Focus time</span>
          <span className="stat-value">3h 24m</span>
        </div>
        <div className="stat glass">
          <span className="stat-label">Tasks done</span>
          <span className="stat-value">
            {tasksDone} / {tasksTotal}
          </span>
        </div>
        <div className="stat glass">
          <span className="stat-label">Energy</span>
          <span className="stat-value">High</span>
        </div>
      </div>

      <div className="mock-cols">
        <div className="today glass">
          <h2>Today</h2>
          <p className="muted">A light plan for a quiet day</p>
          <ul className="schedule">
            {visible.map((item) => (
              <li key={item.id} className={done.has(item.id) ? 'is-done' : ''}>
                <span className="time">{item.time}</span>
                <button className="sched-title" onClick={() => toggleDone(item.id)}>
                  {item.title}
                </button>
                <span className="tag">{item.tag}</span>
              </li>
            ))}
            {visible.length === 0 && <li className="muted">No items match “{query}”.</li>}
          </ul>
          <div className="add-row">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addItem()}
              placeholder="Add an item, Enter to save"
              aria-label="Add a schedule item"
            />
            <select
              value={draftTag}
              onChange={(e) => setDraftTag(e.target.value as Item['tag'])}
              aria-label="Tag for new item"
            >
              <option>Focus</option>
              <option>Build</option>
              <option>Rest</option>
            </select>
            <button className="btn mint" onClick={addItem} disabled={!draft.trim()}>
              Add
            </button>
          </div>
        </div>

        <div className="side-col">
          <div className="now-playing glass">
            <span className="stat-label">Now playing</span>
            <h3>Soft Focus</h3>
            <p className="muted">Leavv</p>
            <div className="progress" aria-hidden>
              <div className="bar" />
            </div>
            <div className="progress-times muted">
              <span>2:08</span>
              <span>3:24</span>
            </div>
          </div>
          <div className="intention glass">
            <span className="stat-label">Intention</span>
            <p>Make one thing clear and useful.</p>
          </div>
        </div>
      </div>

      <div className="glass-controls glass">
        <h2>Vibrancy</h2>
        <p className="muted">
          {isMac
            ? `Native NSVisualEffectView is live (${glass?.vibrancy ?? '…'}). The whole window is translucent — put a bright wallpaper behind it to see the blur.`
            : 'No native vibrancy on this platform — you are seeing the CSS fallback. Switch to macOS for the real thing.'}
        </p>
        {isMac && options.length > 0 && (
          <div className="row wrap">
            {options.map((name) => (
              <button
                key={name}
                className={`btn ghost${glass?.vibrancy === name ? ' active-opt' : ''}`}
                onClick={() =>
                  window.api.glass.set(name).then(onGlassChange).catch(console.error)
                }
              >
                {name}
              </button>
            ))}
            <button
              className="btn ghost"
              onClick={() => window.api.glass.set(null).then(onGlassChange).catch(console.error)}
            >
              off
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
