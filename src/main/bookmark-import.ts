import { app, dialog, shell, type BaseWindow } from "electron";
import { execFile } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import {
  buildFirefoxBookmarkTree,
  parseChromiumBookmarks,
  parseChromiumProfileNames,
  parseFirefoxProfilesIni,
  parseNetscapeBookmarks,
  parseSafariBookmarks,
  type BookmarkImportBrowser,
  type BookmarkImportSource,
  type BookmarkImportSummary,
  type ImportedHistoryEntry,
} from "../shared/bookmark-import";
import {
  isBinaryPlist,
  parseBinaryPlist,
  type PlistValue,
} from "../shared/bplist";
import type { ImportedBookmarkNode } from "../shared/bookmarks";
import {
  openSqliteCopy,
  readChromiumHistory,
  type ImportDatabase,
  readFirefoxBookmarks,
  readFirefoxHistory,
  readSafariHistory,
} from "./bookmark-import-db";
import { exportBookmarksHtml, importBookmarks } from "./bookmarks";
import { importBrowsingHistory } from "./history";

/**
 * Settings → Import: finds other browsers' profiles on this machine and copies their bookmarks
 * and history in. Databases are copied to a temp dir first (the browser may have them locked)
 * and read with node:sqlite. Passwords are never touched — Bramble owns those.
 */

const execFileAsync = promisify(execFile);
const MAX_BOOKMARK_FILE_BYTES = 64 * 1024 * 1024;
const MAX_DATABASE_BYTES = 512 * 1024 * 1024;

interface ResolvedSource extends BookmarkImportSource {
  directory: string;
}

let lastScan = new Map<string, ResolvedSource>();
function home(): string {
  return app.getPath("home");
}

function localAppData(): string {
  return process.env.LOCALAPPDATA || join(home(), "AppData", "Local");
}

function roamingAppData(): string {
  return process.env.APPDATA || join(home(), "AppData", "Roaming");
}

const BROWSER_LABELS: Record<BookmarkImportBrowser, string> = {
  chrome: "Chrome",
  brave: "Brave",
  edge: "Edge",
  arc: "Arc",
  firefox: "Firefox",
  safari: "Safari",
};

function arcWindowsUserData(): string[] {
  const packages = join(localAppData(), "Packages");
  try {
    return readdirSync(packages)
      .filter((name) => name.startsWith("TheBrowserCompany.Arc_"))
      .map((name) =>
        join(packages, name, "LocalCache", "Local", "Arc", "User Data"),
      );
  } catch {
    return [];
  }
}

