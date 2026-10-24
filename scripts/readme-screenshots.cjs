// README screenshots: runs the production build in a throwaway profile, sets up a handful of scenes
// and writes one PNG per scene to SURFFISH_SCREENSHOT_DIR.
//   bun run build && SURFFISH_SCREENSHOT_DIR=/tmp/shots electron scripts/readme-screenshots.cjs
// Linux: needs DISPLAY (xvfb-run) + ffmpeg, grabs the window from X (x11grab).
// macOS: `screencapture -o -l <window id>` (real window, native sidebar blur) when the process has
// Screen Recording permission; otherwise it stitches the window's views together with capturePage
// and switches the sidebar to the snapshot blur (capturePage can't see the native one). The method
// used per shot goes to capture-method.txt next to the PNGs. README_SHOT_SIDEBAR=native|snapshot|solid
// and README_SHOT_METHOD=compose|screencapture override the choices.
// Pages are real public sites (GitHub, Linear, Apple, Hacker News, a GitHub blog post). Each gets one
// retry, then waits for its favicon; one that still doesn't load is replaced by a local fixture page.
// README_SHOTS=hero,newtab,... runs a subset. README_SHOT_WIDTH/HEIGHT set the window (1440x900).
const smoke = require("./smoke-harness.cjs");
const { execFileSync } = require("node:child_process");
const { createServer } = require("node:http");
const {
  appendFileSync,
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BaseWindow, BrowserWindow, Menu, screen } = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const outDir = resolve(
  process.env.SURFFISH_SCREENSHOT_DIR ||
    join(tmpdir(), "surffish-readme-shots"),
);
const userData = join(tmpdir(), `surffish-readme-shots-${process.pid}`);
const WIDTH = Number(process.env.README_SHOT_WIDTH) || 1440;
const HEIGHT = Number(process.env.README_SHOT_HEIGHT) || 900;
const only = (process.env.README_SHOTS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...args) =>
  console.log(
    `[readme-shots +${((Date.now() - started) / 1000).toFixed(1)}s]`,
    ...args,
  );
const started = Date.now();

const SITES = {
  gh: "https://github.com/PylotLight/Surffish",
  linear: "https://linear.app/",
  apple: "https://www.apple.com/",
  hn: "https://news.ycombinator.com/",
  article:
    process.env.README_SHOT_ARTICLE ||
    "https://github.blog/engineering/architecture-optimization/improving-site-performance-by-shipping-more-css/",
  electron: "https://www.electronjs.org/docs/latest/",
};
// sidebar order (top to bottom) for the tabs every scene shares
const TAB_ORDER = ["gh", "linear", "apple", "hn"];

async function waitFor(predicate, description, timeout = 30000) {
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
    `Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError.message}` : ""}`,
  );
}

function surfaceFor(view) {
  try {
    return new URL(view.webContents.getURL()).searchParams.get("surface");
  } catch {
    return null;
  }
}
const viewsOf = (win) =>
  win.contentView.children.filter(
    (v) => v.webContents && !v.webContents.isDestroyed(),
  );
const surface = (win, name) => viewsOf(win).find((v) => surfaceFor(v) === name);
const mainWindow = () =>
  BaseWindow.getAllWindows().find(
    (w) => !w.isDestroyed() && surface(w, "toolbar"),
  );
const evaluate = (view, js) => view.webContents.executeJavaScript(js);
const api = (win, call) =>
  evaluate(surface(win, "toolbar"), `window.api.browser.${call}`);
const pageViews = (win) =>
  viewsOf(win).filter(
    (v) => /^https?:/.test(v.webContents.getURL()) && v.getVisible(),
  );

function menuItem(label) {
  const walk = (items) => {
    for (const item of items) {
      if (item.label === label) return item;
      if (item.submenu) {
        const hit = walk(item.submenu.items);
        if (hit) return hit;
      }
    }
    return null;
  };
  const item = walk(Menu.getApplicationMenu()?.items ?? []);
  if (!item) throw new Error(`no menu item "${label}"`);
  return item;
}
const clickMenu = (label) => menuItem(label).click();

// --- local fallback page (used when a real site doesn't load) -------------------------------------
let fixtureOrigin = "";
const fixture = createServer((request, response) => {
  const name = decodeURIComponent(request.url.slice(1)) || "Page";
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(
    `<!doctype html><meta charset="utf-8"><title>${name}</title><style>body{font:17px/1.6 system-ui;max-width:720px;margin:48px auto;padding:0 24px;color:#1d1d1f}h1{font-size:34px}</style><article><h1>${name}</h1>${"<p>Surfing is a surface water sport in which an individual, a surfer, uses a board to ride on the forward section, or face, of a moving wave of water, which usually carries the surfer towards the shore. Waves suitable for surfing are primarily found on ocean shores, but can also be found in standing waves in the open ocean, in lakes, and in rivers.</p>".repeat(8)}</article>`,
  );
});

