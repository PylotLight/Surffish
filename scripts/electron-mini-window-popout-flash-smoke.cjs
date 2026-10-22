// Integration smoke: the menu bar popout's always-on strip stays still while its pages churn, against
// the production build. Three tabs share one menu bar popout (grouping 'tabs'): two chat-like pages and
// a music page. While nothing the strip shows changes, it must get zero DOM writes, zero favicon <img>
// src writes and zero setBounds calls on any window or view:
//   1. Active chat tab "streaming": same-document pushState (did-start/stop-loading, did-navigate-in-page),
//      a chunked fetch stream, its icon <link> re-inserted with the same href (page-favicon-updated),
//      and the same title re-set, many times a second. (A same-document load used to re-read the icon,
//      flipping the tab's favicon between its http URL and the cached data: URL twice per load, and
//      each flip rebuilt every chip in the strip, reloading every favicon: the strip blinked.)
//   2. The same churn in a background chat tab.
//   3. The music tab's sound flapping on and off (audibility; skipped where nothing is audible).
//   4. A background tab really retitles once: only that chip's label is written (no chip rebuilt, no
//      favicon reloaded), and the strip's other chips keep their elements.
// `bun run build && bun run test:electron-mini-window-popout-flash`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-mini-window-popout-flash-smoke.cjs`).
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  app,
  BaseWindow,
  View,
  webContents: allWebContents,
} = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const userData = join(
  tmpdir(),
  `surffish-mini-window-popout-flash-smoke-${process.pid}`,
);
const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M1 8l14-7-4 14-3-5z" fill="#fff" stroke="#000"/></svg>';
const PAGE = (
  name,
) => `<!doctype html><meta charset="utf-8"><link rel="icon" href="/icon.svg"><title>${name}</title>
<body><p>${name}</p><iframe id="frame" hidden src="/frame"></iframe><script>
// A live connection (server-sent events) open the whole time.
addEventListener('load', () => setTimeout(() => { window.events = new EventSource('/sse') }, 100))
window.loadId = Math.random()
window.churnTimer = 0
// A chat app streaming a reply: same-document navigations, a streamed fetch, the icon link re-added, the same title.
window.startChurn = () => {
  clearInterval(window.churnTimer)
  let n = 0
  window.churnTimer = setInterval(() => {
    n += 1
    history.pushState({ n }, '', location.pathname)
    if (n % 3 === 0) fetch('/stream').then((r) => r.text()).catch(() => {})
    // A hidden frame reloading (did-start/stop-loading for a subframe) every half second.
    if (n % 8 === 0) document.getElementById('frame').src = '/frame?' + n
    const link = document.querySelector('link[rel=icon]')
    const again = link.cloneNode(); link.remove(); document.head.append(again)
    document.title = document.title
  }, 60)
  return true
}
window.stopChurn = () => { clearInterval(window.churnTimer); return true }
window.startAudio = async () => { try { const ctx = new AudioContext(); const osc = ctx.createOscillator(); const gain = ctx.createGain(); gain.gain.value = 0.05; osc.connect(gain).connect(ctx.destination); osc.start(); await ctx.resume(); window.tone = { ctx, gain }; return ctx.state === 'running' } catch (error) { return String(error) } }
window.flapAudio = () => { let on = true; clearInterval(window.flapTimer); window.flapTimer = setInterval(() => { on = !on; window.tone.gain.gain.value = on ? 0.05 : 0 }, 150); return true }
window.stopFlap = () => { clearInterval(window.flapTimer); window.tone.gain.gain.value = 0.05; return true }
</script></body>`;
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/icon.svg" || path === "/icon2.svg") {
    // A real site's icon is a network round trip away (main re-fetches it to cache it as a data: URL).
    setTimeout(() => {
      response.writeHead(200, {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "no-store",
      });
      response.end(
        path === "/icon2.svg" ? ICON.replace("#fff", "#e5484d") : ICON,
      );
    }, 150);
    return;
  }
  if (path === "/frame") {
    response.writeHead(200, {
      "Content-Type": "text/html",
      "Cache-Control": "no-store",
    });
    return response.end("<!doctype html><title>frame</title>");
  }
  if (path === "/sse") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
    });
    const timer = setInterval(() => response.write("data: tick\n\n"), 100);
    request.on("close", () => clearInterval(timer));
    return;
  }
  if (path === "/stream") {
    response.writeHead(200, {
      "Content-Type": "text/plain",
      "Cache-Control": "no-store",
    });
    let i = 0;
    const timer = setInterval(() => {
      response.write(`token ${i}\n`);
      if (++i === 5) {
        clearInterval(timer);
        response.end();
      }
    }, 20);
    return;
  }
  const page = /^\/(chat1|chat2|music)$/.exec(path);
  const names = {
    chat1: "ChatGPT",
    chat2: "ChatGPT Two",
    music: "YouTube Music",
  };
  const body =
    path === "/start"
      ? "<!doctype html><title>Start</title><p>start</p>"
      : page
        ? PAGE(names[page[1]])
        : null;
  response.writeHead(body ? 200 : 404, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(body ?? "not found");
});

