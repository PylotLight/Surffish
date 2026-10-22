/**
 * Feeds (RSS 2.0 / RSS 1.0, Atom, JSON Feed, and GitHub Actions workflow runs): parsing, the stored
 * record, merging new items with read state, and polling decisions with error backoff. Pure (no
 * Electron imports), so main, the preload types and the unit tests share it. The Atom/XML reading
 * reuses the small regex helpers from update-feed.ts.
 */
import {
  attribute,
  decodeXmlEntities,
  elementText,
  httpUrlOrEmpty,
  releaseNotesToText,
} from "./update-feed";
import { displayHost } from "./url-host";

export const FEED_INTERVALS = [5, 15, 30, 60, 180, 360, 1440] as const;
export type FeedIntervalMinutes = (typeof FEED_INTERVALS)[number];
export const DEFAULT_FEED_INTERVAL: FeedIntervalMinutes = 30;
export const MIN_FEED_INTERVAL_MINUTES = 5;
/** Unauthenticated GitHub API calls are limited to 60/hour per IP: never poll it faster than this. */
export const GITHUB_API_MIN_INTERVAL_MINUTES = 15;
export const MAX_FEEDS = 100;
export const MAX_ITEMS_PER_FEED = 200;
export const MAX_CONCURRENT_FEED_CHECKS = 3;
export const FEED_MAX_BYTES = 5 * 1024 * 1024;
export const MAX_FEED_BACKOFF_MS = 24 * 60 * 60 * 1000;
export const FEED_BLOCKED_RETRY_MS = 5 * 60 * 1000;
const MIN_WAKE_MS = 1_000;
const MAX_WAKE_MS = 6 * 60 * 60 * 1000;
const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 300;
const MAX_SUMMARY_LENGTH = 280;
const MAX_KEY_LENGTH = 500;

export function isFeedInterval(value: unknown): value is FeedIntervalMinutes {
  return (
    typeof value === "number" &&
    (FEED_INTERVALS as readonly number[]).includes(value)
  );
}

export function feedIntervalLabel(minutes: number): string {
  if (minutes < 60) return `Every ${minutes} min`;
  if (minutes === 60) return "Every hour";
  if (minutes < 1440) return `Every ${minutes / 60} hours`;
  return "Every day";
}

// ---------------------------------------------------------------------------------------------
// Parsing

export interface ParsedFeedItem {
  /** Stable dedupe key: guid / id, else link, else title + date. */
  key: string;
  title: string;
  /** http(s) link to open, or ''. */
  link: string;
  /** Epoch ms, or null when the feed gives no (parseable) date. */
  publishedAt: number | null;
  author: string;
  /** Plain text, one line, short. Safe to render as text. */
  summary: string;
}

export interface ParsedFeed {
  format: "rss" | "atom" | "json" | "github-actions";
  title: string;
  siteUrl: string;
  items: ParsedFeedItem[];
}

export type ParseFeedResult =
  { ok: true; feed: ParsedFeed } | { ok: false; error: string; html?: boolean };

