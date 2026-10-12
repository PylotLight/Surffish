/** Layout primitives for the Settings pages: glass group card, label/control row, slider row. */
export function SettingsGroup({ title, status, statusOn, aside, icon, className = '', children }: { title: string; status?: string; statusOn?: boolean; aside?: React.ReactNode; icon?: string; className?: string; children?: React.ReactNode }): React.JSX.Element {
  return (
    <section className={`settings-group ${className}`.trim()} aria-label={title}>
      <header className="settings-group-header">
        {icon && <img className="settings-group-icon" src={icon} alt="" />}
        <div className="settings-group-title">
          <h2>{title}</h2>
          {status && <span className={`settings-status${statusOn ? ' is-on' : ''}`}>{status}</span>}
        </div>
        {aside && <div className="settings-group-aside">{aside}</div>}
      </header>
      {children && <div className="settings-group-body">{children}</div>}
    </section>
  )
}

export function SettingsRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <span className="settings-row-label">{label}</span>
        {hint && <span className="settings-row-hint">{hint}</span>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  )
}

export function SettingsSlider({ label, value, unit = '', min, max, step = 1, onChange }: { label: string; value: number; unit?: string; min: number; max: number; step?: number; onChange: (value: number) => void }): React.JSX.Element {
  const percent = ((value - min) / (max - min)) * 100
  return (
    <label className="settings-row settings-slider-row">
      <span className="settings-row-label">{label}</span>
      <input className="settings-range" type="range" min={min} max={max} step={step} value={value} style={{ '--range-fill': `${percent}%` } as React.CSSProperties} onChange={(event) => onChange(Number(event.target.value))} aria-label={label} />
      <output className="settings-slider-value">{value}{unit}</output>
    </label>
  )
}
