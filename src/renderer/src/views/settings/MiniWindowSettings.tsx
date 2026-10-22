import { useEffect, useState } from "react";
import {
  acceleratorFromKeyEvent,
  formatAccelerator,
  MINI_WINDOW_MIN_OPACITY,
  MINI_WINDOW_PEEK_DELAYS,
  type MiniWindowGrouping,
  type MiniWindowHeaderPlacement,
  type MiniWindowMenuBarIcon,
  type MiniWindowSettings as Settings,
} from "../../../../shared/mini-window";
import {
  SettingsDisclosure,
  SettingsGroup,
  SettingsRow,
  SettingsSegmented,
  SettingsSlider,
} from "./SettingsControls";

const IS_MAC = navigator.platform.toUpperCase().includes("MAC");
const IS_LINUX = navigator.platform.toUpperCase().includes("LINUX");

interface Status {
  shortcut: string;
  registered: boolean;
  error: string | null;
}

/**
 * Settings → General → Mini window: the page the global shortcut opens (empty: pop out the current
 * tab), the shortcut itself (press keys to record, Clear to turn it off), how several mini windows
 * group, where the header shows, the menu bar icon, tuck to screen edge (and peek on hover, with its
 * delay) and opacity. Basics stay visible; "Windows & motion" and "Edge tuck & peek" are disclosures
 * whose summary line shows the current values.
 */

/** One-line hints (shown) and the full explanation (behind the row's ⓘ, still searchable). */
const GROUPING_HINTS: Record<MiniWindowGrouping, [string, string]> = {
  tabs: [
    "Pop-outs join the last used mini window as tabs.",
    "One edge tab each. Drag a tab out of the strip to give it its own window; drop a window's header on another, or tuck it to an edge that already has one, to merge them.",
  ],
  stack: [
    "Each tab gets its own window; tucked windows stack on the edge.",
    "Windows tucked to the same screen edge share one edge tab and slide out together, stacked along the edge.",
  ],
  separate: [
    "Each tab gets its own window and its own edge tab.",
    "Nothing is shared: every mini window tucks, peeks and slides on its own.",
  ],
};
const HEADER_HINTS: Record<MiniWindowHeaderPlacement, [string, string]> = {
  float: [
    "Shows just above the window, never over the page.",
    "The header and tab strip show just above the mini window (below it when there is no room above), so they never cover the page.",
  ],
  push: [
    "Shows inside the window and moves the page down.",
    "The header and tab strip show inside the mini window and move the page down while they are visible.",
  ],
  overlay: [
    "Slides over the top of the page.",
    "The header and tab strip slide over the top of the page while the pointer is near them.",
  ],
};

const MENU_BAR_NAME = IS_MAC ? "menu bar" : "system tray";
const MENU_BAR_HINTS: Record<MiniWindowMenuBarIcon, [string, string]> = {
  "in-use": [
    "Shows while a mini window lives there.",
    `Send a mini window to the ${MENU_BAR_NAME} (its header's button, ⌘K, or a tab's right-click menu) and an icon there drops it in under the icon. The icon shows only while one lives there.`,
  ],
  always: [
    `Always in the ${MENU_BAR_NAME}.`,
    `The ${MENU_BAR_NAME} icon always shows; click it to drop in a mini window that lives there, or to send the current tab there.`,
  ],
  never: [
    "Hidden; mini windows can't be sent there.",
    `No ${MENU_BAR_NAME} icon, and mini windows can't be sent there.`,
  ],
};

const GROUPING_OPTIONS = [
  { value: "tabs", label: "Tabs" },
  { value: "stack", label: "Stack" },
  { value: "separate", label: "Separate" },
] as const;
const HEADER_OPTIONS = [
  { value: "float", label: "Float" },
  { value: "push", label: "Push" },
  { value: "overlay", label: "Overlay" },
] as const;
const MENU_BAR_OPTIONS = [
  { value: "in-use", label: "In use" },
  { value: "always", label: "Always" },
  { value: "never", label: "Never" },
] as const;
const delayLabel = (ms: number): string => (ms === 1000 ? "1 s" : `${ms} ms`);

