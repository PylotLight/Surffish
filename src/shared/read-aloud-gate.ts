/**
 * The part of Read Aloud main parses at launch: the settings file name, the engine scheme, and the
 * on/off and menu gating. Everything else (settings parsing, player state types, the download
 * manifest) is in read-aloud.ts and friends, which load with the feature. Pure.
 */

export const READ_ALOUD_SETTINGS_FILE = "browser-read-aloud.json";
/** The hidden engine page's origin. Its own in-memory session; no network but its own files. */
export const READ_ALOUD_SCHEME = "surffish-tts";

/** Play / pause (or start reading the page when nothing is playing). Edge uses the same keys. */
export const READ_ALOUD_SHORTCUT = "CmdOrCtrl+Shift+U";

/** On in the settings file (off when the file is missing or unreadable). */
export function readAloudEnabledIn(raw: unknown): boolean {
  return (
    typeof raw === "object" &&
    raw !== null &&
    (raw as { enabled?: unknown }).enabled === true
  );
}

export type ReadAloudStatus =
  "idle" | "downloading" | "loading" | "playing" | "paused" | "error";

/** A reading in progress (anything but idle/error). */
export function isReadAloudActive(state: { status: ReadAloudStatus }): boolean {
  return (
    state.status === "downloading" ||
    state.status === "loading" ||
    state.status === "playing" ||
    state.status === "paused"
  );
}

/** Command palette entries that only exist while Read Aloud is on. */
export const READ_ALOUD_COMMAND_IDS: readonly string[] = [
  "readAloud.page",
  "readAloud.selection",
  "readAloud.pause",
  "readAloud.stop",
];

export function isCommandHiddenByReadAloud(
  id: string,
  enabled: boolean,
): boolean {
  return !enabled && READ_ALOUD_COMMAND_IDS.includes(id);
}

/** Page context menu entries: feature on, a web page (http/https) or a PDF (any source the viewer or editor shows). */
export function canOfferReadAloud(options: {
  enabled: boolean;
  url: string;
  pdf: boolean;
}): boolean {
  return options.enabled && (options.pdf || /^https?:\/\//i.test(options.url));
}
