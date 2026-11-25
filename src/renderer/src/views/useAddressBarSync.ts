import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  isTypingIn,
  liveAddressValue,
  nextAddressValue,
  type AddressSyncReason,
} from "../../../shared/address-bar-sync";
import {
  OmniboxDrafts,
  type OmniboxDraft,
  type OmniboxDraftTab,
} from "../../../shared/omnibox-drafts";

/**
 * Keeps the address bar in step with the active tab (see shared/address-bar-sync): the tab's URL
 * wins unless the user is really typing. Unsubmitted text is kept per tab (shared/omnibox-drafts):
 * switching to another tab shows that tab's URL or its own draft, and switching back restores the
 * text and caret. Returns the input's blur handler, `rememberDraft` for edits, `clearDraft` for a
 * submitted bar, and `markSynced` for code that sets the bar to the tab URL itself (Esc, a
 * finished navigation), which also drops the tab's draft.
 */
export function useAddressBarSync({
  inputRef,
  address,
  setAddress,
  displayUrl,
  tabKey,
  tabs,
  onRestoreFocus,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  address: string;
  setAddress: (value: string) => void;
  /** What the active tab wants shown ('' on the local New Tab page). */
  displayUrl: string;
  /** Changes when another tab becomes active. */
  tabKey: string;
  /** Every tab in this window and what its bar shows; drafts of closed or navigated tabs go. */
  tabs: readonly OmniboxDraftTab[];
  /**
   * A New Tab draft came back: put the keyboard in the bar (without opening suggestions), then call
   * `placeCaret` to put the caret / selection back where it was.
   */
  onRestoreFocus?: (input: HTMLInputElement, placeCaret: () => void) => void;
}): {
  onBlur: () => void;
  markSynced: (value: string) => void;
  rememberDraft: (text: string, input?: HTMLInputElement | null) => void;
  clearDraft: () => void;
} {
  const syncedRef = useRef(displayUrl);
  const valueRef = useRef(address);
  const displayRef = useRef(displayUrl);
  const tabKeyRef = useRef(tabKey);
  const selectAllRef = useRef(false);
  const [drafts] = useState(() => new OmniboxDrafts());
  const restoreRef = useRef<{ draft: OmniboxDraft; focus: boolean } | null>(
    null,
  );
  const restoreFocusRef = useRef(onRestoreFocus);
  useLayoutEffect(() => {
    restoreFocusRef.current = onRestoreFocus;
    valueRef.current = address;
    displayRef.current = displayUrl;
    tabKeyRef.current = tabKey;
  });

  const sync = useCallback(
    (reason: AddressSyncReason) => {
      const input = inputRef.current;
      const next = displayRef.current;
      const typing = isTypingIn(input, document);
      // The field itself, not the last render: a keystroke can be in the input before its state is.
      const shown = liveAddressValue(input, valueRef.current);
      // This tab's own unsubmitted text (typed over what it shows now) comes back instead of its URL.
      // The tab id and its URL reach this renderer separately, in either order, so only restore once
      // both say this tab; the draft waits for the other half otherwise.
      const draft =
        reason === "blur" ? null : drafts.draftFor(tabKeyRef.current, next);
      if (draft) {
        syncedRef.current = next;
        if (shown === draft.text) {
          // The field still holds the draft (this renderer kept it while another tab was showing),
          // so nothing re-renders: put the keyboard back on a New Tab here instead.
          if (reason === "tab" && next === "" && input && !hasKeyboard(input))
            restoreFocusRef.current?.(input, caretPlacer(input, draft));
          return;
        }
        selectAllRef.current = false;
        restoreRef.current = { draft, focus: next === "" };
        valueRef.current = draft.text;
        setAddress(draft.text);
        return;
      }
      const value = nextAddressValue({
        value: shown,
        synced: syncedRef.current,
        next,
        typing,
        reason,
      });
      if (value === null) {
        // Already showing the tab URL (e.g. after Esc): that's the new "unedited" baseline.
        if (shown === next) syncedRef.current = next;
        return;
      }
      // A focused bar with the whole URL selected stays fully selected, so typing still replaces it.
      // Reselect as soon as React commits the new value (a rAF is too late: a keystroke that lands
      // before the next frame would be appended to the new URL instead of replacing it).
      selectAllRef.current =
        typing &&
        input !== null &&
        input.selectionStart === 0 &&
        input.selectionEnd === input.value.length;
      restoreRef.current = null;
      syncedRef.current = value;
      valueRef.current = value;
      setAddress(value);
    },
    [drafts, inputRef, setAddress],
  );

  useLayoutEffect(() => {
    const input = inputRef.current;
    const restore = restoreRef.current;
    if (restore) {
      if (!input || input.value !== restore.draft.text) return;
      restoreRef.current = null;
      const placeCaret = caretPlacer(input, restore.draft);
      if (hasKeyboard(input)) placeCaret();
      else if (restore.focus) onRestoreFocus?.(input, placeCaret);
      return;
    }
    if (!selectAllRef.current) return;
    selectAllRef.current = false;
    if (input && document.activeElement === input && input.value === address)
      input.select();
  }, [address, inputRef, onRestoreFocus]);

  useEffect(() => {
    sync("url");
  }, [displayUrl, sync]);
  useEffect(() => {
    sync("tab");
  }, [tabKey, sync]);
  useEffect(() => {
    drafts.prune(tabs);
  }, [drafts, tabs]);

  const onBlur = useCallback(() => {
    const input = inputRef.current;
    if (input)
      drafts.saveSelection(
        tabKeyRef.current,
        input.value,
        input.selectionStart,
        input.selectionEnd,
      );
    sync("blur");
  }, [drafts, inputRef, sync]);
  const rememberDraft = useCallback(
    (text: string, input?: HTMLInputElement | null) => {
      drafts.save(tabKeyRef.current, {
        text,
        base: displayRef.current,
        selectionStart: input?.selectionStart ?? null,
        selectionEnd: input?.selectionEnd ?? null,
      });
    },
    [drafts],
  );
  const clearDraft = useCallback(() => {
    restoreRef.current = null;
    drafts.clear(tabKeyRef.current);
  }, [drafts]);
  const markSynced = useCallback(
    (value: string) => {
      syncedRef.current = value;
      clearDraft();
    },
    [clearDraft],
  );
  return { onBlur, markSynced, rememberDraft, clearDraft };
}

/** Puts the caret (or selection) back where it was in a restored draft, if the bar has the keyboard. */
function caretPlacer(input: HTMLInputElement, draft: OmniboxDraft): () => void {
  const { text, selectionStart, selectionEnd } = draft;
  return () => {
    if (document.activeElement !== input || input.value !== text) return;
    const end = input.value.length;
    input.setSelectionRange(
      Math.min(selectionStart ?? end, end),
      Math.min(selectionEnd ?? end, end),
    );
  };
}

/**
 * The bar really has the keyboard: focused in this document and this surface has the OS focus.
 * activeElement alone sticks on a surface that lost focus to another view (the toolbar, a page).
 */
function hasKeyboard(input: HTMLInputElement): boolean {
  return document.activeElement === input && document.hasFocus();
}
