import { useEffect, useRef, useState } from "react";
import {
  NAV_HISTORY_HOLD_MS,
  navHistoryDisposition,
  type BrowserNavHistoryMenu,
  type NavHistoryDirection,
} from "../../../shared/nav-history-menu";
import { usePopoverDismiss } from "../lib/popover-dismiss";

/** A menu row's icon: the site's cached favicon, else its first letter (nothing is fetched from here, so private tabs stay quiet). */
function NavHistoryIcon({
  url,
  title,
  faviconUrl,
}: {
  url: string;
  title: string;
  faviconUrl: string | null;
}): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  if (faviconUrl && !failed)
    return (
      <img
        src={faviconUrl}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  let letter = title.trim().slice(0, 1);
  try {
    letter = new URL(url).hostname.replace(/^www\./i, "").slice(0, 1) || letter;
  } catch {
    /* not a URL: keep the title's letter */
  }
  return <span>{(letter || "•").toUpperCase()}</span>;
}

/**
 * The toolbar's Back and Forward buttons. A click goes back/forward; press-and-hold (or a
 * right-click / the context-menu key) opens Chrome's history menu: that direction's entries for the
 * active tab (the focused split pane), newest first, then Show Full History. A row navigates the
 * tab; Cmd/Ctrl- or middle-click opens it in a new tab after this one. Holding, dragging onto a row
 * and releasing picks it, as in Chrome.
 *
 * The menu is drawn in the toolbar document (`#nav-history-menu`), so useToolbarExtent grows the
 * toolbar view to fit it and it is never clipped against the page view.
 */