/** Chromium "User Data" directories per browser on this platform. */
function chromiumUserDataDirs(
  browser: Exclude<BookmarkImportBrowser, "firefox" | "safari">,
): string[] {
  const support = join(home(), "Library", "Application Support");
  if (process.platform === "darwin") {
    return {
      chrome: [join(support, "Google", "Chrome")],
      brave: [join(support, "BraveSoftware", "Brave-Browser")],
      edge: [join(support, "Microsoft Edge")],
      arc: [join(support, "Arc", "User Data")],
    }[browser];
  }
  if (process.platform === "win32") {
    return {
      chrome: [join(localAppData(), "Google", "Chrome", "User Data")],
      brave: [
        join(localAppData(), "BraveSoftware", "Brave-Browser", "User Data"),
      ],
      edge: [join(localAppData(), "Microsoft", "Edge", "User Data")],
      arc: arcWindowsUserData(),
    }[browser];
  }
  const config = process.env.XDG_CONFIG_HOME || join(home(), ".config");
  return {
    chrome: [
      join(config, "google-chrome"),
      join(
        home(),
        ".var",
        "app",
        "com.google.Chrome",
        "config",
        "google-chrome",
      ),
    ],
    brave: [
      join(config, "BraveSoftware", "Brave-Browser"),
      join(
        home(),
        ".var",
        "app",
        "com.brave.Browser",
        "config",
        "BraveSoftware",
        "Brave-Browser",
      ),
    ],
    edge: [join(config, "microsoft-edge")],
    arc: [],
  }[browser];
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function scanChromium(
  browser: Exclude<BookmarkImportBrowser, "firefox" | "safari">,
): ResolvedSource[] {
  const sources: ResolvedSource[] = [];
  for (const userData of chromiumUserDataDirs(browser)) {
    if (!isDirectory(userData)) continue;
    const names = parseChromiumProfileNames(
      readJson(join(userData, "Local State")),
    );
    let directories: string[];
    try {
      directories = readdirSync(userData).filter(
        (name) =>
          name === "Default" || /^Profile \d+$/.test(name) || names.has(name),
      );
    } catch {
      continue;
    }
    directories.sort((a, b) =>
      a === "Default"
        ? -1
        : b === "Default"
          ? 1
          : a.localeCompare(b, undefined, { numeric: true }),
    );
    for (const directory of directories) {
      const path = join(userData, directory);
      const hasBookmarks = existsSync(join(path, "Bookmarks"));
      const hasHistory = existsSync(join(path, "History"));
      if (!hasBookmarks && !hasHistory) continue;
      sources.push({
        id: `${browser}:${path}`,
        browser,
        browserLabel: BROWSER_LABELS[browser],
        profileName: names.get(directory) ?? directory,
        hasBookmarks,
        hasHistory,
        directory: path,
      });
    }
  }
  return sources;
}

function firefoxRoots(): string[] {
  if (process.platform === "darwin")
    return [join(home(), "Library", "Application Support", "Firefox")];
  if (process.platform === "win32")
    return [join(roamingAppData(), "Mozilla", "Firefox")];
  return [
    join(home(), ".mozilla", "firefox"),
    join(home(), "snap", "firefox", "common", ".mozilla", "firefox"),
    join(home(), ".var", "app", "org.mozilla.firefox", ".mozilla", "firefox"),
  ];
}

function scanFirefox(): ResolvedSource[] {
  const sources: ResolvedSource[] = [];
  for (const root of firefoxRoots()) {
    let profiles: Array<{ name: string; path: string; isDefault: boolean }>;
    try {
      profiles = parseFirefoxProfilesIni(
        readFileSync(join(root, "profiles.ini"), "utf8"),
      ).map((profile) => ({
        name: profile.name,
        path:
          profile.isRelative || !isAbsolute(profile.path)
            ? join(root, ...profile.path.split(/[\\/]/))
            : profile.path,
        isDefault: profile.isDefault,
      }));
    } catch {
      // No profiles.ini: fall back to any profile folder that has a places database.
      const folder = join(root, "Profiles");
      try {
        profiles = readdirSync(isDirectory(folder) ? folder : root).map(
          (name) => ({
            name,
            path: join(isDirectory(folder) ? folder : root, name),
            isDefault: false,
          }),
        );
      } catch {
        continue;
      }
    }
    profiles.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
    for (const profile of profiles) {
      if (!existsSync(join(profile.path, "places.sqlite"))) continue;
      sources.push({
        id: `firefox:${profile.path}`,
        browser: "firefox",
        browserLabel: BROWSER_LABELS.firefox,
        profileName: profile.name,
        hasBookmarks: true,
        hasHistory: true,
        directory: profile.path,
      });
    }
  }
  return sources;
}

function scanSafari(): ResolvedSource[] {
  if (process.platform !== "darwin") return [];
  const directory = join(home(), "Library", "Safari");
  // ~/Library/Safari is privacy-protected: without Full Disk Access we can't even list it, so
  // always offer Safari and explain the permission when reading fails.
  return [
    {
      id: `safari:${directory}`,
      browser: "safari",
      browserLabel: BROWSER_LABELS.safari,
      profileName: "Safari",
      hasBookmarks: true,
      hasHistory: true,
      directory,
    },
  ];
}

export function listBookmarkImportSources(): BookmarkImportSource[] {
  const sources = [
    ...scanChromium("chrome"),
    ...scanChromium("brave"),
    ...scanChromium("edge"),
    ...scanChromium("arc"),
    ...scanFirefox(),
    ...scanSafari(),
  ];
  lastScan = new Map(sources.map((source) => [source.id, source]));
  return sources.map(({ directory: _directory, ...source }) => source);
}

function errorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : "";
}

