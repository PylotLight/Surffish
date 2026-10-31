// These open the overlay with chrome.set({ sidebarHovered: true }) while the real cursor sits
// elsewhere; the cursor poll (src/main/sidebar-reveal-guard.ts) would rightly close it again.
process.env.SURFFISH_SIDEBAR_CURSOR_POLL ??= "off";
// The sidebar card must sit on exactly the same window pixels whether the content renderer draws
// it in-page (New Tab, full panels) or the overlay sidebar view draws it above a live page:
// x/y/width/height, radius, border, shadow, and the window-control / pinned / tab-list offsets.
// Checks docked and hover-revealed, a private window, and Spaces on. Run once per backdrop path:
//
//   SURFFISH_SIDEBAR_BACKDROP=native|solid|snapshot  path to test (default: the platform's own)
//   SURFFISH_SCREENSHOT_DIR=…                        save window captures (needs ffmpeg + X11)
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { execFileSync } = require("node:child_process");
const { mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BaseWindow } = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const userData = join(tmpdir(), `surffish-sidebar-card-smoke-${process.pid}`);
const screenshotDirectory = process.env.SURFFISH_SCREENSHOT_DIR;
const label = process.env.SURFFISH_SIDEBAR_BACKDROP || "default";
const TOLERANCE = 1;

const server = createServer((request, response) => {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  const hue = (request.url.length * 37) % 360;
  response.end(
    `<!doctype html><meta charset="utf-8"><title>Live ${request.url}</title><body style="margin:0;height:100vh;background:repeating-linear-gradient(45deg,hsl(${hue} 60% 55%) 0 40px,#fff 40px 80px);font:20px system-ui"><h1 style="margin:0;padding:30px 380px">live page</h1>`,
  );
});

const delay = (ms) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
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
    await delay(50);
  }
  throw new Error(
    `Timed out while waiting for ${description}.${lastError ? ` Last error: ${lastError}` : ""}`,
  );
}
const windows = () =>
  BaseWindow.getAllWindows().filter(
    (win) => !win.isDestroyed() && win.isVisible(),
  );
function surface(win, name) {
  return win.contentView.children.find((view) => {
    try {
      return (
        view.webContents &&
        new URL(view.webContents.getURL()).searchParams.get("surface") === name
      );
    } catch {
      return false;
    }
  });
}
const evaluate = (view, expression) =>
  view.webContents.executeJavaScript(expression);
const api = (win, call) =>
  evaluate(surface(win, "toolbar"), `window.api.browser.${call}`);
async function ready(win) {
  await waitFor(
    () =>
      surface(win, "content") &&
      surface(win, "toolbar") &&
      surface(win, "sidebar"),
    "the renderer surfaces",
  );
  await waitFor(
    () =>
      evaluate(
        surface(win, "toolbar"),
        'document.readyState === "complete" && Boolean(window.api)',
      ),
    "the toolbar renderer",
  );
}

function captureWindow(win, name) {
  if (!screenshotDirectory) return;
  mkdirSync(screenshotDirectory, { recursive: true });
  const { x, y, width, height } = win.getContentBounds();
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "x11grab",
    "-video_size",
    `${width}x${height}`,
    "-i",
    `${process.env.DISPLAY}.0+${x},${y}`,
    "-frames:v",
    "1",
    "-y",
    join(screenshotDirectory, name),
  ]);
}

// Card + inner offsets in the view's own coordinates. A `.sidebar-window-controls` probe stands in
// for the macOS dots on other platforms (same element + CSS), so their spacing is checked here too.
const MEASURE = `(() => {
  const card = document.querySelector('.browser-sidebar')
  if (!card) return null
  let probe = null
  if (!card.querySelector('.sidebar-window-controls')) {
    probe = document.createElement('div')
    probe.className = 'sidebar-window-controls'
    for (let i = 0; i < 3; i++) { const dot = document.createElement('span'); dot.className = 'sidebar-window-control'; probe.appendChild(dot) }
    card.insertBefore(probe, card.firstChild)
  }
  const rect = (node) => { if (!node) return null; const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
  const s = getComputedStyle(card)
  const out = {
    className: card.className,
    card: rect(card),
    radius: s.borderTopLeftRadius + ' ' + s.borderTopRightRadius + ' ' + s.borderBottomRightRadius + ' ' + s.borderBottomLeftRadius,
    border: s.borderTopWidth + ' ' + s.borderRightWidth + ' ' + s.borderBottomWidth + ' ' + s.borderLeftWidth + ' ' + s.borderTopStyle + ' ' + s.borderTopColor,
    shadow: s.boxShadow,
    controls: rect(card.querySelector('.sidebar-window-controls')),
    firstDot: rect(card.querySelector('.sidebar-window-control')),
    rail: rect(card.querySelector('.sidebar-rail')),
    railActions: rect(card.querySelector('.sidebar-rail-actions')),
    pinned: rect(card.querySelector('.sidebar-pinned-sites')),
    tabList: rect(card.querySelector('.tab-list')),
    firstTab: rect(card.querySelector('.tab-item')),
    footer: rect(card.querySelector('.sidebar-footer'))
  }
  probe?.remove()
  return out
})()`;