export function MiniWindowSettings(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [defaultShortcut, setDefaultShortcut] = useState("");
  const [url, setUrl] = useState("");
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void window.api.browser.miniWindow
      .getSettings()
      .then((snapshot) => {
        if (!live) return;
        setSettings(snapshot.settings);
        setStatus(snapshot.status);
        setDefaultShortcut(snapshot.defaults.shortcut);
        setUrl(snapshot.settings.defaultUrl);
      })
      .catch(() => undefined);
    const off = window.api.browser.miniWindow.onSettingsChange((snapshot) => {
      setSettings(snapshot.settings);
      setStatus(snapshot.status);
    });
    return () => {
      live = false;
      off();
    };
  }, []);

  const update = (patch: Partial<Settings>): void => {
    void window.api.browser.miniWindow
      .update(patch)
      .then((result) => {
        if (!result.ok) {
          setMessage(result.error);
          return;
        }
        setMessage(null);
        setSettings(result.settings);
        setStatus(result.status);
        if ("defaultUrl" in patch) setUrl(result.settings.defaultUrl);
      })
      .catch(() => undefined);
  };

  const shortcutLabel = settings
    ? formatAccelerator(settings.shortcut, IS_MAC)
    : "";
  const shortcutState = !settings?.shortcut
    ? "Off"
    : status?.registered
      ? "On"
      : (status?.error ?? "Not active");
  const grouping = settings?.grouping ?? "tabs";
  const header = settings?.headerPlacement ?? "float";
  const menuBar = settings?.menuBarIcon ?? "in-use";
  const windowsSummary = [
    GROUPING_OPTIONS.find((option) => option.value === grouping)?.label,
    HEADER_OPTIONS.find((option) => option.value === header)?.label,
    settings?.throwMomentum === false ? "no throw" : null,
    !IS_LINUX && settings && settings.opacity < 1
      ? `${Math.round(settings.opacity * 100)}%`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const tuckSummary = !settings?.tuckToEdge
    ? "Off"
    : settings.peekOnHover
      ? `Peek after ${delayLabel(settings.peekDelayMs)}`
      : "On · no peek";
  return (
    <SettingsGroup
      title="Mini window"
      status={
        settings
          ? settings.shortcut && status?.registered
            ? shortcutLabel
            : "Shortcut off"
          : undefined
      }
      statusOn={Boolean(settings?.shortcut && status?.registered)}
    >
      <SettingsRow
        label="Default page"
        hint="The toggle shortcut opens it on top of other apps; empty pops out the current tab."
        info={`A small window that stays on top of other apps (e.g. claude.ai or chatgpt.com), signed in with your usual profile. Any tab can pop out from its right-click menu or ${IS_MAC ? "⌘⇧M" : "Ctrl+Shift+M"}.`}
      >
        <input
          className="settings-input"
          type="text"
          value={url}
          placeholder="https://claude.ai"
          spellCheck={false}
          autoCapitalize="none"
          disabled={!settings}
          aria-label="Mini window default page"
          onChange={(event) => setUrl(event.target.value)}
          onBlur={() => {
            if (settings && url.trim() !== settings.defaultUrl)
              update({ defaultUrl: url });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") update({ defaultUrl: url });
          }}
        />
      </SettingsRow>
      <SettingsRow
        label="Toggle shortcut"
        hint={
          shortcutState === "On" || shortcutState === "Off"
            ? "Works from any app. Click the field and press keys to change it."
            : `${shortcutState}. Click the field and press keys to change it.`
        }
        info="Opens the default page, then shows or hides the mini window."
      >
        <input
          className="settings-input settings-input-shortcut"
          type="text"
          readOnly
          value={recording ? "Press keys…" : shortcutLabel}
          disabled={!settings}
          aria-label="Mini window toggle shortcut"
          onFocus={() => setRecording(true)}
          onBlur={() => setRecording(false)}
          onKeyDown={(event) => {
            event.preventDefault();
            if (event.key === "Escape")
              return void (event.target as HTMLInputElement).blur();
            const accelerator = acceleratorFromKeyEvent(event, IS_MAC);
            if (!accelerator) return;
            update({ shortcut: accelerator });
            (event.target as HTMLInputElement).blur();
          }}
        />
        <button
          className="settings-action secondary"
          type="button"
          disabled={!settings?.shortcut}
          aria-label="Turn off the mini window shortcut"
          onClick={() => update({ shortcut: "" })}
        >
          Clear
        </button>
        {defaultShortcut && settings?.shortcut !== defaultShortcut && (
          <button
            className="settings-action secondary"
            type="button"
            aria-label="Use the default mini window shortcut"
            onClick={() => update({ shortcut: defaultShortcut })}
          >
            Default
          </button>
        )}
      </SettingsRow>
      <SettingsRow
        label={IS_MAC ? "Menu bar icon" : "Tray icon"}
        hint={MENU_BAR_HINTS[menuBar][0]}
        info={MENU_BAR_HINTS[menuBar][1]}
      >
        <SettingsSegmented
          value={menuBar}
          options={MENU_BAR_OPTIONS}
          ariaLabel="Mini window menu bar icon"
          disabled={!settings}
          onChange={(menuBarIcon) => update({ menuBarIcon })}
        />
      </SettingsRow>
      <SettingsDisclosure
        id="mini-window-windows"
        title="Windows & motion"
        summary={settings ? windowsSummary : undefined}
      >
        <SettingsRow
          label="Grouping"
          hint={GROUPING_HINTS[grouping][0]}
          info={GROUPING_HINTS[grouping][1]}
        >
          <SettingsSegmented
            value={grouping}
            options={GROUPING_OPTIONS}
            ariaLabel="Mini window grouping"
            disabled={!settings}
            onChange={(value) => update({ grouping: value })}
          />
        </SettingsRow>
        <SettingsRow
          label="Header"
          hint={HEADER_HINTS[header][0]}
          info={HEADER_HINTS[header][1]}
        >
          <SettingsSegmented
            value={header}
            options={HEADER_OPTIONS}
            ariaLabel="Mini window header"
            disabled={!settings}
            onChange={(headerPlacement) => update({ headerPlacement })}
          />
        </SettingsRow>
        <SettingsRow
          label="Throw with momentum"
          hint="Let go mid-drag and it glides to a stop; fling it at an edge to tuck it."
          info="It always stops inside the screen. Off when Reduce Motion is on."
        >
          <input
            type="checkbox"
            className="settings-switch"
            disabled={!settings}
            checked={settings?.throwMomentum ?? true}
            aria-label="Throw mini windows with momentum"
            onChange={(event) =>
              update({ throwMomentum: event.target.checked })
            }
          />
        </SettingsRow>
        {!IS_LINUX && settings && (
          <SettingsSlider
            label="Opacity"
            value={Math.round(settings.opacity * 100)}
            unit="%"
            min={Math.round(MINI_WINDOW_MIN_OPACITY * 100)}
            max={100}
            step={5}
            onChange={(value) => update({ opacity: value / 100 })}
          />
        )}
      </SettingsDisclosure>
      <SettingsDisclosure
        id="mini-window-tuck"
        title="Edge tuck & peek"
        summary={settings ? tuckSummary : undefined}
      >
        <SettingsRow
          label="Tuck to screen edge"
          hint="Drag it against a screen edge and it slides away behind a small tab."
          info="Or use its header's arrow. Click the tab or press the toggle shortcut to slide it back out."
        >
          <input
            type="checkbox"
            className="settings-switch"
            disabled={!settings}
            checked={settings?.tuckToEdge ?? true}
            aria-label="Tuck the mini window to a screen edge"
            onChange={(event) => update({ tuckToEdge: event.target.checked })}
          />
        </SettingsRow>
        {settings?.tuckToEdge && (
          <SettingsRow
            label="Peek on hover"
            hint="Rest the pointer on the edge tab to slide it out for a look."
            info="Move away and it tucks back in. Click or type in it to keep it out."
          >
            <input
              type="checkbox"
              className="settings-switch"
              checked={settings.peekOnHover}
              aria-label="Peek the tucked mini window on hover"
              onChange={(event) =>
                update({ peekOnHover: event.target.checked })
              }
            />
          </SettingsRow>
        )}
        {settings?.tuckToEdge && settings.peekOnHover && (
          <SettingsRow
            label="Hover delay"
            hint="How long the pointer rests on the edge tab first."
          >
            <SettingsSegmented
              value={settings.peekDelayMs}
              options={MINI_WINDOW_PEEK_DELAYS.map((ms) => ({
                value: ms,
                label: delayLabel(ms),
              }))}
              ariaLabel="Mini window peek hover delay"
              onChange={(peekDelayMs) => update({ peekDelayMs })}
            />
          </SettingsRow>
        )}
      </SettingsDisclosure>
      {message && (
        <p className="settings-message" role="status">
          {message}
        </p>
      )}
    </SettingsGroup>
  );
}