function oneLine(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Titles may carry markup (Atom type="html", entity-encoded RSS): text only. */
function plainTitle(value: string): string {
  return oneLine(
    decodeXmlEntities(value.replace(/<[^>]*>/g, "")),
    MAX_TITLE_LENGTH,
  );
}

function plainSummary(html: string): string {
  if (!html) return "";
  return oneLine(releaseNotesToText(html.slice(0, 50_000)), MAX_SUMMARY_LENGTH);
}

function parseDate(value: string): number | null {
  if (!value) return null;
  const time = Date.parse(value.trim());
  return Number.isFinite(time) ? time : null;
}

function itemKey(
  id: string,
  link: string,
  title: string,
  date: string,
): string {
  const key = id.trim() || link || `${title}|${date}`;
  return key.slice(0, MAX_KEY_LENGTH);
}

function resolveLink(value: string, base: string): string {
  if (!value) return "";
  try {
    return httpUrlOrEmpty(new URL(value.trim(), base || undefined).toString());
  } catch {
    return "";
  }
}

/** Remove nested blocks so a channel-level lookup never reads an item's element. */
function withoutBlocks(xml: string, name: string): string {
  return xml.replace(
    new RegExp(`<${name}\\b[^>]*>[\\s\\S]*?</${name}>`, "gi"),
    "",
  );
}

function parseRss(xml: string, baseUrl: string): ParsedFeed {
  const channelMatch = /<channel\b[^>]*>([\s\S]*?)<\/channel>/i.exec(xml);
  const channel = withoutBlocks(channelMatch?.[1] ?? xml, "item");
  const siteUrl = resolveLink(elementText(channel, "link"), baseUrl);
  const items: ParsedFeedItem[] = [];
  for (const match of xml.matchAll(/<item\b([^>]*)>([\s\S]*?)<\/item>/gi)) {
    const block = match[2] ?? "";
    const rdfAbout = attribute(`<item${match[1] ?? ""}>`, "rdf:about");
    const guid = elementText(block, "guid") || rdfAbout;
    const guidTag = /<guid\b[^>]*>/i.exec(block)?.[0] ?? "";
    const guidIsLink =
      guidTag &&
      attribute(guidTag, "isPermaLink") !== "false" &&
      /^https?:\/\//i.test(guid);
    const link =
      resolveLink(elementText(block, "link"), siteUrl || baseUrl) ||
      (guidIsLink ? resolveLink(guid, baseUrl) : "");
    const rawTitle = elementText(block, "title");
    const date =
      elementText(block, "pubDate") ||
      elementText(block, "dc:date") ||
      elementText(block, "updated");
    const body =
      elementText(block, "description") ||
      elementText(block, "content:encoded");
    const title =
      plainTitle(rawTitle) || plainSummary(body).slice(0, 120) || "(untitled)";
    items.push({
      key: itemKey(guid, link, title, date),
      title,
      link,
      publishedAt: parseDate(date),
      author: oneLine(
        elementText(block, "dc:creator") || elementText(block, "author"),
        120,
      ),
      summary: plainSummary(body),
    });
  }
  return {
    format: "rss",
    title: plainTitle(elementText(channel, "title")),
    siteUrl,
    items,
  };
}

/** rel="alternate" (or no rel) <link href>, relative hrefs resolved. */
function atomLink(block: string, baseUrl: string): string {
  const links = block.match(/<link\b[^>]*>/gi) ?? [];
  const alternate = links.find((tag) => {
    const rel = attribute(tag, "rel");
    return (rel === "" || rel === "alternate") && attribute(tag, "href");
  });
  return alternate ? resolveLink(attribute(alternate, "href"), baseUrl) : "";
}

function parseAtom(xml: string, baseUrl: string): ParsedFeed {
  const head = withoutBlocks(xml, "entry");
  const siteUrl = atomLink(head, baseUrl);
  const items: ParsedFeedItem[] = [];
  for (const match of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    const block = match[1] ?? "";
    const id = elementText(block, "id");
    const link = atomLink(block, siteUrl || baseUrl);
    const date =
      elementText(block, "published") || elementText(block, "updated");
    const body = elementText(block, "summary") || elementText(block, "content");
    const title =
      plainTitle(elementText(block, "title")) ||
      plainSummary(body).slice(0, 120) ||
      "(untitled)";
    const author =
      /<author\b[^>]*>([\s\S]*?)<\/author>/i.exec(block)?.[1] ?? "";
    items.push({
      key: itemKey(id, link, title, date),
      title,
      link,
      publishedAt: parseDate(date),
      author: oneLine(author ? elementText(author, "name") : "", 120),
      summary: plainSummary(body),
    });
  }
  return {
    format: "atom",
    title: plainTitle(elementText(head, "title")),
    siteUrl,
    items,
  };
}

function text(value: unknown): string {
  return typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : "";
}

function parseJsonFeed(
  record: Record<string, unknown>,
  baseUrl: string,
): ParsedFeed {
  const siteUrl = resolveLink(text(record.home_page_url), baseUrl);
  const items: ParsedFeedItem[] = [];
  for (const raw of Array.isArray(record.items) ? record.items : []) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const link = resolveLink(
      text(item.url) || text(item.external_url),
      siteUrl || baseUrl,
    );
    const date = text(item.date_published) || text(item.date_modified);
    const body =
      text(item.summary) || text(item.content_text) || text(item.content_html);
    const title =
      plainTitle(text(item.title)) ||
      plainSummary(body).slice(0, 120) ||
      "(untitled)";
    const authors = Array.isArray(item.authors)
      ? item.authors
      : item.author
        ? [item.author]
        : [];
    const firstAuthor =
      authors[0] && typeof authors[0] === "object"
        ? text((authors[0] as Record<string, unknown>).name)
        : "";
    items.push({
      key: itemKey(text(item.id), link, title, date),
      title,
      link,
      publishedAt: parseDate(date),
      author: oneLine(firstAuthor, 120),
      summary: plainSummary(body),
    });
  }
  return {
    format: "json",
    title: plainTitle(text(record.title)),
    siteUrl,
    items,
  };
}

const RUN_CONCLUSION_LABEL: Record<string, string> = {
  success: "✅ passed",
  failure: "❌ failed",
  cancelled: "⚪ cancelled",
  timed_out: "⏱ timed out",
  action_required: "⚠️ action required",
  neutral: "⚪ neutral",
  skipped: "⚪ skipped",
  stale: "⚪ stale",
  startup_failure: "❌ startup failure",
};

/**
 * GitHub's REST "list workflow runs" response (GET /repos/{owner}/{repo}/actions/runs). Only
 * finished runs become items: a run that is still going would otherwise show up as new twice.
 */