function seedProfile() {
  mkdirSync(userData, { recursive: true, mode: 0o700 });
  const blocker = ElectronBlocker.parse(
    "||surffish-readme-never-match.invalid^",
    smoke.ADBLOCK_CONFIG,
  );
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), blocker.serialize(), {
    mode: 0o600,
  });
  writeFileSync(
    join(userData, "window-state.json"),
    JSON.stringify({
      bounds: { x: 40, y: 40, width: WIDTH, height: HEIGHT },
      maximized: false,
      fullScreen: false,
    }),
  );
  writeFileSync(
    join(userData, "browser-preferences.json"),
    `${JSON.stringify({
      version: 1,
      pinnedSites: [
        {
          title: "GitHub",
          url: "https://github.com/",
          faviconUrl: "https://github.com/favicon.ico",
        },
        {
          title: "Linear",
          url: "https://linear.app/",
          faviconUrl: "https://linear.app/favicon.ico",
        },
        {
          title: "Apple",
          url: "https://www.apple.com/",
          faviconUrl: "https://www.apple.com/favicon.ico",
        },
        {
          title: "Hacker News",
          url: "https://news.ycombinator.com/",
          faviconUrl: "https://news.ycombinator.com/favicon.ico",
        },
      ],
    })}\n`,
    { mode: 0o600 },
  );
}

// --- capture ----------------------------------------------------------------------------------------
const methods = [];
let macScreencaptureWorks =
  process.platform === "darwin" && process.env.README_SHOT_METHOD !== "compose";

function macWindowId(win) {
  // BaseWindow has no getMediaSourceId in every Electron version; getNativeWindowHandle is an NSView*,
  // so ask the window server for our pid's on-screen window with the matching size instead.
  const swift = `import CoreGraphics
let pid = Int32(CommandLine.arguments[1])!
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as! [[String: Any]]
for w in list where (w[kCGWindowOwnerPID as String] as? Int32) == pid && (w[kCGWindowLayer as String] as? Int) == 0 {
  let b = w[kCGWindowBounds as String] as! [String: Any]
  print("\\(w[kCGWindowNumber as String]!) \\(b["Width"]!) \\(b["Height"]!)")
}`;
  const file = join(userData, "winid.swift");
  const bin = join(userData, "winid");
  if (!existsSync(bin)) {
    writeFileSync(file, swift);
    execFileSync("swiftc", ["-O", "-o", bin, file], { timeout: 180000 });
  }
  const out = execFileSync(bin, [String(process.pid)], {
    encoding: "utf8",
    timeout: 30000,
  });
  const { width, height } = win.getBounds();
  const rows = out
    .trim()
    .split("\n")
    .map((line) => line.split(" ").map(Number))
    .filter((r) => r.length === 3);
  const hit =
    rows.find(
      ([, w, h]) => Math.round(w) === width && Math.round(h) === height,
    ) ?? rows[0];
  if (!hit)
    throw new Error(`no on-screen window for pid ${process.pid}: ${out}`);
  return hit[0];
}

/** macOS: does this process have Screen Recording permission (CGPreflightScreenCaptureAccess)? */
function macScreenRecordingAllowed() {
  const file = join(userData, "preflight.swift");
  writeFileSync(
    file,
    'import CoreGraphics\nprint(CGPreflightScreenCaptureAccess() ? "yes" : "no")\n',
  );
  const bin = join(userData, "preflight");
  execFileSync("swiftc", ["-O", "-o", bin, file], { timeout: 180000 });
  return (
    execFileSync(bin, { encoding: "utf8", timeout: 30000 }).trim() === "yes"
  );
}

