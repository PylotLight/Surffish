import { useEffect, useRef } from "react";
import {
  popoverRoom,
  toolbarExtentFor,
  type PopoverBox,
} from "../../../shared/popover-dismiss";
import { dismissPopovers, usePopoverDismiss } from "../lib/popover-dismiss";

/** Everything the toolbar draws below itself. The toolbar view is sized to fit all of them whole. */
export const TOOLBAR_POPOVER_SELECTOR = [
  ".address-suggestions",
  "#downloads-popup",
  "#downloads-popup .downloads-menu",
  "#site-actions-menu",
  "#extensions-menu",
  "#find-bar",
  "#command-palette",
  "#bookmark-popover",
  "#browser-notice",
  ".bookmarks-menu-panel",
  "#reading-list-popover",
  "#read-aloud-popover",
  "#adblock-popover",
  "#cast-popover",
  "#nav-history-menu",
  "#surffish-menu",
  "#toolbar-item-menu",
].join(", ");

/** Popovers proper (light-dismissed); the find bar, palette and notices manage themselves. */
const LIGHT_DISMISS_SELECTOR =
  "#downloads-popup, #site-actions-menu, #extensions-menu, #bookmark-popover, .bookmarks-menu-panel, #reading-list-popover, #read-aloud-popover, #adblock-popover, #cast-popover, #nav-history-menu, #surffish-menu, #toolbar-item-menu";

/**
 * Where an element sits as laid out, ignoring transforms: an entry animation (scale 0.98,
 * translateY −4px) made getBoundingClientRect report a shorter box at mount, and a ResizeObserver
 * never fires when the transform settles, so the toolbar view stayed a few px short and clipped
 * the popover's last row (Extensions › Manage extensions).
 */
function layoutBox(element: HTMLElement): PopoverBox {
  const shadow =
    element.matches(LIGHT_DISMISS_SELECTOR) ||
    element.matches(
      ".surffish-egg, .downloads-menu, .address-suggestions, #command-palette",
    );
  let top = 0;
  let node: HTMLElement | null = element;
  while (node) {
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { top, height: element.offsetHeight, shadow };
}

/**
 * Size the toolbar view (overlay mode) to the toolbar plus whatever hangs below it, tell main
 * whether a popover is open (so presses on the page/sidebar and window blur close it), and give
 * popovers the window's free height as `--popover-room` so they cap themselves and scroll instead
 * of running off the bottom of the window.
 */
export function useToolbarExtent(
  chromeRef: React.RefObject<HTMLElement | null>,
  active: boolean,
  extraOpen: boolean,
  deps: readonly unknown[],
): void {
  const windowHeightRef = useRef<number | undefined>(undefined);
  const lastSentRef = useRef<string | null>(null);
  const forceNextRef = useRef(true);
  useEffect(() => {
    const element = chromeRef.current;
    if (!element || !active) return;
    let frame = 0;
    let force = forceNextRef.current;
    const update = (): void => {
      frame = 0;
      const toolbarHeight = element.getBoundingClientRect().height;
      const popovers = Array.from(
        element.querySelectorAll<HTMLElement>(TOOLBAR_POPOVER_SELECTOR),
      );
      // The logo easter egg is portalled to <body> (fixed to the viewport, not a blurred ancestor).
      popovers.push(
        ...Array.from(
          document.querySelectorAll<HTMLElement>(
            "body > .surffish-egg-root .surffish-egg",
          ),
        ),
      );
      const toolbarExtent = toolbarExtentFor(
        toolbarHeight,
        popovers.map(layoutBox),
        windowHeightRef.current,
      );
      const popoverOpen =
        extraOpen ||
        popovers.some((popover) => popover.matches(LIGHT_DISMISS_SELECTOR));
      // Toolbar DOM changes all the time (loading state, typing); only talk to main when it matters.
      const key = `${toolbarHeight}|${toolbarExtent}|${popoverOpen}`;
      if (key === lastSentRef.current && !force) return;
      lastSentRef.current = key;
      force = false;
      forceNextRef.current = false;
      void window.api.browser.chrome
        .reportMetrics({ toolbarHeight, toolbarExtent, popoverOpen })
        .then((metrics) => {
          if (!metrics?.windowHeight) return;
          const grew = windowHeightRef.current !== metrics.windowHeight;
          windowHeightRef.current = metrics.windowHeight;
          const room = popoverRoom(metrics.windowHeight, toolbarHeight);
          const root = document.documentElement.style;
          root.setProperty(
            "--shell-window-height",
            `${metrics.windowHeight}px`,
          );
          if (room !== null) root.setProperty("--popover-room", `${room}px`);
          // The first answer can shrink a popover that ran past the window: measure again.
          if (grew && popovers.length > 0) {
            force = true;
            forceNextRef.current = true;
            schedule();
          }
        })
        .catch(() => undefined);
    };
    const schedule = (): void => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    // Popups fill in after they mount (downloads load async); re-measure as they grow so the
    // toolbar view isn't left too short and clips them against the page view.
    element
      .querySelectorAll<HTMLElement>(TOOLBAR_POPOVER_SELECTOR)
      .forEach((popover) => observer.observe(popover));
    // A popover that mounts inside another (the downloads … menu) or animates in.
    const mutations = new MutationObserver(() => {
      element
        .querySelectorAll<HTMLElement>(TOOLBAR_POPOVER_SELECTOR)
        .forEach((popover) => observer.observe(popover));
      schedule();
    });
    // The logo easter egg mounts (lazily) in <body>, outside the toolbar element.
    mutations.observe(extraOpen ? document.body : element, {
      childList: true,
      subtree: true,
    });
    const onResize = (): void => {
      force = true;
      forceNextRef.current = true;
      schedule();
    };
    element.addEventListener("animationend", schedule, true);
    window.addEventListener("resize", onResize);
    update();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      mutations.disconnect();
      element.removeEventListener("animationend", schedule, true);
      window.removeEventListener("resize", onResize);
    };
  }, [active, extraOpen, chromeRef, deps]);
}

/**
 * The History panel the toolbar's clock button opens (drawn in the sidebar view) closes like a
 * popover: a press on the page or elsewhere in the toolbar, Escape, the window losing focus, a tab
 * switch. Presses inside the panel (the sidebar view) keep it open. `anchorRef` is the toolbar's
 * history button (it toggles the panel itself) or, in the sidebar surface, the sidebar card.
 */
export function useHistoryPanelDismiss(
  open: boolean,
  anchorRef: React.RefObject<HTMLElement | null>,
  close: () => void,
): void {
  usePopoverDismiss(open, anchorRef, close, { kind: "panel" });
}

/**
 * A tab switch closes whatever popover was open in this surface before it (it belonged to the old
 * page). `activeTabSince` is when main made the tab active (BrowserState): the tab broadcast that
 * tells this renderer is coalesced per frame and can arrive after a popover main opened right
 * after the switch (close a tab, then Open Reading List), which must stay open.
 */
export function useDismissOnTabSwitch(
  activeTabId: string,
  activeTabSince?: number,
): void {
  const previous = useRef(activeTabId);
  const since = useRef(activeTabSince);
  since.current = activeTabSince;
  useEffect(() => {
    if (previous.current === activeTabId) return;
    previous.current = activeTabId;
    dismissPopovers("tab-switch", since.current);
  }, [activeTabId]);
}