function parseGitHubActionsRuns(
  record: Record<string, unknown>,
  feedUrl: string,
): ParsedFeed {
  const items: ParsedFeedItem[] = [];
  let repoName = "";
  for (const raw of Array.isArray(record.workflow_runs)
    ? record.workflow_runs
    : []) {
    if (typeof raw !== "object" || raw === null) continue;
    const run = raw as Record<string, unknown>;
    if (run.status !== "completed") continue;
    const repository =
      run.repository && typeof run.repository === "object"
        ? (run.repository as Record<string, unknown>)
        : {};
    repoName ||= text(repository.full_name);
    const conclusion = text(run.conclusion);
    const name = text(run.name) || "Workflow";
    const number = text(run.run_number);
    const attempt =
      Number(run.run_attempt) > 1 ? ` (attempt ${text(run.run_attempt)})` : "";
    const status =
      RUN_CONCLUSION_LABEL[conclusion] ?? (conclusion || "completed");
    const branch = text(run.head_branch);
    const actor =
      run.actor && typeof run.actor === "object"
        ? text((run.actor as Record<string, unknown>).login)
        : "";
    items.push({
      key: `run:${text(run.id)}:${text(run.run_attempt) || "1"}`.slice(
        0,
        MAX_KEY_LENGTH,
      ),
      title: plainTitle(
        `${name} #${number}${attempt} ${status}${branch ? ` · ${branch}` : ""}`,
      ),
      link: httpUrlOrEmpty(text(run.html_url)),
      publishedAt: parseDate(
        text(run.updated_at) ||
          text(run.run_started_at) ||
          text(run.created_at),
      ),
      author: oneLine(actor, 120),
      summary: oneLine(
        `${text(run.display_title)}${text(run.event) ? ` · ${text(run.event)}` : ""}`,
        MAX_SUMMARY_LENGTH,
      ),
    });
  }
  const fromUrl = parseGitHubApiRunsUrl(feedUrl);
  const repo = repoName || (fromUrl ? `${fromUrl.owner}/${fromUrl.repo}` : "");
  return {
    format: "github-actions",
    title: repo ? `${repo} · Actions runs` : "GitHub Actions runs",
    siteUrl: repo ? `https://github.com/${repo}/actions` : "",
    items,
  };
}

function looksLikeHtml(body: string): boolean {
  return (
    /^\s*(?:<!doctype html|<html\b)/i.test(body) ||
    (/<head\b/i.test(body) && /<body\b/i.test(body))
  );
}

