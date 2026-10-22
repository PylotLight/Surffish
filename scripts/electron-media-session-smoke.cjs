// Integration smoke for paused media sessions (Now Playing / media keys): a background tab whose
// media the user paused keeps its page (and so Chromium's MediaSession) through timed tab sleep
// and auto-archive, while an idle tab without media still sleeps / archives. Hibernate Tab
// (manual) still sleeps it. Only a session that was heard is kept: a muted autoplay video (X's
// timeline) fires media-started-playing too, and that tab sleeps like any idle one. Runs the production build:
// `bun run build && bun run test:electron-media-session`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-media-session-smoke.cjs`).
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BaseWindow, webContents } = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

// Fake audio output: CI runners have no sound card (avoids ALSA errors; players still play and pause).
app.commandLine.appendSwitch("disable-audio-output");

const userData = join(tmpdir(), `surffish-media-session-smoke-${process.pid}`);

// A looping one-second tone built in the page (no media files, no range requests), with Media
// Session metadata like YouTube sets.
const MEDIA_PAGE = `<!doctype html><meta charset="utf-8"><title>Fixture media</title>
<audio id="player" loop></audio>
<script>
  const rate = 8000, samples = rate
  const bytes = new Uint8Array(44 + samples * 2), view = new DataView(bytes.buffer)
  const text = (offset, value) => { for (let i = 0; i < value.length; i += 1) bytes[offset + i] = value.charCodeAt(i) }
  text(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, samples * 2, true)
  for (let i = 0; i < samples; i += 1) view.setInt16(44 + i * 2, Math.sin(i / rate * 2 * Math.PI * 440) * 8000, true)
  document.getElementById('player').src = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
  navigator.mediaSession.metadata = new MediaMetadata({ title: 'Smoke tone', artist: 'Surffish' })
  const player = document.getElementById('player')
  player.addEventListener('play', () => { navigator.mediaSession.playbackState = 'playing' })
  player.addEventListener('pause', () => { navigator.mediaSession.playbackState = 'paused' })
</script>`;

// The same tone in a muted, looping autoplay <video> (muted autoplay needs no gesture), like a
// timeline clip on X: Chromium fires media-started-playing but the page is never audible.
const MUTED_PAGE = MEDIA_PAGE.replace(
  "<title>Fixture media</title>",
  "<title>Fixture muted</title>",
)
  .replace(
    '<audio id="player" loop></audio>',
    '<video id="player" muted autoplay loop playsinline width="160" height="90"></video>',
  )
  .replace(
    "</script>",
    'document.getElementById("player").play().catch(() => {})\n</script>',
  );

const server = createServer((request, response) => {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  const name = (request.url || "/").slice(1).replace(/[^\w-]/g, "") || "root";
  response.end(
    name === "media"
      ? MEDIA_PAGE
      : name === "muted"
        ? MUTED_PAGE
        : `<!doctype html><meta charset="utf-8"><title>Fixture ${name}</title><p>${name}</p>`,
  );
});

let mainWindow;
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

function surfaceFor(view) {
  try {
    return new URL(view.webContents.getURL()).searchParams.get("surface");
  } catch {
    return null;
  }
}

const views = () =>
  mainWindow.contentView.children.filter(
    (view) => view.webContents && !view.webContents.isDestroyed(),
  );
const surface = (name) => views().find((view) => surfaceFor(view) === name);

