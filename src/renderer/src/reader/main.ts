// Surffish Reader view: renders a Readability article on surffish-reader://reader/, an isolated
// in-memory session with no network. The article HTML came from the web page, so it is run through
// DOMPurify before it touches the DOM; images load through main's per-article proxy.
import DOMPurify from "dompurify";
import {
  formatReadingTime,
  normalizeReaderSettings,
  READER_FONT_SIZE_MAX,
  READER_FONT_SIZE_MIN,
  readerImageUrl,
  type ReaderArticle,
  type ReaderSettings,
} from "../../../shared/reader";
import { locateSentence } from "../../../shared/read-aloud-text";
import "./reader.css";

type LoadResult =
  | {
      ok: true;
      token: string;
      isPrivate: boolean;
      settings: ReaderSettings;
      article: ReaderArticle;
      readAloud?: boolean;
    }
  | { ok: false; error: string };

interface SurffishReaderBridge {
  load(): Promise<LoadResult>;
  setSettings(settings: ReaderSettings): Promise<ReaderSettings>;
  back(): void;
  onSettings(callback: (settings: ReaderSettings) => void): void;
  readAloud?(): void;
  onReadAloud?(
    callback: (sentence: { index: number; text: string }) => void,
  ): void;
}

const bridge = (window as unknown as { surffishReader?: SurffishReaderBridge })
  .surffishReader;
const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;
const articleElement = $<HTMLElement>("article");
const meta = $<HTMLDivElement>("meta");
const settingsPanel = $<HTMLDivElement>("settings");
const settingsToggle = $<HTMLButtonElement>("settingsToggle");
const sizeValue = $<HTMLOutputElement>("sizeValue");
let settings: ReaderSettings = normalizeReaderSettings(null);

/** Tags that would bring forms, frames, media players or page styles into the reader. */
const FORBID_TAGS = [
  "style",
  "link",
  "meta",
  "base",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "option",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "video",
  "audio",
  "source",
  "track",
  "canvas",
  "dialog",
  "template",
  "noscript",
];
const FORBID_ATTR = [
  "style",
  "class",
  "srcset",
  "sizes",
  "loading",
  "decoding",
  "fetchpriority",
  "ping",
  "background",
  "poster",
  "formaction",
  "action",
  "width",
  "height",
];

function sanitizeArticle(html: string, token: string): DocumentFragment {
  const fragment = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS,
    FORBID_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: true,
    ALLOWED_URI_REGEXP:
      /^(?:https?:|mailto:|#|data:image\/(?:png|jpe?g|gif|webp|avif);base64,)/i,
  }) as DocumentFragment;
  for (const image of fragment.querySelectorAll("img")) {
    const src = image.getAttribute("src") ?? "";
    if (/^https?:\/\//i.test(src)) {
      image.setAttribute("src", readerImageUrl(token, src));
      image.setAttribute("loading", "lazy");
      image.setAttribute("decoding", "async");
      image.addEventListener("error", () => image.classList.add("is-broken"), {
        once: true,
      });
    } else if (!/^data:image\//i.test(src)) {
      image.remove();
    }
  }
  // <image> inside inline SVG would otherwise try the network (and be refused by the session).
  for (const image of fragment.querySelectorAll("svg image, svg use"))
    image.remove();
  for (const link of fragment.querySelectorAll("a")) {
    const href = link.getAttribute("href") ?? "";
    if (/^https?:\/\//i.test(href))
      link.setAttribute("rel", "noopener noreferrer");
    else if (!href.startsWith("#") && !/^mailto:/i.test(href))
      link.removeAttribute("href");
    link.removeAttribute("target");
  }
  return fragment;
}

