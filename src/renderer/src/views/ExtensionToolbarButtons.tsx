import type { WebStoreExtensionsState } from '../../../shared/types'
import { runExtensionAction } from './useWebStoreExtensions'

interface Props {
  state: WebStoreExtensionsState
  setState: (state: WebStoreExtensionsState) => void
}

/** One toolbar button per enabled Web Store extension; click opens its popup under the icon. */
export function ExtensionToolbarButtons({ state, setState }: Props): React.JSX.Element | null {
  const visible = state.extensions.filter((extension) => extension.enabled && extension.loaded && (extension.hasPopup || extension.hasOptions))
  if (visible.length === 0) return null
  return (
    <div className="extension-toolbar-buttons" role="group" aria-label="Extensions">
      {visible.map((extension) => (
        <button
          key={extension.id}
          className={`toolbar-button extension-toolbar-button${state.popupOpenId === extension.id ? ' is-open' : ''}`}
          type="button"
          aria-label={extension.name}
          aria-haspopup={extension.hasPopup ? 'dialog' : undefined}
          aria-expanded={extension.hasPopup ? state.popupOpenId === extension.id : undefined}
          title={extension.hasPopup ? `${extension.name}${extension.hasOptions ? ' · right-click for options' : ''}` : `${extension.name} options`}
          onContextMenu={(event) => {
            if (!extension.hasOptions) return
            event.preventDefault()
            void runExtensionAction(() => window.api.browser.extensions.openOptions(extension.id), setState, state)
          }}
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect()
            const anchor = { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height }
            void runExtensionAction(() => window.api.browser.extensions.openPopup(extension.id, anchor), setState, state)
          }}
        >
          {extension.iconDataUrl
            ? <img className="extension-toolbar-icon" src={extension.iconDataUrl} alt="" />
            : <span className="extension-toolbar-fallback" aria-hidden="true">{extension.name.slice(0, 1).toUpperCase()}</span>}
        </button>
      ))}
    </div>
  )
}
