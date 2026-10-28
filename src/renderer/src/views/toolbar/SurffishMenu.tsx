import { useEffect, useRef, useState } from "react";
import type { ToolbarItemId } from "../../../../shared/toolbar-layout";
import { usePopoverDismiss } from "../../lib/popover-dismiss";
import { useToolbarBadges } from "./toolbar-slot";
import { PinGlyph, ToolbarGlyph } from "./ToolbarGlyph";

export interface SurffishMenuEntry {
  id: ToolbarItemId;
  label: string;
  shortcut?: string;
  /** On the toolbar right now? (no: unpinned, idle contextual, or folded by a narrow window) */
  pinned: boolean;
  onSelect: () => void;
}

/** Arrow keys / Home / End move between a menu's items; the first item takes focus on open. */
export function useMenuKeyboard(
  menuRef: React.RefObject<HTMLElement | null>,
  open: boolean,
): (event: React.KeyboardEvent) => void {
  useEffect(() => {
    if (open)
      menuRef.current
        ?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)')
        ?.focus();
  }, [open, menuRef]);
  return (event) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>(
        '[role^="menuitem"]:not(:disabled)',
      ) ?? [],
    );
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (event.key === "ArrowDown") next = (index + 1) % items.length;
    else if (event.key === "ArrowUp")
      next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next < 0) return;
    event.preventDefault();
    items[next]?.focus();
  };
}

function MenuBody({
  entries,
  onClose,
  onPin,
  onCustomize,
  onSettings,
}: {
  entries: readonly SurffishMenuEntry[];
  onClose: () => void;
  onPin: (id: ToolbarItemId) => void;
  onCustomize: () => void;
  onSettings: () => void;
}): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);
  const badges = useToolbarBadges();
  const onKeyDown = useMenuKeyboard(menuRef, true);
  const isMac = window.api.platform === "darwin";
  return (
    <div
      id="surffish-menu"
      className="surffish-menu"
      role="menu"
      aria-label="Surffish menu"
      ref={menuRef}
      onKeyDown={onKeyDown}
    >
      {entries.length > 0 && (
        <ul className="surffish-menu-list" role="none">
          {entries.map((entry) => {
            const badge = badges.get(entry.id);
            return (
              <li key={entry.id} className="surffish-menu-row" role="none">
                <button
                  type="button"
                  role="menuitem"
                  className="surffish-menu-item"
                  data-toolbar-item={entry.id}
                  onClick={() => {
                    onClose();
                    entry.onSelect();
                  }}
                >
                  <span className="surffish-menu-icon">
                    <ToolbarGlyph id={entry.id} />
                  </span>
                  <span className="surffish-menu-label">{entry.label}</span>
                  {badge && (
                    <span
                      className="surffish-menu-badge"
                      aria-label={`${badge} ${entry.id === "adblock" ? "blocked" : "unread"}`}
                    >
                      {badge}
                    </span>
                  )}
                  {entry.shortcut && <kbd>{entry.shortcut}</kbd>}
                </button>
                <button
                  type="button"
                  className={`surffish-menu-pin${entry.pinned ? " is-pinned" : ""}`}
                  aria-pressed={entry.pinned}
                  aria-label={
                    entry.pinned
                      ? `Unpin ${entry.label}`
                      : `Pin ${entry.label} to toolbar`
                  }
                  title={
                    entry.pinned
                      ? "Unpin (the window is too narrow to show it)"
                      : "Pin to toolbar"
                  }
                  tabIndex={-1}
                  onClick={() => onPin(entry.id)}
                >
                  <PinGlyph pinned={entry.pinned} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {entries.length > 0 && (
        <div className="surffish-menu-separator" role="separator" />
      )}
      <button
        type="button"
        role="menuitem"
        className="surffish-menu-item"
        data-action="customize"
        onClick={() => {
          onClose();
          onCustomize();
        }}
      >
        <span className="surffish-menu-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4.5 7h9M17.5 7h2M4.5 17h2M10.5 17h9" />
            <circle cx="15.5" cy="7" r="2" />
            <circle cx="8.5" cy="17" r="2" />
          </svg>
        </span>
        <span className="surffish-menu-label">Customize toolbar…</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="surffish-menu-item"
        data-action="settings"
        onClick={() => {
          onClose();
          onSettings();
        }}
      >
        <span className="surffish-menu-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6" />
          </svg>
        </span>
        <span className="surffish-menu-label">Settings</span>
        <kbd>{isMac ? "⌘," : "Ctrl+,"}</kbd>
      </button>
    </div>
  );
}

/**
 * The Surffish button (logo + name, far right) opens the overflow menu: every toolbar button that
 * isn't on the toolbar right now (unpinned, contextual and idle, or folded by a narrow window), with
 * its icon, label and shortcut, plus Customize toolbar… and Settings. Triple-click still opens the
 * logo easter egg.
 */
export function SurffishMenu({
  entries,
  menuButtonRef,
  attention,
  onPin,
  onCustomize,
  onSettings,
  onBrandClick,
  onOpenChange,
}: {
  entries: readonly SurffishMenuEntry[];
  menuButtonRef: React.RefObject<HTMLButtonElement | null>;
  /** A folded button wants attention (a running download): a dot on the logo. */
  attention: boolean;
  onPin: (id: ToolbarItemId) => void;
  onCustomize: () => void;
  onSettings: () => void;
  /** Counts the logo's triple-click; true on the click that opens the easter egg. */
  onBrandClick: () => boolean;
  onOpenChange?: (open: boolean) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const controlRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);
  usePopoverDismiss(open, controlRef, () => setOpen(false), {
    returnFocusRef: menuButtonRef,
    preventEscapeDefault: true,
  });
  return (
    <div className="surffish-menu-control" ref={controlRef}>
      <button
        ref={menuButtonRef}
        type="button"
        className={`toolbar-brand${open ? " is-open" : ""}`}
        aria-label={
          attention ? "Surffish menu, download in progress" : "Surffish menu"
        }
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="surffish-menu"
        title="Surffish menu"
        onClick={(event) => {
          // The 3rd click of a triple-click opens the easter egg instead; a double-click's 2nd click is ignored.
          if (onBrandClick()) setOpen(false);
          else if (event.detail <= 1) setOpen((value) => !value);
        }}
      >
        <img
          className="toolbar-brand-icon"
          src="./surffish-brand-icon.png"
          alt=""
          aria-hidden="true"
          draggable={false}
        />
        <strong>Surffish</strong>
        {attention && <span className="toolbar-brand-dot" aria-hidden="true" />}
      </button>
      {open && (
        <MenuBody
          entries={entries}
          onClose={() => setOpen(false)}
          onPin={onPin}
          onCustomize={onCustomize}
          onSettings={onSettings}
        />
      )}
    </div>
  );
}