async function measure(win, which) {
  const view = surface(win, which);
  const bounds = view.getBounds();
  const raw = await evaluate(view, MEASURE);
  assert.ok(raw, `${which}: a sidebar card`);
  const shift = (r) =>
    r
      ? {
          x: r.x + bounds.x,
          y: r.y + bounds.y,
          width: r.width,
          height: r.height,
        }
      : null;
  return {
    ...raw,
    view: bounds,
    card: shift(raw.card),
    controls: shift(raw.controls),
    firstDot: shift(raw.firstDot),
    rail: shift(raw.rail),
    railActions: shift(raw.railActions),
    pinned: shift(raw.pinned),
    tabList: shift(raw.tabList),
    firstTab: shift(raw.firstTab),
    footer: shift(raw.footer),
  };
}

function assertSame(inPage, overlay, context) {
  for (const key of [
    "card",
    "controls",
    "firstDot",
    "rail",
    "railActions",
    "pinned",
    "tabList",
    "firstTab",
    "footer",
  ]) {
    const a = inPage[key];
    const b = overlay[key];
    assert.equal(Boolean(a), Boolean(b), `${context}: ${key} drawn in both`);
    if (!a) continue;
    for (const field of ["x", "y", "width", "height"]) {
      assert.ok(
        Math.abs(a[field] - b[field]) <= TOLERANCE,
        `${context}: ${key}.${field} differs (in-page ${a[field]} vs overlay ${b[field]})\n in-page ${JSON.stringify(a)}\n overlay ${JSON.stringify(b)}`,
      );
    }
  }
  for (const key of ["radius", "border", "shadow"]) {
    assert.equal(
      overlay[key].replace(/inset 0px 2px 0px [^,]+,\s*/, ""),
      inPage[key].replace(/inset 0px 2px 0px [^,]+,\s*/, ""),
      `${context}: ${key}`,
    );
  }
}

const settle = () => delay(Number(process.env.SMOKE_WAIT_MS || 0) + 650);
const results = [];

