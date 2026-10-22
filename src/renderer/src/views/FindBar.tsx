import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { BrowserFindState } from "../../../shared/types";

const CLOSED: BrowserFindState = { open: false, text: "", result: null };

/**
 * Find in page. Lives in the toolbar overlay (the surface above live pages); main owns the query
 * and runs findInPage, so Cmd+G / Cmd+Shift+G work wherever focus is.
 */
export function FindBar({
  onOpenChange,
}: {
  onOpenChange?: (open: boolean) => void;
}): React.JSX.Element | null {
  const [state, setState] = useState<BrowserFindState>(CLOSED);
  const [text, setText] = useState("");
  const [focusRequest, setFocusRequest] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    const apply = (next: BrowserFindState): void => {
      // Reopening shows the last query (selected, so typing replaces it).
      if (next.open && !wasOpenRef.current) setText(next.text);
      wasOpenRef.current = next.open;
      setState(next);
    };
    const unsubscribe = window.api.browser.find.onChange(apply);
    const unsubscribeFocus = window.api.browser.find.onFocus(() =>
      setFocusRequest((count) => count + 1),
    );
    void window.api.browser.find
      .get()
      .then(apply)
      .catch(() => undefined);
    return () => {
      unsubscribe();
      unsubscribeFocus();
    };
  }, []);

  useEffect(() => {
    onOpenChange?.(state.open);
  }, [state.open, onOpenChange]);

  useEffect(() => {
    if (!state.open || focusRequest === 0) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [focusRequest, state.open]);

  if (!state.open) return null;

  const result = state.result;
  const noMatches = Boolean(
    text && result && result.finalUpdate && result.matches === 0,
  );
  const count =
    !text || !result
      ? ""
      : result.matches === 0
        ? result.finalUpdate
          ? "0 of 0"
          : ""
        : `${result.activeMatchOrdinal} of ${result.matches}`;

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      void window.api.browser.find.close();
    } else if (event.key === "Enter") {
      event.preventDefault();
      void window.api.browser.find.step(!event.shiftKey);
    }
  }

  return (
    <div
      id="find-bar"
      className={`find-bar${noMatches ? " has-no-matches" : ""}`}
      role="search"
      aria-label="Find in page"
    >
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          void window.api.browser.find.query(event.target.value);
        }}
        onKeyDown={handleKeyDown}
        aria-label="Find in page"
        placeholder="Find in page"
        autoComplete="off"
        spellCheck={false}
      />
      <span className="find-bar-count" aria-live="polite">
        {count}
      </span>
      <span className="find-bar-divider" aria-hidden="true" />
      <button
        type="button"
        className="find-bar-button"
        aria-label="Previous match"
        title="Previous match (⇧↩ / Ctrl/⌘+Shift+G)"
        disabled={!text}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => void window.api.browser.find.step(false)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6.5 14.5 5.5-5.5 5.5 5.5" />
        </svg>
      </button>
      <button
        type="button"
        className="find-bar-button"
        aria-label="Next match"
        title="Next match (↩ / Ctrl/⌘+G)"
        disabled={!text}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => void window.api.browser.find.step(true)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
        </svg>
      </button>
      <button
        type="button"
        className="find-bar-button"
        aria-label="Close find bar"
        title="Close (Esc)"
        onClick={() => void window.api.browser.find.close()}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m7 7 10 10M17 7 7 17" />
        </svg>
      </button>
    </div>
  );
}