async function evaluate(target, expression, userGesture = false) {
  const contents = target.webContents ?? target;
  try {
    return await contents.executeJavaScript(expression, userGesture);
  } catch (error) {
    throw new Error(`${expression.slice(0, 120)}: ${error.message}`);
  }
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
  const url = (name) => `${origin}/${name}`;
  writeFileSync(
    join(userData, "browser-session.json"),
    JSON.stringify({ version: 1, tabs: [url("idle")], activeIndex: 0 }),
  );

  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();
  mainWindow = await waitFor(
    () => BaseWindow.getAllWindows()[0],
    "the main window",
  );
  mainWindow.setBounds({ x: 0, y: 0, width: 1100, height: 760 });
  await waitFor(() => surface("toolbar"), "the toolbar surface");
  const toolbar = surface("toolbar");
  await waitFor(
    () =>
      evaluate(
        toolbar,
        'document.readyState === "complete" && Boolean(window.api)',
      ),
    "the toolbar renderer",
  );
  const tabs = () => evaluate(toolbar, "window.api.browser.tabs.get()");
  const tabFor = async (name) =>
    (await tabs()).find((tab) => tab.url === url(name));
  await waitFor(
    async () => (await tabFor("idle"))?.title === "Fixture idle",
    "the idle tab",
  );

  // --- play then pause in the media tab while it is on screen, then send it to the background
  await evaluate(
    toolbar,
    `window.api.browser.tabs.create(${JSON.stringify(url("media"))})`,
  );
  await waitFor(
    async () => (await tabFor("media"))?.title === "Fixture media",
    "the media tab",
  );
  const page = await waitFor(
    () =>
      webContents
        .getAllWebContents()
        .find(
          (contents) =>
            !contents.isDestroyed() && contents.getURL() === url("media"),
        ),
    "the media page",
  );
  let started = false;
  let paused = false;
  page.on("media-started-playing", () => {
    started = true;
  });
  page.on("media-paused", () => {
    paused = true;
  });
  await evaluate(
    page,
    'document.getElementById("player").play().then(() => true)',
    true,
  );
  await waitFor(
    () => started,
    "media-started-playing (no audio output under xvfb?)",
  );
  // The hold needs a session that was heard (the speaker's audibility, not just "media played").
  await waitFor(
    () => page.isCurrentlyAudible(),
    "the playing tone to count as audible",
  );

  // --- a muted autoplay video tab (X's timeline): plays, never audible
  await evaluate(
    toolbar,
    `window.api.browser.tabs.create(${JSON.stringify(url("muted"))})`,
  );
  await waitFor(
    async () => (await tabFor("muted"))?.title === "Fixture muted",
    "the muted autoplay tab",
  );
  const mutedPage = await waitFor(
    () =>
      webContents
        .getAllWebContents()
        .find(
          (contents) =>
            !contents.isDestroyed() && contents.getURL() === url("muted"),
        ),
    "the muted autoplay page",
  );
  await waitFor(
    () =>
      evaluate(
        mutedPage,
        'document.getElementById("player").currentTime > 0.2 && !document.getElementById("player").paused',
      ),
    "the muted video playing",
  );
  assert.equal(
    mutedPage.isCurrentlyAudible(),
    false,
    "Chromium: a muted video is not audible",
  );
  assert.equal(
    (await tabFor("muted")).audible,
    false,
    "muted autoplay: no speaker",
  );
  await evaluate(
    toolbar,
    `window.api.browser.tabs.create(${JSON.stringify(url("front"))})`,
  );
  await waitFor(async () => (await tabFor("front"))?.active, "the front tab");

  // --- 13 hours later (past any tab-sleep delay and the 12h auto-archive) the user pauses it from
  // the background, the way a media key does
  const realNow = Date.now;
  let offset = 13 * 3_600_000;
  Date.now = () => realNow() + offset;
  try {
    await evaluate(page, 'document.getElementById("player").pause()');
    await waitFor(() => paused, "media-paused");
    await waitFor(
      () => !page.isCurrentlyAudible(),
      "the paused tab to stop counting as audible",
    );
    // The muted clip (re)starts in the background now, so a media-started-playing hold would still be
    // live (Chromium may pause hidden muted video again; that pause used to hold 6h too). A minute
    // later its start grace is over.
    let mutedStarted = false;
    mutedPage.on("media-started-playing", () => {
      mutedStarted = true;
    });
    await evaluate(
      mutedPage,
      'document.getElementById("player").pause(); document.getElementById("player").play().then(() => true)',
    );
    await waitFor(
      () => mutedStarted,
      "the muted clip to start again in the background",
    );
    assert.equal(
      mutedPage.isCurrentlyAudible(),
      false,
      "the muted clip is still not audible",
    );
    offset += 60_000;
    // Re-arms every background tab's sleep timer; both are long overdue so they fire at once.
    await evaluate(toolbar, "window.api.browser.setTabSleepMinutes(5)");
    await waitFor(
      async () => (await tabFor("idle"))?.sleeping,
      "the idle tab to sleep",
    );
    // Muted-only autoplay holds nothing (it used to keep the tab awake for six hours).
    await waitFor(
      async () => (await tabFor("muted"))?.sleeping,
      "the muted autoplay tab to sleep",
    );
    await delay(500);
    const media = await tabFor("media");
    assert.equal(
      media.sleeping,
      false,
      "the paused media tab stays awake through timed tab sleep",
    );
    assert.ok(!page.isDestroyed(), "the paused media page still exists");
    assert.equal(
      await evaluate(page, "navigator.mediaSession.playbackState"),
      "paused",
    );
    assert.equal(
      await evaluate(page, 'document.getElementById("player").paused'),
      true,
      "the player is still there, paused",
    );

    // --- auto-archive (12h) takes the idle tab but not the paused media tab
    await evaluate(
      toolbar,
      'window.api.browser.tabArchive.setSettings({ archiveAfter: "12h", prompted: true })',
    );
    await waitFor(
      async () => !(await tabFor("idle")),
      "the idle tab to be archived",
    );
    await delay(300);
    assert.ok(
      await tabFor("media"),
      "the paused media tab is not auto-archived",
    );
    await evaluate(
      toolbar,
      'window.api.browser.tabArchive.setSettings({ archiveAfter: "off" })',
    );

    // --- resuming in the background works (what a media key does), and Hibernate Tab still sleeps it
    started = false;
    await evaluate(
      page,
      'document.getElementById("player").play().then(() => true)',
      true,
    );
    await waitFor(() => started, "background resume");
    await evaluate(page, 'document.getElementById("player").pause()');
    await waitFor(
      () => !page.isCurrentlyAudible(),
      "the resumed tab to go quiet again",
    );
    assert.equal(
      await evaluate(
        toolbar,
        `window.api.browser.diagnostics.discardTab(${JSON.stringify(media.id)})`,
      ),
      true,
    );
    await waitFor(
      async () => (await tabFor("media"))?.sleeping,
      "Hibernate Tab to sleep the paused media tab",
    );
  } finally {
    Date.now = realNow;
  }

  console.log("Electron media session smoke passed.");
}

run().then(
  () => app.exit(0),
  (error) => {
    console.error("Electron media session smoke failed:", error);
    app.exit(1);
  },
);
