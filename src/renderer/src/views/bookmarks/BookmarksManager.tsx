import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { BookmarkNode } from "../../../../shared/types";
import {
  BOOKMARKS_ROOT_ID,
  bookmarkFolderPath,
  FAVOURITES_FOLDER_ID,
  isFixedBookmarkFolder,
  searchBookmarkNodes,
} from "../../../../shared/bookmarks";
import {
  BookmarkFavicon,
  BookmarkFolderSelect,
  BookmarkInlineEditor,
  FolderGlyph,
  ipcErrorMessage,
} from "./BookmarkParts";
import { BookmarkImportPanel } from "./BookmarkImportPanel";
import { BOOKMARK_IMPORT_REQUEST_KEY } from "./BookmarksMenu";
import { useStoredState } from "../../lib/stored-state";
import {
  bookmarkHost,
  bookmarksBelow,
  childrenOf,
  confirmDelete,
  openBookmarkUrl,
  openBookmarksInTabs,
  type BookmarksState,
} from "./useBookmarks";
import {
  BOOKMARK_DRAG_TYPE,
  dropPlacement,
  dropTargetFor,
  type DropPlacement,
} from "./bookmark-drag";

const LIST_LIMIT = 2000;

function formatAdded(ms: number): string {
  if (!ms) return "";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(ms));
}