async function compare(win, { context, liveUrl, chrome, shot }) {
  const tabs = await api(win, "tabs.get()");
  const newTab =
    tabs.find((tab) => tab.url.startsWith("surffish://")) ?? tabs[0];
  let live = tabs.find((tab) => tab.url === liveUrl);
  if (!live) {
    await api(win, `tabs.create(${JSON.stringify(liveUrl)})`);
    live = await waitFor(
      async () =>
        (await api(win, "tabs.get()")).find(
          (tab) => tab.url === liveUrl && !tab.loading,
        ),
      `the live tab (${context})`,
    );
  }
  const reveal = `chrome.set(${JSON.stringify({ sidebarMode: "tabs", sidebarPinned: false, sidebarHovered: false, sidebarFocused: false, ...chrome })})`;

  // In-page: the local New Tab, drawn by the content renderer.
  await api(win, `tabs.activate(${JSON.stringify(newTab.id)})`);
  await api(win, reveal);
  await waitFor(
    () =>
      surface(win, "content").getVisible() &&
      !surface(win, "sidebar").getVisible(),
    `the in-page sidebar (${context})`,
  );
  await waitFor(
    () =>
      evaluate(
        surface(win, "content"),
        'Boolean(document.querySelector(".browser-layout.is-sidebar-visible"))',
      ),
    `the in-page card to show (${context})`,
  );
  await settle();
  const inPage = await measure(win, "content");
  captureWindow(win, `${shot}-newtab.png`);

  // Overlay: the sidebar view above the live page.
  await api(win, `tabs.activate(${JSON.stringify(live.id)})`);
  await api(win, reveal);
  const sidebar = surface(win, "sidebar");
  await waitFor(
    () => sidebar.getVisible() && sidebar.getBounds().width > 0,
    `the overlay sidebar (${context})`,
  );
  await waitFor(
    () =>
      evaluate(
        sidebar,
        'Boolean(document.querySelector(".browser-layout.is-sidebar-visible"))',
      ),
    `the overlay card to show (${context})`,
  );
  await settle();
  let overlay = await measure(win, "sidebar");
  // Hover mode under Xvfb: the real X pointer sits over the page, so main's page-exit timer can
  // un-hover the sidebar before we measure. Re-hover inside the rail, which is only 76px wide when
  // collapsed; a point farther right misses the view and cannot open the panel.
  const { sidebarWidth: targetSidebarWidth } = await api(win, "chrome.get()");
  const [windowWidth] = win.getContentSize();
  const openWidth = Math.min(targetSidebarWidth, windowWidth - 48);
  for (
    let attempt = 0;
    attempt < 3 &&
    chrome.sidebarHovered &&
    overlay.view.width < openWidth - TOLERANCE;
    attempt++
  ) {
    await api(win, reveal);
    sidebar.webContents.sendInputEvent({ type: "mouseMove", x: 30, y: 300 });
    await waitFor(
      () =>
        sidebar.getVisible() &&
        sidebar.getBounds().width >= openWidth - TOLERANCE,
      `the expanded overlay sidebar again (${context})`,
    );
    await settle();
    overlay = await measure(win, "sidebar");
  }
  captureWindow(win, `${shot}-live.png`);

  results.push({
    context,
    inPage: inPage.card,
    overlay: overlay.card,
    view: overlay.view,
    framed: overlay.className.includes("is-view-framed"),
  });
  assertSame(inPage, overlay, `${label} / ${context}`);
  // Both cards reach the window's top and bottom, and the traffic lights match the native origin.
  const [width, height] = win.getContentSize();
  const { sidebarWidth } = await api(win, "chrome.get()");
  const expected = {
    x: 0,
    y: 0,
    width: Math.min(sidebarWidth, width - 48),
    height,
  };
  for (const field of ["x", "y", "width", "height"])
    assert.ok(
      Math.abs(inPage.card[field] - expected[field]) <= TOLERANCE,
      `${context}: card.${field} ${inPage.card[field]} vs expected ${expected[field]}`,
    );
  assert.equal(inPage.radius, "28px 28px 28px 28px", `${context}: card radius`);
  for (const surface of [inPage, overlay]) {
    assert.ok(
      Math.abs(surface.firstDot.x - 16) <= TOLERANCE &&
        Math.abs(surface.firstDot.y - 16) <= TOLERANCE,
      `${context}: traffic lights align to the native (16, 16) origin: ${JSON.stringify(surface.firstDot)}`,
    );
    assert.ok(
      surface.firstDot.x + surface.firstDot.width <=
        surface.rail.x + surface.rail.width + TOLERANCE,
      `${context}: traffic-light controls fit within the collapsed rail`,
    );
    assert.ok(
      Math.abs(
        surface.rail.y +
          surface.rail.height -
          (surface.card.y + surface.card.height - 1),
      ) <= TOLERANCE,
      `${context}: rail reaches the card's bottom edge`,
    );
    assert.ok(
      surface.railActions.y + surface.railActions.height <=
        surface.rail.y + surface.rail.height + TOLERANCE,
      `${context}: rail actions stay anchored inside the bottom edge`,
    );
  }

  await api(
    win,
    "chrome.set({ sidebarPinned: false, sidebarHovered: false, sidebarFocused: false })",
  );
}

