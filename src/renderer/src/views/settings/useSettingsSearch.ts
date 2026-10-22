import { useEffect, useState } from "react";
import {
  matchesSettingsQuery,
  parseSettingsQuery,
  settingsHighlightRanges,
  type SettingsSearchTerm,
} from "../../../../shared/settings-search";

/**
 * Filters the settings page on screen to the rows matching `query` and highlights the matched
 * characters. Works on the live DOM (any settings page, whatever component renders it) without
 * touching React-owned attributes: misses get `data-search-miss` (hidden by CSS), disclosures and
 * long hints holding a match open via `data-search-forced` / `data-search-open`, and highlights use
 * the CSS Custom Highlight API (no DOM mutation). Re-applies when the page's content changes
 * (async loads, conditional rows) while a query is active.
 */

const HIGHLIGHT = "settings-search";
const GROUPS =
  ".settings-group, .settings-content > .settings-section, .settings-view > .settings-section";
const MARKS = ["data-search-miss", "data-search-open", "data-search-hit"];

export interface SettingsSearchResult {
  /** Visible matching rows (or whole groups that matched without rows). */
  matches: number;
  /** Matches per General category id. */
  categories: Record<string, number>;
}

const EMPTY: SettingsSearchResult = { matches: 0, categories: {} };

function searchText(element: Element): string {
  // Labels, hints, info text, plus the accessible names of controls (e.g. "Mini window opacity").
  const names = [...element.querySelectorAll("[aria-label]")]
    .map((node) => node.getAttribute("aria-label") ?? "")
    .join(" ");
  return `${element.textContent ?? ""} ${names}`;
}

function clearMarks(root: Element): void {
  for (const mark of MARKS)
    for (const node of root.querySelectorAll(`[${mark}]`))
      node.removeAttribute(mark);
}

function release(details: HTMLDetailsElement): void {
  details.open = details.getAttribute("data-search-forced") === "was-open";
  details.removeAttribute("data-search-forced");
}

function clear(root: Element): void {
  clearMarks(root);
  for (const details of root.querySelectorAll<HTMLDetailsElement>(
    "details[data-search-forced]",
  ))
    release(details);
  CSS.highlights?.delete(HIGHLIGHT);
}

function hide(element: Element, miss: boolean): void {
  element.toggleAttribute("data-search-miss", miss);
}

function highlight(scopes: Element[], terms: SettingsSearchTerm[]): void {
  if (!CSS.highlights || typeof Highlight === "undefined") return;
  const ranges: Range[] = [];
  for (const scope of scopes) {
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement?.closest(
          "select, option, script, style, [data-search-miss]",
        )
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const [start, end] of settingsHighlightRanges(
        node.textContent ?? "",
        terms,
      )) {
        const range = new Range();
        range.setStart(node, start);
        range.setEnd(node, end);
        ranges.push(range);
      }
    }
  }
  CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges));
}

/** Applies the query to `root` and returns what is left on screen. */
function apply(root: Element, query: string): SettingsSearchResult {
  const terms = parseSettingsQuery(query);
  if (terms.length === 0) {
    clear(root);
    return EMPTY;
  }
  clearMarks(root);
  const result: SettingsSearchResult = { matches: 0, categories: {} };
  const hitScopes: Element[] = [];
  for (const group of root.querySelectorAll(GROUPS)) {
    if (group.parentElement?.closest(GROUPS)) continue;
    const title = group.querySelector(
      ":scope > .settings-group-header, :scope > .settings-section-heading, :scope > header",
    );
    const titleHit = Boolean(
      title && matchesSettingsQuery(searchText(title), terms),
    );
    const rows = [...group.querySelectorAll(".settings-row")];
    let count = 0;
    if (titleHit) {
      count = Math.max(1, rows.length);
      hitScopes.push(group);
    } else if (rows.length > 0) {
      for (const row of rows) {
        const hit = matchesSettingsQuery(searchText(row), terms);
        hide(row, !hit);
        if (!hit) continue;
        count += 1;
        hitScopes.push(row);
        const info = row.querySelector(".settings-row-info");
        if (info && matchesSettingsQuery(info.textContent ?? "", terms))
          row.setAttribute("data-search-open", "");
      }
      // Group-level text (help, lists) that isn't in a row still counts for the whole group.
      if (count === 0 && matchesSettingsQuery(searchText(group), terms)) {
        for (const row of rows) hide(row, false);
        count = 1;
        hitScopes.push(group);
      }
    } else if (matchesSettingsQuery(searchText(group), terms)) {
      count = 1;
      hitScopes.push(group);
    }
    hide(group, count === 0);
    for (const details of group.querySelectorAll<HTMLDetailsElement>(
      "details.settings-disclosure",
    )) {
      // Open it when something inside matches: a visible row, or (row-less lists such as keywords) its text.
      const detailRows = [...details.querySelectorAll(".settings-row")];
      const inside =
        count > 0 &&
        !titleHit &&
        (detailRows.length > 0
          ? detailRows.some((row) => !row.hasAttribute("data-search-miss"))
          : matchesSettingsQuery(searchText(details), terms));
      if (inside) {
        if (!details.hasAttribute("data-search-forced"))
          details.setAttribute(
            "data-search-forced",
            details.open ? "was-open" : "was-closed",
          );
        details.open = true;
      } else {
        if (details.hasAttribute("data-search-forced")) release(details);
        // A disclosure with nothing matching inside is noise while searching (unless the whole group matched).
        if (!titleHit) hide(details, true);
      }
    }
    if (count > 0) {
      group.setAttribute("data-search-hit", "");
      const category = group
        .closest("[data-category]")
        ?.getAttribute("data-category");
      if (category)
        result.categories[category] =
          (result.categories[category] ?? 0) + count;
    }
    result.matches += count;
  }
  for (const category of root.querySelectorAll("[data-category]"))
    hide(
      category,
      !result.categories[category.getAttribute("data-category") ?? ""],
    );
  for (const loose of root.querySelectorAll(
    ".settings-footnote, .settings-content > .settings-help",
  ))
    hide(loose, true);
  highlight(hitScopes, terms);
  return result;
}

const sameResult = (
  a: SettingsSearchResult,
  b: SettingsSearchResult,
): boolean =>
  a.matches === b.matches &&
  JSON.stringify(a.categories) === JSON.stringify(b.categories);

export function useSettingsSearch(
  rootRef: React.RefObject<HTMLElement | null>,
  query: string,
  pageKey: string,
): SettingsSearchResult {
  const [result, setResult] = useState<SettingsSearchResult>(EMPTY);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (!query.trim()) {
      clear(root);
      setResult(EMPTY);
      return;
    }
    let frame = 0;
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(run);
    });
    function run(): void {
      frame = 0;
      observer.disconnect();
      const next = apply(root as HTMLElement, query);
      setResult((current) => (sameResult(current, next) ? current : next));
      // Our own attribute marks aren't observed; content changes (async rows, page switch) are.
      observer.observe(root as HTMLElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
    run();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [rootRef, query, pageKey]);
  return result;
}
