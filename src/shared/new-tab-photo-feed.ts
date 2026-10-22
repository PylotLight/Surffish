import type { NewTabBackground } from "./types.ts";

export const MAX_REMOTE_NEW_TAB_BACKGROUNDS = 2;
export const NEW_TAB_PHOTO_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const MAX_NEW_TAB_PHOTO_BYTES = 2 * 1024 * 1024;
export const WIKIMEDIA_NATURE_SEARCHES = [
  "filetype:bitmap mountain lake photo",
  "filetype:bitmap forest lake landscape photo",
] as const;

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const IMAGE_URL_HOSTS = new Set([
  "upload.wikimedia.org",
  "thumb.wikimedia.org",
]);

export interface WikimediaPhotoCandidate extends Omit<NewTabBackground, "src"> {
  imageUrl: string;
  mimeType: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function plainText(value: unknown, maxLength = 160): string {
  if (typeof value !== "string") return "";
  const withoutTags = value.replace(/<[^>]*>/g, " ");
  const decoded = withoutTags.replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (entity, code: string) => {
      const normalized = code.toLowerCase();
      if (normalized === "amp") return "&";
      if (normalized === "lt") return "<";
      if (normalized === "gt") return ">";
      if (normalized === "quot") return '"';
      if (normalized === "apos") return "'";
      if (normalized === "nbsp") return " ";
      const number = normalized.startsWith("#x")
        ? Number.parseInt(normalized.slice(2), 16)
        : Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(number) && number >= 0 && number <= 0x10ffff
        ? String.fromCodePoint(number)
        : entity;
    },
  );
  return decoded
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function safeHttpsUrl(
  value: unknown,
  allowedHosts: ReadonlySet<string>,
): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !allowedHosts.has(url.hostname.toLowerCase()) ||
      url.username ||
      url.password
    )
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

function readMetadata(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key];
  return isRecord(value) ? plainText(value.value) : "";
}

export function isPermittedWikimediaPhotoLicense(
  name: string,
  licenseUrl: string,
): boolean {
  const shortName = plainText(name, 48).replace(/\s+/g, " ").toUpperCase();
  let url: URL;
  try {
    url = new URL(licenseUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.hostname !== "creativecommons.org")
    return false;

  if (
    (shortName === "CC0" || shortName === "CC0 1.0") &&
    url.pathname.replace(/\/$/, "") === "/publicdomain/zero/1.0"
  )
    return true;
  const match = /^CC BY (2\.0|2\.5|3\.0|4\.0)$/.exec(shortName);
  return Boolean(
    match && url.pathname.replace(/\/$/, "") === `/licenses/by/${match[1]}`,
  );
}

export function parseWikimediaPhotoPage(
  value: unknown,
): WikimediaPhotoCandidate | null {
  if (!isRecord(value) || !Array.isArray(value.imageinfo)) return null;
  const pageTitle = typeof value.title === "string" ? value.title : "";
  const imageInfo = value.imageinfo.find(isRecord);
  if (!imageInfo || !isRecord(imageInfo.extmetadata)) return null;

  const sourceMimeType =
    typeof imageInfo.mime === "string" ? imageInfo.mime.toLowerCase() : "";
  const mimeType =
    typeof imageInfo.thumbmime === "string"
      ? imageInfo.thumbmime.toLowerCase()
      : sourceMimeType;
  const width = Number(imageInfo.width);
  const height = Number(imageInfo.height);
  if (
    !IMAGE_MIME_TYPES.has(sourceMimeType) ||
    !IMAGE_MIME_TYPES.has(mimeType) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  )
    return null;
  if (width < 1280 || height < 720 || width < height * 1.25) return null;

  const sourceUrl = safeHttpsUrl(
    imageInfo.descriptionurl,
    new Set(["commons.wikimedia.org"]),
  );
  const imageUrl = safeHttpsUrl(imageInfo.thumburl, IMAGE_URL_HOSTS);
  if (
    !sourceUrl ||
    !imageUrl ||
    !new URL(sourceUrl).pathname.startsWith("/wiki/File:")
  )
    return null;

  const metadata = imageInfo.extmetadata;
  const creator = readMetadata(metadata, "Artist");
  const title =
    readMetadata(metadata, "ObjectName") ||
    plainText(pageTitle.replace(/^File:/i, "").replace(/_/g, " "), 120);
  const licenseName = readMetadata(metadata, "LicenseShortName");
  const licenseUrl = safeHttpsUrl(
    readMetadata(metadata, "LicenseUrl"),
    new Set(["creativecommons.org"]),
  );
  if (
    !creator ||
    !title ||
    !licenseName ||
    !licenseUrl ||
    !isPermittedWikimediaPhotoLicense(licenseName, licenseUrl)
  )
    return null;

  return {
    id: sourceUrl,
    title,
    creator,
    sourceUrl,
    licenseName,
    licenseUrl,
    imageUrl,
    mimeType,
  };
}

export function parseWikimediaPhotoSearchResults(
  value: unknown,
): WikimediaPhotoCandidate[] {
  if (
    !isRecord(value) ||
    !isRecord(value.query) ||
    !Array.isArray(value.query.pages)
  )
    return [];
  const unique = new Map<string, WikimediaPhotoCandidate>();
  for (const page of value.query.pages) {
    const candidate = parseWikimediaPhotoPage(page);
    if (candidate) unique.set(candidate.id, candidate);
  }
  return [...unique.values()];
}

export function parseCachedNewTabBackground(
  value: unknown,
): NewTabBackground | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id : "";
  const sourceUrl = safeHttpsUrl(
    value.sourceUrl,
    new Set(["commons.wikimedia.org"]),
  );
  const licenseUrl = safeHttpsUrl(
    value.licenseUrl,
    new Set(["creativecommons.org"]),
  );
  const src = typeof value.src === "string" ? value.src : "";
  const title = plainText(value.title, 120);
  const creator = plainText(value.creator, 160);
  const licenseName = plainText(value.licenseName, 48);
  const dataUrlPattern = new RegExp(
    `^data:image\\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$`,
  );
  if (
    !sourceUrl ||
    !licenseUrl ||
    id !== sourceUrl ||
    !title ||
    !creator ||
    !isPermittedWikimediaPhotoLicense(licenseName, licenseUrl)
  )
    return null;
  if (!dataUrlPattern.test(src) || src.length > 3_000_000) return null;
  return { id, src, title, creator, sourceUrl, licenseName, licenseUrl };
}

export function parseCachedNewTabBackgrounds(
  value: unknown,
): NewTabBackground[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, NewTabBackground>();
  for (const entry of value) {
    const background = parseCachedNewTabBackground(entry);
    if (background) unique.set(background.id, background);
    if (unique.size >= MAX_REMOTE_NEW_TAB_BACKGROUNDS) break;
  }
  return [...unique.values()];
}
