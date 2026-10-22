import { app, type IpcMainInvokeEvent, type WebContents } from "electron";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  IDLE_READ_ALOUD_DOWNLOAD,
  IDLE_READ_ALOUD_STATE,
  IDLE_READ_ALOUD_TEST,
  isReadAloudControl,
  parseReadAloudSettings,
  READ_ALOUD_DIRECTORY,
  READ_ALOUD_DISABLED_ERROR,
  READ_ALOUD_READY_FILE,
  READ_ALOUD_SETTINGS_FILE,
  type ReadAloudControl,
  type ReadAloudDownloadState,
  type ReadAloudSettings,
  type ReadAloudState,
  type ReadAloudTestState,
} from "../shared/read-aloud";
import {
  isMainWindowRenderer,
  sendToMainWindowRenderers,
} from "./browser-shell";
import {
  noteReadAloudEnabled,
  readAloudEnabled,
  type ReadAloudChannel,
  type ReadAloudPoint,
} from "./read-aloud-feature";
import { readUserJson, writeSettingsFile } from "./user-json";

/**
 * Read Aloud settings and IPC (loaded on the first Read Aloud IPC call, menu action or reading; the
 * launch-time gate is read-aloud-feature.ts). Playback, downloads and the engine page are
 * read-aloud.ts, loaded only once the feature is on and something needs it.
 */
type ReadAloudModule = typeof import("./read-aloud");

let settings: ReadAloudSettings | null = null;
let module: ReadAloudModule | null = null;
let loading: Promise<ReadAloudModule> | null = null;

function current(): ReadAloudSettings {
  settings ??= parseReadAloudSettings(readUserJson(READ_ALOUD_SETTINGS_FILE));
  return settings;
}

function loadModule(): Promise<ReadAloudModule> {
  loading ??= import("./read-aloud").then((loaded) => {
    module = loaded;
    return loaded;
  });
  return loading;
}

/** The player state, without loading the module (idle until the first reading). */
function getReadAloudState(): ReadAloudState {
  return (
    module?.readAloudState() ?? {
      ...IDLE_READ_ALOUD_STATE,
      speed: current().speed,
      voice: current().voice,
    }
  );
}

function setReadAloudSettings(input: unknown): ReadAloudSettings {
  const before = current();
  const next = parseReadAloudSettings(input, before);
  settings = next;
  writeSettingsFile(READ_ALOUD_SETTINGS_FILE, next);
  noteReadAloudEnabled(next.enabled);
  if (before.enabled && !next.enabled) {
    module?.disposeReadAloud();
  } else if (next.enabled) {
    // On (or switched to Phonon): download the model now, so the first reading starts right away.
    const wantsModel =
      next.engine === "phonon" &&
      (!before.enabled || before.engine !== "phonon");
    if (wantsModel)
      void loadModule().then((loaded) => {
        if (readAloudEnabled()) loaded.prepareReadAloud();
      });
    else if (next.engine === "phonon" && next.voice !== before.voice)
      void loadModule().then((loaded) => {
        if (readAloudEnabled()) loaded.prefetchReadAloudVoice(next.voice);
      });
    module?.applyReadAloudSettings(next);
  }
  try {
    sendToMainWindowRenderers("browser:read-aloud:settings-changed", {
      ...next,
    });
  } catch {
    /* window closing */
  }
  return { ...next };
}

export async function readFromPage(
  page: WebContents,
  target: "page" | "selection" | "here",
  selection: string,
  point?: ReadAloudPoint,
): Promise<boolean> {
  if (!readAloudEnabled() || page.isDestroyed()) return false;
  const loaded = await loadModule();
  if (!readAloudEnabled()) return false;
  return loaded.startReadAloud(page, target, selection, current(), point);
}

export function control(action: ReadAloudControl): void {
  if (readAloudEnabled()) module?.controlReadAloud(action);
}

export function dispose(): void {
  module?.disposeReadAloud();
}

export function readAloudDirectory(): string {
  return join(app.getPath("userData"), READ_ALOUD_DIRECTORY);
}