function applySettings(next: ReaderSettings): void {
  settings = next;
  const root = document.documentElement;
  root.dataset["theme"] = next.theme;
  root.dataset["font"] = next.font;
  root.dataset["width"] = next.width;
  root.style.setProperty("--reader-font-size", `${next.fontSize}px`);
  sizeValue.textContent = String(next.fontSize);
  for (const button of settingsPanel.querySelectorAll<HTMLButtonElement>(
    '[role="radio"]',
  )) {
    const checked =
      button.dataset["font"] === next.font ||
      button.dataset["width"] === next.width ||
      button.dataset["theme"] === next.theme;
    button.setAttribute("aria-checked", String(checked));
    button.classList.toggle("is-current", checked);
  }
  $<HTMLButtonElement>("smaller").disabled =
    next.fontSize <= READER_FONT_SIZE_MIN;
  $<HTMLButtonElement>("larger").disabled =
    next.fontSize >= READER_FONT_SIZE_MAX;
}

function updateSettings(patch: Partial<ReaderSettings>): void {
  const next = normalizeReaderSettings({ ...settings, ...patch }, settings);
  applySettings(next);
  void bridge
    ?.setSettings(next)
    .then(applySettings)
    .catch(() => undefined);
}

function setSettingsOpen(open: boolean): void {
  settingsPanel.hidden = !open;
  settingsToggle.setAttribute("aria-expanded", String(open));
  if (open)
    settingsPanel
      .querySelector<HTMLButtonElement>('[aria-checked="true"]')
      ?.focus();
}

function formatPublished(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
}

function showError(message: string): void {
  articleElement.setAttribute("aria-busy", "false");
  articleElement.replaceChildren();
  const status = document.createElement("p");
  status.className = "reader-status is-error";
  status.textContent = message;
  articleElement.append(status);
}

function render(result: Extract<LoadResult, { ok: true }>): void {
  const { article } = result;
  document.title = article.title;
  if (article.lang) document.documentElement.lang = article.lang;
  articleElement.dir = article.dir;
  const header = document.createElement("header");
  header.className = "reader-header";
  if (article.siteName) {
    const site = document.createElement("p");
    site.className = "reader-site";
    site.textContent = article.siteName;
    header.append(site);
  }
  const title = document.createElement("h1");
  title.className = "reader-title";
  title.textContent = article.title;
  header.append(title);
  const details = [
    article.byline,
    formatPublished(article.publishedTime),
    formatReadingTime(article.readingMinutes),
  ].filter(Boolean);
  const byline = document.createElement("p");
  byline.className = "reader-byline";
  byline.textContent = details.join(" · ");
  header.append(byline);
  const body = document.createElement("div");
  body.className = "reader-content";
  body.append(sanitizeArticle(article.content, result.token));
  articleElement.replaceChildren(header, body);
  articleElement.setAttribute("aria-busy", "false");
  meta.replaceChildren();
  const time = document.createElement("span");
  time.textContent = formatReadingTime(article.readingMinutes);
  meta.append(time);
  if (result.isPrivate) {
    const badge = document.createElement("span");
    badge.className = "reader-private";
    badge.textContent = "Private";
    badge.title = "Private tab: nothing from this article is saved";
    meta.append(badge);
  }
}

// ---- Read Aloud: highlight the sentence being spoken (CSS Custom Highlight API, no DOM changes) ----
const listenButton = $<HTMLButtonElement>("listen");
const READ_ALOUD_HIGHLIGHT = "read-aloud";
let readAloudSearchFrom = 0;

interface TextIndex {
  text: string;
  nodes: Array<{ node: Text; start: number }>;
}

function articleTextIndex(): TextIndex {
  const nodes: TextIndex["nodes"] = [];
  let text = "";
  const walker = document.createTreeWalker(
    articleElement,
    NodeFilter.SHOW_TEXT,
  );
  for (
    let node = walker.nextNode() as Text | null;
    node;
    node = walker.nextNode() as Text | null
  ) {
    nodes.push({ node, start: text.length });
    text += node.data;
  }
  return { text, nodes };
}

function positionAt(
  index: TextIndex,
  offset: number,
): { node: Text; offset: number } | null {
  for (let i = index.nodes.length - 1; i >= 0; i -= 1) {
    const entry = index.nodes[i]!;
    if (entry.start <= offset)
      return {
        node: entry.node,
        offset: Math.min(offset - entry.start, entry.node.data.length),
      };
  }
  return null;
}