/** Detect the format and parse. Never throws: bad input is { ok: false, error }. */
export function parseFeed(body: string, feedUrl = ""): ParseFeedResult {
  const trimmed = body.replace(/^\uFEFF/, "").trimStart();
  if (!trimmed) return { ok: false, error: "The feed is empty." };
  try {
    if (trimmed.startsWith("{")) {
      let json: unknown;
      try {
        json = JSON.parse(trimmed);
      } catch {
        return { ok: false, error: "The feed is not valid JSON." };
      }
      if (typeof json !== "object" || json === null || Array.isArray(json))
        return { ok: false, error: "The feed is not a JSON Feed." };
      const record = json as Record<string, unknown>;
      if (Array.isArray(record.workflow_runs))
        return { ok: true, feed: parseGitHubActionsRuns(record, feedUrl) };
      if (
        /jsonfeed\.org/i.test(text(record.version)) ||
        Array.isArray(record.items)
      )
        return { ok: true, feed: parseJsonFeed(record, feedUrl) };
      return {
        ok: false,
        error: "The address returned JSON, but not a JSON Feed.",
      };
    }
    if (/<feed\b/i.test(trimmed) && !looksLikeHtml(trimmed))
      return { ok: true, feed: parseAtom(trimmed, feedUrl) };
    if (
      /<rss\b|<rdf:RDF\b|<channel\b/i.test(trimmed) &&
      !looksLikeHtml(trimmed)
    )
      return { ok: true, feed: parseRss(trimmed, feedUrl) };
    if (looksLikeHtml(trimmed))
      return {
        ok: false,
        error: "This address is a web page, not a feed.",
        html: true,
      };
    return {
      ok: false,
      error: "This address is not an RSS, Atom or JSON feed.",
    };
  } catch (error) {
    return {
      ok: false,
      error: `Could not read the feed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Discovery + URL helpers

export interface DiscoveredFeed {
  url: string;
  title: string;
  type: "rss" | "atom" | "json" | "github";
}

const FEED_LINK_TYPES: Record<string, DiscoveredFeed["type"]> = {
  "application/rss+xml": "rss",
  "application/atom+xml": "atom",
  "application/feed+json": "json",
  "application/json": "json",
  "application/rdf+xml": "rss",
};

/** Normalize the raw <link> list a page advertises (from HTML or from the live DOM). */
export function normalizeDiscoveredLinks(
  links: ReadonlyArray<{
    rel?: unknown;
    type?: unknown;
    href?: unknown;
    title?: unknown;
  }>,
  baseUrl: string,
): DiscoveredFeed[] {
  const found: DiscoveredFeed[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    const rel = text(link.rel).toLowerCase().split(/\s+/);
    if (!rel.includes("alternate")) continue;
    const type =
      FEED_LINK_TYPES[text(link.type).toLowerCase().split(";")[0]!.trim()];
    if (!type) continue;
    if (
      type === "json" &&
      text(link.type).toLowerCase().startsWith("application/json")
    )
      continue; // too generic (oEmbed etc.)
    const url = resolveLink(text(link.href), baseUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    found.push({
      url,
      title:
        plainTitle(text(link.title)) ||
        (type === "atom"
          ? "Atom feed"
          : type === "json"
            ? "JSON feed"
            : "RSS feed"),
      type,
    });
    if (found.length >= 20) break;
  }
  return found;
}

/** `<link rel="alternate" type="application/rss+xml|atom+xml|feed+json">` tags in an HTML page. */
export function discoverFeedLinks(
  html: string,
  baseUrl: string,
): DiscoveredFeed[] {
  const head = html.slice(0, 500_000);
  const baseHref = /<base\b[^>]*>/i.exec(head)?.[0];
  const base = baseHref
    ? resolveLink(attribute(baseHref, "href"), baseUrl) || baseUrl
    : baseUrl;
  const links = (head.match(/<link\b[^>]*>/gi) ?? []).map((tag) => ({
    rel: attribute(tag, "rel"),
    type: attribute(tag, "type"),
    href: attribute(tag, "href"),
    title: attribute(tag, "title"),
  }));
  return normalizeDiscoveredLinks(links, base);
}

export function normalizeFeedAddress(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;
  if (/^feed:\/\//i.test(trimmed)) trimmed = `https://${trimmed.slice(7)}`;
  else if (/^feed:/i.test(trimmed)) trimmed = trimmed.slice(5);
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) trimmed = `https://${trimmed}`;
  try {
    const url = new URL(trimmed);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      !url.hostname
    )
      return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/** Safe for logs and errors: no credentials, query string or fragment. */
export function redactFeedAddress(input: string): string {
  try {
    const url = new URL(input);
    return `${url.protocol}//${url.host}${url.pathname}${url.search ? "?…" : ""}`;
  } catch {
    return "(invalid URL)";
  }
}

const GITHUB_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/;

/** "owner/repo", "github.com/owner/repo", or any github.com URL inside a repo. */
export function parseGitHubRepo(
  input: unknown,
): { owner: string; repo: string } | null {
  if (typeof input !== "string") return null;
  let value = input.trim().replace(/\.git$/i, "");
  const urlMatch =
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)/i.exec(value);
  if (urlMatch) value = `${urlMatch[1]}/${urlMatch[2]}`;
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(value);
  if (!match) return null;
  const owner = match[1]!;
  const repo = match[2]!.replace(/\.git$/i, "");
  if (
    !GITHUB_NAME.test(owner) ||
    !GITHUB_NAME.test(repo) ||
    repo === "." ||
    repo === ".."
  )
    return null;
  return { owner, repo };
}

export type GitHubFeedKind = "releases" | "commits" | "tags" | "actions";

export const GITHUB_FEED_KINDS: ReadonlyArray<{
  kind: GitHubFeedKind;
  label: string;
}> = [
  { kind: "releases", label: "Releases" },
  { kind: "commits", label: "Commits (default branch)" },
  { kind: "tags", label: "Tags" },
  { kind: "actions", label: "Actions runs (CI)" },
];

/** Feed URL for a repo: GitHub's own Atom feeds, or the public REST API for Actions runs. */
export function gitHubFeedUrl(
  owner: string,
  repo: string,
  kind: GitHubFeedKind,
  branch = "",
): string {
  const base = `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const cleanBranch = branch.trim();
  switch (kind) {
    case "releases":
      return `https://github.com/${base}/releases.atom`;
    case "tags":
      return `https://github.com/${base}/tags.atom`;
    case "commits":
      return cleanBranch
        ? `https://github.com/${base}/commits/${cleanBranch.split("/").map(encodeURIComponent).join("/")}.atom`
        : `https://github.com/${base}/commits.atom`;
    case "actions":
      return `https://api.github.com/repos/${base}/actions/runs?per_page=20${cleanBranch ? `&branch=${encodeURIComponent(cleanBranch)}` : ""}`;
  }
}

export function gitHubFeedTitle(
  owner: string,
  repo: string,
  kind: GitHubFeedKind,
): string {
  const label =
    kind === "releases"
      ? "Releases"
      : kind === "tags"
        ? "Tags"
        : kind === "commits"
          ? "Commits"
          : "Actions runs";
  return `${owner}/${repo} · ${label}`;
}

export function parseGitHubApiRunsUrl(
  url: string,
): { owner: string; repo: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "api.github.com") return null;
    const match = /^\/repos\/([^/]+)\/([^/]+)\/actions\/runs\/?$/.exec(
      parsed.pathname,
    );
    return match
      ? {
          owner: decodeURIComponent(match[1]!),
          repo: decodeURIComponent(match[2]!),
        }
      : null;
  } catch {
    return null;
  }
}

export function isGitHubApiUrl(url: string): boolean {
  try {
    return new URL(url).hostname === "api.github.com";
  } catch {
    return false;
  }
}

