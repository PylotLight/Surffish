/**
 * The mini window's address field (main/mini-window.ts drives it; its header page only shows it).
 *
 * The header page is a data: URL with a narrow preload, so it can't import the toolbar's React
 * omnibox. Main runs the same omnibox model for it instead, built from the toolbar's own pieces:
 * suggestions (autocomplete.ts omniboxSuggestions), keyword search (search-keywords.ts), arrow-to-fill
 * and Esc (omnibox-fill.ts), row highlighting (omnibox-fill.ts). The page sends what was typed and the
 * keys that move the selection; main answers with what the field and its dropdown show. Enter goes
 * through the same resolver as the toolbar (search-keywords resolveAddressInput → navigation.ts).
 *
 * There is no setting for it: the field shows by itself on a New Tab in a mini window, ⌘/Ctrl+L
 * shows it on any page, Esc (or leaving it, on a web page) hides it again.
 */
import {
  omniboxSuggestions,
  type AddressSuggestion,
  type OmniboxSuggestionSources,
} from "./autocomplete";
import {
  arrowSuggestion,
  escapeOmnibox,
  highlightMatches,
  keywordSuggestionText,
  omniboxQuery,
  suggestionUrlParts,
  type OmniboxDirection,
  type OmniboxPreview,
  type TextPart,
  type UrlPart,
} from "./omnibox-fill";
import { parseKeywordSearch, type CustomSearchEngine } from "./search-keywords";
import { SURFFISH_QUICK_LINKS_URL } from "./navigation";
import type { MiniWindowGrouping } from "./mini-window";

/** Rows the mini window's dropdown shows at most (the toolbar shows 7; a mini window is small). */
export const MINI_OMNIBOX_LIMIT = 6;
/** One dropdown row (title + URL), and the dropdown's padding top + bottom (header page CSS). */
export const MINI_OMNIBOX_ROW_HEIGHT = 40;
export const MINI_OMNIBOX_PADDING = 8;

export interface MiniOmniboxSources extends OmniboxSuggestionSources {
  engines: readonly CustomSearchEngine[];
}

/** What the field holds: its text, and (while arrowing) which row is filled in and what was typed. */
export interface MiniOmnibox {
  text: string;
  preview: OmniboxPreview | null;
}

export interface MiniOmniboxRow {
  url: string;
  source: AddressSuggestion["source"];
  title: TextPart[];
  urlParts: UrlPart[];
}

/** What the header page draws (sent whole; the page only diffs what it writes). */
export interface MiniOmniboxView {
  text: string;
  /** Put the caret at the end (arrowed onto a row, Esc put back what was typed). */
  caretToEnd: boolean;
  /** The row filled in, -1: the typed text (or the keyword row, when there is one). */
  selected: number;
  keyword: { label: string; chip: string } | null;
  rows: MiniOmniboxRow[];
}

export function emptyMiniOmnibox(text = ""): MiniOmnibox {
  return { text, preview: null };
}

/** Typed (or pasted): the new text is the query; any filled-in row is let go. */
export function typedMiniOmnibox(text: string): MiniOmnibox {
  return { text, preview: null };
}

function suggestionsFor(
  model: MiniOmnibox,
  sources: MiniOmniboxSources,
  limit: number,
): AddressSuggestion[] {
  return omniboxSuggestions(
    omniboxQuery(model.text, model.preview),
    sources,
    limit,
  );
}

/** Up / Down (Tab / Shift+Tab): fill the field with the next row's URL, or back to what was typed. */
export function arrowMiniOmnibox(
  model: MiniOmnibox,
  sources: MiniOmniboxSources,
  direction: OmniboxDirection,
  limit = MINI_OMNIBOX_LIMIT,
): MiniOmnibox {
  const next = arrowSuggestion(
    model.text,
    model.preview,
    suggestionsFor(model, sources, limit),
    direction,
  );
  return { text: next.text, preview: next.preview };
}

