import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isAuthorizedShellIpcSender } from "./renderer-security.ts";
import {
  parseSettingsUrl,
  SURFFISH_SETTINGS_URL,
} from "../shared/settings-tab.ts";

// Settings as a tab: the privileged settings IPC stays on the shell's own preload and senders.
// These are source-level guards (the Electron side is covered by test:electron-settings-tab).

const ipcSource = readFileSync(new URL("./ipc.ts", import.meta.url), "utf8");
const browserSource = readFileSync(
  new URL("./browser.ts", import.meta.url),
  "utf8",
);

function handlerBody(channel: string): string {
  const start = ipcSource.search(
    new RegExp(`ipcMain\\.handle\\(\\s*["']${channel}["']`),
  );
  assert.ok(start >= 0, `${channel} is registered`);
  const next = ipcSource.indexOf("ipcMain.", start + 10);
  return ipcSource.slice(start, next < 0 ? undefined : next);
}

test("settings IPC handlers check the sender is a shell surface before doing anything", () => {
  for (const channel of [
    "browser:settings:open",
    "browser:site-settings:list",
    "browser:site-settings:get",
    "browser:site-settings:set",
    "browser:chrome:set",
  ]) {
    const body = handlerBody(channel);
    const guard = body.indexOf("assertMainRenderer(event)");
    assert.ok(guard > 0, `${channel} calls assertMainRenderer`);
    assert.ok(
      !/openSettingsTab|SiteSettings\(|setBrowserChromeState/.test(
        body.slice(0, guard),
      ),
      `${channel} acts only after the guard`,
    );
  }
});

test("a page sender is never a shell sender (registered surfaces, main frame, own document only)", () => {
  const shell =
    "file:///Applications/Surffish.app/Contents/Resources/app.asar/out/renderer/index.html?surface=content";
  const allowed = {
    registered: true,
    senderIsMainFrame: true,
    currentDocumentUrl: shell,
    expectedDocumentUrl: shell,
  };
  assert.equal(isAuthorizedShellIpcSender(allowed), true);
  // A web page (tab view) is not a registered shell renderer, whatever its URL says.
  assert.equal(
    isAuthorizedShellIpcSender({
      ...allowed,
      registered: false,
      currentDocumentUrl: SURFFISH_SETTINGS_URL,
    }),
    false,
  );
  // The settings address is never a trusted document, even for a registered view.
  assert.equal(
    isAuthorizedShellIpcSender({
      ...allowed,
      currentDocumentUrl: SURFFISH_SETTINGS_URL,
    }),
    false,
  );
  assert.equal(
    isAuthorizedShellIpcSender({
      ...allowed,
      currentDocumentUrl: "https://evil.test/#surface=content",
    }),
    false,
  );
});

test("the Settings tab never gets a page view, so no web content ever runs at its address", () => {
  // ensureTabLoaded returns before createTabView for the settings address.
  const ensure = browserSource.slice(
    browserSource.indexOf("function ensureTabLoaded("),
    browserSource.indexOf(
      "const view = createTabView(tab)",
      browserSource.indexOf("function ensureTabLoaded("),
    ),
  );
  assert.match(
    ensure,
    /target\s*===\s*SURFFISH_SETTINGS_URL\s*\)\s*\{\s*tab\.pendingUrl\s*=\s*(?:""|'');?\s*return\b/,
  );
  // Tab views only ever get an extension's own preload or the page-level one, never the shell preload.
  const preloadAt = browserSource.indexOf(
    "const preload = tab.extensionPreloadPath",
  );
  assert.ok(preloadAt > 0);
  const create = browserSource.slice(preloadAt, preloadAt + 200);
  assert.doesNotMatch(create, /preload\/index/);
  // createTab only makes the settings address when openSettingsTab asks for it.
  assert.match(
    browserSource,
    /requested === SURFFISH_SETTINGS_URL && creatingSettingsTab/,
  );
});

test("typed deep links can only name a section, an http(s) site and a category id", () => {
  assert.deepEqual(
    parseSettingsUrl(
      `${SURFFISH_SETTINGS_URL}?section=sites&host=javascript:alert(document.domain)`,
    ),
    { section: "site" },
  );
  assert.deepEqual(
    parseSettingsUrl(`${SURFFISH_SETTINGS_URL}?section=general&focus=<script>`),
    { section: "settings" },
  );
});
