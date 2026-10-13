import { useUpdateState } from './useUpdateState'
import './UpdateSettings.css'

/** Small sidebar-footer button that appears only while a newer release is waiting. */
export function UpdateBadge(): React.JSX.Element | null {
  const [state] = useUpdateState()
  if (!state?.showBadge || !state.latest) return null
  const label = `Surffish ${state.latest.version} is available`
  return (
    <button
      className="sidebar-footer-icon-button update-badge-button"
      type="button"
      aria-label={`${label}. Open About & updates`}
      title={label}
      onClick={() => void window.api.browser.updates.revealSettings()}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M5 19h14" /></svg>
      <span className="update-badge-dot" aria-hidden="true" />
    </button>
  )
}
