/**
 * Per-tab address bar drafts: what the user typed into the omnibox on a tab and has not submitted.
 *
 * Like Chrome and Arc, half-typed text belongs to its tab. Switching to another tab shows that
 * tab's URL (or its own draft), and switching back puts the typed text (and caret) back, so text
 * copied from another tab can be pasted into a search started on a New Tab. A draft goes away
 * when it is submitted, when Esc reverts the bar, when its tab navigates (the URL it was typed
 * over changes), or when the tab closes.
 *
 * Each shell renderer keeps its own map (renderer memory only, never persisted): the toolbar
 * surface draws the bar on web pages, the content surface on the local New Tab page.
 */

export interface OmniboxDraft {
  /** The unsubmitted text. */
  text: string;
  /** What the bar showed for the tab when the text was typed ('' on the local New Tab page). */
  base: string;
  selectionStart: number | null;
  selectionEnd: number | null;
}

export interface OmniboxDraftTab {
  id: string;
  /** What the bar shows for the tab now (see address-bar-sync `addressDisplayValue`). */
  display: string;
}

export class OmniboxDrafts {
  private readonly drafts = new Map<string, OmniboxDraft>();

  /** Remember (or, when the text is back to the tab's own value, forget) the tab's draft. */
  save(tabId: string, draft: OmniboxDraft): void {
    if (!tabId) return;
    if (draft.text === draft.base) this.drafts.delete(tabId);
    else this.drafts.set(tabId, { ...draft });
  }

  /** Keep the draft's text, only update where the caret was (the input lost focus). */
  saveSelection(
    tabId: string,
    text: string,
    selectionStart: number | null,
    selectionEnd: number | null,
  ): void {
    const draft = this.drafts.get(tabId);
    if (!draft || draft.text !== text) return;
    draft.selectionStart = selectionStart;
    draft.selectionEnd = selectionEnd;
  }

  clear(tabId: string): void {
    this.drafts.delete(tabId);
  }

  /** The tab's draft, if it was typed over what the tab shows now (`display`); null otherwise. */
  draftFor(tabId: string, display: string): OmniboxDraft | null {
    const draft = this.drafts.get(tabId);
    return draft && draft.base === display ? draft : null;
  }

  /** Drop drafts of tabs that closed (or left this window) and of tabs that navigated since. */
  prune(tabs: Iterable<OmniboxDraftTab>): void {
    if (this.drafts.size === 0) return;
    const live = new Map<string, string>();
    for (const tab of tabs) live.set(tab.id, tab.display);
    for (const [tabId, draft] of this.drafts) {
      const display = live.get(tabId);
      if (display === undefined || display !== draft.base)
        this.drafts.delete(tabId);
    }
  }

  get size(): number {
    return this.drafts.size;
  }
}
