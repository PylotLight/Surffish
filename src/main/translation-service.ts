import { net, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import {
  isTranslationLanguage,
  isPublicWebUrl,
  parseTranslationResponse,
} from "../shared/translation";
import { translationPage } from "./translation-page";

const WORLD_ID = 1108;
const jobs = new WeakMap<WebContents, AbortController>();

/** Keyless Google web endpoint, not the supported Cloud Translation API. Best effort only. */
async function translateText(
  text: string,
  target: string,
  signal: AbortSignal,
): Promise<string> {
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.search = new URLSearchParams({
    client: "gtx",
    sl: "auto",
    tl: target,
    dt: "t",
    q: text,
  }).toString();
  const response = await net.fetch(url.toString(), {
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  if (!response.ok) throw new Error("Translation provider unavailable");
  const body = await response.text();
  if (body.length > 100000) throw new Error("Translation response too large");
  const translated = parseTranslationResponse(JSON.parse(body));
  return `${text.match(/^\s*/)?.[0] ?? ""}${translated.trim()}${text.match(/\s*$/)?.[0] ?? ""}`;
}

/** All DOM operations stay in an isolated world; navigation cannot apply stale results. */
export async function translateInPlace(
  contents: WebContents,
  target: string,
  selection?: string,
): Promise<boolean> {
  if (
    contents.isDestroyed() ||
    !isPublicWebUrl(contents.getURL()) ||
    !isTranslationLanguage(target)
  )
    return false;
  if (selection !== undefined && (!selection.trim() || selection.length > 5000))
    return false;
  jobs.get(contents)?.abort();
  const controller = new AbortController();
  jobs.set(contents, controller);
  const id = randomUUID();
  const sourceUrl = contents.getURL();
  const stop = () => controller.abort();
  const navigation = (
    _event: unknown,
    _url: string,
    _inPlace: boolean,
    mainFrame: boolean,
  ) => {
    if (mainFrame) stop();
  };
  contents.on("did-start-navigation", navigation);
  contents.once("destroyed", stop);
  const run = async (action: string, data: Record<string, unknown> = {}) => {
    if (
      contents.isDestroyed() ||
      contents.getURL() !== sourceUrl ||
      controller.signal.aborted
    )
      return false;
    return contents.executeJavaScriptInIsolatedWorld(WORLD_ID, [
      {
        code: `(${translationPage.toString()})(${JSON.stringify(action)},${JSON.stringify({ ...data, id })})`,
      },
    ]);
  };
  try {
    const snapshot = (await run("begin", { selection })) as
      { texts: string[]; limited: boolean } | false;
    if (!snapshot) return false;
    if (!snapshot.texts.length) {
      await run("status", { text: "No readable page text to translate." });
      return false;
    }
    let cursor = 0;
    let completed = 0;
    let failed = 0;
    const cache = new Map<string, Promise<string>>();
    // Bound parallel requests and total page text. Never watch or automatically upload new content.
    await Promise.all(
      Array.from({ length: Math.min(4, snapshot.texts.length) }, async () => {
        while (!controller.signal.aborted && cursor < snapshot.texts.length) {
          const index = cursor++;
          if (!(await run("active"))) {
            controller.abort();
            return;
          }
          const original = snapshot.texts[index]!;
          try {
            let request = cache.get(original);
            if (!request) {
              request = translateText(original, target, controller.signal);
              cache.set(original, request);
            }
            const translated = await request;
            if (
              !(await run("apply", {
                index,
                original,
                text: translated,
                selection: Boolean(selection),
              }))
            ) {
              controller.abort();
              return;
            }
            completed++;
          } catch {
            failed++;
            // Do not hammer a rate-limited/offline provider for the remainder of a large page.
            if (failed >= 4) return;
          }
          if (failed >= 4) return;
        }
      }),
    );
    if (controller.signal.aborted) return false;
    const incomplete =
      failed > 0 || cursor < snapshot.texts.length || snapshot.limited;
    await run("status", {
      text:
        completed === 0
          ? "Translation unavailable. Try again, or use Open in Google Translate from the page menu."
          : incomplete
            ? "Partly translated with Google. Some content was skipped or could not be translated."
            : selection
              ? "Selection translated with Google"
              : "Page translated with Google",
    });
    return completed > 0;
  } catch {
    try {
      await run("status", {
        text: "Translation unavailable. Please try again.",
      });
    } catch {
      /* Page navigated away. */
    }
    return false;
  } finally {
    contents.removeListener("did-start-navigation", navigation);
    contents.removeListener("destroyed", stop);
    if (jobs.get(contents) === controller) jobs.delete(contents);
  }
}
