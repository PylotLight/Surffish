import Browser from './views/Browser'

export default function App(): React.JSX.Element {
  return (
    <div className="app-shell" data-platform={window.api.platform}>
      <Browser />
    </div>
  )
}
