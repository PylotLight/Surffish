import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  readingListBadge,
  type ReadingListSnapshot,
} from "../../../../shared/reading-list";
import { usePopoverDismiss } from "../../lib/popover-dismiss";
import {
  setToolbarBadge,
  useReturnFocusRef,
  useToolbarOpenRequest,
  useToolbarSlot,
} from "../toolbar/toolbar-slot";

/** The popover body (list, search, filters) is its own chunk: launch only pays for this button. */
const ReadingListPanel = lazy(() =>
  import("./ReadingListPanel").then((module) => ({
    default: module.ReadingListPanel,
  })),
);

/** The badge waits until the window has painted and settled, so the Reading List never loads at launch. */
const BADGE_DELAY_MS = 1_500;

/** Reading List snapshot from main: fetched lazily, then kept current by the change broadcast. */
function useReadingList(wanted: boolean): ReadingListSnapshot | null {
  const [snapshot, setSnapshot] = useState<ReadingListSnapshot | null>(null);
  useEffect(() => window.api.browser.readingList.onChange(setSnapshot), []);
  useEffect(() => {
    if (!wanted || snapshot) return;
    let cancelled = false;
    void window.api.browser.readingList
      .get()
      .then((next) => {
        if (!cancelled && next && Array.isArray(next.items)) setSnapshot(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [wanted, snapshot]);
  return snapshot;
}

/**
 * Toolbar Reading List button (beside Bookmarks): unread badge and a popover of pages saved for
 * later. Cmd/Ctrl+Shift+L saves the current page (main handles it); the menu, palette and
 * "Show Reading List" open the popover through `onShow`.
 */
export function ReadingListButton({
  url,
  title,
  isPrivate,
  onOpenChange,
}: {
  url: string;
  title: string;
  isPrivate: boolean;
  onOpenChange?: (open: boolean) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [badgeReady, setBadgeReady] = useState(false);
  const controlRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const snapshot = useReadingList(open || badgeReady);
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);
  useEffect(
    () => window.api.browser.readingList.onShow(() => setOpen(true)),
    [],
  );
  useEffect(() => {
    const timer = setTimeout(() => setBadgeReady(true), BADGE_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  const { folded } = useToolbarSlot();
  const returnFocusRef = useReturnFocusRef(buttonRef);
  useToolbarOpenRequest("reading-list", () => setOpen(true));
  usePopoverDismiss(open, controlRef, () => setOpen(false), {
    returnFocusRef,
    preventEscapeDefault: true,
  });
  const badge = readingListBadge(snapshot?.unread ?? 0);
  useEffect(() => setToolbarBadge("reading-list", badge), [badge]);
  const isMac = window.api.platform === "darwin";
  return (
    <div className="reading-list-control" ref={controlRef}>
      <button
        ref={buttonRef}
        type="button"
        hidden={folded}
        className={`omnibox-action-button reading-list-button${open ? " is-current" : ""}`}
        aria-label={
          badge ? `Reading List, ${snapshot?.unread} unread` : "Reading List"
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="reading-list-popover"
        title={`Reading List (save this page: ${isMac ? "⇧⌘L" : "Ctrl+Shift+L"})`}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="6.5" cy="14.5" r="3.5" />
          <circle cx="17.5" cy="14.5" r="3.5" />
          <path d="M10 14.2c1.2-.8 2.8-.8 4 0M3 14l1.6-6.2A2 2 0 0 1 6.5 6.3H7M21 14l-1.6-6.2a2 2 0 0 0-1.9-1.5H17" />
        </svg>
        {badge && (
          <span className="reading-list-badge" aria-hidden="true">
            {badge}
          </span>
        )}
      </button>
      {open && (
        <Suspense fallback={null}>
          <ReadingListPanel
            snapshot={snapshot}
            pageUrl={url}
            pageTitle={title}
            isPrivate={isPrivate}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
