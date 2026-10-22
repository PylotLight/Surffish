import { useEffect, useRef, useState } from "react";
import { formatAccelerator } from "../../../../shared/command-palette";
import {
  SPACE_COLOR_VALUES,
  type SpacesSnapshot,
} from "../../../../shared/spaces";
import "./spaces.css";

/** Live Spaces snapshot for this window (null until the first answer). */
export function useSpaces(): SpacesSnapshot | null {
  const [snapshot, setSnapshot] = useState<SpacesSnapshot | null>(null);
  useEffect(() => {
    let cancelled = false;
    const unsubscribe = window.api.browser.spaces.onChange(setSnapshot);
    void window.api.browser.spaces
      .get()
      .then((next) => {
        if (!cancelled) setSnapshot(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return snapshot;
}

function shortcutLabel(index: number): string | null {
  if (index >= 9) return null;
  const platform = window.api.platform;
  return formatAccelerator(
    platform === "darwin" ? `Ctrl+${index + 1}` : `Ctrl+Shift+${index + 1}`,
    platform,
  );
}

/**
 * Space switcher at the bottom of the sidebar (only while Spaces are on): one button per Space
 * (emoji or colour dot), the current one labelled; + adds one. Right-click a Space for its menu
 * (rename, icon, colour, separate logins, proxy, reorder, delete). Renaming is inline.
 */
export function SpacesSwitcher({
  snapshot,
}: {
  snapshot: SpacesSnapshot;
}): React.JSX.Element | null {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(
    () =>
      window.api.browser.spaces.onRenameRequest((id) => {
        const space = snapshot.spaces.find((candidate) => candidate.id === id);
        if (!space) return;
        setDraft(space.name);
        setRenaming(id);
      }),
    [snapshot.spaces],
  );

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  if (!snapshot.enabled) return null;
  const active =
    snapshot.spaces.find((space) => space.id === snapshot.activeSpaceId) ??
    snapshot.spaces[0];

  function commitRename(): void {
    const id = renaming;
    setRenaming(null);
    if (id && draft.trim())
      void window.api.browser.spaces
        .update(id, { name: draft })
        .catch(() => undefined);
  }

  return (
    <nav
      className="spaces-switcher"
      aria-label="Spaces"
      style={
        {
          "--space-color": SPACE_COLOR_VALUES[active?.color ?? "blue"],
        } as React.CSSProperties
      }
    >
      {renaming ? (
        <input
          ref={inputRef}
          className="spaces-rename"
          value={draft}
          maxLength={32}
          aria-label="Space name"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitRename();
            else if (event.key === "Escape") setRenaming(null);
          }}
        />
      ) : (
        <span
          className="spaces-current"
          title={
            active
              ? `${active.name}${active.partitioned ? " · separate logins" : ""}`
              : undefined
          }
          onDoubleClick={() => {
            if (active) {
              setDraft(active.name);
              setRenaming(active.id);
            }
          }}
        >
          {active?.name ?? "Default"}
        </span>
      )}
      <div className="spaces-list" role="tablist" aria-label="Switch Space">
        {snapshot.spaces.map((space, index) => {
          const current = space.id === snapshot.activeSpaceId;
          const count = snapshot.tabCounts[space.id] ?? 0;
          const shortcut = shortcutLabel(index);
          return (
            <button
              key={space.id}
              type="button"
              role="tab"
              className={`spaces-button${current ? " is-current" : ""}`}
              aria-selected={current}
              aria-label={`${space.name} Space`}
              data-space-id={space.id}
              title={`${space.name} · ${count} tab${count === 1 ? "" : "s"}${space.partitioned ? " · separate logins" : ""}${shortcut ? ` (${shortcut})` : ""}`}
              style={
                {
                  "--space-color": SPACE_COLOR_VALUES[space.color],
                } as React.CSSProperties
              }
              onClick={() => void window.api.browser.spaces.switch(space.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                void window.api.browser.spaces.showMenu(space.id);
              }}
            >
              {space.icon ? (
                <span className="spaces-icon" aria-hidden="true">
                  {space.icon}
                </span>
              ) : (
                <span className="spaces-dot" aria-hidden="true" />
              )}
            </button>
          );
        })}
        <button
          className="spaces-button spaces-add"
          type="button"
          aria-label="New Space"
          title="New Space"
          onClick={() => void window.api.browser.spaces.create()}
        >
          +
        </button>
      </div>
    </nav>
  );
}
