// Integration smoke for per-tab volume, against the production build:
//   0. The speaker follows audibility (shared/tab-audio.ts): a muted autoplay video (X's timeline)
//      shows no speaker in the sidebar row or the mini window header; unmuting it shows the playing
//      speaker; pausing clears it within ~2 s (the row keeps a hover-only idle control); muting the
//      tab shows the muted speaker; navigating away forgets it.
//   1. A page with an <audio> and a <video> (page volume 0.8 / 1), one in an open shadow root, a
//      detached `new Audio()`, a cross-site iframe (its own process) with an <audio> and Web Audio,
//      and a main-frame AudioContext (an oscillator to the destination, and a media element the page
//      routes into Web Audio). Setting the tab to 50% plays every element at page volume × 50% in
//      every frame (read natively, from an isolated world over CDP) while the page still reads its
//      own values; the AudioContext's destination gets a gain at 0.5; the routed element is left at
//      the page's volume (the gain turns it down once); the page sees no volumechange for our writes
//      and one for its own; bad values still throw; volume 0 is not mute.
//   2. A frame that starts later (reload) gets the level at once (asked on first media use; pages with
//      no media never ask); the level is remembered per site
//      (a second tab on the same site gets it, another site starts at 100%, coming back restores it).
//   3. The sidebar row of a playing tab has the speaker with a hover slider; the wheel steps it 5%.
//   4. ⌘K Volume Up / Volume Down step 10%.
//   5. Pop the tab out to a mini window: the level stays; the header shows the speaker (single tab)
//      and its slider sets the level; a second tab joins (grouping 'tabs'): the playing tab's strip chip
//      has the speaker (wheel, click mutes), the header's goes; returning keeps it; Hibernate Tab and
//      waking keeps it.
//   6. Private tabs use the saved level but never save theirs; Settings → Privacy → Tab volume lists
//      and resets (open tabs go back to 100%).
// `bun run build && bun run test:electron-tab-volume`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-tab-volume-smoke.cjs`).
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
  ipcMain,
  webContents: allWebContents,
} = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

// No sound card on CI; players still play. Media may start without a gesture (the fixture plays on load).
app.commandLine.appendSwitch("disable-audio-output");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const userData = join(tmpdir(), `surffish-tab-volume-smoke-${process.pid}`);

const TONE = `
  const rate = 8000, samples = rate
  const bytes = new Uint8Array(44 + samples * 2), view = new DataView(bytes.buffer)
  const text = (offset, value) => { for (let i = 0; i < value.length; i += 1) bytes[offset + i] = value.charCodeAt(i) }
  text(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, samples * 2, true)
  for (let i = 0; i < samples; i += 1) view.setInt16(44 + i * 2, Math.sin(i / rate * 2 * Math.PI * 440) * 3000, true)
  const toneUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))`;

const MEDIA_PAGE = (
  frameOrigin,
) => `<!doctype html><meta charset="utf-8"><title>Volume fixture</title>
<audio id="a" loop></audio><video id="v"></video><div id="host"></div>
<iframe id="f" src="${frameOrigin}/frame" width="300" height="80"></iframe>
<script>
  ${TONE}
  const a = document.getElementById('a')
  a.src = toneUrl
  a.volume = 0.8
  window.changes = 0
  a.addEventListener('volumechange', () => { window.changes += 1 })
  const root = document.getElementById('host').attachShadow({ mode: 'open' })
  root.innerHTML = '<audio id="s"></audio>'
  root.getElementById('s').volume = 0.6
  window.det = new Audio()
  window.det.volume = 0.5
  window.attachDetached = () => { window.det.id = 'det'; document.body.append(window.det); return true }
  const ctx = new AudioContext()
  window.ctx = ctx
  const osc = ctx.createOscillator()
  window.connectReturnsDestination = osc.connect(ctx.destination) === ctx.destination
  osc.start()
  const routed = document.createElement('audio')
  routed.id = 'r'
  document.body.append(routed)
  ctx.createMediaElementSource(routed).connect(ctx.destination)
  routed.volume = 0.9
  a.play().catch(() => {})
</script>`;