/** Repo feed suggestions for a github.com page (repo pages advertise no feed links themselves). */
export function gitHubSuggestionsForPage(pageUrl: string): DiscoveredFeed[] {
  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return [];
  }
  if (!/^(?:www\.)?github\.com$/i.test(parsed.hostname)) return [];
  const repo = parseGitHubRepo(pageUrl);
  if (!repo) return [];
  if (
    [
      "orgs",
      "settings",
      "marketplace",
      "sponsors",
      "topics",
      "features",
      "about",
    ].includes(repo.owner.toLowerCase())
  )
    return [];
  return GITHUB_FEED_KINDS.map(({ kind }) => ({
    url: gitHubFeedUrl(repo.owner, repo.repo, kind),
    title: gitHubFeedTitle(repo.owner, repo.repo, kind),
    type: "github" as const,
  }));
}

// ---------------------------------------------------------------------------------------------
// Stored record

export interface StoredFeedItem extends ParsedFeedItem {
  firstSeenAt: number;
  read: boolean;
}

export interface Feed {
  id: string;
  url: string;
  /** Title from the feed itself. */
  feedTitle: string;
  /** User's rename; '' means use feedTitle. */
  customTitle: string;
  siteUrl: string;
  /** null: follow the global interval. */
  intervalMinutes: FeedIntervalMinutes | null;
  notify: boolean;
  paused: boolean;
  etag: string;
  lastModified: string;
  createdAt: number;
  lastCheckedAt: number | null;
  lastSuccessAt: number | null;
  nextCheckAt: number;
  consecutiveErrors: number;
  lastError: string | null;
  /** False until the first successful fetch (its items never notify). */
  baselined: boolean;
  items: StoredFeedItem[];
}

export interface FeedSettings {
  intervalMinutes: FeedIntervalMinutes;
}

export const DEFAULT_FEED_SETTINGS: FeedSettings = {
  intervalMinutes: DEFAULT_FEED_INTERVAL,
};

export interface FeedStore {
  settings: FeedSettings;
  feeds: Feed[];
}

export interface FeedSummary {
  id: string;
  url: string;
  title: string;
  customTitle: string;
  feedTitle: string;
  siteUrl: string;
  intervalMinutes: FeedIntervalMinutes | null;
  effectiveIntervalMinutes: number;
  notify: boolean;
  paused: boolean;
  lastCheckedAt: number | null;
  lastSuccessAt: number | null;
  nextCheckAt: number;
  consecutiveErrors: number;
  lastError: string | null;
  itemCount: number;
  unreadCount: number;
}

export interface FeedListItem extends StoredFeedItem {
  feedId: string;
  feedTitle: string;
}

export function feedDisplayTitle(
  feed: Pick<Feed, "customTitle" | "feedTitle" | "url">,
): string {
  return feed.customTitle || feed.feedTitle || displayHost(feed.url);
}

export function effectiveIntervalMinutes(
  feed: Pick<Feed, "intervalMinutes" | "url">,
  settings: FeedSettings,
): number {
  const chosen = feed.intervalMinutes ?? settings.intervalMinutes;
  const floor = isGitHubApiUrl(feed.url)
    ? GITHUB_API_MIN_INTERVAL_MINUTES
    : MIN_FEED_INTERVAL_MINUTES;
  return Math.max(floor, chosen);
}

export function summarizeFeed(feed: Feed, settings: FeedSettings): FeedSummary {
  return {
    id: feed.id,
    url: feed.url,
    title: feedDisplayTitle(feed),
    customTitle: feed.customTitle,
    feedTitle: feed.feedTitle,
    siteUrl: feed.siteUrl,
    intervalMinutes: feed.intervalMinutes,
    effectiveIntervalMinutes: effectiveIntervalMinutes(feed, settings),
    notify: feed.notify,
    paused: feed.paused,
    lastCheckedAt: feed.lastCheckedAt,
    lastSuccessAt: feed.lastSuccessAt,
    nextCheckAt: feed.nextCheckAt,
    consecutiveErrors: feed.consecutiveErrors,
    lastError: feed.lastError,
    itemCount: feed.items.length,
    unreadCount: feed.items.reduce(
      (count, item) => count + (item.read ? 0 : 1),
      0,
    ),
  };
}

function optionalTime(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function parseStoredItem(value: unknown): StoredFeedItem | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const key = str(record.key, MAX_KEY_LENGTH);
  if (!key) return null;
  return {
    key,
    title: str(record.title, MAX_TITLE_LENGTH) || "(untitled)",
    link: httpUrlOrEmpty(str(record.link, MAX_URL_LENGTH)),
    publishedAt: optionalTime(record.publishedAt),
    author: str(record.author, 120),
    summary: str(record.summary, MAX_SUMMARY_LENGTH),
    firstSeenAt: optionalTime(record.firstSeenAt) ?? 0,
    read: record.read === true,
  };
}