async function assertSidebarState(win, which, context, expanded) {
  const view = surface(win, which);
  const [windowWidth, windowHeight] = win.getContentSize();
  const { sidebarWidth } = await api(win, "chrome.get()");
  const expectedWidth = expanded
    ? Math.min(sidebarWidth, windowWidth - 48)
    : Math.min(76, windowWidth - 48);
  const state = await evaluate(
    view,
    `(() => {
      const layout = document.querySelector('.browser-layout')
      const card = document.querySelector('.browser-sidebar')
      const rail = card?.querySelector('.sidebar-rail')
      const panel = card?.querySelector('.sidebar-panel')
      if (!layout || !card || !rail || !panel) return null
      const rect = (node) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
      return {
        hasRail: card.classList.contains('has-rail'),
        collapsed: card.classList.contains('is-collapsed'),
        expanded: layout.classList.contains('is-sidebar-visible'),
        visibility: getComputedStyle(card).visibility,
        card: rect(card), rail: rect(rail),
        actionCount: rail.querySelectorAll('.sidebar-rail-action').length,
        panelInert: panel.hasAttribute('inert')
      }
    })()`,
  );
  assert.ok(state, `${context}: sidebar card, rail, and panel are mounted`);
  assert.equal(state.hasRail, true, `${context}: tab mode keeps the icon rail`);
  assert.equal(state.visibility, "visible", `${context}: sidebar is visible`);
  assert.equal(state.actionCount, 4, `${context}: rail actions are present`);
  assert.ok(
    Math.abs(state.card.x) <= TOLERANCE &&
      Math.abs(state.card.y) <= TOLERANCE &&
      Math.abs(state.card.width - expectedWidth) <= TOLERANCE &&
      Math.abs(state.card.height - windowHeight) <= TOLERANCE,
    `${context}: ${expanded ? "expanded" : "collapsed"} card geometry ${JSON.stringify(state.card)}`,
  );
  assert.ok(
    state.rail.width > 0 &&
      Math.abs(state.rail.y + state.rail.height - windowHeight) <= TOLERANCE,
    `${context}: icon rail reaches the bottom edge`,
  );
  assert.equal(state.collapsed, !expanded, `${context}: collapsed state`);
  assert.equal(state.expanded, expanded, `${context}: expanded state`);
  assert.equal(
    state.panelInert,
    !expanded,
    `${context}: panel interaction state`,
  );
  if (screenshotDirectory) {
    const image = await view.webContents.capturePage();
    writeFileSync(
      join(
        screenshotDirectory,
        `sidebar-webcontents-${which}-${expanded ? "expanded" : "collapsed"}.png`,
      ),
      image.toPNG(),
    );
  }
  return state;
}

async function verifyCollapsedAndExpanded(win, liveUrl) {
  const tabs = await api(win, "tabs.get()");
  const local =
    tabs.find((tab) => tab.url.startsWith("surffish://")) ?? tabs[0];
  await api(win, `tabs.create(${JSON.stringify(liveUrl)})`);
  const live = await waitFor(
    async () =>
      (await api(win, "tabs.get()")).find(
        (tab) => tab.url === liveUrl && !tab.loading,
      ),
    "the collapsed-rail live tab",
  );

  for (const [which, tabId] of [
    ["content", local.id],
    ["sidebar", live.id],
  ]) {
    await api(win, `tabs.activate(${JSON.stringify(tabId)})`);
    await api(
      win,
      "chrome.set({ sidebarMode: 'tabs', sidebarPinned: false, sidebarHovered: false, sidebarFocused: false })",
    );
    const view = surface(win, which);
    const open = which === "content";
    await waitFor(
      () =>
        open
          ? view.getVisible() && !surface(win, "sidebar").getVisible()
          : view.getVisible() && view.getBounds().width > 0,
      `${which} collapsed rail surface`,
    );
    await waitFor(async () => {
      const state = await evaluate(
        view,
        'Boolean(document.querySelector(".browser-sidebar.has-rail.is-collapsed"))',
      );
      return state;
    }, `${which} collapsed rail DOM`);
    await settle();
    await assertSidebarState(win, which, `${which} collapsed`, false);
    captureWindow(win, `sidebar-${which}-collapsed.png`);

    await evaluate(
      view,
      'document.querySelector(".sidebar-rail-pin")?.click()',
    );
    const { sidebarWidth } = await api(win, "chrome.get()");
    const [windowWidth] = win.getContentSize();
    const expandedWidth = Math.min(sidebarWidth, windowWidth - 48);
    if (which === "sidebar")
      await waitFor(
        () => view.getBounds().width >= expandedWidth - TOLERANCE,
        "overlay sidebar to expand from the rail",
      );
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            view,
            'Boolean(document.querySelector(".browser-layout.is-sidebar-visible .browser-sidebar.has-rail:not(.is-collapsed)"))',
          ),
        ),
      `${which} expanded panel DOM`,
    );
    await settle();
    await assertSidebarState(win, which, `${which} expanded`, true);
    captureWindow(win, `sidebar-${which}-expanded.png`);

    await api(
      win,
      "chrome.set({ sidebarPinned: false, sidebarHovered: false, sidebarFocused: false })",
    );
    if (which === "sidebar")
      await waitFor(
        () => view.getBounds().width <= 76 + TOLERANCE,
        "overlay sidebar to return to the collapsed rail",
      );
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            view,
            'Boolean(document.querySelector(".browser-sidebar.has-rail.is-collapsed"))',
          ),
        ),
      `${which} rail restored after closing the panel`,
    );
    await settle();
    await assertSidebarState(win, which, `${which} collapsed again`, false);
  }
}

