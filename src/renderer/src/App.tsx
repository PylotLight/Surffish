import Browser from './views/Browser'
import { sidebarCardCssVars } from '../../shared/sidebar-card'

// One source for the sidebar card's geometry (main uses the same numbers for the overlay view).
const SIDEBAR_CARD_STYLE = sidebarCardCssVars() as React.CSSProperties

export default function App(): React.JSX.Element {
  const requestedSurface = new URLSearchParams(window.location.search).get('surface')
  const surface = requestedSurface === 'toolbar' || requestedSurface === 'sidebar' ? requestedSurface : 'content'
  return (
    <div className="app-shell" data-platform={window.api.platform} data-surface={surface} style={SIDEBAR_CARD_STYLE}>
      <Browser surface={surface} />
    </div>
  )
}