export function parseFeedRecord(value: unknown, now: number): Feed | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const url = normalizeFeedAddress(record.url);
  const id = str(record.id, 100);
  if (!url || !id) return null;
  const items = (Array.isArray(record.items) ? record.items : [])
    .map(parseStoredItem)
    .filter((item): item is StoredFeedItem => item !== null)
    .slice(0, MAX_ITEMS_PER_FEED);
  const nextCheckAt = optionalTime(record.nextCheckAt) ?? now;
  return {
    id,
    url,
    feedTitle: str(record.feedTitle, MAX_TITLE_LENGTH),
    customTitle: str(record.customTitle, MAX_TITLE_LENGTH),
    siteUrl: httpUrlOrEmpty(str(record.siteUrl, MAX_URL_LENGTH)),
    intervalMinutes: isFeedInterval(record.intervalMinutes)
      ? record.intervalMinutes
      : null,
    notify: record.notify === true,
    paused: record.paused === true,
    etag: str(record.etag, 500),
    lastModified: str(record.lastModified, 100),
    createdAt: optionalTime(record.createdAt) ?? now,
    lastCheckedAt: optionalTime(record.lastCheckedAt),
    lastSuccessAt: optionalTime(record.lastSuccessAt),
    // A clock jump backwards (or a corrupted file) must not park a feed for years.
    nextCheckAt: Math.min(nextCheckAt, now + MAX_FEED_BACKOFF_MS),
    consecutiveErrors:
      typeof record.consecutiveErrors === "number" &&
      record.consecutiveErrors > 0
        ? Math.min(Math.floor(record.consecutiveErrors), 100)
        : 0,
    lastError:
      typeof record.lastError === "string"
        ? record.lastError.slice(0, 300)
        : null,
    baselined: record.baselined === true,
    items,
  };
}

export function parseFeedStore(value: unknown, now: number): FeedStore {
  const record =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const settingsRecord =
    typeof record.settings === "object" && record.settings !== null
      ? (record.settings as Record<string, unknown>)
      : {};
  const settings: FeedSettings = {
    intervalMinutes: isFeedInterval(settingsRecord.intervalMinutes)
      ? settingsRecord.intervalMinutes
      : DEFAULT_FEED_INTERVAL,
  };
  const feeds: Feed[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(record.feeds) ? record.feeds : []) {
    const feed = parseFeedRecord(raw, now);
    if (!feed || seen.has(feed.id) || seen.has(feed.url)) continue;
    seen.add(feed.id);
    seen.add(feed.url);
    feeds.push(feed);
    if (feeds.length >= MAX_FEEDS) break;
  }
  return { settings, feeds };
}

export interface NewFeedInput {
  url: unknown;
  title?: unknown;
  intervalMinutes?: unknown;
  notify?: unknown;
}

export type CreateFeedResult =
  { ok: true; feed: Feed } | { ok: false; error: string };

export function createFeed(
  input: NewFeedInput,
  existing: readonly Feed[],
  id: string,
  now: number,
): CreateFeedResult {
  const url = normalizeFeedAddress(input.url);
  if (!url) return { ok: false, error: "Enter an http(s) feed address." };
  if (existing.length >= MAX_FEEDS)
    return { ok: false, error: `You can follow up to ${MAX_FEEDS} feeds.` };
  if (existing.some((feed) => feed.url === url))
    return { ok: false, error: "You already follow this feed." };
  if (
    input.intervalMinutes !== undefined &&
    input.intervalMinutes !== null &&
    !isFeedInterval(input.intervalMinutes)
  )
    return { ok: false, error: "Choose one of the listed check intervals." };
  return {
    ok: true,
    feed: {
      id,
      url,
      feedTitle: "",
      customTitle:
        typeof input.title === "string"
          ? oneLine(input.title, MAX_TITLE_LENGTH)
          : "",
      siteUrl: "",
      intervalMinutes: isFeedInterval(input.intervalMinutes)
        ? input.intervalMinutes
        : null,
      notify: input.notify === true,
      paused: false,
      etag: "",
      lastModified: "",
      createdAt: now,
      lastCheckedAt: null,
      lastSuccessAt: null,
      nextCheckAt: now,
      consecutiveErrors: 0,
      lastError: null,
      baselined: false,
      items: [],
    },
  };
}

export interface FeedPatch {
  title?: unknown;
  intervalMinutes?: unknown;
  notify?: unknown;
  paused?: unknown;
}

export type EditFeedResult =
  { ok: true; feed: Feed } | { ok: false; error: string };