/**
 * The download as the folder shows it, without loading read-aloud.ts (Settings while the feature is
 * off, or before anything ran this session). ready.json is written last, after every hash matched.
 */
function diskDownloadState(): ReadAloudDownloadState {
  const directory = readAloudDirectory();
  let bytes = 0;
  let ready = false;
  try {
    const marker = JSON.parse(
      readFileSync(join(directory, READ_ALOUD_READY_FILE), "utf8"),
    ) as { bytes?: unknown };
    ready = true;
    bytes = typeof marker.bytes === "number" ? marker.bytes : 0;
  } catch {
    /* not downloaded */
  }
  let voices: string[] = [];
  try {
    voices = readdirSync(join(directory, "model", "voices"))
      .filter((name) => name.endsWith(".safetensors"))
      .map((name) => name.slice(0, -".safetensors".length));
  } catch {
    /* none */
  }
  return {
    ...IDLE_READ_ALOUD_DOWNLOAD,
    status: ready ? "ready" : existsSync(directory) ? "partial" : "absent",
    bytes,
    voices: ready ? ["default", ...voices] : voices,
  };
}

function getReadAloudDownloadState(): ReadAloudDownloadState {
  return module?.readAloudDownloadState() ?? diskDownloadState();
}

function getReadAloudTestState(): ReadAloudTestState {
  return module?.readAloudTestState() ?? { ...IDLE_READ_ALOUD_TEST };
}

/** Channels only the app window may call (the rest only read). */
const APP_WINDOW_ONLY: ReadonlySet<ReadAloudChannel> = new Set([
  "set-settings",
  "control",
  "download-start",
  "download-cancel",
  "delete-downloads",
  "test",
  "test-stop",
]);

export async function handleIpc(
  channel: ReadAloudChannel,
  event: IpcMainInvokeEvent,
  args: unknown[],
): Promise<unknown> {
  if (
    APP_WINDOW_ONLY.has(channel) &&
    !isMainWindowRenderer(event.sender, event.senderFrame)
  )
    throw new Error(
      "This browser operation is available only to the app window.",
    );
  const [input] = args;
  switch (channel) {
    case "get-settings":
      return { ...current() };
    case "set-settings":
      return setReadAloudSettings(input);
    case "get-state":
      return getReadAloudState();
    case "control":
      if (!readAloudEnabled())
        return { ok: false, error: READ_ALOUD_DISABLED_ERROR };
      if (!isReadAloudControl(input))
        return { ok: false, error: "unknown control" };
      control(input);
      return { ok: true };
    case "download-info":
      return getReadAloudDownloadState();
    case "download-start": {
      if (!readAloudEnabled()) return getReadAloudDownloadState();
      const loaded = await loadModule();
      if (readAloudEnabled()) loaded.prepareReadAloud();
      return getReadAloudDownloadState();
    }
    case "download-cancel":
      module?.cancelReadAloudDownload();
      return getReadAloudDownloadState();
    case "delete-downloads": {
      if (module) return module.deleteReadAloudDownloads();
      await rm(readAloudDirectory(), { recursive: true, force: true }).catch(
        () => undefined,
      );
      const state = diskDownloadState();
      try {
        sendToMainWindowRenderers("browser:read-aloud:download", state);
      } catch {
        /* window closing */
      }
      return state;
    }
    case "test-state":
      return getReadAloudTestState();
    // The voice pickers' list (the English catalog, fetched once the model is there) and Advanced's model conditioners.
    case "catalog":
      if (!readAloudEnabled())
        return {
          status: "needs-model",
          voices: [],
          conditioners: [],
          error: READ_ALOUD_DISABLED_ERROR,
        };
      return (await loadModule()).readAloudCatalog();
    case "test": {
      if (!readAloudEnabled())
        return { ok: false, error: READ_ALOUD_DISABLED_ERROR };
      const loaded = await loadModule();
      if (!readAloudEnabled())
        return { ok: false, error: READ_ALOUD_DISABLED_ERROR };
      return loaded.testReadAloud(input, current());
    }
    case "test-stop":
      module?.stopReadAloudTest();
      return { ok: true };
  }
}
