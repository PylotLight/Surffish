/**
 * Read Aloud (experimental, Settings → Integrations → Read Aloud, off by default): Surffish reads the article (Reader
 * view's Readability extraction) or the selection out loud with Phonon, an on-device TTS model
 * (gradium/phonon-31m-en, Apache-2.0) running as WebAssembly in a hidden engine page. Nothing is
 * bundled: the first use downloads the official `phonon-tts` npm package and the model weights into
 * the profile, pinned and checked against the hashes below. Off means the read-aloud module is never
 * loaded and no menu, palette or toolbar entry shows. Falls back to the system voices (Chromium
 * speechSynthesis) if Phonon can't start, or speaks through a local OpenAI-compatible
 * `/v1/audio/speech` server when that engine is picked.
 *
 * Pure: settings, gating and player state. Shared by main, preload and renderers, so it stays small;
 * the download manifest and voices are in read-aloud-assets.ts (loaded only with the feature).
 */

import type { ModelConditioner } from "./read-aloud-assets";
import type { CatalogVoice } from "./read-aloud-voices";
import { READ_ALOUD_SCHEME, type ReadAloudStatus } from "./read-aloud-gate";

export {
  READ_ALOUD_SETTINGS_FILE,
  READ_ALOUD_SCHEME,
  READ_ALOUD_SHORTCUT,
  READ_ALOUD_COMMAND_IDS,
  isCommandHiddenByReadAloud,
  canOfferReadAloud,
  isReadAloudActive,
  type ReadAloudStatus,
} from "./read-aloud-gate";
export const READ_ALOUD_HOST = "engine";
export const READ_ALOUD_ORIGIN = `${READ_ALOUD_SCHEME}://${READ_ALOUD_HOST}`;
export const READ_ALOUD_PAGE = "read-aloud.html";
export const READ_ALOUD_URL = `${READ_ALOUD_ORIGIN}/${READ_ALOUD_PAGE}`;
export const READ_ALOUD_PARTITION = "surffish-read-aloud";
/** Folder under userData holding the downloaded runtime and model. Deleting it re-downloads. */
export const READ_ALOUD_DIRECTORY = "read-aloud";
/** Written after the runtime, model and default voice are downloaded and verified. */
export const READ_ALOUD_READY_FILE = "ready.json";
/** Engine-page paths for the downloaded files (served from the profile folder by main). */
export const READ_ALOUD_RUNTIME_PATH = "/runtime/";
export const READ_ALOUD_MODEL_PATH = "/model/";
export const READ_ALOUD_DISABLED_ERROR = "read aloud disabled";

export const READ_ALOUD_ENGINES = ["phonon", "system", "openai"] as const;
export type ReadAloudEngineId = (typeof READ_ALOUD_ENGINES)[number];

/**
 * Speech rate, 0.75–3×, in 0.05 steps. Phonon's own `duration_delta` conditioner covers about
 * 0.87–1.25× (measured, see read-aloud-speed.ts); the rest is a pitch-preserving time stretch of
 * its audio in the engine page, so 2–3× doesn't chipmunk.
 */
export const READ_ALOUD_MIN_SPEED = 0.75;
export const READ_ALOUD_MAX_SPEED = 3;
/** One-click rates in Settings and the player. */
export const READ_ALOUD_SPEED_PRESETS = [
  0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3,
] as const;

/** Phonon's text rewrites: 'default' (numbers, currency, urls…), 'all' (+ phones, times, dates), 'none'. */
export const READ_ALOUD_REWRITES = ["default", "all", "none"] as const;
export type ReadAloudRewrites = (typeof READ_ALOUD_REWRITES)[number];
export const READ_ALOUD_DEVICES = ["cpu", "webgpu", "auto"] as const;
export type ReadAloudDevice = (typeof READ_ALOUD_DEVICES)[number];
/** phonon-tts's own defaults (temperature 0.3, seed 4242424242424242: the same text gives the same audio). */
export const READ_ALOUD_DEFAULT_TEMPERATURE = 0.3;
export const READ_ALOUD_MAX_TEMPERATURE = 1;
export const READ_ALOUD_DEFAULT_SEED = 4242424242424242;
export const READ_ALOUD_MAX_THREADS = 8;