/** Esc: with a row filled in, put back what was typed (the dropdown stays); otherwise close (revert). */
export function escapeMiniOmnibox(
  model: MiniOmnibox,
): { kind: "restore"; model: MiniOmnibox } | { kind: "close" } {
  const escape = escapeOmnibox(model.preview);
  return escape.kind === "restore"
    ? { kind: "restore", model: { text: escape.text, preview: null } }
    : { kind: "close" };
}

/** A clicked row: its URL. */
export function miniOmniboxRowUrl(
  model: MiniOmnibox,
  sources: MiniOmniboxSources,
  index: number,
  limit = MINI_OMNIBOX_LIMIT,
): string | null {
  return suggestionsFor(model, sources, limit)[index]?.url ?? null;
}

/** What the field and its dropdown show for `model` (no rows for an empty field). */
export function miniOmniboxView(
  model: MiniOmnibox,
  sources: MiniOmniboxSources,
  options: { caretToEnd?: boolean; limit?: number } = {},
): MiniOmniboxView {
  const query = omniboxQuery(model.text, model.preview);
  const suggestions = suggestionsFor(
    model,
    sources,
    options.limit ?? MINI_OMNIBOX_LIMIT,
  );
  const keyword = parseKeywordSearch(query, sources.engines);
  return {
    text: model.text,
    caretToEnd: Boolean(options.caretToEnd),
    selected: model.preview ? model.preview.index : -1,
    keyword: keyword ? keywordSuggestionText(keyword) : null,
    rows: suggestions.map((suggestion) => ({
      url: suggestion.url,
      source: suggestion.source,
      title: highlightMatches(suggestion.title || suggestion.url, query),
      urlParts: suggestionUrlParts(suggestion.url, query),
    })),
  };
}

/** How tall the dropdown under the header is for `view` (0: none), at most `maxHeight` (whole rows). */
export function miniOmniboxDropdownHeight(
  view: Pick<MiniOmniboxView, "rows" | "keyword">,
  maxHeight: number,
): number {
  const rows = view.rows.length + (view.keyword ? 1 : 0);
  if (rows === 0) return 0;
  const fit = Math.floor(
    (Math.max(0, maxHeight) - MINI_OMNIBOX_PADDING) / MINI_OMNIBOX_ROW_HEIGHT,
  );
  const shown = Math.min(rows, fit);
  return shown > 0 ? shown * MINI_OMNIBOX_ROW_HEIGHT + MINI_OMNIBOX_PADDING : 0;
}

/** How many suggestion rows fit in `maxHeight` px under the header (a keyword row takes one of them). */
export function miniOmniboxLimit(
  model: MiniOmnibox,
  sources: Pick<MiniOmniboxSources, "engines">,
  maxHeight: number,
): number {
  const fit = Math.floor(
    (Math.max(0, maxHeight) - MINI_OMNIBOX_PADDING) / MINI_OMNIBOX_ROW_HEIGHT,
  );
  const keyword = parseKeywordSearch(
    omniboxQuery(model.text, model.preview),
    sources.engines,
  )
    ? 1
    : 0;
  return Math.max(0, Math.min(MINI_OMNIBOX_LIMIT, fit - keyword));
}

/** The active mini tab is a New Tab: the address field shows (and takes the keyboard) by itself. */
export function miniAddressAutoOpens(url: string | null | undefined): boolean {
  return url === SURFFISH_QUICK_LINKS_URL;
}

/**
 * Where + (and ⌘/Ctrl+T in a mini window) puts the New Tab: grouping 'tabs' makes each mini window a
 * collection, so it joins this one's strip; 'stack' and 'separate' are one tab per window, so it opens
 * in a mini window of its own (cascaded off the last one, focused).
 */
export function miniNewTabTarget(
  grouping: MiniWindowGrouping,
): "collection" | "window" {
  return grouping === "tabs" ? "collection" : "window";
}