const MUTED_PAGE = `<!doctype html><meta charset="utf-8"><title>Muted autoplay</title>
<video id="mv" muted autoplay loop playsinline width="160" height="90"></video>
<script>
  ${TONE}
  const mv = document.getElementById('mv')
  mv.src = toneUrl
  mv.play().catch(() => {})
</script>`;

const FRAME_PAGE = `<!doctype html><meta charset="utf-8"><title>Frame</title><audio id="fa"></audio>
<script>
  document.getElementById('fa').volume = 0.7
  const ctx = new AudioContext()
  ctx.createOscillator().connect(ctx.destination)
</script>`;

let frameOrigin = "";
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  const body =
    path === "/media"
      ? MEDIA_PAGE(frameOrigin)
      : path === "/muted"
        ? MUTED_PAGE
        : path === "/frame"
          ? FRAME_PAGE
          : `<!doctype html><meta charset="utf-8"><title>Fixture ${path.slice(1)}</title><p>${path}</p>`;
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(body);
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
    await delay(50);
  }
  throw new Error(
    `Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError}` : ""}`,
  );
}

const surfaceFor = (view) => {
  try {
    return new URL(view.webContents.getURL()).searchParams.get("surface");
  } catch {
    return null;
  }
};
const liveContents = () =>
  allWebContents
    .getAllWebContents()
    .filter((contents) => !contents.isDestroyed());
const close = (a, b) => typeof a === "number" && Math.abs(a - b) < 0.011;
const isMiniHeader = (contents) =>
  contents.getURL().startsWith("data:text/html") &&
  decodeURIComponent(contents.getURL()).includes("<title>Mini Window</title>");

/**
 * Native (unwrapped) reads over CDP: an isolated world sees the real HTMLMediaElement getter. Cross-site
 * iframes are separate targets, reached with auto-attach.
 */
function inspector(contents) {
  const dbg = contents.debugger;
  dbg.attach("1.3");
  const children = [];
  dbg.on("message", (_event, method, params) => {
    if (
      method === "Target.attachedToTarget" &&
      params.targetInfo.type === "iframe"
    )
      children.push(params.sessionId);
  });
  const send = (method, params = {}, sessionId) =>
    dbg.sendCommand(method, params, sessionId);
  const isolatedEval = async (expression, sessionId) => {
    const { frameTree } = await send("Page.getFrameTree", {}, sessionId);
    const { executionContextId } = await send(
      "Page.createIsolatedWorld",
      { frameId: frameTree.frame.id, worldName: "surffish-smoke" },
      sessionId,
    );
    const { result, exceptionDetails } = await send(
      "Runtime.evaluate",
      { expression, contextId: executionContextId, returnByValue: true },
      sessionId,
    );
    if (exceptionDetails)
      throw new Error(
        exceptionDetails.exception?.description ?? exceptionDetails.text,
      );
    return result.value;
  };
  return {
    ready: () =>
      send("Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
      }),
    native: (expression) => isolatedEval(expression),
    frameNative: async (expression) => {
      for (const sessionId of children) {
        try {
          return await isolatedEval(expression, sessionId);
        } catch {
          /* a gone frame */
        }
      }
      throw new Error("no iframe target");
    },
    /** Every GainNode in the page's main world (the page makes none of its own). */
    gains: async () => {
      const { result: proto } = await send("Runtime.evaluate", {
        expression: "GainNode.prototype",
      });
      const { objects } = await send("Runtime.queryObjects", {
        prototypeObjectId: proto.objectId,
      });
      const { result } = await send("Runtime.callFunctionOn", {
        objectId: objects.objectId,
        functionDeclaration:
          "function () { return this.map((gain) => gain.gain.value) }",
        returnByValue: true,
      });
      return result.value;
    },
    detach: () => {
      try {
        dbg.detach();
      } catch {
        /* gone */
      }
    },
  };
}

const NATIVE = `(() => {
  const read = (el) => el ? Math.round(el.volume * 1000) / 1000 : null
  return { a: read(document.getElementById('a')), v: read(document.getElementById('v')), s: read(document.getElementById('host').shadowRoot?.getElementById('s')), det: read(document.getElementById('det')), r: read(document.getElementById('r')) }
})()`;
const PAGE_SEES = `({ a: document.getElementById('a').volume, v: document.getElementById('v').volume, s: document.getElementById('host').shadowRoot.getElementById('s').volume, det: window.det.volume, r: document.getElementById('r').volume })`;

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
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  frameOrigin = `http://localhost:${port}`;
  const url = (name) => `${origin}/${name}`;
  writeFileSync(
    join(userData, "browser-session.json"),
    JSON.stringify({ version: 1, tabs: [url("start")], activeIndex: 0 }),
  );

  // Which pages asked main for their level (only frames that use media should).
  const asks = [];
  ipcMain.on("surffish:tab-volume:get", (event) => {
    try {
      asks.push(event.senderFrame?.url ?? "");
    } catch {
      asks.push("");
    }
  });
  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();
  const mainWindow = await waitFor(
    () => BaseWindow.getAllWindows()[0],
    "the main window",
  );
  mainWindow.setBounds({ x: 0, y: 0, width: 1200, height: 800 });
  const surface = (name) =>
    mainWindow.contentView.children.find(
      (view) =>
        view.webContents &&
        !view.webContents.isDestroyed() &&
        surfaceFor(view) === name,
    );
  await waitFor(
    () => surface("toolbar") && surface("content"),
    "the renderer surfaces",
  );
  const toolbar = surface("toolbar").webContents;
  const content = surface("content").webContents;
  await waitFor(
    () =>
      smoke.evaluate(
        toolbar,
        'document.readyState === "complete" && Boolean(window.api)',
      ),
    "the toolbar renderer",
  );
  await waitFor(
    () =>
      smoke.evaluate(
        content,
        'document.readyState === "complete" && Boolean(window.api)',
      ),
    "the content renderer",
  );
  const api = (call) => smoke.evaluate(toolbar, `window.api.browser.${call}`);
  const tabs = () => api("tabs.get()");
  const tabAt = async (target) =>
    (await tabs()).find((tab) => tab.url === target);
  const runCommand = (id) => api(`commands.run(${JSON.stringify(id)})`);
  const setVolume = (id, volume) =>
    api(`tabs.setVolume(${JSON.stringify(id)}, ${volume})`);
  const pageFor = (target) =>
    waitFor(
      () =>
        liveContents().find(
          (contents) => contents.getURL() === target && !contents.isLoading(),
        ),
      `the page ${target}`,
    );
  const ready = async (page) => {
    await waitFor(
      () =>
        smoke.evaluate(
          page,
          'document.readyState === "complete" && typeof window.attachDetached === "function"',
        ),
      "the fixture",
    );
    await waitFor(
      () =>
        page.mainFrame.framesInSubtree.some(
          (frame) => frame.url === `${frameOrigin}/frame`,
        ),
      "the cross-site iframe",
    );
  };

  // --- 0. The speaker follows audibility, not "media started playing".
  smoke.step(
    "muted autoplay video: no speaker; unmute shows it; pause clears it; mute shows muted; navigation forgets",
  );
  {
    await api(`tabs.create(${JSON.stringify(url("muted"))})`);
    const mutedTab = await waitFor(
      () => tabAt(url("muted")),
      "the muted autoplay tab",
    );
    const mutedPage = await pageFor(url("muted"));
    await waitFor(
      () =>
        smoke.evaluate(
          mutedPage,
          'document.getElementById("mv").currentTime > 0.2 && !document.getElementById("mv").paused',
        ),
      "the muted video playing",
    );
    const summary = async () =>
      (await tabs()).find((entry) => entry.id === mutedTab.id);
    const sidebarView = surface("sidebar")?.webContents;
    const rowSel = `document.querySelector('.tab-list [data-browser-tab-id=${JSON.stringify(JSON.stringify(mutedTab.id)).slice(1, -1)}]')`;
    const rowAudio = () =>
      sidebarView
        ? smoke.evaluate(
            sidebarView,
            `(() => { const v = ${rowSel}?.querySelector('.tab-volume'); return v ? { audio: v.dataset.audio, display: getComputedStyle(v).display, playing: Boolean(v.querySelector('.tab-audio-button.is-playing')) } : null })()`,
          )
        : Promise.resolve(undefined);
    if (sidebarView)
      await waitFor(
        () => smoke.evaluate(sidebarView, `Boolean(${rowSel})`),
        "the muted tab row",
      );
    await delay(1500);
    let entry = await summary();
    assert.equal(
      mutedPage.isCurrentlyAudible(),
      false,
      "Chromium: a muted video is not audible",
    );
    assert.equal(entry.audible, false, "muted autoplay: not audible");
    assert.equal(entry.audioHeard, undefined, "muted autoplay: never heard");
    if (sidebarView)
      assert.equal(
        await rowAudio(),
        null,
        "muted autoplay: no speaker on the row",
      );

    // Mini window (single tab): no speaker in the header either.
    await api(`tabs.activate(${JSON.stringify(mutedTab.id)})`);
    await waitFor(
      async () =>
        (await tabs()).find((candidate) => candidate.active)?.id ===
        mutedTab.id,
      "the muted tab active",
    );
    await runCommand("miniWindow.popOut");
    const mutedHeader = await waitFor(
      () =>
        liveContents().find(
          (contents) => isMiniHeader(contents) && !contents.isLoading(),
        ),
      "the mini window header",
    );
    const headerAudio = () =>
      smoke.evaluate(
        mutedHeader,
        '(() => { const v = document.getElementById("vol"); return { audio: v.dataset.audio ?? null, shown: v.classList.contains("shown"), display: getComputedStyle(v).display } })()',
      );
    await waitFor(
      async () => (await headerAudio()).audio === "none",
      "the mini header has no speaker for muted autoplay",
    );
    assert.equal((await headerAudio()).shown, false);
    await smoke.evaluate(
      mutedPage,
      'document.getElementById("mv").muted = false; true',
    );
    await waitFor(async () => {
      const h = await headerAudio();
      return h.audio === "playing" && h.shown && h.display !== "none";
    }, "the mini header speaker once unmuted");
    await smoke.evaluate(
      mutedPage,
      'document.getElementById("mv").muted = true; true',
    );
    await waitFor(
      async () => (await headerAudio()).audio === "idle",
      "the mini header speaker goes idle (hover only) when silent again",
    );
    assert.equal(
      (await headerAudio()).shown,
      false,
      "idle is not the active speaker",
    );
    await smoke.evaluate(mutedHeader, "window.miniWindow.returnAll(); true");
    await waitFor(
      () => !liveContents().some(isMiniHeader),
      "Return All closes the mini window",
    );
    await waitFor(
      async () => Boolean(await summary()),
      "the muted tab back in the browser",
    );

    smoke.step(
      "unmuted: the playing speaker; paused: gone within ~2 s; tab mute: muted speaker",
    );
    await smoke.evaluate(
      mutedPage,
      'document.getElementById("mv").muted = false; document.getElementById("mv").play().then(() => true)',
    );
    await waitFor(
      async () => (await summary())?.audible === true,
      "audible once unmuted",
    );
    if (sidebarView)
      await waitFor(async () => {
        const r = await rowAudio();
        return r?.audio === "playing" && r.playing && r.display !== "none";
      }, "the playing speaker on the row");
    const pausedAt = Date.now();
    await smoke.evaluate(
      mutedPage,
      'document.getElementById("mv").pause(); true',
    );
    await waitFor(
      async () => (await summary())?.audible === false,
      "not audible after pausing",
      4000,
    );
    const quietMs = Date.now() - pausedAt;
    console.log(`  speaker cleared ${quietMs} ms after pause`);
    assert.ok(
      quietMs < 2500,
      `the speaker clears within ~2 s of pausing (${quietMs} ms)`,
    );
    entry = await summary();
    assert.equal(entry.audioHeard, true, "heard since load");
    if (sidebarView)
      await waitFor(async () => {
        const r = await rowAudio();
        return r?.audio === "idle" && !r.playing && r.display === "none";
      }, "the row keeps a hidden, hover-only control");
    assert.equal(
      await api(`tabs.setMuted(${JSON.stringify(mutedTab.id)}, true)`),
      true,
    );
    await waitFor(async () => (await summary())?.muted === true, "tab muted");
    if (sidebarView)
      await waitFor(async () => {
        const r = await rowAudio();
        return r?.audio === "muted" && r.display !== "none";
      }, "the muted speaker on the row");
    await api(`tabs.setMuted(${JSON.stringify(mutedTab.id)}, false)`);
    if (sidebarView)
      await waitFor(
        async () => (await rowAudio())?.audio === "idle",
        "unmuting the quiet tab: back to idle",
      );

    smoke.step("navigating away forgets the heard state");
    await mutedPage.loadURL(url("start"));
    await waitFor(async () => {
      const e = await summary();
      return (
        e?.url === url("start") &&
        e.audioHeard === undefined &&
        e.audible === false
      );
    }, "a new document starts unheard");
    if (sidebarView)
      await waitFor(
        async () => (await rowAudio()) === null,
        "no speaker on the row after navigating",
      );
    await api(`tabs.close(${JSON.stringify(mutedTab.id)})`);
  }

  // --- 1. One tab, every kind of audio.
  smoke.step(
    "tab at 50%: every element and frame plays at page × 50%; the page still sees its own volume",
  );
  await api(`tabs.create(${JSON.stringify(url("media"))})`);
  const tab = await waitFor(() => tabAt(url("media")), "the media tab");
  let page = await pageFor(url("media"));
  await ready(page);
  let cdp = inspector(page);
  await cdp.ready();
  await waitFor(async () => {
    try {
      return close(
        await cdp.frameNative('document.getElementById("fa").volume'),
        0.7,
      );
    } catch {
      return false;
    }
  }, "the iframe target over CDP");
  assert.equal(
    await smoke.evaluate(page, "window.connectReturnsDestination"),
    true,
    "connect() still returns the destination",
  );
  assert.deepEqual(
    await cdp.gains(),
    [1],
    "one gain in front of the destination, at 100%",
  );
  const changesBefore = await smoke.evaluate(page, "window.changes");

  assert.equal(await setVolume(tab.id, 0.5), true);
  assert.equal(
    (await tabAt(url("media"))).volume,
    0.5,
    "the tab list carries the level",
  );
  await smoke.evaluate(page, "window.attachDetached()");
  const native = await waitFor(async () => {
    const value = await cdp.native(NATIVE);
    return close(value.a, 0.4) ? value : null;
  }, "the main frame at 50%");
  assert.ok(close(native.v, 0.5), `video: ${native.v}`);
  assert.ok(close(native.s, 0.3), `shadow DOM audio: ${native.s}`);
  assert.ok(close(native.det, 0.25), `detached new Audio(): ${native.det}`);
  assert.ok(
    close(native.r, 0.9),
    `routed into Web Audio: left at the page's volume (${native.r})`,
  );
  await waitFor(
    async () =>
      close(
        await cdp.frameNative('document.getElementById("fa").volume'),
        0.35,
      ),
    "the cross-site iframe at 50%",
  );
  assert.ok(
    close(
      await page.mainFrame.framesInSubtree
        .find((frame) => frame.url === `${frameOrigin}/frame`)
        .executeJavaScript('document.getElementById("fa").volume'),
      0.7,
    ),
    "the iframe page still sees 0.7",
  );
  assert.deepEqual(
    await smoke.evaluate(page, PAGE_SEES),
    { a: 0.8, v: 1, s: 0.6, det: 0.5, r: 0.9 },
    "page-reported volumes are the page's own",
  );
  await waitFor(async () => {
    const gains = await cdp.gains();
    return gains.length === 1 && close(gains[0], 0.5);
  }, "the Web Audio gain at 0.5");
  await delay(200);
  assert.equal(
    await smoke.evaluate(page, "window.changes"),
    changesBefore,
    "no volumechange for our own writes",
  );

  smoke.step(
    "the page sets its own volume: scaled, one event; bad values still throw; 0 is not mute",
  );
  await smoke.evaluate(page, 'document.getElementById("a").volume = 0.6; true');
  await waitFor(
    async () => close((await cdp.native(NATIVE)).a, 0.3),
    "page volume 0.6 × 50%",
  );
  assert.equal(
    await smoke.evaluate(page, 'document.getElementById("a").volume'),
    0.6,
  );
  await waitFor(
    async () =>
      (await smoke.evaluate(page, "window.changes")) === changesBefore + 1,
    "one volumechange for the page's own change",
  );
  assert.equal(
    await smoke.evaluate(
      page,
      '(() => { try { document.getElementById("a").volume = 2; return "no error" } catch (error) { return error.name } })()',
    ),
    "IndexSizeError",
  );
  assert.equal(
    await smoke.evaluate(
      page,
      '(() => { try { document.getElementById("a").volume = NaN; return "no error" } catch (error) { return error.name } })()',
    ),
    "TypeError",
  );
  assert.equal(await setVolume(tab.id, 0), true);
  await waitFor(async () => {
    const value = await cdp.native(NATIVE);
    return value.a === 0 && value.v === 0 && value.det === 0;
  }, "everything at 0");
  assert.equal(page.isAudioMuted(), false, "volume 0 is not mute");
  await smoke.evaluate(page, 'document.getElementById("a").volume = 0.2; true');
  await waitFor(
    async () =>
      (await smoke.evaluate(page, "window.changes")) === changesBefore + 2,
    "the page still gets volumechange at tab volume 0",
  );
  assert.equal(
    await smoke.evaluate(page, 'document.getElementById("a").volume'),
    0.2,
  );
  await waitFor(async () => {
    const gains = await cdp.gains();
    return gains.length === 1 && gains[0] < 0.01;
  }, "the gain at 0");
  cdp.detach();

  // --- 2. New frames, per-site memory.
  smoke.step(
    "a reload gets the level at once; per-site memory across tabs and navigations",
  );
  assert.equal(await setVolume(tab.id, 0.4), true);
  page.reload();
  page = await waitFor(async () => {
    const contents = await pageFor(url("media"));
    return (await smoke.evaluate(
      contents,
      'typeof window.attachDetached === "function"',
    ))
      ? contents
      : null;
  }, "the reloaded page");
  await ready(page);
  cdp = inspector(page);
  await cdp.ready();
  assert.ok(
    close((await cdp.native(NATIVE)).a, 0.32),
    "the reloaded page plays at 0.8 × 40% from the start",
  );
  await waitFor(async () => {
    try {
      return close(
        await cdp.frameNative('document.getElementById("fa").volume'),
        0.28,
      );
    } catch {
      return false;
    }
  }, "the reloaded iframe at 40%");
  cdp.detach();
  await waitFor(
    async () =>
      (await api("siteVolume.list()")).some(
        (site) => site.origin === origin && site.volume === 0.4,
      ),
    "the level saved for the site",
  );
  await api(`tabs.create(${JSON.stringify(`${origin}/other`)})`);
  await waitFor(
    async () => (await tabAt(`${origin}/other`))?.volume === 0.4,
    "a second tab on the same site starts at its saved level",
  );
  await pageFor(`${origin}/other`);
  await delay(200);
  assert.ok(
    asks.some((frame) => frame === url("media")),
    "the media page asked for its level",
  );
  assert.ok(
    !asks.some(
      (frame) => frame === `${origin}/other` || frame === url("start"),
    ),
    `pages without media never ask (${JSON.stringify(asks)})`,
  );
  await api(`tabs.activate(${JSON.stringify(tab.id)})`);
  await page.loadURL(`${frameOrigin}/elsewhere`);
  await waitFor(
    async () =>
      (await tabs()).find((entry) => entry.id === tab.id)?.volume === undefined,
    "another site starts at 100%",
  );
  page.navigationHistory.goBack();
  await waitFor(
    async () =>
      (await tabs()).find((entry) => entry.id === tab.id)?.volume === 0.4,
    "coming back restores the site's level",
  );
  page = await pageFor(url("media"));
  await ready(page);

  // --- 3. Sidebar speaker.
  smoke.step(
    "the sidebar row shows the speaker with a hover slider; the wheel steps 5%",
  );
  await waitFor(
    async () =>
      (await tabs()).find((entry) => entry.id === tab.id)?.audible === true,
    "the tab to count as audible",
  );
  const sidebar = surface("sidebar")?.webContents;
  if (sidebar) {
    const row = `document.querySelector('.tab-list [data-browser-tab-id=${JSON.stringify(JSON.stringify(tab.id)).slice(1, -1)}]')`;
    await waitFor(
      () =>
        smoke.evaluate(
          sidebar,
          `Boolean(${row}?.querySelector('.tab-volume .tab-audio-button') && ${row}?.querySelector('.tab-volume input[type=range]'))`,
        ),
      "the speaker and slider on the row",
    );
    assert.equal(
      await smoke.evaluate(
        sidebar,
        `${row}.querySelector('.tab-volume input').value`,
      ),
      "40",
    );
    await smoke.evaluate(
      sidebar,
      `${row}.querySelector('.tab-volume').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, deltaMode: 1, bubbles: true, cancelable: true })); true`,
    );
    await waitFor(
      async () =>
        (await tabs()).find((entry) => entry.id === tab.id)?.volume === 0.45,
      "wheel up: 45%",
    );
  } else {
    smoke.step("(no docked sidebar surface; skipped the row check)");
    await setVolume(tab.id, 0.45);
  }

  // --- 4. Palette commands.
  smoke.step("⌘K Volume Up / Volume Down");
  await runCommand("tab.volumeUp");
  await waitFor(
    async () =>
      (await tabs()).find((entry) => entry.id === tab.id)?.volume === 0.55,
    "Volume Up: 55%",
  );
  await runCommand("tab.volumeDown");
  await runCommand("tab.volumeDown");
  await waitFor(
    async () =>
      (await tabs()).find((entry) => entry.id === tab.id)?.volume === 0.35,
    "Volume Down twice: 35%",
  );

  // --- 5. Mini window, sleep.
  smoke.step(
    "mini window: the level stays; the header speaker sets it; back and through hibernate it stays",
  );
  await runCommand("miniWindow.popOut");
  const header = await waitFor(
    () =>
      liveContents().find(
        (contents) => isMiniHeader(contents) && !contents.isLoading(),
      ),
    "the mini window header",
  );
  cdp = inspector(page);
  await cdp.ready();
  assert.ok(
    close((await cdp.native(NATIVE)).a, 0.8 * 0.35),
    "unchanged after the move (no reload)",
  );
  await waitFor(
    () =>
      smoke.evaluate(
        header,
        'document.getElementById("vol").classList.contains("shown") && document.querySelector("#vol input").value === "35"',
      ),
    "the header speaker at 35%",
  );
  await smoke.evaluate(
    header,
    `window.miniWindow.setVolume(${JSON.stringify(tab.id)}, 0.2); true`,
  );
  await waitFor(
    async () => close((await cdp.native(NATIVE)).a, 0.16),
    "the header slider sets the level",
  );
  await waitFor(
    () =>
      smoke.evaluate(
        header,
        'document.querySelector("#vol input").value === "20"',
      ),
    "the header shows 20%",
  );
  cdp.detach();
  // A second tab joins (grouping 'tabs'): the strip's chip for the playing tab has the speaker, the other's doesn't, the header's goes.
  const other = await tabAt(`${origin}/other`);
  await api(`tabs.activate(${JSON.stringify(other.id)})`);
  await waitFor(
    async () => (await tabs()).find((entry) => entry.active)?.id === other.id,
    "the other tab active",
  );
  await runCommand("miniWindow.popOut");
  const chip = (id) =>
    `document.querySelector('.tab[data-tab-id=${JSON.stringify(JSON.stringify(id)).slice(1, -1)}] .vol')`;
  await waitFor(
    () =>
      smoke.evaluate(
        header,
        `document.body.classList.contains('tabbed') && ${chip(tab.id)}?.classList.contains('shown') === true && ${chip(other.id)}?.classList.contains('shown') === false && !document.getElementById('vol').classList.contains('shown')`,
      ),
    "the chip speaker on the playing tab only",
  );
  assert.equal(
    await smoke.evaluate(
      header,
      `${chip(tab.id)}.querySelector('input').value`,
    ),
    "20",
  );
  await smoke.evaluate(
    header,
    `${chip(tab.id)}.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, deltaMode: 0, bubbles: true, cancelable: true })); true`,
  );
  await waitFor(
    () =>
      smoke.evaluate(
        header,
        `${chip(tab.id)}.querySelector('input').value === '25'`,
      ),
    "chip wheel up: 25%",
  );
  await smoke.evaluate(
    header,
    `${chip(tab.id)}.querySelector('.spk').click(); true`,
  );
  await waitFor(() => page.isAudioMuted(), "the chip speaker click mutes");
  await waitFor(
    () => smoke.evaluate(header, `${chip(tab.id)}.classList.contains('muted')`),
    "the chip shows muted",
  );
  await smoke.evaluate(
    header,
    `${chip(tab.id)}.querySelector('.spk').click(); true`,
  );
  await waitFor(() => !page.isAudioMuted(), "and unmutes");
  await smoke.evaluate(
    header,
    `window.miniWindow.setVolume(${JSON.stringify(tab.id)}, 0.2); true`,
  );
  await smoke.evaluate(header, `window.miniWindow.returnAll(); true`);
  await waitFor(
    () => !liveContents().some(isMiniHeader),
    "Return All closes the mini window",
  );
  await runCommand("miniWindow.return");
  await waitFor(
    async () =>
      !liveContents().some(isMiniHeader) ||
      (await tabs()).some((entry) => entry.id === tab.id),
    "back in the browser",
  );
  await waitFor(
    async () =>
      (await tabs()).find((entry) => entry.id === tab.id)?.volume === 0.2,
    "still 20% after returning",
  );
  // An audible tab only sleeps after a minute; pause first, like the media session smoke.
  await smoke.evaluate(
    page,
    'document.getElementById("a").pause(); window.ctx.suspend().then(() => true)',
  );
  await waitFor(() => !page.isCurrentlyAudible(), "the tab to go quiet");
  await api(
    `tabs.activate(${JSON.stringify((await tabAt(`${origin}/other`)).id)})`,
  );
  assert.equal(
    await api(`diagnostics.discardTab(${JSON.stringify(tab.id)})`),
    true,
  );
  await waitFor(
    async () => (await tabs()).find((entry) => entry.id === tab.id)?.sleeping,
    "hibernated",
  );
  await api(`tabs.activate(${JSON.stringify(tab.id)})`);
  page = await pageFor(url("media"));
  await ready(page);
  cdp = inspector(page);
  await cdp.ready();
  await waitFor(
    async () => close((await cdp.native(NATIVE)).a, 0.16),
    "woken at 20%",
  );
  cdp.detach();

  // --- 6. Private tabs, settings reset.
  smoke.step(
    "private tabs use the saved level and never save theirs; Settings resets",
  );
  await api(`tabs.createPrivate(${JSON.stringify(url("media"))})`);
  const privateTab = await waitFor(
    async () =>
      (await tabs()).find(
        (entry) =>
          entry.private && entry.url === url("media") && entry.volume === 0.2,
      ),
    "the private tab at the saved level",
  );
  assert.equal(await setVolume(privateTab.id, 0.9), true);
  await delay(300);
  assert.deepEqual(
    (await api("siteVolume.list()")).find((site) => site.origin === origin)
      ?.volume,
    0.2,
    "the private change is not saved",
  );
  await api(`tabs.close(${JSON.stringify(privateTab.id)})`);
  assert.deepEqual(
    await smoke.evaluate(content, "window.api.browser.siteVolume.reset(null)"),
    [],
    "Reset all forgets every site",
  );
  await waitFor(
    async () =>
      (await tabs()).find((entry) => entry.id === tab.id)?.volume === undefined,
    "the open tab goes back to 100%",
  );
  cdp = inspector(page);
  await cdp.ready();
  await waitFor(
    async () => close((await cdp.native(NATIVE)).a, 0.8),
    "the page plays at its own volume again",
  );
  cdp.detach();

  console.log("Electron tab volume smoke passed.");
}

run().then(
  () => app.exit(0),
  (error) => {
    console.error("Electron tab volume smoke failed:", error);
    app.exit(1);
  },
);
