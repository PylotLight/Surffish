import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  EMPTY_TAB_SELECTION,
  clickTabSelection,
  pruneTabSelection,
  selectedTabIds,
  selectionModifiers,
  type TabSelection,
} from "../../../../shared/tab-selection";
import "./tab-selection.css";

/**
 * Sidebar multi-select: Cmd-click (Ctrl-click off macOS) toggles an entry, Shift-click selects a
 * range, a plain click or Escape clears. The rules live in shared/tab-selection.ts; this hook keeps
 * the state, prunes entries that leave the list, and mirrors the selected tab ids to main (the tab
 * context menu, Cmd/Ctrl+G and the palette act on them there).
 *
 * `order` is the sidebar's entry keys (group headers included, they're skipped); `panesOf` turns
 * an entry key into its tab ids (a split's panes); `activeKey` is the active tab's entry. Only the
 * renderer surface that has the tab list on screen (`enabled`) keeps a selection and reports it.
 */
export function useTabSelection(
  order: readonly string[],
  panesOf: (key: string) => readonly string[],
  activeKey: string | null,
  enabled: boolean,
): {
  selectedKeys: ReadonlySet<string>;
  /** Tabs selected (split panes count one each). */
  count: number;
  /** Call first from an entry's click: true when the click was a selection gesture (don't open the tab). */
  handleClick: (event: ReactMouseEvent, key: string) => boolean;
  clear: () => void;
  group: () => void;
} {
  const isMac = window.api.platform === "darwin";
  const [selection, setSelection] = useState<TabSelection>(EMPTY_TAB_SELECTION);
  const panesRef = useRef(panesOf);
  panesRef.current = panesOf;

  // Closed, pinned, collapsed or moved entries leave the selection.
  useEffect(() => {
    setSelection((current) => pruneTabSelection(current, order, activeKey));
  }, [order, activeKey]);

  const ids = useMemo(
    () => selectedTabIds(selection, (key) => panesRef.current(key)),
    [selection],
  );
  const idsKey = ids.join("|");
  // The list went off screen (sidebar hidden, another surface took over): drop the selection.
  useEffect(() => {
    if (!enabled) setSelection(EMPTY_TAB_SELECTION);
  }, [enabled]);
  // Report changes; a surface that never selected anything stays quiet, so it can't wipe another's.
  const reported = useRef(false);
  useEffect(() => {
    if (!idsKey && !reported.current) return;
    reported.current = Boolean(idsKey);
    void window.api.browser.tabSelection
      .set(idsKey ? idsKey.split("|") : [])
      .catch(() => undefined);
  }, [idsKey]);

  useEffect(
    () =>
      window.api.browser.tabSelection.onClear(() =>
        setSelection(EMPTY_TAB_SELECTION),
      ),
    [],
  );

  const hasSelection = selection.keys.length > 0;
  useEffect(() => {
    if (!hasSelection) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA")
      )
        return;
      setSelection(EMPTY_TAB_SELECTION);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasSelection]);

  const handleClick = useCallback(
    (event: ReactMouseEvent, key: string): boolean => {
      const modifiers = selectionModifiers(event, isMac);
      const result = clickTabSelection(
        selection,
        order,
        key,
        modifiers,
        activeKey,
      );
      if (result.selection !== selection) setSelection(result.selection);
      if (result.activate) return false;
      event.preventDefault();
      event.stopPropagation();
      return true;
    },
    [selection, order, activeKey, isMac],
  );

  const clear = useCallback(() => setSelection(EMPTY_TAB_SELECTION), []);
  const group = useCallback(() => {
    void window.api.browser.tabSelection.group().catch(() => undefined);
  }, []);

  const selectedKeys = useMemo(() => new Set(selection.keys), [selection]);
  return { selectedKeys, count: ids.length, handleClick, clear, group };
}