function isPermissionError(error: unknown): boolean {
  return ["EPERM", "EACCES"].includes(errorCode(error));
}

function describeReadError(
  source: ResolvedSource,
  what: string,
  error: unknown,
): string {
  const code = errorCode(error);
  if (code === "ENOENT")
    return `${source.browserLabel} has no ${what} in this profile.`;
  if (code === "EBUSY" || code === "EAGAIN")
    return `${source.browserLabel} is holding its ${what} file. Quit ${source.browserLabel} and try again.`;
  if (isPermissionError(error)) {
    return source.browser === "safari"
      ? `macOS blocked access to Safari's ${what}. Give Surffish Full Disk Access (System Settings → Privacy & Security → Full Disk Access), then try again.`
      : `Surffish isn't allowed to read ${source.browserLabel}'s ${what}.`;
  }
  const message = error instanceof Error ? error.message : String(error);
  return `Could not read ${source.browserLabel} ${what}: ${message}`;
}

function readBoundedFile(path: string, limit: number): Buffer {
  const size = statSync(path).size;
  if (size > limit)
    throw new Error(
      `the file is too large (${Math.round(size / 1024 / 1024)} MB)`,
    );
  return readFileSync(path);
}

/** Copy a database aside first: the browser may have the live file open or locked. */
async function withDatabaseCopy<T>(
  path: string,
  read: (db: ImportDatabase) => T,
): Promise<T> {
  const size = statSync(path).size;
  if (size > MAX_DATABASE_BYTES)
    throw new Error(
      `the file is too large (${Math.round(size / 1024 / 1024)} MB)`,
    );
  const directory = mkdtempSync(join(tmpdir(), "surffish-import-"));
  try {
    const copy = join(directory, basename(path));
    copyFileSync(path, copy);
    const db = openSqliteCopy(copy);
    try {
      return read(db);
    } finally {
      db.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function readHistoryDatabase(
  path: string,
  reader: (db: ImportDatabase) => ImportedHistoryEntry[],
): Promise<ImportedHistoryEntry[]> {
  return withDatabaseCopy(path, reader);
}

async function readSafariPlist(path: string): Promise<PlistValue> {
  const bytes = new Uint8Array(readBoundedFile(path, MAX_BOOKMARK_FILE_BYTES));
  if (isBinaryPlist(bytes)) return parseBinaryPlist(bytes);
  // XML plists are rare here; plutil ships with macOS.
  const { stdout } = await execFileAsync(
    "/usr/bin/plutil",
    ["-convert", "json", "-o", "-", path],
    { maxBuffer: MAX_BOOKMARK_FILE_BYTES },
  );
  return JSON.parse(stdout) as PlistValue;
}

async function readSourceBookmarks(
  source: ResolvedSource,
): Promise<ImportedBookmarkNode[]> {
  if (source.browser === "firefox") {
    return withDatabaseCopy(join(source.directory, "places.sqlite"), (db) =>
      buildFirefoxBookmarkTree(readFirefoxBookmarks(db)),
    );
  }
  if (source.browser === "safari")
    return parseSafariBookmarks(
      await readSafariPlist(join(source.directory, "Bookmarks.plist")),
    );
  return parseChromiumBookmarks(
    JSON.parse(
      readBoundedFile(
        join(source.directory, "Bookmarks"),
        MAX_BOOKMARK_FILE_BYTES,
      ).toString("utf8"),
    ),
  );
}

function readSourceHistory(
  source: ResolvedSource,
): Promise<ImportedHistoryEntry[]> {
  if (source.browser === "firefox")
    return readHistoryDatabase(
      join(source.directory, "places.sqlite"),
      readFirefoxHistory,
    );
  if (source.browser === "safari")
    return readHistoryDatabase(
      join(source.directory, "History.db"),
      readSafariHistory,
    );
  return readHistoryDatabase(
    join(source.directory, "History"),
    readChromiumHistory,
  );
}

function sourceLabel(source: ResolvedSource): string {
  const sameBrowser = [...lastScan.values()].filter(
    (candidate) => candidate.browser === source.browser,
  ).length;
  return sameBrowser > 1
    ? `${source.browserLabel} (${source.profileName})`
    : source.browserLabel;
}

export async function runBookmarkImport(
  id: unknown,
  options: unknown,
): Promise<BookmarkImportSummary> {
  const source = typeof id === "string" ? lastScan.get(id) : undefined;
  if (!source)
    throw new Error(
      "That browser profile is no longer available. Refresh the list and try again.",
    );
  const record =
    typeof options === "object" && options !== null
      ? (options as Record<string, unknown>)
      : {};
  const wantBookmarks = record.bookmarks !== false;
  const wantHistory = record.history === true;
  const label = sourceLabel(source);
  const summary: BookmarkImportSummary = {
    sourceLabel: label,
    bookmarks: null,
    history: null,
    errors: [],
    needsFullDiskAccess: false,
  };

  if (wantBookmarks) {
    try {
      const tree = await readSourceBookmarks(source);
      const result = importBookmarks(label, tree);
      summary.bookmarks = {
        added: result.added,
        folders: result.folders,
        duplicates: result.duplicates,
        skipped: result.skipped,
        folderTitle: result.folderTitle,
      };
    } catch (error) {
      if (source.browser === "safari" && isPermissionError(error))
        summary.needsFullDiskAccess = true;
      summary.errors.push(describeReadError(source, "bookmarks", error));
    }
  }
  if (wantHistory) {
    try {
      const entries = await readSourceHistory(source);
      summary.history = {
        found: entries.length,
        added: importBrowsingHistory(entries),
      };
    } catch (error) {
      if (source.browser === "safari" && isPermissionError(error))
        summary.needsFullDiskAccess = true;
      summary.errors.push(describeReadError(source, "history", error));
    }
  }
  return summary;
}

export async function importBookmarksHtmlFile(
  owner: BaseWindow | null,
): Promise<BookmarkImportSummary> {
  const options: Electron.OpenDialogOptions = {
    title: "Import bookmarks",
    buttonLabel: "Import",
    properties: ["openFile"],
    filters: [
      { name: "Bookmarks HTML", extensions: ["html", "htm"] },
      { name: "All files", extensions: ["*"] },
    ],
  };
  const result = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options);
  const path = result.filePaths[0];
  if (result.canceled || !path)
    return {
      sourceLabel: "HTML file",
      bookmarks: null,
      history: null,
      errors: [],
      needsFullDiskAccess: false,
      cancelled: true,
    };
  const label = basename(path);
  try {
    const tree = parseNetscapeBookmarks(
      readBoundedFile(path, MAX_BOOKMARK_FILE_BYTES).toString("utf8"),
    );
    const imported = importBookmarks(label, tree);
    return {
      sourceLabel: label,
      bookmarks: {
        added: imported.added,
        folders: imported.folders,
        duplicates: imported.duplicates,
        skipped: imported.skipped,
        folderTitle: imported.folderTitle,
      },
      history: null,
      errors: [],
      needsFullDiskAccess: false,
    };
  } catch (error) {
    return {
      sourceLabel: label,
      bookmarks: null,
      history: null,
      errors: [
        `Could not import ${label}: ${error instanceof Error ? error.message : String(error)}`,
      ],
      needsFullDiskAccess: false,
    };
  }
}

export async function exportBookmarksHtmlFile(
  owner: BaseWindow | null,
): Promise<string | null> {
  const date = new Date().toISOString().slice(0, 10);
  const options: Electron.SaveDialogOptions = {
    title: "Export bookmarks",
    defaultPath: join(
      app.getPath("downloads"),
      `surffish-bookmarks-${date}.html`,
    ),
    filters: [{ name: "Bookmarks HTML", extensions: ["html"] }],
  };
  const result = owner
    ? await dialog.showSaveDialog(owner, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return null;
  writeFileSync(result.filePath, exportBookmarksHtml(), "utf8");
  return result.filePath;
}

/** Opens System Settings at Full Disk Access (macOS) so Safari's data can be read. */
export async function openFullDiskAccessSettings(): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  await shell.openExternal(
    "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
  );
  return true;
}
