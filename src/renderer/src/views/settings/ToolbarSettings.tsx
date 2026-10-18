import { DEFAULT_TOOLBAR_LAYOUT, isDefaultToolbarLayout, setToolbarPlacement, shiftToolbarItem, TOOLBAR_ITEMS, type ToolbarItemId, type ToolbarPlacement } from '../../../../shared/toolbar-layout'
import { ToolbarGlyph } from '../toolbar/ToolbarGlyph'
import { useToolbarLayout } from '../toolbar/useToolbarLayout'
import { SettingsGroup, SettingsSegmented } from './SettingsControls'

const HINTS: Record<ToolbarItemId, string> = {
  bookmarks: 'Bookmarks dropdown',
  'reading-list': 'Pages saved for later',
  adblock: 'Blocked count and the per-site switch',
  cast: 'When needed: a page played media and a Chromecast is around, or a cast is live',
  history: 'Opens the History panel',
  extensions: 'Extensions menu and pinned extension icons',
  downloads: 'When needed: while downloading, and for an hour after (or until opened)'
}

const PLAIN: ReadonlyArray<{ value: ToolbarPlacement; label: string }> = [{ value: 'pinned', label: 'Toolbar' }, { value: 'menu', label: 'Menu' }]
const CONTEXTUAL: ReadonlyArray<{ value: ToolbarPlacement; label: string }> = [{ value: 'pinned', label: 'Always' }, { value: 'auto', label: 'When needed' }, { value: 'menu', label: 'Menu' }]

/**
 * Settings → General → Appearance → Toolbar: where each right-hand toolbar button lives (pinned on
 * the toolbar, in the Surffish menu, or for Cast / Downloads only when needed) and their order.
 * Same layout the right-click menu and drag-to-reorder change (shared/toolbar-layout.ts).
 */
export function ToolbarSettings(): React.JSX.Element {
  const [layout, setLayout] = useToolbarLayout()
  const last = layout.order.length - 1
  return (
    <SettingsGroup title="Toolbar" className="toolbar-settings">
      <p className="settings-row-hint toolbar-settings-intro">Right-click a toolbar button to pin or unpin it, or drag it to reorder. Anything not on the toolbar is in the Surffish menu.</p>
      <ul className="toolbar-settings-list" aria-label="Toolbar buttons">
        {layout.order.map((id, index) => {
          const item = TOOLBAR_ITEMS[id]
          return (
            <li key={id} className="toolbar-settings-row" data-toolbar-item={id}>
              <span className="surffish-menu-icon"><ToolbarGlyph id={id} /></span>
              <span className="toolbar-settings-name">{item.label}<small>{HINTS[id]}</small></span>
              <SettingsSegmented
                value={layout.placement[id]}
                options={item.contextual ? CONTEXTUAL : PLAIN}
                ariaLabel={`${item.label} placement`}
                onChange={(placement) => setLayout(setToolbarPlacement(layout, id, placement))}
              />
              <span className="toolbar-settings-move">
                <button type="button" aria-label={`Move ${item.label} left`} title="Move left" disabled={index === 0} onClick={() => setLayout(shiftToolbarItem(layout, id, -1))}>
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12.5 8h-9M7 4.5 3.5 8 7 11.5" /></svg>
                </button>
                <button type="button" aria-label={`Move ${item.label} right`} title="Move right" disabled={index === last} onClick={() => setLayout(shiftToolbarItem(layout, id, 1))}>
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9M9 4.5 12.5 8 9 11.5" /></svg>
                </button>
              </span>
            </li>
          )
        })}
      </ul>
      <div className="toolbar-settings-footer">
        <button type="button" className="settings-action secondary" disabled={isDefaultToolbarLayout(layout)} onClick={() => setLayout(DEFAULT_TOOLBAR_LAYOUT)}>Reset to defaults</button>
      </div>
    </SettingsGroup>
  )
}