function setListening(listening: boolean): void {
  listenButton.setAttribute("aria-pressed", String(listening));
  listenButton.classList.toggle("is-current", listening);
  listenButton.title = listening
    ? "Stop reading aloud"
    : "Read this article aloud";
  const label = listenButton.querySelector("span");
  if (label) label.textContent = listening ? "Stop" : "Listen";
}

function highlightSentence(sentence: { index: number; text: string }): void {
  const highlights = (CSS as unknown as { highlights?: Map<string, unknown> })
    .highlights;
  const HighlightClass = (
    window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }
  ).Highlight;
  if (sentence.index < 0 || !sentence.text) {
    highlights?.delete(READ_ALOUD_HIGHLIGHT);
    readAloudSearchFrom = 0;
    setListening(false);
    return;
  }
  setListening(true);
  if (!highlights || !HighlightClass) return;
  const index = articleTextIndex();
  const found =
    locateSentence(index.text, sentence.text, readAloudSearchFrom) ??
    locateSentence(index.text, sentence.text, 0);
  if (!found) return;
  readAloudSearchFrom = found[0];
  const start = positionAt(index, found[0]);
  const end = positionAt(index, found[1]);
  if (!start || !end) return;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  highlights.set(READ_ALOUD_HIGHLIGHT, new HighlightClass(range));
  const box = range.getBoundingClientRect();
  const toolbar =
    document.getElementById("toolbar")?.getBoundingClientRect().bottom ?? 0;
  if (box.top < toolbar + 8 || box.bottom > window.innerHeight - 24)
    window.scrollBy({
      top: box.top - toolbar - window.innerHeight * 0.3,
      behavior: "smooth",
    });
}

function wireControls(): void {
  listenButton.addEventListener("click", () => bridge?.readAloud?.());
  $<HTMLButtonElement>("back").addEventListener("click", () => bridge?.back());
  settingsToggle.addEventListener("click", () =>
    setSettingsOpen(settingsPanel.hidden === true),
  );
  $<HTMLButtonElement>("smaller").addEventListener("click", () =>
    updateSettings({ fontSize: settings.fontSize - 1 }),
  );
  $<HTMLButtonElement>("larger").addEventListener("click", () =>
    updateSettings({ fontSize: settings.fontSize + 1 }),
  );
  for (const button of settingsPanel.querySelectorAll<HTMLButtonElement>(
    '[role="radio"]',
  )) {
    button.addEventListener("click", () => {
      const { font, width, theme } = button.dataset;
      updateSettings({
        ...(font ? { font: font as ReaderSettings["font"] } : {}),
        ...(width ? { width: width as ReaderSettings["width"] } : {}),
        ...(theme ? { theme: theme as ReaderSettings["theme"] } : {}),
      });
    });
  }
  document.addEventListener("click", (event) => {
    if (
      !settingsPanel.hidden &&
      !(event.target as Element).closest(".reader-settings-anchor")
    )
      setSettingsOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key !== "Escape" ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    )
      return;
    if (!settingsPanel.hidden) {
      setSettingsOpen(false);
      settingsToggle.focus();
    } else {
      bridge?.back();
    }
    event.preventDefault();
  });
}

async function start(): Promise<void> {
  wireControls();
  applySettings(settings);
  if (!bridge) {
    showError("Reader view is unavailable.");
    return;
  }
  bridge.onSettings((next) => applySettings(normalizeReaderSettings(next)));
  try {
    const result = await bridge.load();
    if (!result.ok) {
      showError(result.error);
      return;
    }
    applySettings(normalizeReaderSettings(result.settings));
    render(result);
    if (result.readAloud && bridge.readAloud) {
      listenButton.hidden = false;
      bridge.onReadAloud?.(highlightSentence);
    }
  } catch {
    showError("Reader view could not load this article.");
  }
}

void start();