export interface ReadAloudSettings {
  enabled: boolean;
  engine: ReadAloudEngineId;
  /** A Phonon voice id ('default' is the checkpoint's own voice; others come from the voice catalog). */
  voice: string;
  speed: number;
  /** openai engine only: loopback base URL, e.g. http://127.0.0.1:8880/v1 (ptts-openai-server). */
  endpoint: string;
  /** openai engine only: the server's voice name ('' lets it pick). */
  endpointVoice: string;
  /** Phonon sampling temperature ("Expressiveness"), 0–1. */
  temperature: number;
  /** A new noise seed for every reading instead of the fixed one (same text, slightly different read). */
  varySeed: boolean;
  /** Phonon text normalization ("Read numbers, dates & times naturally"); a change reloads the model. */
  rewrites: ReadAloudRewrites;
  /** Advanced: where Phonon generates (CPU by default: on Apple silicon it often beats WebGPU for a model this small), and on how many CPU threads (2 by default; 'auto' lets phonon-tts pick, usually 3). */
  device: ReadAloudDevice;
  threads: "auto" | number;
  /** Advanced: values for other conditioners the checkpoint's config.json lists (not duration_delta). */
  conditions: Record<string, string | number>;
}

export const DEFAULT_READ_ALOUD_SETTINGS: ReadAloudSettings = {
  enabled: false,
  engine: "phonon",
  voice: "default",
  speed: 1,
  endpoint: "http://127.0.0.1:8880/v1",
  endpointVoice: "",
  temperature: READ_ALOUD_DEFAULT_TEMPERATURE,
  varySeed: false,
  rewrites: "default",
  device: "cpu",
  threads: 2,
  conditions: {},
};

/** Loopback http(s) only: the text being read never leaves the machine through this setting. */
export function isLoopbackSpeechEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    return (
      url.hostname === "127.0.0.1" ||
      url.hostname === "localhost" ||
      url.hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

/** `<endpoint>/audio/speech`, accepting a base with or without the trailing `/v1`. */
export function speechEndpointUrl(endpoint: string): string | null {
  if (!isLoopbackSpeechEndpoint(endpoint)) return null;
  const base = endpoint.trim().replace(/\/+$/, "");
  return /\/v1$/.test(base)
    ? `${base}/audio/speech`
    : `${base}/v1/audio/speech`;
}

/**
 * A speed in range, on the 0.05 grid. Accepts "1.5x"/"2×" strings (hand-edited files). Older
 * builds offered 0.8/1/1.15/1.3/1.5; those are kept as they are (all on the grid, all in range).
 */
export function normalizeSpeed(value: unknown, fallback = 1): number {
  const number =
    typeof value === "string"
      ? Number.parseFloat(value.replace(/[x×]\s*$/i, ""))
      : value;
  if (typeof number !== "number" || !Number.isFinite(number) || number <= 0)
    return fallback;
  const clamped = Math.min(
    READ_ALOUD_MAX_SPEED,
    Math.max(READ_ALOUD_MIN_SPEED, number),
  );
  return Math.round(clamped * 20) / 20;
}

/** "1.25×", "2×". */
export function formatSpeed(speed: number): string {
  return `${Number(speed.toFixed(2))}×`;
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
  step: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.round(Math.min(max, Math.max(min, value)) / step) * step;
}

function parseConditions(
  value: unknown,
  fallback: Record<string, string | number>,
): Record<string, string | number> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return { ...fallback };
  const out: Record<string, string | number> = {};
  for (const [name, raw] of Object.entries(
    value as Record<string, unknown>,
  ).slice(0, 12)) {
    // duration_delta belongs to the speed setting; anything else the checkpoint's config lists.
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(name) || name === "duration_delta")
      continue;
    if (typeof raw === "number" && Number.isFinite(raw))
      out[name] = Math.round(raw * 1000) / 1000;
    else if (typeof raw === "string" && /^[\w.-]{1,24}$/.test(raw))
      out[name] = raw;
  }
  return out;
}

