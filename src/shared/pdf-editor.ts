// Shared, side-effect free helpers for the built-in PDF editor (pdf.js + pdf-lib). The editor page is
// served from its own privileged scheme on an isolated in-memory session; only main hands it bytes.

export const PDF_EDITOR_SCHEME = "surffish-pdf";
export const PDF_EDITOR_HOST = "editor";
export const PDF_EDITOR_ORIGIN = `${PDF_EDITOR_SCHEME}://${PDF_EDITOR_HOST}`;
export const PDF_EDITOR_PAGE = "pdf-editor.html";
export const PDF_EDITOR_URL = `${PDF_EDITOR_ORIGIN}/${PDF_EDITOR_PAGE}`;
/** Bigger documents are left to the built-in viewer; the editor holds the whole file in memory. */
export const MAX_PDF_EDITOR_BYTES = 200 * 1024 * 1024;
export const PDF_EDITOR_TITLE_PREFIX = "Editing – ";

/** Static files the editor page may load: its HTML, Vite's hashed assets and the bundled pdf.js data. */
const ASSET_PATH = /^(?:assets|pdfjs)\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/;

/**
 * Map a request on the editor scheme to a path relative to the renderer output directory, or null.
 * Only the editor origin, and only the editor page, `assets/` and `pdfjs/` files, are ever served.
 */
export function pdfEditorAssetPath(requestUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (
    url.protocol !== `${PDF_EDITOR_SCHEME}:` ||
    url.host !== PDF_EDITOR_HOST ||
    url.username ||
    url.password
  )
    return null;
  let path: string;
  try {
    path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  } catch {
    return null;
  }
  if (path === PDF_EDITOR_PAGE) return path;
  if (
    !ASSET_PATH.test(path) ||
    path.split("/").some((part) => part === "." || part === "..")
  )
    return null;
  return path;
}

export function isPdfEditorUrl(value: string): boolean {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return url.toString() === PDF_EDITOR_URL;
  } catch {
    return false;
  }
}

const UNSAFE_FILENAME = new RegExp(
  '[\\/:*?"<>|' +
    String.fromCharCode(0) +
    "-" +
    String.fromCharCode(31) +
    String.fromCharCode(127) +
    "]",
  "g",
);

function cleanFilename(value: string): string {
  return value
    .replace(UNSAFE_FILENAME, "_")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 180);
}

/** A display/file name for a PDF at `sourceUrl` (http(s) or file://), always ending in .pdf. */
export function pdfNameFromUrl(
  sourceUrl: string,
  fallback = "document",
): string {
  let name: string;
  try {
    const url = new URL(sourceUrl);
    name =
      decodeURIComponent(url.pathname.split("/").pop() || "") ||
      (url.protocol === "file:" ? "" : url.hostname);
  } catch {
    name = "";
  }
  const safe = cleanFilename(name) || fallback;
  return /\.pdf$/i.test(safe) ? safe : `${safe}.pdf`;
}

/** Default Save name: `report.pdf` → `report-edited.pdf` (never doubles the suffix). */
export function editedPdfFilename(name: string): string {
  const base = (cleanFilename(name) || "document").replace(/\.pdf$/i, "");
  const stem = base.replace(/-edited$/i, "");
  return `${stem || "document"}-edited.pdf`;
}

/** Tab title while editing: "Editing – report.pdf", with a dot when there are unsaved changes. */
export function pdfEditorTabTitle(name: string, dirty: boolean): string {
  return `${dirty ? "• " : ""}${PDF_EDITOR_TITLE_PREFIX}${name}`;
}

/** Make sure a path picked in the Save dialog ends in .pdf. */
export function withPdfExtension(filePath: string): string {
  return /\.pdf$/i.test(filePath) ? filePath : `${filePath}.pdf`;
}

/** Sources the editor can load: http(s) (fetched with the tab's session) or a local file:// path. */
export function isEditablePdfSource(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === "http:" || url.protocol === "https:") return true;
    return (
      url.protocol === "file:" &&
      (url.hostname === "" || url.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

/**
 * PDFs a page made itself (blob:, or a data: URL Chromium let through as a download-turned-tab).
 * main can't fetch these, so the editor reads the bytes from the tab's own renderer instead.
 */
export function isInMemoryPdfSource(value: string): boolean {
  if (/^data:application\/(?:pdf|x-pdf|octet-stream)[;,]/i.test(value))
    return true;
  if (!/^blob:/i.test(value)) return false;
  try {
    const inner = new URL(value.slice("blob:".length));
    return (
      inner.protocol === "https:" ||
      inner.protocol === "http:" ||
      inner.protocol === "file:"
    );
  } catch {
    return false;
  }
}

/** Bytes of a `data:` PDF URL (base64 or percent-encoded), or null when it isn't one. */
export function decodePdfDataUrl(value: string): Uint8Array | null {
  const match = /^data:([^,]*),(.*)$/is.exec(value);
  if (!match) return null;
  const meta = match[1] ?? "";
  const payload = match[2] ?? "";
  try {
    if (/;base64$/i.test(meta)) {
      const binary = atob(decodeURIComponent(payload).replace(/\s+/g, ""));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1)
        bytes[index] = binary.charCodeAt(index);
      return bytes;
    }
    return new TextEncoder().encode(decodeURIComponent(payload));
  } catch {
    return null;
  }
}

const UUID_LIKE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\.pdf)?$/i;

/** A name for a page-made PDF: the viewer's title when it is a real file name, else `document.pdf`. */
export function inMemoryPdfName(title: string | null | undefined): string {
  const trimmed = (title ?? "").trim();
  if (
    !trimmed ||
    UUID_LIKE.test(trimmed) ||
    /^(?:blob|data):/i.test(trimmed) ||
    /^https?:\/\//i.test(trimmed)
  )
    return "document.pdf";
  const safe = cleanFilename(trimmed);
  if (!safe) return "document.pdf";
  return /\.pdf$/i.test(safe) ? safe : `${safe}.pdf`;
}

/** Quick magic-number check so a login page or an error HTML never reaches pdf.js as a "PDF". */
export function looksLikePdf(bytes: Uint8Array): boolean {
  // %PDF- may follow up to 1 KB of junk per the spec's implementation notes.
  const limit = Math.min(bytes.length - 5, 1024);
  for (let index = 0; index <= limit; index += 1) {
    if (
      bytes[index] === 0x25 &&
      bytes[index + 1] === 0x50 &&
      bytes[index + 2] === 0x44 &&
      bytes[index + 3] === 0x46 &&
      bytes[index + 4] === 0x2d
    )
      return true;
  }
  return false;
}