function shortUrl(url: string | undefined): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./i, "")}${parsed.pathname === "/" ? "" : parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

/** Full-page bookmark manager (⌥⌘B): folders, search, multi-select move/delete, import, export. */
export function BookmarksManager({
  bookmarks,
  cachedIcons,
  onClose,
  onOpened,
}: {
  bookmarks: BookmarksState;
  cachedIcons: Record<string, string>;
  onClose: () => void;
  onOpened: () => void;
}): React.JSX.Element {
  const { index, nodes } = bookmarks;
  const [folderId, setFolderId] = useState<string>(FAVOURITES_FOLDER_ID);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [moveTarget, setMoveTarget] = useState<string>(FAVOURITES_FOLDER_ID);
  const [importOpen, setImportOpen] = useState(false);
  // The toolbar's Bookmarks → Import… opens the manager with the import panel showing.
  const [importRequest] = useStoredState<number>(
    BOOKMARK_IMPORT_REQUEST_KEY,
    0,
  );
  useEffect(() => {
    if (importRequest && Date.now() - importRequest < 10_000)
      setImportOpen(true);
  }, [importRequest]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [dragIds, setDragIds] = useState<string[] | null>(null);
  const [drop, setDrop] = useState<{
    id: string;
    placement: DropPlacement;
  } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  // The open folder may disappear (deleted elsewhere): fall back to Favourites.
  useEffect(() => {
    if (
      folderId !== BOOKMARKS_ROOT_ID &&
      bookmarks.loaded &&
      !index.byId.has(folderId)
    )
      setFolderId(FAVOURITES_FOLDER_ID);
  }, [index, folderId, bookmarks.loaded]);

  const searching = query.trim().length > 0;
  const items = useMemo(
    () =>
      searching
        ? searchBookmarkNodes(nodes, query, LIST_LIMIT)
        : childrenOf(index, folderId).slice(0, LIST_LIMIT),
    [searching, nodes, query, index, folderId],
  );
  const visibleSelection = items.filter((node) => selected.has(node.id));
  const selectedIds = [...selected].filter((id) => index.byId.has(id));
  const folderPath = bookmarkFolderPath(index, folderId);

  useEffect(() => {
    setSelected(new Set());
    setAnchorId(null);
    setEditingId(null);
    setCreatingFolder(false);
  }, [folderId, searching]);

  async function run(
    action: () => Promise<unknown>,
    done?: string,
  ): Promise<void> {
    setError("");
    try {
      await action();
      if (done) setStatus(done);
    } catch (caught) {
      setError(ipcErrorMessage(caught));
    }
  }

  function selectRow(node: BookmarkNode, event: ReactMouseEvent): void {
    const next = new Set(selected);
    if (event.shiftKey && anchorId) {
      const from = items.findIndex((item) => item.id === anchorId);
      const to = items.findIndex((item) => item.id === node.id);
      if (from >= 0 && to >= 0) {
        if (!(event.metaKey || event.ctrlKey)) next.clear();
        for (
          let position = Math.min(from, to);
          position <= Math.max(from, to);
          position++
        )
          next.add(items[position]!.id);
        setSelected(next);
        return;
      }
    }
    if (event.metaKey || event.ctrlKey) {
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
    } else {
      next.clear();
      next.add(node.id);
    }
    setSelected(next);
    setAnchorId(node.id);
  }

  function toggleChecked(node: BookmarkNode): void {
    const next = new Set(selected);
    if (next.has(node.id)) next.delete(node.id);
    else next.add(node.id);
    setSelected(next);
    setAnchorId(node.id);
  }

  function activate(node: BookmarkNode, newTab = false): void {
    if (node.type === "folder") {
      setQuery("");
      setFolderId(node.id);
      return;
    }
    if (!node.url) return;
    void openBookmarkUrl(node.url, newTab ? "new-tab" : "current");
    if (!newTab) onOpened();
  }

  async function deleteIds(ids: string[]): Promise<void> {
    const deletable = ids.filter((id) => !isFixedBookmarkFolder(id));
    if (deletable.length === 0 || !confirmDelete(index, deletable)) return;
    await run(async () => {
      const removed = await window.api.browser.bookmarks.remove(deletable);
      setSelected(new Set());
      setStatus(`Deleted ${removed} item${removed === 1 ? "" : "s"}.`);
    });
  }

  async function moveIds(
    ids: string[],
    parentId: string,
    slot?: number,
  ): Promise<void> {
    await run(async () => {
      const moved = await window.api.browser.bookmarks.move(
        ids,
        parentId,
        slot,
      );
      const title = index.byId.get(parentId)?.title ?? "Bookmarks";
      if (moved > 0 && parentId !== folderId)
        setStatus(
          `Moved ${moved} item${moved === 1 ? "" : "s"} to “${title}”.`,
        );
    });
  }

  async function showMenu(node: BookmarkNode): Promise<void> {
    const action = await window.api.browser.bookmarks.contextMenu({
      type: node.type,
      fixed: isFixedBookmarkFolder(node.id),
      childCount:
        node.type === "folder" ? bookmarksBelow(index, node.id).length : 0,
    });
    if (!action) return;
    if (action === "open") activate(node);
    else if (action === "open-new-tab" && node.url)
      void openBookmarkUrl(node.url, "new-tab");
    else if (action === "open-private" && node.url)
      void openBookmarkUrl(node.url, "private");
    else if (action === "open-all")
      void openBookmarksInTabs(bookmarksBelow(index, node.id));
    else if (action === "edit") setEditingId(node.id);
    else if (action === "new-folder") {
      if (node.type === "folder") setFolderId(node.id);
      setCreatingFolder(true);
    } else if (action === "delete") void deleteIds([node.id]);
  }

  function dragStart(event: DragEvent<HTMLElement>, node: BookmarkNode): void {
    const ids = selected.has(node.id)
      ? items.filter((item) => selected.has(item.id)).map((item) => item.id)
      : [node.id];
    event.dataTransfer.setData(BOOKMARK_DRAG_TYPE, JSON.stringify(ids));
    if (node.url) event.dataTransfer.setData("text/uri-list", node.url);
    event.dataTransfer.effectAllowed = "move";
    setDragIds(ids);
  }

  function dragOverRow(
    event: DragEvent<HTMLElement>,
    node: BookmarkNode,
    folderOnly = false,
  ): void {
    if (!dragIds) return;
    let placement = dropPlacement(event, node, index, dragIds);
    if (folderOnly)
      placement = placement && node.type === "folder" ? "inside" : null;
    if (searching && placement !== "inside") placement = null;
    if (!placement) {
      if (drop?.id === node.id) setDrop(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (drop?.id !== node.id || drop.placement !== placement)
      setDrop({ id: node.id, placement });
  }

  function dropOnRow(event: DragEvent<HTMLElement>, node: BookmarkNode): void {
    event.preventDefault();
    const ids = dragIds;
    const placement = drop?.id === node.id ? drop.placement : null;
    setDrop(null);
    setDragIds(null);
    if (!ids || !placement) return;
    const target = dropTargetFor(node, placement);
    void moveIds(ids, target.parentId, target.index);
  }

  function renderFolderTree(
    parentId: string,
    depth: number,
  ): React.JSX.Element[] {
    return childrenOf(index, parentId)
      .filter((node) => node.type === "folder")
      .flatMap((node) => {
        const hasSubfolders = childrenOf(index, node.id).some(
          (child) => child.type === "folder",
        );
        const isCollapsed = collapsed.has(node.id);
        const dropClass = drop?.id === node.id ? " is-drop-inside" : "";
        const row = (
          <div
            key={node.id}
            className={`bookmarks-folder-row${folderId === node.id && !searching ? " is-current" : ""}${dropClass}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            role="treeitem"
            aria-selected={folderId === node.id}
            aria-expanded={hasSubfolders ? !isCollapsed : undefined}
            tabIndex={0}
            onClick={() => {
              setQuery("");
              setFolderId(node.id);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                setQuery("");
                setFolderId(node.id);
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              void showMenu(node);
            }}
            onDragOver={(event) => dragOverRow(event, node, true)}
            onDragLeave={() => {
              if (drop?.id === node.id) setDrop(null);
            }}
            onDrop={(event) => dropOnRow(event, node)}
          >
            <button
              type="button"
              className={`bookmark-chevron${hasSubfolders ? "" : " is-hidden"}${isCollapsed ? "" : " is-open"}`}
              aria-label={
                isCollapsed ? `Expand ${node.title}` : `Collapse ${node.title}`
              }
              tabIndex={-1}
              onClick={(event) => {
                event.stopPropagation();
                const next = new Set(collapsed);
                if (isCollapsed) next.delete(node.id);
                else next.add(node.id);
                setCollapsed(next);
              }}
            >
              ›
            </button>
            <FolderGlyph open={folderId === node.id} />
            <span className="bookmark-row-title">{node.title}</span>
          </div>
        );
        return [
          row,
          ...(isCollapsed ? [] : renderFolderTree(node.id, depth + 1)),
        ];
      });
  }

  const allVisibleSelected =
    items.length > 0 && visibleSelection.length === items.length;
  const currentFolder = index.byId.get(folderId);

  return (
    <section
      className="bookmarks-manager"
      aria-label="Bookmark manager"
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        const typing =
          target.tagName === "INPUT" ||
          target.tagName === "SELECT" ||
          target.tagName === "TEXTAREA";
        if (event.key === "Escape" && selected.size > 0 && !typing) {
          event.preventDefault();
          setSelected(new Set());
        } else if (
          (event.key === "Delete" || event.key === "Backspace") &&
          !typing &&
          selectedIds.length > 0
        ) {
          event.preventDefault();
          void deleteIds(selectedIds);
        } else if (
          event.key.toLowerCase() === "a" &&
          (event.metaKey || event.ctrlKey) &&
          !typing
        ) {
          event.preventDefault();
          setSelected(new Set(items.map((item) => item.id)));
        } else if (
          event.key.toLowerCase() === "f" &&
          (event.metaKey || event.ctrlKey)
        ) {
          event.preventDefault();
          searchRef.current?.focus();
        }
      }}
    >
      <header className="bookmarks-manager-header">
        <div>
          <h1>Bookmarks</h1>
          <p>
            {nodes
              .filter((node) => node.type === "bookmark")
              .length.toLocaleString()}{" "}
            bookmarks ·{" "}
            {window.api.platform === "darwin" ? "⌥⌘B" : "Ctrl+Alt+B"}
          </p>
        </div>
        <label className="bookmarks-manager-search">
          <span aria-hidden="true">⌕</span>
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder="Search bookmarks"
            aria-label="Search bookmarks"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="bookmarks-manager-actions">
          <button
            type="button"
            className="settings-action secondary"
            onClick={() => {
              setQuery("");
              setCreatingFolder(true);
            }}
          >
            New folder
          </button>
          <button
            type="button"
            className={`settings-action secondary${importOpen ? " is-current" : ""}`}
            aria-expanded={importOpen}
            onClick={() => setImportOpen((open) => !open)}
          >
            Import…
          </button>
          <button
            type="button"
            className="settings-action secondary"
            onClick={() =>
              void run(async () => {
                const path = await window.api.browser.bookmarks.exportHtml();
                if (path) setStatus(`Exported to ${path}`);
              })
            }
          >
            Export
          </button>
          <button
            type="button"
            className="settings-action secondary"
            onClick={onClose}
            title="Close (Esc)"
          >
            Close
          </button>
        </div>
      </header>
      {importOpen && (
        <div className="bookmarks-manager-import">
          <BookmarkImportPanel compact />
        </div>
      )}
      {(status || error) && (
        <p
          className={`settings-message${error ? " is-error" : ""}`}
          role="status"
        >
          {error || status}
        </p>
      )}
      <div className="bookmarks-manager-body">
        <nav
          className="bookmarks-manager-folders"
          role="tree"
          aria-label="Folders"
        >
          {renderFolderTree(BOOKMARKS_ROOT_ID, 0)}
          <div
            className={`bookmarks-folder-row${folderId === BOOKMARKS_ROOT_ID && !searching ? " is-current" : ""}`}
            role="treeitem"
            aria-selected={folderId === BOOKMARKS_ROOT_ID}
            tabIndex={0}
            onClick={() => {
              setQuery("");
              setFolderId(BOOKMARKS_ROOT_ID);
            }}
            onDragOver={(event) => {
              if (dragIds) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              const ids = dragIds;
              setDragIds(null);
              setDrop(null);
              if (ids) void moveIds(ids, BOOKMARKS_ROOT_ID);
            }}
          >
            <span className="bookmark-chevron is-hidden" aria-hidden="true">
              ›
            </span>
            <FolderGlyph />
            <span className="bookmark-row-title">Top level</span>
          </div>
        </nav>
        <div className="bookmarks-manager-list-pane">
          <div className="bookmarks-manager-list-header">
            <input
              type="checkbox"
              aria-label="Select all"
              checked={allVisibleSelected}
              disabled={items.length === 0}
              onChange={() =>
                setSelected(
                  allVisibleSelected
                    ? new Set()
                    : new Set(items.map((item) => item.id)),
                )
              }
            />
            {selectedIds.length > 0 ? (
              <div
                className="bookmarks-selection-bar"
                role="toolbar"
                aria-label="Selected bookmarks"
              >
                <strong>{selectedIds.length} selected</strong>
                <BookmarkFolderSelect
                  index={index}
                  value={moveTarget}
                  onChange={setMoveTarget}
                  includeRoot
                  label="Move selected to folder"
                />
                <button
                  type="button"
                  className="settings-action secondary"
                  onClick={() => void moveIds(selectedIds, moveTarget)}
                >
                  Move
                </button>
                <button
                  type="button"
                  className="settings-action secondary"
                  disabled={!selectedIds.some((id) => index.byId.get(id)?.url)}
                  onClick={() =>
                    void openBookmarksInTabs(
                      selectedIds
                        .map((id) => index.byId.get(id)!)
                        .filter((node) => node.url),
                    )
                  }
                >
                  Open in tabs
                </button>
                <button
                  type="button"
                  className="settings-action secondary is-danger"
                  onClick={() => void deleteIds(selectedIds)}
                >
                  Delete
                </button>
              </div>
            ) : (
              <strong className="bookmarks-manager-path">
                {searching
                  ? `Results for “${query.trim()}”`
                  : folderId === BOOKMARKS_ROOT_ID
                    ? "Top level"
                    : folderPath.join(" › ")}
              </strong>
            )}
          </div>
          <div
            className="bookmarks-manager-list"
            role="grid"
            aria-label={
              searching
                ? "Search results"
                : `${currentFolder?.title ?? "Bookmarks"} contents`
            }
            aria-multiselectable="true"
          >
            {creatingFolder && !searching && (
              <BookmarkInlineEditor
                initialTitle="New folder"
                showUrl={false}
                submitLabel="Create"
                onCancel={() => setCreatingFolder(false)}
                onSubmit={async (title) => {
                  await window.api.browser.bookmarks.createFolder({
                    parentId: folderId,
                    title,
                  });
                  setCreatingFolder(false);
                }}
              />
            )}
            {items.map((node) => {
              if (editingId === node.id) {
                return (
                  <BookmarkInlineEditor
                    key={node.id}
                    initialTitle={node.title}
                    initialUrl={node.url}
                    showUrl={node.type === "bookmark"}
                    onCancel={() => setEditingId(null)}
                    onSubmit={async (title, url) => {
                      await window.api.browser.bookmarks.update(
                        node.id,
                        node.type === "bookmark" ? { title, url } : { title },
                      );
                      setEditingId(null);
                    }}
                  />
                );
              }
              const isSelected = selected.has(node.id);
              const dropClass =
                drop?.id === node.id ? ` is-drop-${drop.placement}` : "";
              return (
                <div
                  key={node.id}
                  className={`bookmarks-manager-row${node.type === "folder" ? " is-folder" : ""}${isSelected ? " is-selected" : ""}${dragIds?.includes(node.id) ? " is-dragging" : ""}${dropClass}`}
                  role="row"
                  aria-selected={isSelected}
                  tabIndex={0}
                  draggable={!isFixedBookmarkFolder(node.id)}
                  onDragStart={(event) => dragStart(event, node)}
                  onDragEnd={() => {
                    setDragIds(null);
                    setDrop(null);
                  }}
                  onDragOver={(event) => dragOverRow(event, node)}
                  onDragLeave={() => {
                    if (drop?.id === node.id) setDrop(null);
                  }}
                  onDrop={(event) => dropOnRow(event, node)}
                  onClick={(event) => selectRow(node, event)}
                  onDoubleClick={() => activate(node)}
                  onAuxClick={(event) => {
                    if (event.button === 1) {
                      event.preventDefault();
                      activate(node, true);
                    }
                  }}
                  onMouseDown={(event) => {
                    if (event.button === 1) event.preventDefault();
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    void showMenu(node);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      activate(node, event.metaKey || event.ctrlKey);
                    } else if (event.key === "F2") setEditingId(node.id);
                    else if (event.key === " ") {
                      event.preventDefault();
                      toggleChecked(node);
                    }
                  }}
                >
                  <input
                    type="checkbox"
                    aria-label={`Select ${node.title}`}
                    checked={isSelected}
                    onClick={(event) => event.stopPropagation()}
                    onChange={() => toggleChecked(node)}
                  />
                  {node.type === "folder" ? (
                    <FolderGlyph />
                  ) : (
                    <BookmarkFavicon node={node} cachedIcons={cachedIcons} />
                  )}
                  <span className="bookmarks-manager-row-main">
                    <strong>{node.title || bookmarkHost(node.url)}</strong>
                    <small>
                      {node.type === "folder"
                        ? `${childrenOf(index, node.id).length} items`
                        : shortUrl(node.url)}
                      {searching
                        ? ` · ${bookmarkFolderPath(index, node.parentId).join(" › ") || "Top level"}`
                        : ""}
                    </small>
                  </span>
                  <time
                    className="bookmarks-manager-row-date"
                    dateTime={new Date(node.dateAdded).toISOString()}
                  >
                    {formatAdded(node.dateAdded)}
                  </time>
                  <span className="bookmarks-manager-row-actions">
                    {node.type === "bookmark" && (
                      <button
                        type="button"
                        title="Open in new tab"
                        aria-label={`Open ${node.title} in a new tab`}
                        onClick={(event) => {
                          event.stopPropagation();
                          activate(node, true);
                        }}
                      >
                        ↗
                      </button>
                    )}
                    {!isFixedBookmarkFolder(node.id) && (
                      <button
                        type="button"
                        title="Edit (F2)"
                        aria-label={`Edit ${node.title}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setEditingId(node.id);
                        }}
                      >
                        ✎
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
            {items.length === 0 && !creatingFolder && (
              <p className="sidebar-empty">
                {searching
                  ? "No matching bookmarks"
                  : "This folder is empty. Drag bookmarks here, or use Import… to bring bookmarks from another browser."}
              </p>
            )}
            {items.length >= LIST_LIMIT && (
              <p className="sidebar-empty">
                Showing the first {LIST_LIMIT.toLocaleString()}. Search to
                narrow it down.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
