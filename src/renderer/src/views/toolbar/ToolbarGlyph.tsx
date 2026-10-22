import type { ToolbarItemId } from "../../../../shared/toolbar-layout";

/** The toolbar buttons' glyphs (same paths as the buttons), for the Surffish menu and Settings. */
export function ToolbarGlyph({ id }: { id: ToolbarItemId }): React.JSX.Element {
  switch (id) {
    case "bookmarks":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4-6.5 4v-16a1 1 0 0 1 1-1Z" />
        </svg>
      );
    case "reading-list":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="6.5" cy="14.5" r="3.5" />
          <circle cx="17.5" cy="14.5" r="3.5" />
          <path d="M10 14.2c1.2-.8 2.8-.8 4 0M3 14l1.6-6.2A2 2 0 0 1 6.5 6.3H7M21 14l-1.6-6.2a2 2 0 0 0-1.9-1.5H17" />
        </svg>
      );
    case "adblock":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3.5 5 6v5.2c0 4.3 2.9 7.9 7 9.3 4.1-1.4 7-5 7-9.3V6z" />
        </svg>
      );
    case "cast":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3.5 17.5a3 3 0 0 1 3 3M3.5 13.8a6.7 6.7 0 0 1 6.7 6.7M3.5 10a10.5 10.5 0 0 1 10.5 10.5" />
          <path d="M3.5 7.5V6a1.5 1.5 0 0 1 1.5-1.5h14A1.5 1.5 0 0 1 20.5 6v12a1.5 1.5 0 0 1-1.5 1.5h-2.5" />
        </svg>
      );
    case "history":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4.5 8.5A8 8 0 1 1 4 12" />
          <path d="M4.5 4.5v4h4M12 7.5v5l3 1.8" />
        </svg>
      );
    case "extensions":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10 4.5a2 2 0 0 1 4 0V6h3.5A1.5 1.5 0 0 1 19 7.5V11h-1.5a2 2 0 0 0 0 4H19v3.5a1.5 1.5 0 0 1-1.5 1.5H14v-1.5a2 2 0 0 0-4 0V20H6.5A1.5 1.5 0 0 1 5 18.5V15h1.5a2 2 0 0 0 0-4H5V7.5A1.5 1.5 0 0 1 6.5 6H10z" />
        </svg>
      );
    case "downloads":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3.5v12" />
          <path d="m7 10.5 5 5 5-5" />
          <path d="M4.5 16v3a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-3" />
        </svg>
      );
  }
}

export function PinGlyph({ pinned }: { pinned: boolean }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={pinned ? "is-pinned" : undefined}
    >
      <path d="M9 4.5h6l-1 5 3 3v1.5H7V12.5l3-3z" />
      <path d="M12 14.5v5" />
    </svg>
  );
}
