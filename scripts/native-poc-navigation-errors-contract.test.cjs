const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("native navigation errors map common failures safely and ignore cancellations", () => {
  const model = read("poc-native/Sources/BrowserNavigationError.swift");
  assert.match(model, /nsError\.code != NSURLErrorCancelled/);
  assert.match(model, /NSURLErrorNotConnectedToInternet/);
  assert.match(model, /NSURLErrorCannotFindHost/);
  assert.match(model, /NSURLErrorSecureConnectionFailed/);
  assert.match(model, /NSURLErrorServerCertificateUntrusted/);
  assert.match(model, /failedURL/);
  assert.match(model, /webContentProcessTerminated/);
  assert.doesNotMatch(model, /proceed anyway|ignore certificate/i);
});

test("failed navigations have an accessible retry and back-or-new-tab recovery panel", () => {
  const view = read("poc-native/Sources/BrowserNavigationErrorView.swift");
  const window = read("poc-native/Sources/MainWindowController.swift");
  assert.match(view, /Button\("Try Again", action: onRetry\)/);
  assert.match(view, /canGoBack \? "Go Back" : "New Tab"/);
  assert.match(view, /accessibilityIdentifier\("browser-navigation-error"\)/);
  assert.match(window, /updateNavigationErrorOverlay\(for: tab\)/);
  assert.match(window, /TabManager\.shared\.retryNavigation\(id: tab\.id\)/);
  assert.match(window, /tab\.webView\.goBack\(\)/);
  assert.match(
    window,
    /createTab\(url: TabManager\.startPage, makeActive: true\)/,
  );
});

test("WebKit failures and terminated content processes update transient tab state", () => {
  const tabs = read("poc-native/Sources/TabManager.swift");
  const omnibox = read("poc-native/Sources/OmniboxView.swift");
  const window = read("poc-native/Sources/MainWindowController.swift");
  assert.match(
    tabs,
    /recordNavigationFailure\(in: webView, error: error, provisional: false\)/,
  );
  assert.match(
    tabs,
    /recordNavigationFailure\(in: webView, error: error, provisional: true\)/,
  );
  assert.match(
    tabs,
    /webViewWebContentProcessDidTerminate\(_ webView: WKWebView\)/,
  );
  assert.match(
    tabs,
    /tab\.navigationError = BrowserNavigationError\.from\(error/,
  );
  assert.match(
    tabs,
    /tab\.navigationError\?\.url \?\? tab\.webView\.url \?\? tab\.url/,
  );
  assert.match(
    omnibox,
    /tab\.navigationError\?\.url \?\? tab\.webView\.url \?\? tab\.url/,
  );
  assert.match(
    window,
    /if tab\.navigationError != nil\s*\{\s*TabManager\.shared\.retryNavigation/,
  );
  assert.match(
    window,
    /tab\.navigationError\?\.url \?\? tab\.webView\.url \?\? tab\.url/,
  );
});
