import { useEffect, useMemo, useRef, useState } from "react";
import {
  canSaveToReadingList,
  filterReadingList,
  readingListAge,
  readingListHost,
  readingListKey,
  type ReadingListFilter,
  type ReadingListItem,
  type ReadingListSnapshot,
} from "../../../../shared/reading-list";
import "./reading-list.css";

const FILTER_KEY = "surffish.readingList.filter";

function ItemFavicon({ item }: { item: ReadingListItem }): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  const letter = (
    item.title.trim()[0] ??
    readingListHost(item.url)[0] ??
    "↗"
  ).toUpperCase();
  return (
    <span className="bookmark-favicon reading-list-favicon" aria-hidden="true">
      {item.faviconUrl && !failed ? (
        <img
          src={item.faviconUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{letter}</span>
      )}
    </span>
  );
}

/**
 * The Reading List popover: save this page, Unread / All, search, and the list. Click opens the
 * page here (and marks it read), ⌘/Ctrl-click or middle-click in a new tab, ⌥/Alt-click in Reader
 * view (from the saved copy when the page is offline). Row buttons mark read/unread and remove;
 * right-click has the rest.
 */
export function ReadingListPanel({
  snapshot,
  pageUrl,
  pageTitle,
  isPrivate,
  onClose,
}: {
  snapshot: ReadingListSnapshot | null;
  pageUrl: string;
  pageTitle: string;
  isPrivate: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const [filter, setFilter] = useState<ReadingListFilter>(() =>
    localStorage.getItem(FILTER_KEY) === "all" ? "all" : "unread",
  );
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const items = useMemo(() => snapshot?.items ?? [], [snapshot]);
  const visible = useMemo(
    () => filterReadingList(items, filter, query),
    [items, filter, query],
  );
  const pageKey = pageUrl ? readingListKey(pageUrl) : "";
  const saved = pageKey
    ? items.find((item) => readingListKey(item.url) === pageKey)
    : undefined;
  const canSave = canSaveToReadingList({ url: pageUrl, private: isPrivate });
  const readCount = items.length - (snapshot?.unread ?? 0);
  const isMac = window.api.platform === "darwin";

  useEffect(() => {
    localStorage.setItem(FILTER_KEY, filter);
  }, [filter]);
  useEffect(() => {
    requestAnimationFrame(() =>
      searchRef.current?.focus({ preventScroll: true }),
    );
  }, []);

  async function run<T extends { ok: boolean; error?: string }>(
    task: Promise<T>,
  ): Promise<T | null> {
    setError("");
    try {
      const result = await task;
      if (!result.ok) setError(result.error ?? "Something went wrong.");
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    }
  }

  async function saveCurrent(): Promise<void> {
    setBusy(true);
    await run(window.api.browser.readingList.addTab());
    setBusy(false);
  }

  function open(
    item: ReadingListItem,
    event: React.MouseEvent | React.KeyboardEvent,
  ): void {
    const newTab =
      event.metaKey ||
      event.ctrlKey ||
      ("button" in event && event.button === 1);
    void run(
      window.api.browser.readingList.open(item.id, {
        target: newTab ? "new-tab" : "current",
        reader: event.altKey,
      }),
    );
    if (!newTab) onClose();
  }

  const saveLabel = !canSave
    ? isPrivate
      ? "Not available in private tabs"
      : "Open a web page to save it"
    : saved
      ? saved.readAt === null
        ? "Saved · move to top"
        : "Saved · mark unread"
      : "Add This Page";

  return (
    <div
      id="reading-list-popover"
      className="reading-list-popover"
      role="dialog"
      aria-label="Reading List"
    >
      <div className="reading-list-header">
        <strong>Reading List</strong>
        <div className="reading-list-filter" role="tablist" aria-label="Show">
          <button
            type="button"
            role="tab"
            aria-selected={filter === "unread"}
            className={filter === "unread" ? "is-current" : ""}
            onClick={() => setFilter("unread")}
          >
            Unread
            {snapshot && snapshot.unread > 0 ? (
              <span className="reading-list-count">{snapshot.unread}</span>
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === "all"}
            className={filter === "all" ? "is-current" : ""}
            onClick={() => setFilter("all")}
          >
            All
          </button>
        </div>
      </div>
      <button
        type="button"
        className="reading-list-add"
        disabled={!canSave || busy}
        title={
          canSave
            ? `${pageTitle || pageUrl}\n${isMac ? "⇧⌘L" : "Ctrl+Shift+L"} saves the current page from anywhere`
            : saveLabel
        }
        onClick={() => void saveCurrent()}
      >
        <span aria-hidden="true">{saved ? "✓" : "+"}</span>
        <span className="reading-list-add-label">{saveLabel}</span>
        {canSave && !saved && <kbd>{isMac ? "⇧⌘L" : "Ctrl+Shift+L"}</kbd>}
      </button>
      <label className="reading-list-search">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6" />
          <path d="m16 16 4 4" />
        </svg>
        <input
          ref={searchRef}
          type="search"
          placeholder="Search Reading List"
          aria-label="Search Reading List"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && visible[0]) open(visible[0], event);
            else if (event.key === "ArrowDown") {
              event.preventDefault();
              event.currentTarget
                .closest(".reading-list-popover")
                ?.querySelector<HTMLElement>(".reading-list-item-open")
                ?.focus();
            }
          }}
        />
      </label>
      {error && (
        <p className="reading-list-error" role="alert">
          {error}
        </p>
      )}
      <div className="reading-list-scroll" role="list">
        {!snapshot && <p className="reading-list-empty">Loading…</p>}
        {snapshot && visible.length === 0 && (
          <p className="reading-list-empty">
            {query
              ? "No matches."
              : filter === "unread" && items.length > 0
                ? "All caught up. Nothing unread."
                : "Nothing saved yet. Save pages to read later: here, with the shortcut, or right-click a link → Add Link to Reading List."}
          </p>
        )}
        {visible.map((item) => {
          const unread = item.readAt === null;
          return (
            <div
              key={item.id}
              role="listitem"
              className={`reading-list-item${unread ? " is-unread" : ""}`}
              data-reading-id={item.id}
            >
              <button
                type="button"
                className="reading-list-item-open"
                title={`${item.title || item.url}\n${item.url}${item.excerpt ? `\n\n${item.excerpt}` : ""}\n\nClick: open · ${isMac ? "⌘" : "Ctrl"}-click: new tab · ${isMac ? "⌥" : "Alt"}-click: Reader view`}
                onClick={(event) => open(item, event)}
                onMouseDown={(event) => {
                  if (event.button === 1) event.preventDefault();
                }}
                onAuxClick={(event) => {
                  if (event.button === 1) {
                    event.preventDefault();
                    open(item, event);
                  }
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  void window.api.browser.readingList.contextMenu(item.id);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowDown" && event.key !== "ArrowUp")
                    return;
                  event.preventDefault();
                  const rows = Array.from(
                    event.currentTarget
                      .closest(".reading-list-scroll")
                      ?.querySelectorAll<HTMLElement>(
                        ".reading-list-item-open",
                      ) ?? [],
                  );
                  const at = rows.indexOf(event.currentTarget);
                  if (event.key === "ArrowUp" && at === 0)
                    searchRef.current?.focus();
                  else
                    rows[
                      Math.min(
                        rows.length - 1,
                        Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)),
                      )
                    ]?.focus();
                }}
              >
                <span className="reading-list-dot" aria-hidden="true" />
                <ItemFavicon item={item} />
                <span className="reading-list-text">
                  <span className="reading-list-title">
                    {item.title || readingListHost(item.url)}
                  </span>
                  <span className="reading-list-meta">
                    {item.siteName || readingListHost(item.url)} ·{" "}
                    {readingListAge(item.addedAt)}
                    {item.hasSnapshot && (
                      <span
                        className="reading-list-offline"
                        title="Saved for offline reading"
                      >
                        {" "}
                        · offline
                      </span>
                    )}
                  </span>
                  {item.excerpt && (
                    <span className="reading-list-excerpt">{item.excerpt}</span>
                  )}
                </span>
              </button>
              <div className="reading-list-item-actions">
                <button
                  type="button"
                  aria-label={unread ? "Mark as read" : "Mark as unread"}
                  title={unread ? "Mark as read" : "Mark as unread"}
                  onClick={() =>
                    void run(
                      window.api.browser.readingList.setRead(item.id, unread),
                    )
                  }
                >
                  {unread ? (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="m5 12.5 4.5 4.5L19 7.5" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="12" cy="12" r="4" />
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  aria-label="Remove"
                  title="Remove from Reading List"
                  onClick={() =>
                    void run(window.api.browser.readingList.remove(item.id))
                  }
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m7 7 10 10M17 7 7 17" />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {readCount > 0 && filter === "all" && (
        <div className="reading-list-footer">
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  `Remove ${readCount} read item${readCount === 1 ? "" : "s"} from your Reading List?`,
                )
              )
                void run(window.api.browser.readingList.clearRead());
            }}
          >
            Clear read items ({readCount})
          </button>
        </div>
      )}
    </div>
  );
}