/**
 * Invalid fields fall back to `fallback` (the defaults, or the current settings when saving a change).
 * Files from older builds (speed on the old 0.8–1.5 list, no Phonon levers, a stray tester engine
 * key) read as the same choices plus the new defaults.
 */
export function parseReadAloudSettings(
  value: unknown,
  fallback: ReadAloudSettings = DEFAULT_READ_ALOUD_SETTINGS,
): ReadAloudSettings {
  const raw =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const engine = READ_ALOUD_ENGINES.includes(raw.engine as ReadAloudEngineId)
    ? (raw.engine as ReadAloudEngineId)
    : fallback.engine;
  // Any voice-id-shaped string; an id the catalog doesn't know falls back to the model voice when used.
  const voice =
    typeof raw.voice === "string" && /^[\w-]{1,40}$/.test(raw.voice)
      ? raw.voice
      : fallback.voice;
  const endpoint =
    typeof raw.endpoint === "string" &&
    isLoopbackSpeechEndpoint(raw.endpoint.trim())
      ? raw.endpoint.trim().replace(/\/+$/, "")
      : fallback.endpoint;
  const endpointVoice =
    typeof raw.endpointVoice === "string"
      ? raw.endpointVoice.trim().slice(0, 80)
      : fallback.endpointVoice;
  const threads =
    raw.threads === "auto"
      ? "auto"
      : typeof raw.threads === "number" &&
          Number.isInteger(raw.threads) &&
          raw.threads >= 1 &&
          raw.threads <= READ_ALOUD_MAX_THREADS
        ? raw.threads
        : fallback.threads;
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : fallback.enabled,
    engine,
    voice,
    speed:
      raw.speed === undefined
        ? fallback.speed
        : normalizeSpeed(raw.speed, fallback.speed),
    endpoint,
    endpointVoice,
    temperature:
      Math.round(
        clampNumber(
          raw.temperature,
          0,
          READ_ALOUD_MAX_TEMPERATURE,
          fallback.temperature,
          0.05,
        ) * 100,
      ) / 100,
    varySeed:
      typeof raw.varySeed === "boolean" ? raw.varySeed : fallback.varySeed,
    rewrites: READ_ALOUD_REWRITES.includes(raw.rewrites as ReadAloudRewrites)
      ? (raw.rewrites as ReadAloudRewrites)
      : fallback.rewrites,
    device: READ_ALOUD_DEVICES.includes(raw.device as ReadAloudDevice)
      ? (raw.device as ReadAloudDevice)
      : fallback.device,
    threads,
    conditions:
      raw.conditions === undefined
        ? { ...fallback.conditions }
        : parseConditions(raw.conditions, fallback.conditions),
  };
}

/** What the toolbar control and the Reader view show. One reading at a time, app-wide. */
export interface ReadAloudState {
  status: ReadAloudStatus;
  /** The tab being read (null when idle). */
  tabId: string | null;
  title: string;
  /** Sentence being spoken, 0-based, and how many there are. */
  index: number;
  total: number;
  /** Engine actually speaking: 'phonon', or 'system' after a fallback. */
  engine: ReadAloudEngineId | null;
  /** Why Phonon was not used, when it fell back. */
  fallbackReason: string;
  speed: number;
  voice: string;
  /** First-use download progress. */
  download: { label: string; loaded: number; total: number } | null;
  error: string;
}