export function NavHistoryButtons({
  canGoBack,
  canGoForward,
  currentUrl,
  onShowFullHistory,
  children,
}: {
  canGoBack: boolean;
  canGoForward: boolean;
  /** The active tab's URL: the menu closes when the tab navigates or switches. */
  currentUrl: string;
  onShowFullHistory: () => void;
  children?: React.ReactNode;
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const forwardRef = useRef<HTMLButtonElement>(null);
  const holdTimer = useRef<number | null>(null);
  /** The last press opened the menu by holding: its click must not also go back. */
  const openedByHold = useRef(false);
  /** The press that opened the menu is still down: releasing it over a row picks that row. */
  const holdDragging = useRef(false);
  const requestSeq = useRef(0);
  const [menu, setMenu] = useState<BrowserNavHistoryMenu | null>(null);
  const isMac = window.api.platform === "darwin";

  const close = (): void => {
    requestSeq.current += 1;
    setMenu(null);
  };
  const returnFocusRef = menu?.direction === "forward" ? forwardRef : backRef;
  usePopoverDismiss(menu !== null, containerRef, close, { returnFocusRef });

  const cancelHold = (): void => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };
  useEffect(() => cancelHold, []);
  // The tab navigated or another tab became active: the rows belong to the old page.
  useEffect(() => close(), [currentUrl]);
  useEffect(() => {
    const release = (): void => {
      holdDragging.current = false;
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, []);

  const open = (direction: NavHistoryDirection, focusMenu: boolean): void => {
    const seq = ++requestSeq.current;
    void window.api.browser.navHistory
      .list(direction)
      .then((next) => {
        if (seq !== requestSeq.current) return;
        if (next.entries.length === 0) {
          setMenu(null);
          return;
        }
        setMenu(next);
        if (focusMenu)
          requestAnimationFrame(() =>
            menuRef.current
              ?.querySelector<HTMLButtonElement>("button")
              ?.focus(),
          );
      })
      .catch(() => undefined);
  };

  const buttonHandlers = (
    direction: NavHistoryDirection,
    go: () => Promise<void>,
  ) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      openedByHold.current = false;
      if (event.button !== 0) return;
      cancelHold();
      holdTimer.current = window.setTimeout(() => {
        holdTimer.current = null;
        openedByHold.current = true;
        holdDragging.current = true;
        open(direction, false);
      }, NAV_HISTORY_HOLD_MS);
    },
    onPointerUp: cancelHold,
    onPointerCancel: cancelHold,
    onPointerLeave: (event: React.PointerEvent<HTMLButtonElement>) => {
      // Leaving the button while holding (towards the menu) still opens it; only a plain move-away cancels.
      if (event.buttons === 0) cancelHold();
    },
    onClick: () => {
      cancelHold();
      if (openedByHold.current) {
        openedByHold.current = false;
        return;
      }
      if (menu) {
        // A click while the menu is open just closes it, as in Chrome.
        close();
        return;
      }
      void go();
    },
    onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      cancelHold();
      if (menu?.direction === direction) {
        close();
        return;
      }
      // A mouse right-click has a position; the context-menu key / Shift+F10 doesn't: focus the first row then.
      open(direction, event.clientX === 0 && event.clientY === 0);
    },
  });

  const pick = (
    index: number,
    input: {
      button: number;
      metaKey: boolean;
      ctrlKey: boolean;
      shiftKey: boolean;
    },
  ): void => {
    const disposition = navHistoryDisposition(input, isMac);
    close();
    void window.api.browser.navHistory.go(index, disposition);
  };

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    )
      return;
    event.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (current + 1) % items.length
            : current <= 0
              ? items.length - 1
              : current - 1;
    items[next]?.focus();
  };

  return (
    <div className="browser-nav-buttons" ref={containerRef}>
      <button
        ref={backRef}
        className={`toolbar-button${menu?.direction === "back" ? " is-current" : ""}`}
        type="button"
        aria-label="Back"
        aria-haspopup="menu"
        aria-expanded={menu?.direction === "back"}
        title="Back (hold or right-click for history)"
        disabled={!canGoBack}
        {...buttonHandlers("back", () => window.api.browser.back())}
      >
        <span aria-hidden="true">‹</span>
      </button>
      <button
        ref={forwardRef}
        className={`toolbar-button${menu?.direction === "forward" ? " is-current" : ""}`}
        type="button"
        aria-label="Forward"
        aria-haspopup="menu"
        aria-expanded={menu?.direction === "forward"}
        title="Forward (hold or right-click for history)"
        disabled={!canGoForward}
        {...buttonHandlers("forward", () => window.api.browser.forward())}
      >
        <span aria-hidden="true">›</span>
      </button>
      {children}
      {menu && (
        <div
          id="nav-history-menu"
          ref={menuRef}
          className={`nav-history-menu is-${menu.direction}`}
          role="menu"
          aria-label={
            menu.direction === "back" ? "Back history" : "Forward history"
          }
          onKeyDown={onMenuKeyDown}
        >
          <div className="nav-history-menu-list" data-popover-scroll>
            {menu.entries.map((entry) => (
              <button
                key={entry.index}
                type="button"
                role="menuitem"
                className="nav-history-menu-item"
                data-index={entry.index}
                title={entry.url}
                onClick={(event) => pick(entry.index, event)}
                onAuxClick={(event) => {
                  if (event.button !== 1) return;
                  event.preventDefault();
                  pick(entry.index, event);
                }}
                onMouseDown={(event) => {
                  // Middle-button autoscroll would otherwise start in the toolbar.
                  if (event.button === 1) event.preventDefault();
                }}
                onPointerUp={(event) => {
                  if (!holdDragging.current || event.button !== 0) return;
                  holdDragging.current = false;
                  pick(entry.index, event);
                }}
              >
                <span className="nav-history-menu-icon" aria-hidden="true">
                  <NavHistoryIcon
                    url={entry.url}
                    title={entry.title}
                    faviconUrl={entry.faviconUrl}
                  />
                </span>
                <span className="nav-history-menu-title">{entry.title}</span>
              </button>
            ))}
          </div>
          <div className="nav-history-menu-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="nav-history-menu-item nav-history-menu-full"
            onClick={() => {
              close();
              onShowFullHistory();
            }}
            onPointerUp={(event) => {
              if (!holdDragging.current || event.button !== 0) return;
              holdDragging.current = false;
              close();
              onShowFullHistory();
            }}
          >
            <span className="nav-history-menu-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
                <path d="M3.5 4.5V9H8" />
                <path d="M12 7.5V12l3 2" />
              </svg>
            </span>
            <span className="nav-history-menu-title">
              Show Full History
              {menu.total > menu.entries.length
                ? ` (${menu.total - menu.entries.length} more)`
                : ""}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
