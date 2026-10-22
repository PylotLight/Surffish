/**
 * Address bar "arrow to fill" (Chrome/Firefox style) and the suggestion row's URL formatting.
 *
 * Arrowing onto a suggestion puts its full URL in the input, caret at the end and nothing
 * selected, so the user can edit it into a similar address. The dropdown keeps matching what the
 * user actually typed while they arrow (the list doesn't reshuffle under them); typing again edits
 * the filled text and that becomes the new query. Esc puts back what they typed; a second Esc
 * reverts to the page URL as before. Hovering a row never touches the input.
 */

/** A previewed suggestion: what the user typed before arrowing, and which row is filled in. */
export interface OmniboxPreview {
  typed: string;
  index: number;
}

export type OmniboxDirection = "down" | "up";

/**
 * Next row while arrowing. -1 is "what the user typed" (the input, or the keyword row when one
 * shows), so Down from the last row and Up from the first come back to the typed text, like Chrome.
 */
export function nextSuggestionIndex(
  index: number,
  count: number,
  direction: OmniboxDirection,
): number {
  if (count <= 0) return -1;
  const current = index >= 0 && index < count ? index : -1;
  if (direction === "down") return current >= count - 1 ? -1 : current + 1;
  return current === -1 ? count - 1 : current - 1;
}

export interface OmniboxArrowResult {
  /** null once back on the typed text. */
  preview: OmniboxPreview | null;
  /** What the input shows now. */
  text: string;
}

/** Arrow (or Tab) from the current state; `address` is what the input shows right now. */
export function arrowSuggestion(
  address: string,
  preview: OmniboxPreview | null,
  suggestions: ReadonlyArray<{ url: string }>,
  direction: OmniboxDirection,
): OmniboxArrowResult {
  const typed = preview ? preview.typed : address;
  const index = nextSuggestionIndex(
    preview ? preview.index : -1,
    suggestions.length,
    direction,
  );
  const suggestion = index >= 0 ? suggestions[index] : undefined;
  if (!suggestion) return { preview: null, text: typed };
  return { preview: { typed, index }, text: suggestion.url };
}

/** What the dropdown matches against: the typed text while previewing, otherwise the input. */
export function omniboxQuery(
  address: string,
  preview: OmniboxPreview | null,
): string {
  return preview ? preview.typed : address;
}

/**
 * Esc: with a suggestion filled in, put back what the user typed and keep the dropdown open;
 * otherwise 'revert' (the existing behaviour: close, show the page URL, select it).
 */
export function escapeOmnibox(
  preview: OmniboxPreview | null,
): { kind: "restore"; text: string } | { kind: "revert" } {
  return preview
    ? { kind: "restore", text: preview.typed }
    : { kind: "revert" };
}

/** The keyword row's text ("yt cats" / "cats !yt"): what Enter does, and the chip naming the keyword. Both omniboxes (toolbar, mini window) show it. */
export function keywordSuggestionText(match: {
  engine: { name: string; keyword: string };
  query: string;
  via: "keyword" | "bang";
}): { label: string; chip: string } {
  return {
    label: match.query
      ? `Search ${match.engine.name} for “${match.query}”`
      : `Open ${match.engine.name}`,
    chip:
      match.via === "bang" ? `!${match.engine.keyword}` : match.engine.keyword,
  };
}

export type UrlPartRole = "scheme" | "www" | "host" | "path";

export interface UrlPart {
  text: string;
  role: UrlPartRole;
  match: boolean;
}

export interface TextPart {
  text: string;
  match: boolean;
}

/** Splits `text` into runs, marking each (case-insensitive) occurrence of `query`. */
export function highlightMatches(text: string, query: string): TextPart[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!text) return [];
  if (!needle) return [{ text, match: false }];
  const haystack = text.toLocaleLowerCase();
  // Lower-casing can change length for a few scripts; only highlight when offsets line up.
  if (haystack.length !== text.length) return [{ text, match: false }];
  const parts: TextPart[] = [];
  let from = 0;
  while (from < text.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    if (at > from) parts.push({ text: text.slice(from, at), match: false });
    parts.push({ text: text.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false });
  return parts;
}

/** Where scheme, "www.", host and the rest end in a URL string, as written (no normalising). */
function urlRoles(url: string): Array<{ end: number; role: UrlPartRole }> {
  const scheme = /^[a-z][a-z0-9+.-]*:(\/\/)?/i.exec(url)?.[0] ?? "";
  if (!scheme.endsWith("//")) return [{ end: url.length, role: "path" }];
  const rest = url.slice(scheme.length);
  const www = /^www\./i.exec(rest)?.[0] ?? "";
  const hostLength = rest.slice(www.length).search(/[/?#]/);
  const hostEnd =
    scheme.length +
    www.length +
    (hostLength < 0 ? rest.length - www.length : hostLength);
  const segments: Array<{ end: number; role: UrlPartRole }> = [
    { end: scheme.length, role: "scheme" },
    { end: scheme.length + www.length, role: "www" },
    { end: hostEnd, role: "host" },
    { end: url.length, role: "path" },
  ];
  // Drop empty segments (no "www.", no path).
  return segments.filter(
    (segment, index) => segment.end > (segments[index - 1]?.end ?? 0),
  );
}

/**
 * A suggestion row's URL, split for display: scheme and "www." dimmed, host strong, path normal,
 * with the typed query highlighted wherever it lands (across part boundaries too).
 */
export function suggestionUrlParts(url: string, query: string): UrlPart[] {
  const roles = urlRoles(url);
  const parts: UrlPart[] = [];
  let offset = 0;
  for (const run of highlightMatches(url, query)) {
    let start = offset;
    const end = offset + run.text.length;
    while (start < end) {
      const segment = roles.find((role) => role.end > start) ?? {
        end,
        role: "path" as const,
      };
      const stop = Math.min(end, segment.end);
      const last = parts[parts.length - 1];
      const text = url.slice(start, stop);
      if (last && last.role === segment.role && last.match === run.match)
        last.text += text;
      else parts.push({ text, role: segment.role, match: run.match });
      start = stop;
    }
    offset = end;
  }
  return parts;
}
