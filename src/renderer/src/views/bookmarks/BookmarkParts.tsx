import { useEffect, useMemo, useState } from "react";
import type { BookmarkNode } from "../../../../shared/types";
import {
  BOOKMARKS_ROOT_ID,
  listBookmarkFolders,
  type BookmarkIndex,
} from "../../../../shared/bookmarks";
import { bookmarkHost, bookmarkOrigin } from "./useBookmarks";

/** Cached site icon (data URL), then the bookmark's own favicon URL, then a letter. */
export function BookmarkFavicon({
  node,
  cachedIcons,
}: {
  node: BookmarkNode;
  cachedIcons?: Record<string, string>;
}): React.JSX.Element {
  const origin = bookmarkOrigin(node.url);
  const cached = origin ? cachedIcons?.[origin] : undefined;
  const sources = useMemo(
    () =>
      [cached, node.faviconUrl].filter((source): source is string =>
        Boolean(source),
      ),
    [cached, node.faviconUrl],
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => setAttempt(0), [sources]);
  const source = sources[attempt];
  const letter = (
    node.title.trim()[0] ??
    bookmarkHost(node.url)[0] ??
    "↗"
  ).toUpperCase();
  return (
    <span className="bookmark-favicon" aria-hidden="true">
      {source ? (
        <img
          src={source}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setAttempt((value) => value + 1)}
        />
      ) : (
        <span>{letter}</span>
      )}
    </span>
  );
}

export function FolderGlyph({
  open = false,
}: {
  open?: boolean;
}): React.JSX.Element {
  return (
    <svg
      className="bookmark-folder-glyph"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      {open ? (
        <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1H8.2a2 2 0 0 0-1.9 1.4L4 18.5M4 18.5l2.4-6.3a1.5 1.5 0 0 1 1.4-1h12.7a1 1 0 0 1 .9 1.4l-2.3 5.3a1.5 1.5 0 0 1-1.4.9H4Z" />
      ) : (
        <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
      )}
    </svg>
  );
}

export function StarGlyph({ filled }: { filled: boolean }): React.JSX.Element {
  return (
    <svg className="bookmark-star-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <path
        className={filled ? "is-filled" : ""}
        d="m12 3.8 2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.7l-5.1 2.7 1-5.6-4.1-4 5.7-.8Z"
      />
    </svg>
  );
}

/** Folder picker with indented options; `exclude` hides a folder (and its subtree) being moved. */
export function BookmarkFolderSelect({
  index,
  value,
  onChange,
  exclude,
  includeRoot = false,
  label = "Folder",
  className = "settings-select",
}: {
  index: BookmarkIndex;
  value: string;
  onChange: (folderId: string) => void;
  exclude?: string;
  /** Offer the top level (outside any folder) as a choice. */
  includeRoot?: boolean;
  label?: string;
  className?: string;
}): React.JSX.Element {
  const folders = useMemo(() => {
    const all = listBookmarkFolders(index);
    if (!exclude) return all;
    const result: typeof all = [];
    let skipDepth: number | null = null;
    for (const folder of all) {
      if (skipDepth !== null && folder.depth > skipDepth) continue;
      skipDepth = null;
      if (folder.id === exclude) {
        skipDepth = folder.depth;
        continue;
      }
      result.push(folder);
    }
    return result;
  }, [index, exclude]);
  return (
    <select
      className={className}
      value={value}
      aria-label={label}
      onChange={(event) => onChange(event.target.value)}
    >
      {includeRoot && <option value={BOOKMARKS_ROOT_ID}>Top level</option>}
      {folders.map((folder) => (
        <option
          key={folder.id}
          value={folder.id}
        >{`${"\u2003".repeat(folder.depth)}${folder.title}`}</option>
      ))}
    </select>
  );
}

/** Small inline form for renaming a folder or editing a bookmark's name and address. */
export function BookmarkInlineEditor({
  initialTitle,
  initialUrl,
  showUrl,
  submitLabel = "Save",
  onSubmit,
  onCancel,
}: {
  initialTitle: string;
  initialUrl?: string;
  showUrl: boolean;
  submitLabel?: string;
  onSubmit: (title: string, url?: string) => Promise<void> | void;
  onCancel: () => void;
}): React.JSX.Element {
  const [title, setTitle] = useState(initialTitle);
  const [url, setUrl] = useState(initialUrl ?? "");
  const [error, setError] = useState("");
  async function submit(): Promise<void> {
    try {
      await onSubmit(title, showUrl ? url : undefined);
    } catch (caught) {
      setError(ipcErrorMessage(caught));
    }
  }
  return (
    <form
      className="bookmark-inline-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <input
        autoFocus
        type="text"
        value={title}
        placeholder="Name"
        aria-label="Name"
        spellCheck={false}
        onChange={(event) => setTitle(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
      />
      {showUrl && (
        <input
          type="text"
          value={url}
          placeholder="https://"
          aria-label="Address"
          spellCheck={false}
          autoCapitalize="none"
          onChange={(event) => setUrl(event.target.value)}
        />
      )}
      {error && (
        <p className="bookmark-inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="bookmark-inline-actions">
        <button
          type="button"
          className="settings-action secondary"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button type="submit" className="settings-action primary">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

export function ipcErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    "",
  );
}