/** Rename / interval / notifications / pause. Bad values are a result, never an exception. */
export function editFeed(
  feed: Feed,
  patch: unknown,
  settings: FeedSettings,
  now: number,
): EditFeedResult {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch))
    return { ok: false, error: "Feed changes must be an object." };
  const record = patch as FeedPatch;
  const next: Feed = { ...feed };
  if (record.title !== undefined) {
    if (typeof record.title !== "string")
      return { ok: false, error: "The feed name must be text." };
    next.customTitle = oneLine(record.title, MAX_TITLE_LENGTH);
  }
  if (record.intervalMinutes !== undefined) {
    if (
      record.intervalMinutes !== null &&
      !isFeedInterval(record.intervalMinutes)
    )
      return { ok: false, error: "Choose one of the listed check intervals." };
    next.intervalMinutes = record.intervalMinutes;
    // A shorter interval pulls the next check in.
    if (next.consecutiveErrors === 0 && next.lastCheckedAt !== null)
      next.nextCheckAt = Math.min(
        next.nextCheckAt,
        next.lastCheckedAt + effectiveIntervalMinutes(next, settings) * 60_000,
      );
  }
  if (record.notify !== undefined) {
    if (typeof record.notify !== "boolean")
      return { ok: false, error: "Notifications must be on or off." };
    next.notify = record.notify;
  }
  if (record.paused !== undefined) {
    if (typeof record.paused !== "boolean")
      return { ok: false, error: "Pause must be on or off." };
    next.paused = record.paused;
    if (!record.paused && feed.paused)
      next.nextCheckAt = Math.max(
        now,
        Math.min(
          next.nextCheckAt,
          now + effectiveIntervalMinutes(next, settings) * 60_000,
        ),
      );
  }
  return { ok: true, feed: next };
}

// ---------------------------------------------------------------------------------------------
// Merging + scheduling

export interface MergeOutcome {
  items: StoredFeedItem[];
  /** Items not seen before (empty on the baseline fetch's notification side: see `notifiable`). */
  added: StoredFeedItem[];
}

function sortTime(
  item: Pick<StoredFeedItem, "publishedAt" | "firstSeenAt">,
): number {
  return item.publishedAt ?? item.firstSeenAt;
}

/**
 * Merge a fetch into the stored items: dedupe by key, keep read state, refresh titles/links,
 * newest first, capped. Items that dropped out of the feed stay until the cap pushes them out.
 */
export function mergeFeedItems(
  existing: readonly StoredFeedItem[],
  incoming: readonly ParsedFeedItem[],
  now: number,
  cap = MAX_ITEMS_PER_FEED,
): MergeOutcome {
  const byKey = new Map(existing.map((item) => [item.key, item]));
  const added: StoredFeedItem[] = [];
  const seenIncoming = new Set<string>();
  const merged: StoredFeedItem[] = [];
  for (const item of incoming) {
    if (!item.key || seenIncoming.has(item.key)) continue;
    seenIncoming.add(item.key);
    const previous = byKey.get(item.key);
    if (previous) {
      merged.push({
        ...item,
        firstSeenAt: previous.firstSeenAt,
        read: previous.read,
      });
    } else {
      const fresh: StoredFeedItem = { ...item, firstSeenAt: now, read: false };
      merged.push(fresh);
      added.push(fresh);
    }
  }
  for (const item of existing)
    if (!seenIncoming.has(item.key)) merged.push(item);
  merged.sort((a, b) => sortTime(b) - sortTime(a));
  const kept = merged.slice(0, cap);
  const keptKeys = new Set(kept.map((item) => item.key));
  return { items: kept, added: added.filter((item) => keptKeys.has(item.key)) };
}

export interface FeedFetchSuccess {
  /** null for 304 Not Modified. */
  parsed: ParsedFeed | null;
  etag?: string;
  lastModified?: string;
}

export interface FeedCheckOutcome {
  feed: Feed;
  /** New items worth a notification (never from the baseline fetch). */
  notifiable: StoredFeedItem[];
}

export function applyFeedSuccess(
  feed: Feed,
  result: FeedFetchSuccess,
  settings: FeedSettings,
  now: number,
): FeedCheckOutcome {
  const next: Feed = {
    ...feed,
    etag: result.etag ?? feed.etag,
    lastModified: result.lastModified ?? feed.lastModified,
    lastCheckedAt: now,
    lastSuccessAt: now,
    consecutiveErrors: 0,
    lastError: null,
    nextCheckAt: now + effectiveIntervalMinutes(feed, settings) * 60_000,
  };
  if (!result.parsed)
    return { feed: { ...next, baselined: true }, notifiable: [] };
  const merged = mergeFeedItems(feed.items, result.parsed.items, now);
  next.items = merged.items;
  next.feedTitle = result.parsed.title || feed.feedTitle;
  next.siteUrl = result.parsed.siteUrl || feed.siteUrl;
  next.baselined = true;
  return { feed: next, notifiable: feed.baselined ? merged.added : [] };
}

export function feedBackoffDelayMs(
  intervalMinutes: number,
  errors: number,
): number {
  const base = intervalMinutes * 60_000;
  if (errors <= 0) return base;
  return Math.max(
    base,
    Math.min(base * 2 ** Math.min(errors - 1, 16), MAX_FEED_BACKOFF_MS),
  );
}