async function composeCapture(win) {
  // Paint every visible view into one canvas at its bounds, bottom to top.
  const { width, height } = win.getContentBounds();
  const layers = [];
  for (const view of win.contentView.children) {
    if (
      !view.webContents ||
      view.webContents.isDestroyed() ||
      !view.getVisible()
    )
      continue;
    const b = view.getBounds();
    if (b.width <= 0 || b.height <= 0) continue;
    const image = await view.webContents.capturePage();
    if (image.isEmpty()) continue;
    layers.push({ ...b, url: image.toDataURL() });
  }
  const scale = screen.getDisplayMatching(win.getBounds()).scaleFactor || 1;
  const painter = new BrowserWindow({
    show: false,
    width: 200,
    height: 200,
    webPreferences: { offscreen: true },
  });
  await painter.loadURL("data:text/html,<canvas></canvas>");
  const dataUrl = await painter.webContents.executeJavaScript(`(async () => {
    const layers = ${JSON.stringify(layers)}
    const s = ${scale}
    const c = document.querySelector('canvas'); c.width = ${width} * s; c.height = ${height} * s
    const g = c.getContext('2d'); g.fillStyle = '#1c1c1e'; g.fillRect(0, 0, c.width, c.height)
    for (const l of layers) {
      const img = new Image(); img.src = l.url; await img.decode()
      g.drawImage(img, l.x * s, l.y * s, l.width * s, l.height * s)
    }
    return c.toDataURL('image/png')
  })()`);
  painter.destroy();
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

async function shoot(win, name) {
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${name}.png`);
  await delay(Number(process.env.README_SHOT_SETTLE_MS) || 1200);
  let method;
  if (
    process.platform === "linux" &&
    process.env.DISPLAY &&
    process.env.README_SHOT_METHOD !== "compose"
  ) {
    const { x, y, width, height } = win.getBounds();
    execFileSync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "x11grab",
      "-draw_mouse",
      "0",
      "-video_size",
      `${width}x${height}`,
      "-i",
      `${process.env.DISPLAY}.0+${x},${y}`,
      "-frames:v",
      "1",
      "-y",
      file,
    ]);
    method = "x11grab";
  } else if (macScreencaptureWorks) {
    try {
      const id = macWindowId(win);
      execFileSync("screencapture", ["-o", "-x", "-l", String(id), file], {
        timeout: 30000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (statSync(file).size < 20000)
        throw new Error(
          `screencapture wrote only ${statSync(file).size} bytes`,
        );
      method = `screencapture -o -l ${id}`;
      // Without Screen Recording permission macOS can hand back the wallpaper instead of failing,
      // so keep the capturePage version next to it to compare.
      writeFileSync(
        join(outDir, `${name}.compose.png`),
        await composeCapture(win),
      );
    } catch (error) {
      log(
        `screencapture failed (${error.message.split("\n")[0]}; stderr: ${String(error.stderr || "").trim() || "none"}), falling back to capturePage`,
      );
      macScreencaptureWorks = false;
    }
  }
  if (!method) {
    writeFileSync(file, await composeCapture(win));
    method = "capturePage compose";
  }
  methods.push(`${name}.png ${method}`);
  appendFileSync(
    join(outDir, "capture-method.txt"),
    `${name}.png\t${method}\t${process.platform}\n`,
  );
  log(`wrote ${file} (${method})`);
}

// --- scene helpers ----------------------------------------------------------------------------------
async function loaded(win, url, timeout = 25000) {
  try {
    await waitFor(
      () =>
        pageViews(win).some(
          (v) =>
            v.webContents.getURL().startsWith(url.split("#")[0]) &&
            !v.webContents.isLoading(),
        ),
      `${url} to load`,
      timeout,
    );
    return true;
  } catch {
    return false;
  }
}

// Third-party banners (cookie / sign-up prompts) are not Surffish UI, so they go.
const TIDY_CSS = {
  "github.com":
    ".js-notice, .flash-full, .js-cookie-consent-banner, cookie-consent-link, #ghcc { display: none !important }",
  "github.blog":
    '#ghcc, .cookie-consent, [class*="cookie"] { display: none !important }',
  // the "choose another country or region" bar Apple shows visitors from outside the US
  "apple.com":
    "#ac-localeswitcher, #ac-gn-segmentbar, .ac-gn-segmentbar, #globalnav-segmentbar { display: none !important }",
};
async function tidy(win) {
  for (const view of pageViews(win)) {
    let host = "";
    try {
      host = new URL(view.webContents.getURL()).hostname;
    } catch {}
    for (const [domain, css] of Object.entries(TIDY_CSS)) {
      if (host === domain || host.endsWith(`.${domain}`))
        await view.webContents.insertCSS(css).catch(() => {});
    }
  }
}

const tabInfo = async (win, id) =>
  (await api(win, "tabs.get()")).find((tab) => tab.id === id);

/** Load url in tab id (already navigating there): one retry, then wait for the favicon to land. */
async function settle(win, id, url, timeout = 30000) {
  let ok = await loaded(win, url, timeout);
  if (!ok) {
    log(`${url} did not load in ${timeout / 1000}s, retrying once`);
    await api(win, `tabs.activate(${JSON.stringify(id)})`);
    await api(win, `navigate(${JSON.stringify(url)})`);
    ok = await loaded(win, url, timeout + 15000);
  }
  if (!ok) return false;
  // real page load: document complete and some content painted
  const view = pageViews(win).find((v) =>
    v.webContents.getURL().startsWith(url.split("#")[0]),
  );
  if (view) {
    await waitFor(
      () =>
        evaluate(
          view,
          'document.readyState === "complete" && document.body && document.body.innerText.length > 200',
        ),
      `${url} content`,
      15000,
    ).catch(() => log(`${url}: content wait timed out`));
  }
  await waitFor(
    async () => (await tabInfo(win, id))?.faviconUrl,
    `${url} favicon`,
    15000,
  ).catch(() => log(`${url}: no favicon after 15s`));
  return true;
}

async function openTab(win, url) {
  const id = await api(win, `tabs.create(${JSON.stringify(url)})`);
  if (!(await settle(win, id, url))) {
    log(`${url} did not load after a retry, using the fixture page`);
    const name =
      new URL(url).pathname.split("/").filter(Boolean).pop() ||
      new URL(url).hostname;
    await api(
      win,
      `navigate(${JSON.stringify(`${fixtureOrigin}/${name.replace(/[_-]/g, " ")}`)})`,
    );
    await delay(800);
  }
  return id;
}

async function activate(win, key) {
  await api(win, `tabs.activate(${JSON.stringify(state.ids[key])})`);
  await loaded(win, SITES[key], 10000);
  await tidy(win);
}

async function setChrome(win, state) {
  await api(win, `chrome.set(${JSON.stringify(state)})`);
  await delay(700);
}

async function closePopovers(win) {
  for (const view of viewsOf(win))
    view.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  await delay(400);
}

const scenes = {
  // New Tab with its photo, the tab sidebar open over it as a card
  async hero(win) {
    await setChrome(win, { sidebarMode: "tabs" });
    state.newTab = await api(win, "tabs.create()");
    await delay(2500);
    await setChrome(win, { sidebarPinned: true });
    await delay(1200); // photo fade-in
    await shoot(win, "hero");
    // close it so later sidebars list only the real pages (newtab opens a fresh one)
    await api(win, `tabs.close(${JSON.stringify(state.newTab)})`).catch(
      () => {},
    );
    await delay(500);
  },
  async palette(win) {
    await setChrome(win, { sidebarPinned: true });
    await activate(win, "gh");
    clickMenu("Command Palette…");
    const toolbar = surface(win, "toolbar");
    await delay(800);
    for (const ch of "split") {
      toolbar.webContents.sendInputEvent({ type: "char", keyCode: ch });
      await delay(60);
    }
    await shoot(win, "command-palette");
    await closePopovers(win);
  },
  // GitHub repo on the left, Linear on the right
  async split(win) {
    await setChrome(win, { sidebarPinned: false });
    await activate(win, "linear");
    await activate(win, "gh");
    await api(win, "split.toggle()");
    await delay(2500);
    await tidy(win);
    await shoot(win, "split-view");
    await api(win, "split.toggle()").catch(() => {});
    await delay(500);
    await setChrome(win, { sidebarPinned: true });
  },
  async settings(win) {
    await activate(win, "gh");
    await setChrome(win, { sidebarMode: "connection" });
    const content = surface(win, "content");
    await waitFor(
      () =>
        evaluate(
          content,
          "Boolean(document.querySelector('[aria-label=\"Local SOCKS5 port\"]'))",
        ),
      "the SOCKS5 proxy card",
      10000,
    );
    // the proxy card, then the per-site routing and kill switch under it
    await evaluate(
      content,
      `(() => { const el = document.querySelector('[aria-label="Local SOCKS5 port"]'); const card = el.closest('section, .settings-card, .settings-group') || el; card.scrollIntoView({ block: 'start' }); const scroller = card.closest('[class*="scroll"], main') ; if (scroller) scroller.scrollTop -= 24 })()`,
    );
    await delay(800);
    await shoot(win, "settings-proxy");
    await setChrome(win, { sidebarMode: "tabs" });
  },
  // the Apple tab walked Hacker News -> GitHub -> Linear -> back to Apple, then Back's menu
  async history(win) {
    await setChrome(win, { sidebarMode: "tabs", sidebarPinned: true });
    await activate(win, "apple");
    const id = state.ids.apple;
    for (const url of [SITES.hn, SITES.gh, SITES.linear, SITES.apple]) {
      await api(win, `navigate(${JSON.stringify(url)})`);
      await settle(win, id, url, 20000);
    }
    await tidy(win);
    const toolbar = surface(win, "toolbar");
    const rect = await evaluate(
      toolbar,
      `(() => { const r = document.querySelector('[aria-label="Back"]').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } })()`,
    );
    toolbar.webContents.sendInputEvent({
      type: "mouseMove",
      x: rect.x,
      y: rect.y,
    });
    toolbar.webContents.sendInputEvent({
      type: "mouseDown",
      x: rect.x,
      y: rect.y,
      button: "right",
      clickCount: 1,
    });
    toolbar.webContents.sendInputEvent({
      type: "mouseUp",
      x: rect.x,
      y: rect.y,
      button: "right",
      clickCount: 1,
    });
    await waitFor(
      () =>
        evaluate(
          toolbar,
          "Boolean(document.querySelector('[aria-label=\"Back history\"]'))",
        ),
      "the Back history menu",
      8000,
    );
    await delay(1500); // favicons in the menu
    await shoot(win, "history-menu");
    await closePopovers(win);
  },
  async integrations(win) {
    await setChrome(win, { sidebarMode: "integrations" });
    await delay(1500);
    await shoot(win, "settings-integrations");
    await setChrome(win, { sidebarMode: "tabs" });
  },
  // a GitHub blog post in reader view (its own tab, closed afterwards)
  async reader(win) {
    await setChrome(win, { sidebarPinned: false });
    const id = await openTab(win, SITES.article);
    await tidy(win);
    await delay(1000);
    await api(win, "toggleReader()");
    await delay(2500);
    await shoot(win, "reader");
    await api(win, "toggleReader()").catch(() => {});
    await api(win, `tabs.close(${JSON.stringify(id)})`).catch(() => {});
    await setChrome(win, { sidebarPinned: true });
  },
  async glance(win) {
    await activate(win, "hn");
    const page = pageViews(win)[0];
    const rect = await evaluate(
      page,
      `(() => { const a = [...document.querySelectorAll('.titleline > a, article a, p a')].find((el) => el.getBoundingClientRect().top > 60); if (!a) return null; a.href = ${JSON.stringify(SITES.electron)}; const r = a.getBoundingClientRect(); return { x: Math.round(r.x + 8), y: Math.round(r.y + r.height / 2) } })()`,
    );
    if (!rect) throw new Error("no link to Shift+click");
    const base = {
      x: rect.x,
      y: rect.y,
      button: "left",
      clickCount: 1,
      modifiers: ["shift"],
    };
    page.webContents.sendInputEvent({
      type: "mouseMove",
      x: rect.x,
      y: rect.y,
      modifiers: ["shift"],
    });
    page.webContents.sendInputEvent({ type: "mouseDown", ...base });
    page.webContents.sendInputEvent({ type: "mouseUp", ...base });
    await delay(5000);
    await shoot(win, "glance");
    await closePopovers(win);
  },
  // New Tab on its own: photo, clock and favourites, sidebar tucked away
  async newtab(win) {
    await setChrome(win, { sidebarMode: "tabs" });
    // the reader / glance pages would land in Most visited without favicons; Favourites only
    await api(win, "history.clear()").catch((error) =>
      log(`history.clear failed: ${error.message}`),
    );
    await api(win, "tabs.create()");
    await delay(2500);
    await setChrome(win, {
      sidebarPinned: false,
      sidebarHovered: false,
      sidebarFocused: false,
    });
    await delay(1200);
    await shoot(win, "new-tab");
    await setChrome(win, { sidebarPinned: true });
  },
};
const state = { ids: {} };

async function run() {
  mkdirSync(outDir, { recursive: true });
  app.setPath("userData", userData);
  seedProfile();
  if (macScreencaptureWorks) {
    try {
      const allowed = macScreenRecordingAllowed();
      log(
        `Screen Recording permission (CGPreflightScreenCaptureAccess): ${allowed ? "granted" : "NOT granted"}`,
      );
      appendFileSync(
        join(outDir, "capture-method.txt"),
        `# screen recording permission: ${allowed ? "granted" : "not granted"}\n`,
      );
      // README_SHOT_METHOD=screencapture tries it anyway (the preflight can miss a permission granted to a parent)
      if (!allowed && process.env.README_SHOT_METHOD !== "screencapture")
        macScreencaptureWorks = false;
    } catch (error) {
      log(`preflight failed: ${error.message.split("\n")[0]}`);
    }
  }
  // The native macOS sidebar blur is a compositor effect capturePage can't see (the sidebar comes out
  // see-through), so captures that may fall back to capturePage use the in-renderer snapshot blur.
  if (process.env.README_SHOT_SIDEBAR)
    process.env.SURFFISH_SIDEBAR_BACKDROP = process.env.README_SHOT_SIDEBAR;
  else if (!macScreencaptureWorks)
    process.env.SURFFISH_SIDEBAR_BACKDROP = "snapshot";
  mkdirSync(outDir, { recursive: true });
  await new Promise((r) => fixture.listen(0, "127.0.0.1", r));
  fixtureOrigin = `http://127.0.0.1:${fixture.address().port}`;
  mkdirSync(outDir, { recursive: true });
  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();
  const win = await waitFor(() => mainWindow(), "the window", 60000);
  await waitFor(
    () =>
      surface(win, "toolbar") &&
      surface(win, "sidebar") &&
      surface(win, "content"),
    "the renderer surfaces",
  );
  await waitFor(
    () =>
      evaluate(
        surface(win, "toolbar"),
        'document.readyState === "complete" && Boolean(window.api)',
      ),
    "the toolbar",
  );
  win.setBounds({ x: 40, y: 40, width: WIDTH, height: HEIGHT });
  log("window ready", JSON.stringify(win.getBounds()));
  for (const key of TAB_ORDER) state.ids[key] = await openTab(win, SITES[key]);
  // drop the start-up New Tab so the sidebar lists only real pages
  const tabs = await api(win, "tabs.get()");
  for (const tab of tabs)
    if (!Object.values(state.ids).includes(tab.id))
      await api(win, `tabs.close(${JSON.stringify(tab.id)})`);
  // hero first: the sidebar lists only the shared tabs plus its New Tab
  const order = [
    "hero",
    "palette",
    "split",
    "reader",
    "history",
    "settings",
    "integrations",
    "newtab",
  ];
  for (const name of order) {
    if (only.length ? !only.includes(name) : name === "integrations") continue;
    try {
      log(`scene ${name}`);
      await scenes[name](win);
    } catch (error) {
      log(`scene ${name} failed: ${error.stack || error.message}`);
      appendFileSync(
        join(outDir, "capture-method.txt"),
        `${name}\tFAILED ${String(error.message).split("\n")[0]}\t${process.platform}\n`,
      );
    }
  }
  log("done", methods.join("; "));
}

run().then(
  () => {
    fixture.close();
    app.exit(0);
  },
  (error) => {
    console.error(error);
    app.exit(1);
  },
);