async function run() {
  app.setPath("userData", userData);
  mkdirSync(userData, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(userData, smoke.ADBLOCK_CACHE_FILE),
    ElectronBlocker.parse(
      "||surffish-smoke-never-match.invalid^",
      smoke.ADBLOCK_CONFIG,
    ).serialize(),
  );
  const now = Date.now();
  writeFileSync(
    join(userData, "new-tab-photo-cache.json"),
    `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`,
  );
  await new Promise((resolvePromise) =>
    server.listen(0, "127.0.0.1", resolvePromise),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;

  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();
  const win = await waitFor(() => windows()[0], "the main window", 45000);
  win.setBounds({ x: 0, y: 0, width: 1280, height: 800 });
  await ready(win);
  const mode = (await api(win, "sidebarBackdrop.get()")).state.mode;
  assert.equal(
    mode,
    process.env.SURFFISH_SIDEBAR_BACKDROP ||
      (process.platform === "darwin" ? "native" : "solid"),
    "the expected backdrop path",
  );
  await verifyCollapsedAndExpanded(win, `${origin}/collapsed-rail`);

  await compare(win, {
    context: "docked",
    liveUrl: `${origin}/a`,
    chrome: { sidebarPinned: true },
    shot: `sidebar-card-${label}-docked`,
  });
  await compare(win, {
    context: "hover",
    liveUrl: `${origin}/a`,
    chrome: { sidebarHovered: true },
    shot: `sidebar-card-${label}-hover`,
  });
  // The smallest window with the widest sidebar.
  win.setBounds({ x: 0, y: 0, width: 800, height: 600 });
  await delay(300);
  await compare(win, {
    context: "small window, wide sidebar",
    liveUrl: `${origin}/a`,
    chrome: { sidebarPinned: true, sidebarWidth: 520 },
    shot: `sidebar-card-${label}-small`,
  });
  await api(win, "chrome.set({ sidebarWidth: 320 })");
  win.setBounds({ x: 0, y: 0, width: 1280, height: 800 });
  await delay(300);

  // Spaces on: the Space colour rule along the top keeps the card's own inset shadows.
  assert.equal(await api(win, "spaces.setEnabled(true)"), true);
  await waitFor(
    () =>
      evaluate(
        surface(win, "sidebar"),
        'Boolean(document.querySelector(".browser-sidebar.has-spaces"))',
      ),
    "the Spaces card",
  );
  await compare(win, {
    context: "spaces",
    liveUrl: `${origin}/b`,
    chrome: { sidebarPinned: true },
    shot: `sidebar-card-${label}-spaces`,
  });
  const spacesShadow = await evaluate(
    surface(win, "sidebar"),
    'getComputedStyle(document.querySelector(".browser-sidebar")).boxShadow',
  );
  assert.ok(
    (spacesShadow.match(/inset/g) || []).length >= 3,
    `Spaces keeps the card shadows (${spacesShadow})`,
  );

  // A private window.
  await api(win, "tabs.newWindow(true)");
  const privateWindow = await waitFor(
    () => windows().find((candidate) => candidate !== win),
    "the private window",
  );
  privateWindow.setBounds({ x: 0, y: 0, width: 1280, height: 800 });
  await ready(privateWindow);
  await waitFor(
    async () =>
      (await api(privateWindow, "tabs.get()")).some((tab) => tab.private),
    "a private tab",
  );
  await compare(privateWindow, {
    context: "private",
    liveUrl: `${origin}/p`,
    chrome: { sidebarPinned: true },
    shot: `sidebar-card-${label}-private`,
  });
  assert.ok(
    (
      await evaluate(
        surface(privateWindow, "sidebar"),
        'document.querySelector(".browser-sidebar").className',
      )
    ).includes("is-private-window"),
  );

  console.log(`SIDEBAR_CARD_RESULTS ${JSON.stringify(results)}`);
  console.log("Electron sidebar card smoke passed.");
}

run().then(
  () => app.exit(0),
  (error) => {
    console.error("Electron sidebar card smoke failed:", error);
    app.exit(1);
  },
);