const delay = (ms) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
async function waitFor(predicate, description, timeout = smoke.waitMs) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(25);
  }
  throw new Error(
    `Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError}` : ""}`,
  );
}

const liveContents = () =>
  allWebContents
    .getAllWebContents()
    .filter((contents) => !contents.isDestroyed());
const pageContents = (predicate) =>
  liveContents().find((contents) => predicate(contents.getURL(), contents));
const isMiniHeader = (contents) =>
  contents.getURL().startsWith("data:text/html") &&
  decodeURIComponent(contents.getURL()).includes("<title>Mini Window</title>");
const allWindows = () =>
  BaseWindow.getAllWindows().filter((win) => !win.isDestroyed());
const miniWindows = () =>
  allWindows().filter((win) => /(^| — )Mini Window$/.test(win.getTitle()));
const viewOf = (win, contents) =>
  win.contentView.children.find((view) => view.webContents === contents);
const headerOf = (win) =>
  win.contentView.children.find(
    (view) =>
      view.webContents &&
      !view.webContents.isDestroyed() &&
      isMiniHeader(view.webContents),
  )?.webContents;
const surfaceFor = (view) => {
  try {
    return new URL(view.webContents.getURL()).searchParams.get("surface");
  } catch {
    return null;
  }
};

// Every setBounds on a window or view (main's layout, the strip, the page).
let setBoundsCalls = [];
for (const proto of [View.prototype, BaseWindow.prototype]) {
  const original = proto.setBounds;
  proto.setBounds = function (...args) {
    setBoundsCalls.push(this.constructor?.name ?? "view");
    return original.apply(this, args);
  };
}

async function run() {
  app.setPath("userData", userData);
  mkdirSync(userData, { recursive: true, mode: 0o700 });
  const blocker = ElectronBlocker.parse(
    "||surffish-smoke-never-match.invalid^",
    smoke.ADBLOCK_CONFIG,
  );
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), blocker.serialize(), {
    mode: 0o600,
  });
  const now = Date.now();
  writeFileSync(
    join(userData, "new-tab-photo-cache.json"),
    `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`,
  );
  await new Promise((resolvePromise) =>
    server.listen(0, "127.0.0.1", resolvePromise),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  writeFileSync(
    join(userData, "browser-session.json"),
    JSON.stringify({ version: 1, tabs: [`${origin}/start`], activeIndex: 0 }),
  );
  writeFileSync(
    join(userData, "browser-mini-window.json"),
    JSON.stringify({
      defaultUrl: "",
      shortcut: "CommandOrControl+Shift+Space",
      opacity: 1,
      tuckToEdge: true,
      peekOnHover: true,
      peekDelayMs: 350,
      grouping: "tabs",
      headerPlacement: "float",
      menuBarIcon: "in-use",
    }),
  );

  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();
  const mainWindow = await waitFor(() => allWindows()[0], "the main window");
  mainWindow.setBounds({ x: 0, y: 0, width: 900, height: 700 });
  const surface = (win, name) =>
    win.contentView.children.find(
      (view) =>
        view.webContents &&
        !view.webContents.isDestroyed() &&
        surfaceFor(view) === name,
    );
  await waitFor(
    () => surface(mainWindow, "content") && surface(mainWindow, "toolbar"),
    "the renderer surfaces",
  );
  const toolbar = surface(mainWindow, "toolbar").webContents;
  await waitFor(
    () =>
      smoke.evaluate(
        toolbar,
        'document.readyState === "complete" && Boolean(window.api)',
      ),
    "the toolbar renderer",
  );
  const tabs = () => smoke.evaluate(toolbar, "window.api.browser.tabs.get()");
  const runCommand = (id) =>
    smoke.evaluate(
      toolbar,
      `window.api.browser.commands.run(${JSON.stringify(id)})`,
    );
  const bar = () => globalThis.__surffishMiniMenuBar;

  smoke.step("three tabs (music, two chats) in one menu bar popout strip");
  const pages = {};
  for (const name of ["music", "chat1", "chat2"]) {
    await smoke.evaluate(
      toolbar,
      `window.api.browser.tabs.create(${JSON.stringify(`${origin}/${name}`)})`,
    );
    const contents = await waitFor(
      () =>
        pageContents((url, c) => url === `${origin}/${name}` && !c.isLoading()),
      `page ${name}`,
    );
    await waitFor(
      () =>
        smoke.evaluate(
          contents,
          'document.readyState === "complete" && typeof window.loadId === "number"',
        ),
      `${name} ready`,
    );
    pages[name] = {
      contents,
      id: (await tabs()).find((tab) => tab.url === `${origin}/${name}`).id,
    };
  }
  const activate = async (entry) => {
    await smoke.evaluate(
      toolbar,
      `window.api.browser.tabs.activate(${JSON.stringify(entry.id)})`,
    );
    await waitFor(
      async () => (await tabs()).find((tab) => tab.active)?.id === entry.id,
      "tab active",
    );
  };
  await activate(pages.music);
  await runCommand("miniWindow.popOut");
  const win = await waitFor(
    () => miniWindows().find((w) => viewOf(w, pages.music.contents)),
    "music in a mini window",
  );
  await runCommand("miniWindow.menuBar");
  await waitFor(() => bar()?.exists(), "the menu bar icon");
  for (const name of ["chat1", "chat2"]) {
    await activate(pages[name]);
    await delay(300);
    await runCommand("miniWindow.menuBar");
    await waitFor(
      () => viewOf(win, pages[name].contents),
      `${name} joined the popout`,
    );
  }
  await waitFor(() => win.isVisible(), "the popout shows");
  const header = await waitFor(() => headerOf(win), "the popout strip");
  await waitFor(
    () =>
      smoke.evaluate(
        header,
        'document.body.classList.contains("popout") && document.querySelectorAll("#bar .tab").length === 3 && document.querySelectorAll("#bar .tab img").length === 3',
      ),
    "three chips with favicons",
  );
  // Each chat already has history (Back enabled), as a real chat does once it has been used.
  for (const name of ["chat1", "chat2"])
    await smoke.evaluate(
      pages[name].contents,
      'history.pushState(null, "", location.pathname); true',
    );
  const played = await pages.music.contents.executeJavaScript(
    "window.startAudio()",
    true,
  );
  // Let favicons settle (fetched, cached as data: URLs) and the audio state land.
  await delay(1500);

  // Instrument the strip: DOM mutations, favicon <img> src writes, chip elements replaced, state pushes.
  await smoke.evaluate(
    header,
    `(() => {
    window.__log = { mutations: 0, srcWrites: 0, chipsReplaced: 0, detail: [] }
    window.__chips = new Map([...document.querySelectorAll('#bar .tab')].map((el) => [el.dataset.tabId, el]))
    window.__observer = new MutationObserver((records) => { for (const r of records) {
      window.__log.mutations += 1
      if (r.type === 'attributes' && r.attributeName === 'src') window.__log.srcWrites += 1
      if (r.type === 'childList') for (const node of r.addedNodes) if (node.nodeType === 1) window.__log.srcWrites += (node.tagName === 'IMG' ? 1 : 0) + node.querySelectorAll('img').length
      if (window.__log.detail.length < 12) window.__log.detail.push(r.type + ' ' + (r.target.id || r.target.className || r.target.nodeName) + ' ' + (r.attributeName || ''))
    } })
    window.__observer.observe(document.body, { subtree: true, attributes: true, childList: true, characterData: true }); return true })()`,
  );
  let sends = 0;
  const send = header.send.bind(header);
  header.send = (channel, ...args) => {
    if (channel === "mini-window:state") sends += 1;
    return send(channel, ...args);
  };
  const take = async () => {
    const strip = await smoke.evaluate(
      header,
      `(() => { const l = window.__log; const chips = [...document.querySelectorAll('#bar .tab')]
      const replaced = chips.filter((el) => window.__chips.get(el.dataset.tabId) !== el).length
      const out = { mutations: l.mutations, srcWrites: l.srcWrites, chipsReplaced: replaced, detail: l.detail }
      window.__log = { mutations: 0, srcWrites: 0, chipsReplaced: 0, detail: [] }; window.__chips = new Map(chips.map((el) => [el.dataset.tabId, el])); return out })()`,
    );
    const out = { ...strip, setBounds: setBoundsCalls.length, sends };
    setBoundsCalls = [];
    sends = 0;
    return out;
  };
  const results = {};
  await take();

  const quiet = async (label, start, stop) => {
    await start();
    await delay(2500);
    await stop();
    await delay(600);
    results[label] = await take();
    console.log(`[flash] ${label}: ${JSON.stringify(results[label])}`);
  };

  const events = {};
  for (const name of [
    "did-start-loading",
    "did-stop-loading",
    "did-navigate-in-page",
    "page-favicon-updated",
    "page-title-updated",
    "audio-state-changed",
  ])
    pages.chat2.contents.on(name, () => {
      events[name] = (events[name] ?? 0) + 1;
    });
  if (process.env.FLASH_DEBUG)
    console.log(
      "[flash] icons",
      await smoke.evaluate(
        header,
        '[...document.querySelectorAll("#bar .tab img")].map((i) => i.src.slice(0, 40)).join(" , ")',
      ),
    );
  smoke.step(
    "1. active chat tab streaming (pushState, fetch stream, icon link re-added, same title)",
  );
  await quiet(
    "active-chat-churn",
    () => smoke.evaluate(pages.chat2.contents, "window.startChurn()"),
    () => smoke.evaluate(pages.chat2.contents, "window.stopChurn()"),
  );
  if (process.env.FLASH_DEBUG)
    console.log("[flash] chat2 events", JSON.stringify(events));
  smoke.step("2. the same churn in a background chat tab");
  await quiet(
    "background-chat-churn",
    () => smoke.evaluate(pages.chat1.contents, "window.startChurn()"),
    () => smoke.evaluate(pages.chat1.contents, "window.stopChurn()"),
  );
  if (played === true && pages.music.contents.isCurrentlyAudible()) {
    smoke.step("3. the music tab flapping audible / quiet");
    await quiet(
      "audio-flap",
      () => smoke.evaluate(pages.music.contents, "window.flapAudio()"),
      () => smoke.evaluate(pages.music.contents, "window.stopFlap()"),
    );
  } else {
    smoke.step(
      `note: nothing audible on this runner (${played}); skipping the audio flap`,
    );
  }

  smoke.step("4. a background tab retitles once: only its label is written");
  await smoke.evaluate(
    pages.chat1.contents,
    'document.title = "Renamed chat"; true',
  );
  await waitFor(
    () =>
      smoke.evaluate(
        header,
        '[...document.querySelectorAll("#bar .tab .label")].some((el) => el.textContent === "Renamed chat")',
      ),
    "the new title on its chip",
  );
  await delay(600);
  results["background-retitle"] = await take();
  console.log(
    `[flash] background-retitle: ${JSON.stringify(results["background-retitle"])}`,
  );

  smoke.step(
    "5. a tab really changes its icon: that chip swaps to the new one, once, with no blank in between",
  );
  const iconOf = (index) =>
    smoke.evaluate(
      header,
      `document.querySelectorAll("#bar .tab")[${index}].querySelector("img")?.getAttribute("src") ?? ""`,
    );
  const before = await iconOf(1);
  await smoke.evaluate(
    pages.chat1.contents,
    'document.querySelector("link[rel=icon]").href = "/icon2.svg"; true',
  );
  await waitFor(async () => {
    const src = await iconOf(1);
    return src !== before && src.startsWith("data:image/svg+xml");
  }, "the new icon (its cached copy) on the chip");
  await delay(600);
  results["icon-change"] = await take();
  console.log(`[flash] icon-change: ${JSON.stringify(results["icon-change"])}`);

  if (process.env.FLASH_MEASURE_ONLY !== "1") {
    for (const label of [
      "active-chat-churn",
      "background-chat-churn",
      "audio-flap",
    ]) {
      const r = results[label];
      if (!r) continue;
      assert.equal(
        r.mutations,
        0,
        `${label}: no strip DOM writes while nothing it shows changes (${r.detail.join(" | ")})`,
      );
      assert.equal(r.srcWrites, 0, `${label}: no favicon reloads`);
      assert.equal(r.setBounds, 0, `${label}: no setBounds`);
    }
    const r = results["background-retitle"];
    assert.equal(r.srcWrites, 0, "retitle: no favicon reloads");
    assert.equal(r.chipsReplaced, 0, "retitle: no chip rebuilt");
    assert.equal(r.setBounds, 0, "retitle: no setBounds");
    assert.ok(
      r.mutations <= 3,
      `retitle: only the label (and its tooltip) written (${r.mutations}: ${r.detail.join(" | ")})`,
    );
    const icon = results["icon-change"];
    assert.equal(
      icon.srcWrites,
      1,
      `icon change: one src write on that chip (${icon.detail.join(" | ")})`,
    );
    assert.equal(icon.chipsReplaced, 0, "icon change: no chip rebuilt");
  }

  smoke.step("Return All leaves nothing behind");
  await runCommand("miniWindow.return");
  await waitFor(() => miniWindows().length === 0, "all closed");
  server.closeAllConnections?.();
  console.log("Electron mini window popout flash smoke passed.");
}

run().then(
  () => app.exit(0),
  (error) => {
    console.error("Electron mini window popout flash smoke failed:", error);
    app.exit(1);
  },
);