/** `retryAt` (from Retry-After or a rate-limit reset) wins when it is later than the backoff. */
export function applyFeedFailure(
  feed: Feed,
  error: string,
  settings: FeedSettings,
  now: number,
  retryAt: number | null = null,
): Feed {
  const consecutiveErrors = feed.consecutiveErrors + 1;
  const backoff =
    now +
    feedBackoffDelayMs(
      effectiveIntervalMinutes(feed, settings),
      consecutiveErrors,
    );
  const nextCheckAt =
    retryAt !== null && retryAt > backoff
      ? Math.min(retryAt, now + MAX_FEED_BACKOFF_MS)
      : backoff;
  return {
    ...feed,
    lastCheckedAt: now,
    consecutiveErrors,
    lastError: error.slice(0, 300),
    nextCheckAt,
  };
}

/** Skipped without trying (e.g. the proxy kill switch is blocking): not an error streak. */
export function deferFeedCheck(
  feed: Feed,
  reason: string,
  now: number,
  delayMs = FEED_BLOCKED_RETRY_MS,
): Feed {
  return {
    ...feed,
    lastError: reason.slice(0, 300),
    nextCheckAt: now + delayMs,
  };
}

export function dueFeeds(
  feeds: readonly Feed[],
  now: number,
  running: ReadonlySet<string> = new Set(),
): Feed[] {
  return feeds
    .filter(
      (feed) =>
        !feed.paused && !running.has(feed.id) && feed.nextCheckAt <= now,
    )
    .sort((a, b) => a.nextCheckAt - b.nextCheckAt);
}

/** How long the poller may sleep, or null when there is nothing to wait for (no timer at all). */
export function nextFeedWakeDelay(
  feeds: readonly Feed[],
  now: number,
  running: ReadonlySet<string> = new Set(),
): number | null {
  let earliest: number | null = null;
  for (const feed of feeds) {
    if (feed.paused || running.has(feed.id)) continue;
    if (earliest === null || feed.nextCheckAt < earliest)
      earliest = feed.nextCheckAt;
  }
  if (earliest === null) return null;
  return Math.min(MAX_WAKE_MS, Math.max(MIN_WAKE_MS, earliest - now));
}

export function markFeedItemsRead(
  feed: Feed,
  itemKey: string | null,
  read = true,
): Feed {
  let changed = false;
  const items = feed.items.map((item) => {
    if ((itemKey === null || item.key === itemKey) && item.read !== read) {
      changed = true;
      return { ...item, read };
    }
    return item;
  });
  return changed ? { ...feed, items } : feed;
}

/** Items across feeds (or one feed), newest first, for the Feeds view. */
export function listFeedItems(
  feeds: readonly Feed[],
  feedId: string | null,
  options: { unreadOnly?: boolean; limit?: number } = {},
): FeedListItem[] {
  const limit = Math.max(1, Math.min(options.limit ?? 300, 1000));
  const rows: FeedListItem[] = [];
  for (const feed of feeds) {
    if (feedId !== null && feed.id !== feedId) continue;
    const title = feedDisplayTitle(feed);
    for (const item of feed.items) {
      if (options.unreadOnly && item.read) continue;
      rows.push({ ...item, feedId: feed.id, feedTitle: title });
    }
  }
  rows.sort((a, b) => sortTime(b) - sortTime(a));
  return rows.slice(0, limit);
}

// ---------------------------------------------------------------------------------------------
// HTTP results

export interface FeedHttpFailureInfo {
  message: string;
  /** Absolute retry time from Retry-After / X-RateLimit-Reset, when given. */
  retryAt: number | null;
}

/** Map a non-2xx response to what the Feeds view shows. Headers: lower-case name → value. */
export function describeFeedHttpError(
  status: number,
  url: string,
  header: (name: string) => string | null,
  now: number,
): FeedHttpFailureInfo {
  const retryAfter = header("retry-after");
  let retryAt: number | null = null;
  if (retryAfter) {
    const seconds = Number(retryAfter);
    retryAt = Number.isFinite(seconds)
      ? now + Math.max(0, seconds) * 1000
      : parseDate(retryAfter);
  }
  if (
    isGitHubApiUrl(url) &&
    (status === 403 || status === 429) &&
    header("x-ratelimit-remaining") === "0"
  ) {
    const reset = Number(header("x-ratelimit-reset"));
    if (Number.isFinite(reset) && reset > 0) retryAt = reset * 1000;
    return {
      message:
        "GitHub API rate limit reached (60 requests an hour without sign-in); will retry after it resets.",
      retryAt,
    };
  }
  if (status === 404)
    return {
      message: isGitHubApiUrl(url)
        ? "Not found (HTTP 404): the repository may be private or the address wrong."
        : "Feed not found (HTTP 404).",
      retryAt,
    };
  if (status === 401 || status === 403)
    return {
      message: `Access denied (HTTP ${status}): the feed needs sign-in or a token.`,
      retryAt,
    };
  if (status === 410)
    return { message: "The feed is gone (HTTP 410).", retryAt };
  if (status === 429)
    return {
      message: "Rate-limited by the site (HTTP 429); will retry later.",
      retryAt,
    };
  return { message: `The feed answered HTTP ${status}.`, retryAt };
}