export const IDLE_READ_ALOUD_STATE: ReadAloudState = {
  status: "idle",
  tabId: null,
  title: "",
  index: 0,
  total: 0,
  engine: null,
  fallbackReason: "",
  speed: 1,
  voice: "default",
  download: null,
  error: "",
};

export type ReadAloudControl =
  "toggle" | "pause" | "resume" | "stop" | "next" | "previous";

export function isReadAloudControl(value: unknown): value is ReadAloudControl {
  return (
    value === "toggle" ||
    value === "pause" ||
    value === "resume" ||
    value === "stop" ||
    value === "next" ||
    value === "previous"
  );
}

// ---------------------------------------------------------------------------
// Model download (Settings → Integrations → Read Aloud). Turning Read Aloud on starts it; the files
// stay in the profile across restarts (re-checked against their hashes once per session, never
// re-downloaded when they match) and when the feature is turned off, until Delete download.

export type ReadAloudDownloadStatus =
  | "absent"
  | "partial"
  | "checking"
  | "downloading"
  | "ready"
  | "error"
  | "cancelled";

export interface ReadAloudDownloadState {
  status: ReadAloudDownloadStatus;
  /** The file being fetched ('Model weights', …) while downloading. */
  label: string;
  /** Bytes fetched / to fetch in this download (only the files that were missing). */
  loaded: number;
  total: number;
  /** The whole model download's size (runtime + weights + tokenizer + config + default voice). */
  bytes: number;
  error: string;
  /** Phonon voices already in the profile (ids; 'default' comes with the model). */
  voices: string[];
  /** A voice being fetched on its own (~250 KB), picked in the tester or the player. */
  voice: { id: string; loaded: number; total: number } | null;
}

export const IDLE_READ_ALOUD_DOWNLOAD: ReadAloudDownloadState = {
  status: "absent",
  label: "",
  loaded: 0,
  total: 0,
  bytes: 0,
  error: "",
  voices: [],
  voice: null,
};

// ---------------------------------------------------------------------------
// Voice tester (Settings → Integrations → Read Aloud → Voice): speak a sample with the current
// engine, voice, speed and levers, and show how long it took, so they can be compared on this Mac. Its helpers
// live in read-aloud-tester.ts, which isn't parsed at launch.

/** The sample to speak; engine, voice, speed and the Phonon levers are Read Aloud's own settings. */
export interface ReadAloudTestRequest {
  text: string;
}

export type ReadAloudTestStatus =
  "idle" | "preparing" | "loading" | "playing" | "finished" | "error";

export interface ReadAloudTestStats {
  /** Engine start: Phonon model load (0-ish when already loaded: `cold` false), system voice list. */
  loadMs: number | null;
  cold: boolean;
  /** From the engine being ready (model loaded) to the first sound. */
  firstAudioMs: number | null;
  /** Audio produced and the time spent producing it (Phonon / local server). */
  audioSeconds: number | null;
  generateMs: number | null;
  threads: number | null;
  /** Phonon: 'cpu' or 'webgpu', and why (phonon-tts's deviceReason / threadsReason). */
  device: string | null;
  deviceReason: string;
  threadsReason: string;
}

export interface ReadAloudTestState {
  status: ReadAloudTestStatus;
  engine: ReadAloudEngineId | null;
  voice: string;
  speed: number;
  stats: ReadAloudTestStats | null;
  error: string;
  fallbackReason: string;
}

export const IDLE_READ_ALOUD_TEST: ReadAloudTestState = {
  status: "idle",
  engine: null,
  voice: "default",
  speed: 1,
  stats: null,
  error: "",
  fallbackReason: "",
};

/** The voice pickers' list and Advanced's model conditioners (fetched on demand, see read-aloud-voices.ts). */
export interface ReadAloudCatalogInfo {
  /** 'needs-model': the voice list is fetched once the model is downloaded. */
  status: "ready" | "needs-model" | "error";
  voices: CatalogVoice[];
  conditioners: ModelConditioner[];
  error: string;
}
