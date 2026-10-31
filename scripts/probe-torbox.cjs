// Loads the TorBox login in the production app (out/main/index.js, throwaway profile) and reports
// what happens at the Cloudflare challenge stage, over two network routes:
//   bunx electron scripts/probe-torbox.cjs direct    (no proxy: straight out of this Mac)
//   bunx electron scripts/probe-torbox.cjs tunnel    (the user's profile route: 127.0.0.1:1088 via SSH to nas)
// Reports the final URL, page title, console/network errors, and the Turnstile widget state.
const { app, BaseWindow, webContents: allWebContents } = require("electron");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");
const { mkdirSync, writeFileSync } = require("node:fs");
const { pathToFileURL } = require("node:url");

const smoke = require("./smoke-harness.cjs");

const mode = process.argv[2] === "tunnel" ? "tunnel" : "direct";
const LOGIN_URL = "https://www.torbox.app/login";
const userData = join(tmpdir(), `surffish-torbox-${mode}-${process.pid}`);

const consoleMessages = [];
const networkErrors = new Map(); // failed url -> last error
let finalUrl = null;
let finalTitle = null;

const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function waitFor(predicate, description, timeout = 45_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(
    `Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError}` : ""}`,
  );
}

function isLoginContents(contents) {
  try {
    return !contents.isDestroyed() && contents.getURL().includes("torbox.app");
  } catch {
    return false;
  }
}

app.setPath("userData", userData);
mkdirSync(userData, { recursive: true, mode: 0o700 });
writeFileSync(
  join(userData, "browser-session.json"),
  JSON.stringify({ version: 1, tabs: [LOGIN_URL], activeIndex: 0 }),
  { mode: 0o600 },
);
writeFileSync(
  join(userData, "new-tab-photo-cache.json"),
  `${JSON.stringify({ version: 1, updatedAt: Date.now(), lastAttemptAt: Date.now(), backgrounds: [] })}\n`,
);
if (mode === "tunnel") {
  writeFileSync(
    join(userData, "browser-proxy.json"),
    JSON.stringify(
      {
        enabled: true,
        host: "127.0.0.1",
        port: 1088,
        sshHost: "nas",
        sshClient: "builtin",
        bypassLocalNetwork: true,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}

smoke.step(
  `${mode === "tunnel" ? "via 127.0.0.1:1088 (SSH to nas)" : "direct (no proxy)"}`,
);
import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href)
  .then(() => app.whenReady())
  .then(() => waitFor(() => BaseWindow.getAllWindows()[0], "the main window"))
  .then(() =>
    waitFor(
      () => allWebContents.getAllWebContents().find(isLoginContents),
      "the login tab",
    ),
  )
  .then(async (contents) => {
    contents.on("console-message", (_e, level, message) => {
      consoleMessages.push(message);
    });
    try {
      contents.session.webRequest.onErrorOccurred(
        { urls: ["<all_urls>"] },
        (details) => {
          networkErrors.set(details.url, details.error);
        },
      );
    } catch {
      // another owner already holds this session's error event; did-fail-load covers it
    }
    contents.on(
      "did-fail-load",
      (_e, errorCode, errorDescription, validatedURL) => {
        if (errorCode !== -3)
          networkErrors.set(
            validatedURL || contents.getURL(),
            `did-fail-load ${errorCode} ${errorDescription}`,
          );
      },
    );
    contents.on("did-navigate", (_e, url) => (finalUrl = url));
    await delay(30_000);
    finalUrl ??= contents.getURL();
    finalTitle = await contents.getTitle();
    let widget = null;
    try {
      widget = await contents.executeJavaScript(`
        (() => {
          const widgets = [...document.querySelectorAll('iframe, [class*=challenge], [id*=turnstile]')].slice(0, 6)
            .map(el => ({ tag: el.tagName, src: el.src || null, cls: (el.className || '').toString().slice(0, 80), text: (el.innerText || '').slice(0, 120) }));
          const toast = document.body ? document.body.innerText.slice(0, 400) : null;
          return { widgets, toast };
        })()
      `);
    } catch {
      widget = { error: "could not read page" };
    }
    console.log(`\n=== ${mode.toUpperCase()} RESULT ===`);
    console.log("final URL: ", finalUrl);
    console.log("title:     ", finalTitle);
    const interesting = consoleMessages.filter((m) =>
      /cloudflare|turnstile|403|forbidden|ERR_|CSP|Content Security|adapter|permitted/i.test(
        m,
      ),
    );
    console.log(
      `console (${consoleMessages.length} total, ${interesting.length} interesting):`,
    );
    for (const m of interesting.slice(0, 25))
      console.log("  ", m.slice(0, 220));
    console.log(`network failures (${networkErrors.size}):`);
    for (const [url, error] of [...networkErrors].slice(0, 15))
      console.log(`   ${error}: ${url.slice(0, 120)}`);
    console.log("page state:", JSON.stringify(widget).slice(0, 900));
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
