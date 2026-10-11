import Browser from './views/Browser'

export default function App(): React.JSX.Element {
  const requestedSurface = new URLSearchParams(window.location.search).get('surface')
  const surface = requestedSurface === 'toolbar' || requestedSurface === 'sidebar' ? requestedSurface : 'content'
  return (
    <div className="app-shell" data-platform={window.api.platform} data-surface={surface}>
      <Browser surface={surface} />
    </div>
  )
}
