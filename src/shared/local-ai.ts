/**
 * Built-in AI (experimental, Electron 45+): pages and extensions that call Chromium's Prompt API
 * (`LanguageModel.create()`, `model.prompt()`) are answered by a Surffish utility process
 * (src/main/local-ai.ts, src/main/local-ai-handler.ts). Off by default: then no handler is
 * registered and `LanguageModel.availability()` says 'unavailable'.
 */
export const LOCAL_AI_SETTINGS_FILE = "browser-local-ai.json";

/** `echo` is a stub for testing; `openai-compatible` posts to `<baseUrl>/chat/completions` (LM Studio, Ollama, llama.cpp server). */
export const LOCAL_AI_PROVIDERS = ["echo", "openai-compatible"] as const;
export type LocalAIProviderId = (typeof LOCAL_AI_PROVIDERS)[number];

export interface LocalAISettings {
  enabled: boolean;
  provider: LocalAIProviderId;
  /** openai-compatible only, e.g. http://127.0.0.1:1234/v1 */
  baseUrl: string;
  /** openai-compatible only; '' lets the server pick its loaded model. */
  model: string;
}

export const DEFAULT_LOCAL_AI_SETTINGS: LocalAISettings = {
  enabled: false,
  provider: "echo",
  baseUrl: "http://127.0.0.1:1234/v1",
  model: "",
};

/** Loopback http(s) only: a page's prompts never leave the machine through this prototype. */
export function isLoopbackBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return (
      url.hostname === "127.0.0.1" ||
      url.hostname === "localhost" ||
      url.hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

/** Invalid fields fall back to `fallback` (the defaults, or the current settings when saving a change). */
export function parseLocalAISettings(
  value: unknown,
  fallback: LocalAISettings = DEFAULT_LOCAL_AI_SETTINGS,
): LocalAISettings {
  const raw =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const provider = LOCAL_AI_PROVIDERS.includes(
    raw.provider as LocalAIProviderId,
  )
    ? (raw.provider as LocalAIProviderId)
    : fallback.provider;
  const baseUrl =
    typeof raw.baseUrl === "string" && isLoopbackBaseUrl(raw.baseUrl.trim())
      ? raw.baseUrl.trim().replace(/\/+$/, "")
      : fallback.baseUrl;
  const model =
    typeof raw.model === "string"
      ? raw.model.trim().slice(0, 200)
      : fallback.model;
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : fallback.enabled,
    provider,
    baseUrl,
    model,
  };
}

/** Origins that may get a Prompt API session: web pages and extensions. */
export function isLocalAIOrigin(origin: string): boolean {
  return /^(?:https?|chrome-extension):\/\//.test(origin);
}

/** One Prompt API message as Electron hands it to the utility process (LanguageModelMessage). */
export interface PromptMessage {
  role: "system" | "user" | "assistant";
  content: { type: "text" | "image" | "audio"; value: unknown }[];
}

/** The text of a message; images and audio are dropped (text-only prototype). */
export function messageText(message: PromptMessage): string {
  return message.content
    .filter((part) => part.type === "text" && typeof part.value === "string")
    .map((part) => part.value as string)
    .join("");
}
