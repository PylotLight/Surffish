import { useRef, useState } from 'react'

interface Step {
  id: string
  label: string
  status: 'wait' | 'run' | 'done' | 'error'
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function stamp(): string {
  return new Date().toLocaleTimeString([], { hour12: false })
}

export default function Agent(): React.JSX.Element {
  const [goal, setGoal] = useState('Check system health and report back')
  const [running, setRunning] = useState(false)
  const [steps, setSteps] = useState<Step[]>([])
  const [log, setLog] = useState<string[]>([])
  const cancelRef = useRef(false)

  const pushLog = (line: string): void => setLog((prev) => [...prev, `[${stamp()}] ${line}`])
  const setStep = (id: string, status: Step['status']): void =>
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)))

  async function run(): Promise<void> {
    if (running) return
    cancelRef.current = false
    setRunning(true)
    setLog([])
    setSteps([
      { id: 'plan', label: 'Plan: decompose goal into tool calls', status: 'wait' },
      { id: 'sys', label: 'Tool: sys.info — gather system facts', status: 'wait' },
      { id: 'notify', label: 'Tool: notify.send — announce result', status: 'wait' },
      { id: 'summary', label: 'Summarize for the user', status: 'wait' }
    ])

    const cancelled = (): boolean => cancelRef.current

    try {
      setStep('plan', 'run')
      pushLog(`goal: "${goal}"`)
      await sleep(700)
      if (cancelled()) throw new Error('cancelled by user')
      setStep('plan', 'done')
      pushLog('plan: [sys.info] → [notify.send] → summary')

      setStep('sys', 'run')
      await sleep(500)
      const info = await window.api.sys.info()
      if (cancelled()) throw new Error('cancelled by user')
      const totalGb = (info.totalMem / 1024 ** 3).toFixed(1)
      const freeGb = (info.freeMem / 1024 ** 3).toFixed(1)
      pushLog(
        `sys.info → ${info.platform}/${info.arch} · ${info.cpus} cpus · mem ${freeGb}/${totalGb} GiB free`
      )
      setStep('sys', 'done')

      setStep('notify', 'run')
      await sleep(500)
      if (cancelled()) throw new Error('cancelled by user')
      const ok = await window.api.notify(
        'Agent mode',
        `Checked ${info.hostname}: ${info.cpus} CPUs, ${freeGb} GiB free.`
      )
      pushLog(`notify.send → ${ok ? 'delivered' : 'not supported on this platform'}`)
      setStep('notify', 'done')

      setStep('summary', 'run')
      await sleep(600)
      if (cancelled()) throw new Error('cancelled by user')
      pushLog('summary: system looks healthy. Agent run complete.')
      setStep('summary', 'done')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      pushLog(`stopped: ${msg}`)
      setSteps((prev) => prev.map((s) => (s.status === 'run' ? { ...s, status: 'error' } : s)))
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className="grid">
      <div className="card span2">
        <h2>Agent mode</h2>
        <p className="muted">
          A starter pattern for agentic UI: a goal, a visible plan, real tool calls through the
          preload bridge (<code>sys.info</code>, <code>notify.send</code>), and a streaming log.
          Swap the simulated planner for your own backend later — the tool surface stays the same.
        </p>
        <div className="row">
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Goal for the agent…"
            disabled={running}
            className="grow"
          />
          {!running ? (
            <button className="btn" onClick={() => void run()} disabled={!goal.trim()}>
              Run agent
            </button>
          ) : (
            <button className="btn danger" onClick={() => (cancelRef.current = true)}>
              Cancel
            </button>
          )}
          <button
            className="btn ghost"
            title="Hide the window; the app keeps running in the tray"
            onClick={() => void window.api.win.hide()}
          >
            Hide to tray
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Plan</h2>
        {steps.length === 0 ? (
          <p className="muted">No run yet — press “Run agent”.</p>
        ) : (
          <ol className="steps">
            {steps.map((s) => (
              <li key={s.id} data-status={s.status}>
                <span className="dot" aria-hidden />
                {s.label}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="card">
        <h2>Activity log</h2>
        <div className="console" aria-live="polite">
          {log.length === 0 ? (
            <span className="muted">—</span>
          ) : (
            log.map((line, i) => <div key={i}>{line}</div>)
          )}
        </div>
      </div>
    </section>
  )
}
